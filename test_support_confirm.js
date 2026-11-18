'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const { resetSharedCountersForTests } = require('./lib/shared-counters');
const { setSupportQueryForTests } = require('./lib/support-confirm');

function post(body) {
  return request(app).post('/api/support').send(body);
}

describe('support confirmation email', () => {
  let sent;
  let queries;
  let originalFetch;
  const previousKey = process.env.RESEND_API_KEY;
  const SUPPORT_INBOX = 'support@fitmunch.com.au';

  beforeEach(async () => {
    process.env.RESEND_API_KEY = 're_test_support_confirm';
    await resetSharedCountersForTests();
    sent = [];
    queries = [];
    setSupportQueryForTests(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ id: 'row-1' }], rowCount: 1 };
    });
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      const target = String(url);
      if (!target.includes('api.resend.com')) throw new Error('unexpected fetch ' + target);
      const body = JSON.parse(opts.body);
      sent.push(body);
      const to = Array.isArray(body.to) ? body.to[0] : '';
      const id = to === SUPPORT_INBOX ? 'email_forward_1' : 'email_ack_1';
      return { ok: true, status: 200, json: async () => ({ id }) };
    });
  });

  afterEach(() => {
    setSupportQueryForTests(null);
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  });

  function acksFor(address) {
    return sent.filter((row) => row.subject === "We've got your message" && row.to[0] === address);
  }

  function forwards() {
    return sent.filter((row) => Array.isArray(row.to) && row.to[0] === SUPPORT_INBOX);
  }

  test('sends one confirmation to the validated submitter and nowhere else', async () => {
    const res = await post({
      name: 'Ada <script>',
      email: '  Ada@Example.com  ',
      to: 'victim@example.net',
      cc: 'other@example.net',
      message: 'How do I cancel?',
    }).expect(200);
    expect(res.body).toEqual({ success: true });
    expect(acksFor('ada@example.com')).toHaveLength(1);
    expect(forwards()).toHaveLength(1);
    expect(sent[0].from).toBe('FitMunch <support@fitmunch.com.au>');
    expect(sent[0].to).toEqual(['ada@example.com']);
    expect(sent[0].subject).toBe("We've got your message");
    const blob = JSON.stringify(sent[0]);
    expect(blob).not.toContain('victim@example.net');
    expect(blob).not.toContain('other@example.net');
    expect(sent[0].text).toContain("We've got your message.");
    expect(sent[0].text).toContain('within 1 business day');
    expect(sent[0].text).not.toContain('1-2 business days');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#billing');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#trial');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#cancel');
    expect(sent[0].html).toContain('We&#39;ve got your message.');
    expect(sent[0].html).toContain('Hi Ada &lt;script&gt;.');
    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#billing"');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#trial"');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#cancel"');
    expect(sent[1].to).toEqual([SUPPORT_INBOX]);
    expect(sent[1].reply_to).toBe('ada@example.com');
    expect(sent[1].text).toContain('How do I cancel?');
    expect(JSON.stringify(sent[1])).not.toContain('victim@example.net');
    expect(JSON.stringify(sent[1])).not.toContain('other@example.net');
    expect(sent[1].html).not.toContain('<script>');
  });

  test('does not send when the address is missing, listed, or broken', async () => {
    for (const email of ['', 'not-an-email', 'a@b.com, c@d.com', 'Ada <ada@example.com>', 'ada@example.com\nBcc: victim@example.net']) {
      const res = await post({ email, message: 'Hello' });
      expect(res.status).toBe(400);
    }
    const empty = await post({ email: 'ada@example.com', message: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ success: false, error: 'Enter a message.' });
    const tooLong = await post({ email: 'ada@example.com', message: 'a'.repeat(4001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ success: false, error: 'Enter a message.' });
    expect(sent).toEqual([]);
    expect(queries).toEqual([]);
  });

  test('rate-limits per address and does not send the extra confirmation', async () => {
    for (let i = 0; i < 3; i += 1) {
      await post({ email: 'ada@example.com', message: 'Question ' + i }).expect(200);
    }
    expect(queries).toHaveLength(3);
    const blocked = await post({ email: 'ADA@example.com', message: 'Again' }).expect(429);
    expect(blocked.body).toEqual({ success: false, error: 'Too many messages from this email. Try again later.' });
    expect(acksFor('ada@example.com')).toHaveLength(3);
    expect(forwards()).toHaveLength(3);
    expect(queries).toHaveLength(3);
    const other = await post({ email: 'bea@example.com', message: 'Different person' }).expect(200);
    expect(other.body).toEqual({ success: true });
    expect(acksFor('bea@example.com')).toHaveLength(1);
    expect(forwards()).toHaveLength(4);
    expect(queries).toHaveLength(4);
  });

  test('a valid submit stores the message, forwards it, and sends the ack', async () => {
    const res = await post({
      name: 'Ada <script>',
      email: '  Ada@Example.com  ',
      topic: 'billing',
      to: 'victim@example.net',
      cc: 'other@example.net',
      message: 'How do I cancel?',
    }).expect(200);
    expect(res.body).toEqual({ success: true });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO support_messages');
    expect(queries[0].params).toEqual([
      'ada@example.com',
      'Ada <script>',
      'Billing',
      'How do I cancel?',
      'sent',
      'sent',
      'email_forward_1',
    ]);
    expect(acksFor('ada@example.com')).toHaveLength(1);
    expect(acksFor('ada@example.com')[0].text).toContain('within 1 business day');
    expect(acksFor('ada@example.com')[0].text).not.toContain('1-2 business days');
    const forward = forwards()[0];
    expect(forward.reply_to).toBe('ada@example.com');
    expect(forward.subject).toBe('Billing');
    expect(forward.text).toContain('Name: Ada <script>');
    expect(forward.text).toContain('Subject: Billing');
    expect(forward.text).toContain('How do I cancel?');
    expect(forward.html).toContain('Ada &lt;script&gt;');
    expect(forward.html).not.toContain('<script>');
    const blob = JSON.stringify(sent);
    expect(blob).not.toContain('victim@example.net');
    expect(blob).not.toContain('other@example.net');
  });

  test('an invalid submit stores and forwards nothing', async () => {
    const res = await post({ email: 'not-an-email', message: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Enter a valid email.' });
    expect(sent).toEqual([]);
    expect(queries).toEqual([]);
  });

  test('a forward failure with the store OK is still 200 with forward_status failed', async () => {
    global.fetch = jest.fn(async (url, opts) => {
      const body = JSON.parse(opts.body);
      sent.push(body);
      const to = Array.isArray(body.to) ? body.to[0] : '';
      if (to === SUPPORT_INBOX) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id: 'email_ack_1' }) };
    });
    const res = await post({
      email: 'ada@example.com',
      topic: 'trial',
      message: 'Hello from the form',
    }).expect(200);
    expect(res.body).toEqual({ success: true, forward_status: 'failed' });
    expect(queries).toHaveLength(1);
    expect(queries[0].params[4]).toBe('failed');
    expect(queries[0].params[5]).toBe('sent');
    expect(queries[0].params[6]).toBeNull();
    expect(acksFor('ada@example.com')).toHaveLength(1);
    expect(acksFor('ada@example.com')[0].text).toContain('within 1 business day');
  });

  test('store and forward both failing is not a success', async () => {
    const logs = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.map((part) => String(part)).join(' '));
    });
    setSupportQueryForTests(async () => {
      const err = new Error('connection refused');
      err.code = 'ECONNREFUSED';
      throw err;
    });
    global.fetch = jest.fn(async (url, opts) => {
      const body = JSON.parse(opts.body);
      sent.push(body);
      const to = Array.isArray(body.to) ? body.to[0] : '';
      if (to === SUPPORT_INBOX) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id: 'email_ack_1' }) };
    });
    const phrase = 'Keep this phrase out of the log.';
    const res = await post({ email: 'ada@example.com', name: 'Ada', message: phrase });
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Could not send a confirmation just now.' });
    expect(acksFor('ada@example.com')).toHaveLength(1);
    const logged = logs.join('\n');
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain(phrase);
    expect(logged).not.toMatch(/re_test|RESEND_API_KEY/);
  });
});

