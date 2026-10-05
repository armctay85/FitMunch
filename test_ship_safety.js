/**
 * Ship-safety: webhook logs, receipt sample lockdown, API JSON name strip.
 */
const request = require('supertest');
// The limiter tests below simulate the one Vercel/Railway hop, so trust it here.
// Direct runs (no VERCEL, RAILWAY_ENVIRONMENT or TRUST_PROXY) ignore X-Forwarded-For.
process.env.TRUST_PROXY = '1';
const app = require('./server.js');
const { sanitizeApiJson } = require('./lib/sanitize-api-json');
const { webhookHandlerErrorLabel } = require('./lib/log-redact');
const { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } = require('./lib/security-headers');

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
    expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('keeps no-referrer on /login.html and /login after the site-wide policy', () => {
    const fs = require('fs');
    const path = require('path');
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    function matches(source, pathname) {
      if (source === '/(.*)') return pathname.startsWith('/');
      return source === pathname;
    }
    function effective(pathname) {
      let value = null;
      for (const block of vercel.headers || []) {
        if (!matches(block.source, pathname)) continue;
        for (const header of block.headers || []) {
          if (String(header.key).toLowerCase() === 'referrer-policy') value = header.value;
        }
      }
      return value;
    }
    expect(effective('/login.html')).toBe('no-referrer');
    expect(effective('/login')).toBe('no-referrer');
    expect(effective('/')).toBe('strict-origin-when-cross-origin');
    expect(effective('/pricing')).toBe('strict-origin-when-cross-origin');
  });

  it('301s /login and /login?reset= to login.html with the query kept and no-referrer', async () => {
    const plain = await request(app).get('/login').redirects(0);
    expect(plain.status).toBe(301);
    expect(plain.headers.location).toBe('/login.html');
    expect(plain.headers['referrer-policy']).toBe('no-referrer');
    const reset = await request(app).get('/login?reset=QAFAKE').redirects(0);
    expect(reset.status).toBe(301);
    expect(reset.headers.location).toBe('/login.html?reset=QAFAKE');
    expect(reset.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sends no-referrer from Express on /login, /login/, /login?reset= and /login.html', async () => {
    for (const urlPath of ['/login', '/login/', '/login?reset=x', '/login.html']) {
      const res = await request(app).get(urlPath);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    }
    const home = await request(app).get('/');
    expect(home.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('r3 hardening', () => {
  const fs = require('fs');
  const path = require('path');

  it('sends CSP and Permissions-Policy on the /funnel 401s too', async () => {
    for (const urlPath of ['/funnel', '/funnel.html']) {
      const res = await request(app).get(urlPath).expect(401);
      expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    }
  });

  it('compares the analytics key with SHA-256 digests and timingSafeEqual, no length branch', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const fn = src.slice(src.indexOf('function analyticsKeyMatches'), src.indexOf('function analyticsKeyMatches') + 700);
    expect(fn).toMatch(/createHash\('sha256'\)/);
    expect(fn).toMatch(/timingSafeEqual/);
    expect(fn).not.toMatch(/\.length\s*!==/);
    const previous = process.env.FM_ANALYTICS_KEY;
    process.env.FM_ANALYTICS_KEY = 'r3-test-key';
    try {
      await request(app).get('/funnel.html?key=r3-test-ke').expect(401);
      await request(app).get('/funnel.html?key=' + 'x'.repeat(5000)).expect(401);
      await request(app).get('/funnel.html?key=r3-test-key').expect(200);
    } finally {
      if (previous === undefined) delete process.env.FM_ANALYTICS_KEY;
      else process.env.FM_ANALYTICS_KEY = previous;
    }
  });

  it('trusts X-Forwarded-For only behind a proxy', () => {
    const { behindTrustedProxy } = app._private;
    expect(behindTrustedProxy({})).toBe(false);
    expect(behindTrustedProxy({ VERCEL: '1' })).toBe(true);
    expect(behindTrustedProxy({ RAILWAY_ENVIRONMENT: 'production' })).toBe(true);
    expect(behindTrustedProxy({ TRUST_PROXY: '1' })).toBe(true);
    expect(behindTrustedProxy({ VERCEL: '1', TRUST_PROXY: '0' })).toBe(false);
  });

  it('keeps unused hosts out of the CSP, and vercel.json matches Express', () => {
    for (const host of ['js.stripe.com', 'hooks.stripe.com', 'va.vercel-scripts.com', 'vitals.vercel-insights.com']) {
      expect(CONTENT_SECURITY_POLICY).not.toContain(host);
    }
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
    expect(csp.value).toBe(CONTENT_SECURITY_POLICY);
  });

  it('content tables never split words and label every cell for the phone card layout', () => {
    for (const css of ['public/css/fm-shell.css', 'public/css/fm-coach-shell.css']) {
      const text = fs.readFileSync(path.join(__dirname, css), 'utf8');
      expect(text).not.toMatch(/overflow-wrap\s*:\s*anywhere/);
      expect(text).not.toMatch(/word-break\s*:\s*break-all/);
      expect(text).toMatch(/\.fm-table td::before\{\s*content:attr\(data-label\)/);
      expect(text).not.toMatch(/(^|\n)\s*html\s*\{[^}]*overflow-x\s*:\s*hidden/);
    }
    const pages = fs.readdirSync(path.join(__dirname, 'public')).filter((f) => f.endsWith('.html'));
    let tables = 0;
    for (const page of pages) {
      const html = fs.readFileSync(path.join(__dirname, 'public', page), 'utf8');
      const found = html.match(/<table class="fm-table">[\s\S]*?<\/table>/g) || [];
      for (const table of found) {
        tables += 1;
        expect(table).not.toMatch(/<td(?![^>]*data-label=")[^>]*>/);
      }
    }
    expect(tables).toBeGreaterThan(0);
  });

  it('funnel table scrolls inside a hidden-until-loaded wrapper', () => {
    const html = fs.readFileSync(path.join(__dirname, 'private/funnel.html'), 'utf8');
    expect(html).toMatch(/<div class="fn-tbl-wrap" id="tblWrap" hidden>/);
    expect(html).toMatch(/\.fn-tbl-wrap\{[^}]*overflow-x:auto/);
    expect(html).toMatch(/\.fn-tbl-wrap\[hidden\]\{display:none\}/);
  });

  it('tracks nothing under dist/', () => {
    const { execFileSync } = require('child_process');
    let out;
    try {
      out = execFileSync('git', ['ls-files', 'dist'], { cwd: __dirname, encoding: 'utf8' });
    } catch (_) {
      return; // no git checkout (e.g. a deploy bundle)
    }
    expect(out.trim()).toBe('');
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
  it('redacts secret-shaped and email-shaped labels', () => {
    expect(webhookHandlerErrorLabel({ name: 'sk_live_abcdef' })).toBe('Error');
    expect(webhookHandlerErrorLabel({ code: 'sk_test_abcdef' })).toBe('Error');
    expect(webhookHandlerErrorLabel({ code: 'whsec_abc' })).toBe('Error');
    expect(webhookHandlerErrorLabel({ name: 'admin@fitmunch.com.au' })).toBe('Error');
    expect(webhookHandlerErrorLabel({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
    expect(webhookHandlerErrorLabel({ name: 'Error' })).toBe('Error');
  });

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
                metadata: { app: 'fitmunch', product: 'fitmunch', plan: 'premium' },
                items: { data: [{ price: { id: require('./lib/fitmunch-checkout').PRICE_IDS.premium } }] },
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
      expect(res.status).toBe(200);
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

  it('limits wrong keys before the key check, including a different length', async () => {
    await withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'development', RECEIPT_SAMPLE_KEY: sampleKey }, async () => {
      const shortKey = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', 'x')
        .set('x-forwarded-for', '198.51.100.41');
      expect(shortKey.status).toBe(401);
      const longKey = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', `${sampleKey}-extra`)
        .set('x-forwarded-for', '198.51.100.42');
      expect(longKey.status).toBe(401);

      const ip = '198.51.100.43';
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .get('/api/receipt/sample')
          .set('x-receipt-sample-key', `wrong-${i}`)
          .set('x-forwarded-for', ip);
        expect(res.status).toBe(401);
      }
      const blocked = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', 'still-wrong')
        .set('x-forwarded-for', ip);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ success: false, error: 'Too many requests' });
    });
  });

  it('does not give a new bucket for a rotated left-most X-Forwarded-For or X-Real-IP', async () => {
    await withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'development', RECEIPT_SAMPLE_KEY: sampleKey }, async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .get('/api/receipt/sample')
          .set('x-receipt-sample-key', 'nope')
          .set('x-real-ip', `203.0.113.${i}`)
          .set('x-forwarded-for', `203.0.113.${i}, 198.51.100.80`);
        expect(res.status).toBe(401);
      }
      const blocked = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', 'nope')
        .set('x-real-ip', '198.51.100.9')
        .set('x-forwarded-for', '203.0.113.99, 198.51.100.80');
      expect(blocked.status).toBe(429);

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .get('/api/receipt/sample')
          .set('x-receipt-sample-key', 'nope')
          .set('x-real-ip', `192.0.2.${i + 1}`);
        expect(res.status).toBe(401);
      }
      const realIpBlocked = await request(app)
        .get('/api/receipt/sample')
        .set('x-receipt-sample-key', 'nope')
        .set('x-real-ip', '192.0.2.200');
      expect(realIpBlocked.status).toBe(429);
    });
  });
});
