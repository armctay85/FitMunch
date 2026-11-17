'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const { resetSharedCountersForTests } = require('./lib/shared-counters');

function post(body) {
  return request(app).post('/api/support').send(body);
}

describe('support confirmation email', () => {
  let sent;
  let originalFetch;
  const previousKey = process.env.RESEND_API_KEY;

  beforeEach(async () => {
    process.env.RESEND_API_KEY = 're_test_support_confirm';
    await resetSharedCountersForTests();
    sent = [];
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      const target = String(url);
      if (!target.includes('api.resend.com')) throw new Error('unexpected fetch ' + target);
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'email_support_1' }) };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  });

  test('sends one confirmation to the validated submitter and nowhere else', async () => {
    const res = await post({
      name: 'Ada <script>',
      email: '  Ada@Example.com  ',
      to: 'victim@example.net',
      cc: 'other@example.net',
      message: 'How do I cancel?',
    }).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.receipt).toBe(true);
    expect(sent).toHaveLength(2);
    const team = sent[0];
    const receiptEmail = sent[1];
    expect(team.from).toBe('FitMunch Help Form <help@fitmunch.com.au>');
    expect(team.to).toEqual(['support@fitmunch.com.au']);
    expect(team.reply_to).toBe('ada@example.com');
    expect(team.subject).toMatch(/^\[Help form\] App: /);
    expect(JSON.stringify(team)).not.toMatch(/relay@fitmunch\.com\.au|x-fitmunch-support-relay/);
    expect(receiptEmail.from).toBe('FitMunch <support@fitmunch.com.au>');
    expect(receiptEmail.to).toEqual(['ada@example.com']);
    expect(receiptEmail.subject).toBe("We've got your message");
    const blob = JSON.stringify(receiptEmail);
    expect(blob).not.toContain('victim@example.net');
    expect(blob).not.toContain('other@example.net');
    expect(receiptEmail.text).toContain("We've got your message.");
    expect(receiptEmail.text).toContain('within 1 business day');
    expect(receiptEmail.text).not.toContain('1-2 business days');
    expect(receiptEmail.text).toContain('https://www.fitmunch.com.au/support#billing');
    expect(receiptEmail.text).toContain('https://www.fitmunch.com.au/support#trial');
    expect(receiptEmail.text).toContain('https://www.fitmunch.com.au/support#cancel');
    expect(receiptEmail.html).toContain('We&#39;ve got your message.');
    expect(receiptEmail.html).toContain('Hi Ada &lt;script&gt;.');
    expect(receiptEmail.html).not.toContain('<script>');
    expect(receiptEmail.html).toContain('href="https://www.fitmunch.com.au/support#billing"');
    expect(receiptEmail.html).toContain('href="https://www.fitmunch.com.au/support#trial"');
    expect(receiptEmail.html).toContain('href="https://www.fitmunch.com.au/support#cancel"');
  });

  test('does not send when the address is missing, listed, or broken', async () => {
    for (const email of ['', 'not-an-email', 'a@b.com, c@d.com', 'Ada <ada@example.com>', 'ada@example.com\nBcc: victim@example.net']) {
      const res = await post({ email, message: 'Hello' });
      expect(res.status).toBe(400);
    }
    const empty = await post({ email: 'ada@example.com', message: '   ' });
    expect(empty.status).toBe(400);
    expect(sent).toEqual([]);
  });

  test('rate-limits per address and does not send the extra confirmation', async () => {
    for (let i = 0; i < 3; i += 1) {
      await post({ email: 'ada@example.com', message: 'Question ' + i }).expect(200);
    }
    const blocked = await post({ email: 'ADA@example.com', message: 'Again' }).expect(429);
    expect(blocked.body.success).toBe(false);
    expect(sent.filter((row) => row.to[0] === 'ada@example.com')).toHaveLength(3);
    const other = await post({ email: 'bea@example.com', message: 'Different person' }).expect(200);
    expect(other.body.success).toBe(true);
    expect(sent.filter((row) => row.to[0] === 'bea@example.com')).toHaveLength(1);
    expect(sent.filter((row) => row.to[0] === 'support@fitmunch.com.au').length).toBeGreaterThan(0);
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