describe('support message storage', () => {
  test('migration creates support_messages with the stored fields', () => {
    const ddl = require('./lib/db-migrate').DDL;
    const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS support_messages');
    expect(start).toBeGreaterThan(-1);
    const slice = ddl.slice(start, ddl.indexOf('CREATE INDEX IF NOT EXISTS support_messages_created_idx', start));
    for (const column of ['id', 'created_at', 'email', 'name', 'subject', 'message', 'forward_status', 'ack_status', 'forward_provider_id']) {
      expect(slice).toContain(column);
    }
  });
});

describe('help centre page', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/support.html'), 'utf8');

  test('groups questions, searches them, and keeps the reply-time promise', () => {
    expect(html).toContain('id="help-search"');
    expect(html).toContain('id="billing"');
    expect(html).toContain('id="trial"');
    expect(html).toContain('id="cancel"');
    expect(html).toContain('id="account"');
    expect(html).toContain('id="app"');
    expect(html).toContain('[hidden]{display:none!important}');
    expect(html).toContain('Response time: within 1 business day.');
    expect(html).not.toContain('1-2 business days');
    expect(html).not.toContain('1&ndash;2 business days');
    expect(html).toContain('href="/login.html?next=billing"');
    expect(html).toContain("fetch('/api/billing-portal'");
    expect(html).toContain('id="support-form"');
    expect(html).not.toMatch(/Pty Ltd|inc\. GST/i);
    expect(html).not.toMatch(/—| -- /);
  });
});
