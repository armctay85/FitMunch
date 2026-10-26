'use strict';

/**
 * Resend inbound support forward: Svix fail-closed, recipient filter,
 * one forward per received email id, loop guard.
 */
const crypto = require('crypto');
const request = require('supertest');

const app = require('./server.js');
const stripeEvents = require('./lib/stripe-events');
const {
  RELAY_FROM,
  RELAY_MARKER,
  SUBJECT_PREFIX,
  MAX_ATTACHMENT_RAW_BYTES,
  verifySvixSignature,
  recipientsIncludeSupport,
  handleResendInbound,
} = require('./lib/resend-inbound');

const SVIX_BODY = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const SECRET = `whsec_${SVIX_BODY}`;
const NOW = 1700000000000;
const TS = 1700000000;
const EMAIL_ID = '56761188-7520-42d8-8898-ff6fc54ce618';
const BODY_MARKER = 'BODY_SHOULD_NOT_BE_LOGGED_9f3a';
const SEND_URL = 'https://api.resend.com/emails';

const ORIGINAL_ENV = {
  RESEND_INBOUND_WEBHOOK_SECRET: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
  SUPPORT_FORWARD_TO: process.env.SUPPORT_FORWARD_TO,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function sign(raw, timestampSec = TS, secret = SECRET, id = 'msg_inbound_test') {
  const b64 = String(secret).startsWith('whsec_') ? String(secret).slice('whsec_'.length) : String(secret);
  const key = Buffer.from(b64, 'base64');
  const ts = String(timestampSec);
  const digest = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': `v1,${digest}`,
  };
}

function receivedEvent(dataOverrides = {}, type = 'email.received') {
  return {
    type,
    created_at: '2026-10-22T09:00:00.000Z',
    data: {
      email_id: EMAIL_ID,
      from: 'ada@example.com',
      to: ['Support Team <Support@FitMunch.com.au>'],
      cc: [],
      bcc: ['hidden@example.com'],
      subject: 'Need a hand',
      ...dataOverrides,
    },
  };
}

function receivedEmail(overrides = {}) {
  return {
    object: 'email',
    id: EMAIL_ID,
    from: 'ada@example.com',
    to: ['support@fitmunch.com.au'],
    cc: [],
    subject: 'Need a hand',
    html: `<p>${BODY_MARKER}</p>`,
    text: BODY_MARKER,
    headers: {
      from: 'Ada Lovelace <ada@example.com>',
      to: 'support@fitmunch.com.au',
      date: 'Tue, 22 Oct 2026 09:00:00 +0000',
    },
    created_at: '2026-10-22T09:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

function testEnv(overrides = {}) {
  return {
    RESEND_INBOUND_WEBHOOK_SECRET: SECRET,
    SUPPORT_FORWARD_TO: 'ops@example.com',
    RESEND_API_KEY: 're_test_inbound',
    DATABASE_URL: 'postgres://unused/fm',
    ...overrides,
  };
}

function memoryClaims() {
  const rows = new Map();
  return {
    rows,
    async claim(key) {
      const row = rows.get(key);
      if (!row) {
        rows.set(key, 'pending');
        return { claimed: true };
      }
      if (row === 'sent') return { claimed: false, sent: true };
      return { claimed: false, inProgress: true };
    },
    async markSent(key) {
      rows.set(key, 'sent');
    },
    async release(key) {
      if (rows.get(key) !== 'sent') rows.delete(key);
    },
  };
}

function bytesOf(text) {
  const buf = Buffer.from(text);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function jsonResult(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockFetch({ email, attachments = [], fileText = 'hello-file', sendStatus = 200, sendBody = { id: 'sent_1' }, onSend } = {}) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, opts = {}) => {
    const href = String(url);
    calls.push({ href, opts });
    if (href.includes('/attachments')) return jsonResult(200, { object: 'list', has_more: false, data: attachments });
    if (href.includes('/emails/receiving/')) return jsonResult(200, email);
    if (href.includes('inbound-cdn.resend.com')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? String(Buffer.byteLength(fileText)) : null) },
        arrayBuffer: async () => bytesOf(fileText),
        json: async () => ({}),
      };
    }
    if (href === SEND_URL) {
      const body = JSON.parse(opts.body);
      if (onSend) onSend(body, opts.headers);
      return jsonResult(sendStatus, sendBody);
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  return { fetchImpl, calls };
}

function attachmentRow() {
  return {
    id: '2a0c9ce0-3112-4728-976e-47ddcd16a318',
    filename: 'note.txt',
    size: 10,
    content_type: 'text/plain',
    content_disposition: 'attachment',
    content_id: '<note-1>',
    download_url: 'https://inbound-cdn.resend.com/note.txt',
  };
}

async function postInbound(event, options = {}) {
  const raw = typeof event === 'string' ? event : JSON.stringify(event);
  const now = options.now == null ? NOW : options.now;
  const headers = options.headers || sign(raw, Math.floor(now / 1000), options.secret || SECRET);
  return handleResendInbound(
    { body: Buffer.from(raw), headers },
    {
      env: options.env || testEnv(),
      claims: options.claims,
      fetch: options.fetchImpl,
      now,
    }
  );
}

function logged() {
  return ['log', 'warn', 'error', 'info']
    .flatMap((level) => (console[level].mock ? console[level].mock.calls : []))
    .map((args) => args.join(' '))
    .join('\n');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv();
  jest.restoreAllMocks();
  global.fetch.mockReset();
  global.fetch.mockImplementation(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }));
});

