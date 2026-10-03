const fs = require('fs');
const request = require('supertest');
const express = require('express');
const { register5xxAlerts, deliverEmail, resetAlertStateForTests, groupFor, noteServerError, redactFreeText } = require('./lib/alert-5xx');

function buildApp(options) {
  const app = express();
  register5xxAlerts(app, options);
  app.post('/api/auth/login', (req, res) => {
    const err = new Error('storage.withStripeCustomerLock is not a function');
    err.name = 'TypeError';
    if (req.query.code) err.code = String(req.query.code);
    noteServerError(res, err);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  });
  app.post('/api/quick-checkout', (req, res) => {
    res.status(500).json({ success: false });
  });
  app.get('/api/foods', (req, res) => res.status(500).json({ success: false }));
  app.post('/api/auth/login-denied', (req, res) => res.status(401).json({ success: false }));
  app.post('/api/checkout', (req, res) => res.status(400).json({ error: 'Plan is required.' }));
  return app;
}

function productionEnv(extra) {
  return {
    VERCEL_ENV: 'production',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM: 'FitMunch <hello@fitmunch.com.au>',
    ALERT_EMAIL_TO: 'support@fitmunch.com.au',
    VERCEL_DEPLOYMENT_ID: 'dpl_test',
    VERCEL_GIT_COMMIT_SHA: 'abc1234fffffff',
    VERCEL_REGION: 'syd1',
    ...extra,
  };
}

async function flush(pending) {
  await Promise.all(pending);
}

describe('5xx alerts', () => {
  afterEach(() => resetAlertStateForTests());

  it('is registered before helmet so it sees every response', () => {
    const source = fs.readFileSync('server.js', 'utf8');
    const alertAt = source.indexOf('register5xxAlerts(app)');
    const helmetAt = source.indexOf('app.use(helmet');
    expect(alertAt).toBeGreaterThan(-1);
    expect(alertAt).toBeLessThan(helmetAt);
  });

  it('sends one email for several auth 500s in the same bucket', async () => {
    const pending = [];
    const sent = [];
    const app = buildApp({
      env: productionEnv(),
      now: () => Date.parse('2026-10-03T00:04:00Z'),
      waitUntil: (promise) => pending.push(promise),
      send: async (payload) => { sent.push(payload); return true; },
    });
    await request(app).post('/api/auth/login');
    await request(app).post('/api/auth/login');
    await request(app).post('/api/auth/login');
    await flush(pending);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('5xx on auth');
    expect(sent[0].idempotencyKey).toMatch(/^fm-5xx-auth-/);
    expect(sent[0].text).toContain('Path: /api/auth/login');
    expect(sent[0].text).not.toMatch(/@/);
    expect(sent[0].text).not.toMatch(/sk_|rk_|Bearer/);
  });

  it('maps quick checkout to the checkout group', async () => {
    const pending = [];
    const sent = [];
    const app = buildApp({
      env: productionEnv(),
      now: () => Date.parse('2026-10-03T00:04:00Z'),
      waitUntil: (promise) => pending.push(promise),
      send: async (payload) => { sent.push(payload); return true; },
    });
    await request(app).post('/api/quick-checkout');
    await flush(pending);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('5xx on checkout');
    expect(groupFor('/api/stripe/webhook')).toBe('stripe-webhook');
    expect(groupFor('/api/internal/smoke/checkout')).toBeNull();
  });

  it('does not alert on 401, 400, or an unrelated 500', async () => {
    const pending = [];
    const sent = [];
    const app = buildApp({
      env: productionEnv(),
      now: () => Date.parse('2026-10-03T00:04:00Z'),
      waitUntil: (promise) => pending.push(promise),
      send: async (payload) => { sent.push(payload); return true; },
    });
    await request(app).post('/api/auth/login-denied');
    await request(app).post('/api/checkout');
    await request(app).get('/api/foods');
    await flush(pending);
    expect(sent).toHaveLength(0);
  });

  it('logs outside production and does not send', async () => {
    const pending = [];
    const sent = [];
    const errors = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));
    const app = buildApp({
      env: productionEnv({ VERCEL_ENV: 'preview' }),
      now: () => Date.parse('2026-10-03T00:04:00Z'),
      waitUntil: (promise) => pending.push(promise),
      send: async (payload) => { sent.push(payload); return true; },
    });
    await request(app).post('/api/auth/login');
    await flush(pending);
    spy.mockRestore();
    expect(sent).toHaveLength(0);
    expect(errors.some((line) => line.startsWith('FM_ALERT_5XX '))).toBe(true);
  });

  it('sends only the error name and code, with free text redacted', async () => {
    const pending = [];
    const sent = [];
    const app = buildApp({
      env: productionEnv(),
      now: () => Date.parse('2026-10-03T00:04:00Z'),
      waitUntil: (promise) => pending.push(promise),
      send: async (payload) => { sent.push(payload); return true; },
    });
    await request(app).post('/api/auth/login?code=' + encodeURIComponent(
      '10.1.2.3 "buyer@example.com" cus_abc123 cs_live_abc pi_123 sub_456 sk_live_abc123'
    ));
    await flush(pending);
    expect(sent[0].text).toContain('Error: TypeError');
    expect(sent[0].text).toContain('Code:');
    expect(sent[0].text).not.toContain('Hint:');
    expect(sent[0].text).not.toContain('withStripeCustomerLock');
    expect(sent[0].text).not.toContain('10.1.2.3');
    expect(sent[0].text).not.toContain('buyer@example.com');
    expect(sent[0].text).not.toContain('cus_');
    expect(sent[0].text).not.toContain('cs_');
    expect(sent[0].text).not.toContain('pi_');
    expect(sent[0].text).not.toContain('sub_');
    expect(sent[0].text).not.toContain('sk_live_');
    expect(sent[0].to).toEqual(['support@fitmunch.com.au']);
  });

  it('redacts IPs, quoted values, and Stripe ids left in free text', () => {
    const out = redactFreeText('saw 203.0.113.10 and "secret value" and \'quoted\' cus_abc cs_live_zz pi_1 sub_2');
    expect(out).not.toContain('203.0.113.10');
    expect(out).not.toContain('secret value');
    expect(out).not.toContain('quoted');
    expect(out).not.toContain('cus_');
    expect(out).not.toContain('cs_');
    expect(out).not.toContain('pi_');
    expect(out).not.toContain('sub_');
  });

  it('posts to Resend with an idempotency key and does not throw', async () => {
    const seen = [];
    const ok = await deliverEmail({
      from: 'FitMunch <hello@fitmunch.com.au>',
      to: ['support@fitmunch.com.au'],
      subject: '[FitMunch PROD] 5xx on auth (1 in 10m)',
      text: 'Group: auth',
      idempotencyKey: 'fm-5xx-auth-1',
    }, {
      env: { RESEND_API_KEY: 're_test_key' },
      fetch: async (url, options) => {
        seen.push({ url, options });
        return { ok: true };
      },
    });
    expect(ok).toBe(true);
    expect(seen[0].url).toBe('https://api.resend.com/emails');
    expect(seen[0].options.headers['Idempotency-Key']).toBe('fm-5xx-auth-1');
    expect(seen[0].options.body).not.toContain('re_test_key');
    await expect(deliverEmail({
      from: 'a', to: ['b'], subject: 'c', text: 'd', idempotencyKey: 'k',
    }, {
      env: { RESEND_API_KEY: 're_test_key' },
      fetch: () => Promise.reject(new Error('network')),
    })).resolves.toBe(false);
  });
});
