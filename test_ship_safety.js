/**
 * Ship-safety: webhook logs, receipt sample lockdown, API JSON name strip.
 */
const request = require('supertest');
const app = require('./server.js');
const { sanitizeApiJson } = require('./lib/sanitize-api-json');
const { webhookHandlerErrorLabel } = require('./lib/log-redact');
const { CONTENT_SECURITY_POLICY } = require('./lib/security-headers');

function loggedText(spy) {
  return spy.mock.calls.map((args) => args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch (_) { return String(arg); }
  }).join(' ')).join('\n');
}

describe('response headers', () => {
  it('sends the enforcing CSP and still sets Permissions-Policy from Express', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers['content-security-policy']).not.toMatch(/report-only/i);
    expect(res.headers['permissions-policy']).toBe(
      'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")'
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('API JSON name strip', () => {
  it('drops model fields and provider names, including nested errors', () => {
    const cleaned = sanitizeApiJson({
      success: false,
      model: 'gemini-2.5-flash',
      provider: 'openai',
      providerName: 'anthropic',
      geminiConfigured: true,
      error: 'grok failed on cus_should_stay_out_of_this_unit',
      nested: { model: 'gpt-4o-mini', note: 'uses gemini' },
    });
    const text = JSON.stringify(cleaned);
    expect(cleaned.model).toBeUndefined();
    expect(cleaned.provider).toBeUndefined();
    expect(cleaned.providerName).toBeUndefined();
    expect(cleaned.geminiConfigured).toBeUndefined();
    expect(cleaned.nested.model).toBeUndefined();
    expect(text).not.toMatch(/gemini|openai|grok|anthropic/i);
    expect(text).not.toMatch(/"model"/i);
  });
});

describe('webhook handler error log', () => {
  it('logs only a name or code for a failing DB query', () => {
    const err = new Error('Failed query: select "id" from "users" where stripe_customer_id = $1 params: cus_LogLeak123 cs_LogLeak456 pi_LogLeak789 sub_LogLeak012 in_LogLeak345 evt_LogLeak678');
    err.code = '42703';
    err.query = 'select "id" from "users"';
    expect(webhookHandlerErrorLabel(err)).toBe('42703');
  });

  it('a failing DB query logs no SQL and no Stripe ids', async () => {
    const storage = require('./server/storage.js');
    const originalSelect = storage.db.select;
    const sql = 'Failed query: select "users"."id" from "users" where "users"."stripe_customer_id" = $1';
    const ids = 'cus_LogLeak123 cs_LogLeak456 pi_LogLeak789 sub_LogLeak012 in_LogLeak345 evt_LogLeak678';
    const dbErr = new Error(`${sql} params: ${ids}`);
    dbErr.code = '42703';
    dbErr.query = sql;
    storage.db.select = () => { throw dbErr; };

    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    app._private.setStripeForTests({
      webhooks: {
        constructEvent() {
          return {
            id: 'evt_LogLeak678',
            type: 'customer.subscription.updated',
            data: {
              object: {
                id: 'sub_LogLeak012',
                status: 'incomplete',
                customer: 'cus_LogLeak123',
                items: { data: [{ price: { id: 'price_not_live' } }] },
              },
            },
          };
        },
      },
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=test')
        .send('{"id":"evt_LogLeak678"}');
      expect(res.status).toBe(500);
      const logged = loggedText(spy);
      expect(logged).toContain('Webhook handler error:');
      expect(logged).toContain('42703');
      expect(logged).not.toMatch(/select|users|params|failed query/i);
      expect(logged).not.toMatch(/cus_|cs_|pi_|sub_|in_|evt_/);
      expect(logged).not.toContain(sql);
      expect(logged).not.toContain('LogLeak');
    } finally {
      spy.mockRestore();
      storage.db.select = originalSelect;
      app._private.setStripeForTests(null);
      if (previousSecret == null) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    }
  });
});

describe('GET /api/receipt/sample', () => {
  const sampleKey = 'receipt-sample-test-key';

  function withEnv(extra, fn) {
    const previous = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
      RECEIPT_SAMPLE_KEY: process.env.RECEIPT_SAMPLE_KEY,
    };
    if ('VERCEL_ENV' in extra) {
      if (extra.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = extra.VERCEL_ENV;
    }
    if ('NODE_ENV' in extra) process.env.NODE_ENV = extra.NODE_ENV;
    if ('RECEIPT_SAMPLE_KEY' in extra) {
      if (extra.RECEIPT_SAMPLE_KEY == null) delete process.env.RECEIPT_SAMPLE_KEY;
      else process.env.RECEIPT_SAMPLE_KEY = extra.RECEIPT_SAMPLE_KEY;
    }
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        if (previous.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = previous.VERCEL_ENV;
        process.env.NODE_ENV = previous.NODE_ENV;
        if (previous.RECEIPT_SAMPLE_KEY == null) delete process.env.RECEIPT_SAMPLE_KEY;
        else process.env.RECEIPT_SAMPLE_KEY = previous.RECEIPT_SAMPLE_KEY;
      });
  }

  function assertNoModelNames(body) {
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/gemini|openai|grok|anthropic/i);
    expect(text).not.toMatch(/"model"/i);
    expect(body.model).toBeUndefined();
    expect(body.provider).toBeUndefined();
  }

  it('404s in production, and when NODE_ENV is production with no sample key', async () => {
    await withEnv({ VERCEL_ENV: 'production', RECEIPT_SAMPLE_KEY: sampleKey }, async () => {
      const res = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', sampleKey)
        .set('x-forwarded-for', '198.51.100.20');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      assertNoModelNames(res.body);
    });

    await withEnv({ VERCEL_ENV: null, NODE_ENV: 'production', RECEIPT_SAMPLE_KEY: null }, async () => {
      const res = await request(app)
        .get('/api/receipt/sample')
        .set('x-forwarded-for', '198.51.100.21');
      expect(res.status).toBe(404);
      assertNoModelNames(res.body);
    });
  });

  it('401s in dev without the sample key', async () => {
    await withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'development', RECEIPT_SAMPLE_KEY: sampleKey }, async () => {
      const res = await request(app)
        .get('/api/receipt/sample')
        .set('x-forwarded-for', '198.51.100.22');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Unauthorised' });
      assertNoModelNames(res.body);
    });
  });

  it('returns no model names, and the 6th request is 429', async () => {
    await withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'development', RECEIPT_SAMPLE_KEY: sampleKey }, async () => {
      const named = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', sampleKey)
        .set('x-forwarded-for', '198.51.100.30');
      expect(named.status).toBe(200);
      assertNoModelNames(named.body);
      expect(named.body.endpoint).toBe('/api/receipt/sample');

      const ip = '198.51.100.31';
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .get('/api/receipt/sample')
          .set('x-receipt-sample-key', sampleKey)
          .set('x-forwarded-for', ip);
        expect(res.status).not.toBe(429);
        assertNoModelNames(res.body);
      }
      const blocked = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', sampleKey)
        .set('x-forwarded-for', ip);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ success: false, error: 'Too many requests' });
      expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
      assertNoModelNames(blocked.body);
    });
  });
});
