'use strict';
/**
 * support_forward claims against Postgres.
 * A takeover after five minutes replaces claim_token. The sender we replaced
 * cannot mark the row sent or release it. The forward itself is one Resend
 * delivery: an in-flight repeat is concurrent_idempotent_requests, and a
 * later repeat replays the first acceptance.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Real Postgres, not pg-mem:
 * the claim SQL uses INSERT ON CONFLICT, UPDATE ... WHERE claimed_at <
 * NOW() - INTERVAL, and rowCount, which is what production runs.
 */
const crypto = require('crypto');

const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_resend_inbound_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) {
  throw new Error('TEST_DATABASE_URL looks like a real database');
}
const maybe = URL ? describe : describe.skip;
const PREV_URL = process.env.DATABASE_URL;
const PREV_SSL = process.env.DATABASE_SSL;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}

const stripeEvents = require('./lib/stripe-events');
const { ensureSchema, getPool } = require('./lib/db-migrate');
const { handleResendInbound } = require('./lib/resend-inbound');

const SVIX_BODY = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const SECRET = `whsec_${SVIX_BODY}`;
const NOW = 1700000000000;
const TS = 1700000000;
const EMAIL_ID = 'inbound-fwd-takeover-01';
const SEND_KEY = `support_forward:${EMAIL_ID}`;
const SEND_URL = 'https://api.resend.com/emails';
const IDEMPOTENCY_KEY = `support-forward/${EMAIL_ID}`;

function sign(raw) {
  const key = Buffer.from(SVIX_BODY, 'base64');
  const digest = crypto.createHmac('sha256', key).update(`msg_inbound_pg.${TS}.${raw}`).digest('base64');
  return {
    'svix-id': 'msg_inbound_pg',
    'svix-timestamp': String(TS),
    'svix-signature': `v1,${digest}`,
  };
}

function receivedEvent() {
  return {
    type: 'email.received',
    created_at: '2026-10-22T09:00:00.000Z',
    data: {
      email_id: EMAIL_ID,
      from: 'ada@example.com',
      to: ['support@fitmunch.com.au'],
      cc: [],
      subject: 'Need a hand',
    },
  };
}

function receivedEmail() {
  return {
    object: 'email',
    id: EMAIL_ID,
    from: 'ada@example.com',
    to: ['support@fitmunch.com.au'],
    cc: [],
    subject: 'Need a hand',
    html: '<p>Hello</p>',
    text: 'Hello',
    headers: {
      from: 'Ada Lovelace <ada@example.com>',
      to: 'support@fitmunch.com.au',
      date: 'Tue, 22 Oct 2026 09:00:00 +0000',
    },
    created_at: '2026-10-22T09:00:00.000Z',
    attachments: [],
  };
}

function jsonResult(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function postInbound(fetchImpl) {
  const raw = JSON.stringify(receivedEvent());
  return handleResendInbound(
    { body: Buffer.from(raw), headers: sign(raw) },
    {
      env: {
        RESEND_INBOUND_WEBHOOK_SECRET: SECRET,
        SUPPORT_FORWARD_TO: 'ops@example.com',
        RESEND_API_KEY: 're_test_inbound',
        DATABASE_URL: process.env.DATABASE_URL,
      },
      fetch: fetchImpl,
      now: NOW,
    }
  );
}

async function claimRow() {
  const found = await getPool().query(
    'SELECT status, claim_token FROM stripe_welcome_sends WHERE send_key = $1',
    [SEND_KEY]
  );
  return found.rows[0] || null;
}

async function sendStatus() {
  const row = await claimRow();
  return row ? row.status : null;
}

async function wipe() {
  await getPool().query('DELETE FROM stripe_welcome_sends WHERE send_key = $1', [SEND_KEY]);
}

async function waitFor(predicate, label) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(label || 'timed out');
}

function start(pending) {
  pending.then(() => {}, () => {});
  return pending;
}