describe('Svix signature', () => {
  test('accepts the published Svix vector inside the tolerance window', () => {
    const raw = '{"test": 2432232314}';
    const headers = {
      'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'svix-timestamp': '1614265330',
      'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    };
    const now = 1614265330 * 1000;
    expect(verifySvixSignature(raw, headers, SECRET, now)).toBe(true);
    expect(verifySvixSignature(raw, headers, SVIX_BODY, now)).toBe(true);
    const multi = { ...headers, 'svix-signature': `v1,not-the-signature ${headers['svix-signature']}` };
    expect(verifySvixSignature(raw, multi, SECRET, now)).toBe(true);
  });

  test('rejects a stale timestamp, a future timestamp, and a bad signature', () => {
    const raw = '{"test": 2432232314}';
    const headers = {
      'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'svix-timestamp': '1614265330',
      'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    };
    expect(verifySvixSignature(raw, headers, SECRET, 1614265330 * 1000 + 6 * 60 * 1000)).toBe(false);
    expect(verifySvixSignature(raw, headers, SECRET, 1614265330 * 1000 - 6 * 60 * 1000)).toBe(false);
    expect(verifySvixSignature(`${raw} `, headers, SECRET, 1614265330 * 1000)).toBe(false);
    expect(verifySvixSignature(raw, { ...headers, 'svix-signature': 'v1,aaaa' }, SECRET, 1614265330 * 1000)).toBe(false);
    expect(verifySvixSignature(raw, headers, '', 1614265330 * 1000)).toBe(false);
  });
});

describe('POST /api/resend-inbound signature fail-closed', () => {
  function routePost(raw, headers) {
    return request(app)
      .post('/api/resend-inbound')
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  test('401 when the signing secret is missing', async () => {
    delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    const raw = JSON.stringify(receivedEvent({ to: ['hello@fitmunch.com.au'] }));
    const res = await routePost(raw, sign(raw));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain(raw);
  });

  test('401 when the signature, timestamp, or headers are invalid', async () => {
    process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
    const raw = JSON.stringify(receivedEvent({ to: ['hello@fitmunch.com.au'] }));
    const nowSec = Math.floor(Date.now() / 1000);
    const fresh = sign(raw, nowSec);
    const bad = await routePost(raw, { ...fresh, 'svix-signature': 'v1,aaaa' });
    expect(bad.status).toBe(401);

    const stale = await routePost(raw, sign(raw, nowSec - 10 * 60));
    expect(stale.status).toBe(401);

    const future = await routePost(raw, sign(raw, nowSec + 10 * 60));
    expect(future.status).toBe(401);

    const missing = await routePost(raw, { 'svix-id': 'msg_x', 'svix-timestamp': String(nowSec) });
    expect(missing.status).toBe(401);
    expect(logged()).not.toContain(SVIX_BODY);
  });

  test('valid signature for a non-support recipient returns 200 and does not fetch', async () => {
    process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
    process.env.SUPPORT_FORWARD_TO = 'ops@example.com';
    global.fetch.mockClear();
    const raw = JSON.stringify(receivedEvent({ to: ['hello@fitmunch.com.au'], cc: ['dmarc@fitmunch.com.au'] }));
    const headers = sign(raw, Math.floor(Date.now() / 1000));
    const res = await routePost(raw, headers);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('recipient filter', () => {
  test('matches support@ on to or cc, case-insensitive, and ignores hello, dmarc, and bcc', () => {
    expect(recipientsIncludeSupport({ to: ['Support@FitMunch.com.au'] })).toBe(true);
    expect(recipientsIncludeSupport({ to: ['FitMunch <support@fitmunch.com.au>'] })).toBe(true);
    expect(recipientsIncludeSupport({ to: ['hello@fitmunch.com.au'], cc: ['support@fitmunch.com.au'] })).toBe(true);
    expect(recipientsIncludeSupport({ to: ['hello@fitmunch.com.au'], cc: ['dmarc@fitmunch.com.au'] })).toBe(false);
    expect(recipientsIncludeSupport({ to: ['hello@fitmunch.com.au'], bcc: ['support@fitmunch.com.au'] })).toBe(false);
  });

  test.each([
    ['hello@fitmunch.com.au', []],
    ['dmarc@fitmunch.com.au', ['hello@fitmunch.com.au']],
    ['FitMunch <hello@fitmunch.com.au>', ['dmarc@fitmunch.com.au']],
  ])('skips %s without fetching', async (to, cc) => {
    const fetchImpl = jest.fn();
    const res = await postInbound(receivedEvent({ to: [to], cc }), { fetchImpl, claims: memoryClaims() });
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('bcc-only support is not forwarded', async () => {
    const fetchImpl = jest.fn();
    const res = await postInbound(
      receivedEvent({ to: ['hello@fitmunch.com.au'], cc: [], bcc: ['support@fitmunch.com.au'] }),
      { fetchImpl, claims: memoryClaims() }
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('other event types return 200', async () => {
    const fetchImpl = jest.fn();
    const res = await postInbound(receivedEvent({}, 'email.delivered'), { fetchImpl, claims: memoryClaims() });
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('forward payload', () => {
  test('forwards once with reply-to, subject prefix, preamble, and attachments', async () => {
    const claims = memoryClaims();
    const sent = [];
    const email = receivedEmail({
      attachments: [{ id: attachmentRow().id, filename: 'note.txt' }],
    });
    const { fetchImpl, calls } = mockFetch({
      email,
      attachments: [attachmentRow()],
      fileText: 'hello-file',
      onSend: (body, headers) => sent.push({ body, headers }),
    });
    const res = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const { body, headers } = sent[0];
    expect(body.from).toBe(RELAY_FROM);
    expect(body.to).toEqual(['ops@example.com']);
    expect(body.reply_to).toBe('ada@example.com');
    expect(body.subject).toBe(`${SUBJECT_PREFIX}Need a hand`);
    expect(body.headers).toEqual({ 'X-FitMunch-Support-Relay': '1' });
    expect(body.text).toContain('From: Ada Lovelace <ada@example.com>');
    expect(body.text).toContain('To: support@fitmunch.com.au');
    expect(body.text).toContain('Date: Tue, 22 Oct 2026 09:00:00 +0000');
    expect(body.text).toContain(BODY_MARKER);
    expect(body.text).toContain(RELAY_MARKER);
    expect(body.html).toContain(BODY_MARKER);
    expect(body.html).toContain('Ada Lovelace &lt;ada@example.com&gt;');
    expect(body.attachments).toEqual([{
      filename: 'note.txt',
      content: Buffer.from('hello-file').toString('base64'),
      content_type: 'text/plain',
      content_id: 'note-1',
    }]);
    expect(headers['Idempotency-Key']).toBe(`support-forward/${EMAIL_ID}`);
    expect(headers.Authorization).toBe('Bearer re_test_inbound');
    const receiving = calls.find((call) => call.href.includes('/emails/receiving/') && !call.href.includes('/attachments'));
    expect(receiving.href).toContain('html_format=cid');
    const cdn = calls.find((call) => call.href.includes('inbound-cdn.resend.com'));
    expect(cdn.opts.headers).toBeUndefined();
    expect(cdn.opts.redirect).toBe('manual');
    expect(logged()).not.toContain(BODY_MARKER);
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain('re_test_inbound');

    const again = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(again.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test('cc to support@ is enough to forward', async () => {
    const sent = [];
    const { fetchImpl } = mockFetch({
      email: receivedEmail({ to: ['hello@fitmunch.com.au'], cc: ['support@fitmunch.com.au'] }),
      onSend: (body) => sent.push(body),
    });
    const res = await postInbound(
      receivedEvent({ to: ['hello@fitmunch.com.au'], cc: ['support@fitmunch.com.au'] }),
      { fetchImpl, claims: memoryClaims() }
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].reply_to).toBe('ada@example.com');
  });

  test('omits an attachment over the size limit and still forwards the message', async () => {
    const sent = [];
    const big = MAX_ATTACHMENT_RAW_BYTES + 1;
    const { fetchImpl, calls } = mockFetch({
      email: receivedEmail({
        attachments: [
          { id: 'small', filename: 'note.txt' },
          { id: 'big', filename: 'scan.pdf' },
        ],
      }),
      attachments: [
        attachmentRow(),
        {
          id: 'big',
          filename: 'scan.pdf',
          size: big,
          content_type: 'application/pdf',
          download_url: 'https://inbound-cdn.resend.com/scan.pdf',
        },
      ],
      onSend: (body) => sent.push(body),
    });
    const res = await postInbound(receivedEvent(), { fetchImpl, claims: memoryClaims() });
    expect(res.status).toBe(200);
    expect(sent[0].attachments.map((item) => item.filename)).toEqual(['note.txt']);
    expect(sent[0].text).toContain('Attachment omitted because it is over the size limit: scan.pdf');
    expect(calls.some((call) => call.href.includes('scan.pdf'))).toBe(false);
  });

  test.each([
    ['[support@] Need a hand'],
    ['Re: [support@] Need a hand'],
  ])('does not add a second [support@] prefix to %s', async (subject) => {
    const sent = [];
    const { fetchImpl } = mockFetch({
      email: receivedEmail({ subject }),
      onSend: (body) => sent.push(body),
    });
    const res = await postInbound(receivedEvent(), { fetchImpl, claims: memoryClaims() });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(subject);
  });

  test('an attachment redirect is not followed off resend', async () => {
    const seen = [];
    const sent = [];
    const fetchImpl = jest.fn(async (url, opts = {}) => {
      const href = String(url);
      seen.push({ href, redirect: opts.redirect });
      if (href.includes('/attachments')) {
        return jsonResult(200, { object: 'list', has_more: false, data: [attachmentRow()] });
      }
      if (href.includes('/emails/receiving/')) {
        return jsonResult(200, receivedEmail({
          attachments: [{ id: attachmentRow().id, filename: 'note.txt' }],
        }));
      }
      if (href.includes('inbound-cdn.resend.com')) {
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name) => (String(name).toLowerCase() === 'location' ? 'https://evil.example/steal' : null),
          },
          arrayBuffer: async () => bytesOf('should-not-be-attached'),
          json: async () => ({}),
        };
      }
      if (href === SEND_URL) {
        sent.push(JSON.parse(opts.body));
        return jsonResult(200, { id: 'sent_1' });
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    const claims = memoryClaims();
    const res = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(0);
    expect(seen.some((call) => call.href.includes('evil.example'))).toBe(false);
    expect(seen.find((call) => call.href.includes('inbound-cdn.resend.com')).redirect).toBe('manual');
    expect(claims.rows.size).toBe(0);
    expect(logged()).not.toContain('should-not-be-attached');
    expect(logged()).not.toContain('evil.example');
  });

  test('unset SUPPORT_FORWARD_TO is a no-op and does not log the subject or body', async () => {
    const fetchImpl = jest.fn();
    const res = await postInbound(receivedEvent(), {
      fetchImpl,
      claims: memoryClaims(),
      env: testEnv({ SUPPORT_FORWARD_TO: '   ' }),
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logged()).toContain('SUPPORT_FORWARD_TO unset');
    expect(logged()).not.toContain('Need a hand');
    expect(logged()).not.toContain(BODY_MARKER);
  });
});

describe('duplicate delivery', () => {
  test('a send still in progress does not forward a second copy', async () => {
    let releaseSend;
    const gate = new Promise((resolve) => { releaseSend = resolve; });
    let enteredSend;
    const entered = new Promise((resolve) => { enteredSend = resolve; });
    const claims = memoryClaims();
    let sends = 0;
    const { fetchImpl } = mockFetch({
      email: receivedEmail(),
      onSend: () => { sends += 1; },
    });
    const blocked = jest.fn(async (url, opts) => {
      if (String(url) === SEND_URL) {
        enteredSend();
        await gate;
      }
      return fetchImpl(url, opts);
    });
    const first = postInbound(receivedEvent(), { fetchImpl: blocked, claims });
    await entered;
    const second = await postInbound(receivedEvent(), { fetchImpl: blocked, claims });
    expect(second.status).toBe(500);
    expect(sends).toBe(0);
    releaseSend();
    const done = await first;
    expect(done.status).toBe(200);
    expect(sends).toBe(1);
    const third = await postInbound(receivedEvent(), { fetchImpl: blocked, claims });
    expect(third.status).toBe(200);
    expect(sends).toBe(1);
  });

  test('a missing received email releases the claim and asks Resend to retry', async () => {
    const claims = memoryClaims();
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/emails/receiving/')) return { ok: false, status: 404, json: async () => ({}) };
      throw new Error(`unexpected fetch ${url}`);
    });
    const res = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(res.status).toBe(500);
    expect(claims.rows.size).toBe(0);
    expect(logged()).toContain('email missing');
    expect(logged()).not.toContain(BODY_MARKER);
  });

  test('a failed send releases the claim so a later delivery can forward', async () => {
    const claims = memoryClaims();
    const failing = mockFetch({ email: receivedEmail(), sendStatus: 503, sendBody: { name: 'internal_server_error' } });
    const first = await postInbound(receivedEvent(), { fetchImpl: failing.fetchImpl, claims });
    expect(first.status).toBe(500);
    expect(claims.rows.size).toBe(0);
    const sent = [];
    const okFetch = mockFetch({ email: receivedEmail(), onSend: (body) => sent.push(body) });
    const second = await postInbound(receivedEvent(), { fetchImpl: okFetch.fetchImpl, claims });
    expect(second.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test('production uses the payment_failed claim and refuses to forward without a database', async () => {
    const claim = jest.spyOn(stripeEvents, 'claimNotificationSend').mockResolvedValue({ claimed: false, sent: true });
    const fetchImpl = jest.fn();
    try {
      const raw = JSON.stringify(receivedEvent());
      const res = await handleResendInbound(
        { body: Buffer.from(raw), headers: sign(raw) },
        { env: testEnv(), fetch: fetchImpl, now: NOW }
      );
      expect(res.status).toBe(200);
      expect(claim).toHaveBeenCalledWith(`support_forward:${EMAIL_ID}`);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      claim.mockRestore();
    }

    const refusedFetch = jest.fn();
    const refused = await postInbound(receivedEvent(), {
      fetchImpl: refusedFetch,
      env: testEnv({ DATABASE_URL: '' }),
    });
    expect(refused.status).toBe(500);
    expect(refusedFetch).not.toHaveBeenCalled();
    expect(logged()).toContain('database unavailable');
  });

  test('passes the claim token through mark and release', async () => {
    const token = '11111111-2222-4333-8444-555555555555';
    const claim = jest.spyOn(stripeEvents, 'claimNotificationSend').mockResolvedValue({ claimed: true, token });
    const mark = jest.spyOn(stripeEvents, 'markNotificationSent').mockResolvedValue();
    const release = jest.spyOn(stripeEvents, 'releaseNotificationSend').mockResolvedValue();
    const retryId = 'retry-email-id-404';
    try {
      const { fetchImpl } = mockFetch({ email: receivedEmail() });
      const sent = await postInbound(receivedEvent(), { fetchImpl, env: testEnv() });
      expect(sent.status).toBe(200);
      expect(claim).toHaveBeenCalledWith(`support_forward:${EMAIL_ID}`);
      expect(mark).toHaveBeenCalledWith(`support_forward:${EMAIL_ID}`, token);
      expect(release).not.toHaveBeenCalled();

      mark.mockClear();
      const missing = jest.fn(async (url) => {
        if (String(url).includes('/emails/receiving/')) return { ok: false, status: 404, json: async () => ({}) };
        throw new Error(`unexpected fetch ${url}`);
      });
      const retry = await postInbound(receivedEvent({ email_id: retryId }), { fetchImpl: missing, env: testEnv() });
      expect(retry.status).toBe(500);
      expect(release).toHaveBeenCalledWith(`support_forward:${retryId}`, token);
      expect(mark).not.toHaveBeenCalled();
    } finally {
      claim.mockRestore();
      mark.mockRestore();
      release.mockRestore();
    }
  });
});

describe('loop guard', () => {
  test.each([
    ['header', { headers: { 'X-FitMunch-Support-Relay': '1', from: 'Ada <ada@example.com>', date: 'Tue, 22 Oct 2026 09:00:00 +0000' } }],
    ['from address', { from: 'relay@fitmunch.com.au', headers: { from: 'FitMunch Support Relay <relay@fitmunch.com.au>' } }],
  ])('does not forward a relay message (%s)', async (_label, overrides) => {
    const sent = [];
    const { fetchImpl } = mockFetch({
      email: receivedEmail(overrides),
      onSend: (body) => sent.push(body),
    });
    const claims = memoryClaims();
    const res = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(claims.rows.get(`support_forward:${EMAIL_ID}`)).toBe('sent');
    const again = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(again.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  test('a body that quotes the relay marker is still forwarded', async () => {
    const sent = [];
    const { fetchImpl } = mockFetch({
      email: receivedEmail({
        text: `Hello\n${RELAY_MARKER}\n`,
        html: `<p>Hello</p><!-- ${RELAY_MARKER} -->`,
      }),
      onSend: (body) => sent.push(body),
    });
    const claims = memoryClaims();
    const res = await postInbound(receivedEvent(), { fetchImpl, claims });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(RELAY_MARKER);
    expect(claims.rows.get(`support_forward:${EMAIL_ID}`)).toBe('sent');
  });
});
