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
    expect(res.body).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe('FitMunch <support@fitmunch.com.au>');
    expect(sent[0].to).toEqual(['ada@example.com']);
    expect(sent[0].subject).toBe("We've got your message");
    const blob = JSON.stringify(sent[0]);
    expect(blob).not.toContain('victim@example.net');
    expect(blob).not.toContain('other@example.net');
    expect(sent[0].text).toContain("We've got your message.");
    expect(sent[0].text).toContain('1-2 business days');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#billing');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#trial');
    expect(sent[0].text).toContain('https://www.fitmunch.com.au/support#cancel');
    expect(sent[0].html).toContain('We&#39;ve got your message.');
    expect(sent[0].html).toContain('Hi Ada &lt;script&gt;.');
    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#billing"');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#trial"');
    expect(sent[0].html).toContain('href="https://www.fitmunch.com.au/support#cancel"');
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
    expect(sent).toHaveLength(3);
    sent.forEach((row) => expect(row.to).toEqual(['ada@example.com']));
    const other = await post({ email: 'bea@example.com', message: 'Different person' }).expect(200);
    expect(other.body.success).toBe(true);
    expect(sent).toHaveLength(4);
    expect(sent[3].to).toEqual(['bea@example.com']);
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
    expect(html).toContain('Response time: 1&ndash;2 business days.');
    expect(html).toContain('href="/login.html?next=billing"');
    expect(html).toContain("fetch('/api/billing-portal'");
    expect(html).toContain('id="support-form"');
    expect(html).not.toMatch(/Pty Ltd|inc\. GST/i);
    expect(html).not.toMatch(/—| -- /);
  });
});