// Same rules Resend documents for Idempotency-Key. begin() is the request
// arriving. finish() is that request being accepted. A second begin while
// the first is in flight is not a second delivery.
function resendDouble() {
  const keys = new Map();
  let deliveries = 0;
  return {
    get deliveries() { return deliveries; },
    begin(key) {
      const row = keys.get(key);
      if (row && row.status === 'inflight') return { concurrent: true };
      if (row && row.status === 'sent') return { replay: true, id: row.id };
      keys.set(key, { status: 'inflight' });
      return { started: true };
    },
    finish(key) {
      const row = keys.get(key);
      if (!row || row.status !== 'inflight') throw new Error('finish without an in-flight send');
      deliveries += 1;
      const id = `sent_${deliveries}`;
      row.status = 'sent';
      row.id = id;
      return { id };
    },
  };
}

maybe('support forward send claims (postgres)', () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    const ready = await ensureSchema();
    if (!ready) throw new Error('schema was not ensured');
  });

  beforeEach(async () => {
    stripeEvents.resetStripeEventsForTests();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await wipe();
  });

  afterEach(async () => {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
    await wipe();
  });

  afterAll(() => {
    if (PREV_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = PREV_URL;
    if (PREV_SSL === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = PREV_SSL;
  });

  test('a stale takeover cannot double-deliver or let the old claim mark or release', async () => {
    const gate = resendDouble();
    const idempotencyKeys = [];
    let sends = 0;
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    const secondHeld = new Promise((resolve) => { releaseSecond = resolve; });
    const fetchImpl = jest.fn(async (url, opts = {}) => {
      const href = String(url);
      if (href.includes('/emails/receiving/')) return jsonResult(200, receivedEmail());
      if (href === SEND_URL) {
        sends += 1;
        const key = opts.headers && opts.headers['Idempotency-Key'];
        idempotencyKeys.push(key);
        const attempt = gate.begin(key);
        if (attempt.started) {
          await firstHeld;
          return jsonResult(200, gate.finish(key));
        }
        if (attempt.concurrent) {
          await secondHeld;
          return jsonResult(409, { name: 'concurrent_idempotent_requests', message: 'in progress' });
        }
        return jsonResult(200, { id: attempt.id });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    let first = Promise.resolve();
    let second = Promise.resolve();
    try {
      first = start(postInbound(fetchImpl));
      await waitFor(() => sends === 1, 'first send did not start');
      const original = await claimRow();
      expect(original.status).toBe('pending');
      expect(original.claim_token).toEqual(expect.any(String));

      await stripeEvents.ageNotificationSendForTests(SEND_KEY, stripeEvents.STALE_CLAIM_MS + 1000);
      second = start(postInbound(fetchImpl));
      await waitFor(() => sends === 2, 'takeover did not send');
      const taken = await claimRow();
      expect(taken.status).toBe('pending');
      expect(taken.claim_token).toEqual(expect.any(String));
      expect(taken.claim_token).not.toBe(original.claim_token);

      await stripeEvents.releaseNotificationSend(SEND_KEY, original.claim_token);
      expect(await claimRow()).toEqual({
        status: 'pending',
        claim_token: taken.claim_token,
      });
      await expect(stripeEvents.markNotificationSent(SEND_KEY, original.claim_token))
        .rejects.toThrow(/sent mark failed/);
      expect(await claimRow()).toEqual({
        status: 'pending',
        claim_token: taken.claim_token,
      });
      expect(gate.deliveries).toBe(0);

      releaseSecond();
      expect((await second).status).toBe(500);
      expect(gate.deliveries).toBe(0);
      releaseFirst();
      expect((await first).status).toBe(500);
      expect(gate.deliveries).toBe(1);
      expect(await sendStatus()).toBeNull();

      expect((await postInbound(fetchImpl)).status).toBe(200);
      expect(gate.deliveries).toBe(1);
      expect(sends).toBe(3);
      expect(await sendStatus()).toBe('sent');

      expect((await postInbound(fetchImpl)).status).toBe(200);
      expect(sends).toBe(3);
      expect(gate.deliveries).toBe(1);
      expect(idempotencyKeys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.allSettled([first, second]);
    }
  });
});
