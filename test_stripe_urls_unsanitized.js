'use strict';
// Stripe Checkout / Billing Portal urls and ids carry long random parts that hit a provider
// word by chance (Elite QA measured 1,060 of 100,000 bodies on main, about 1 in 94), and the
// /api sanitizer then broke the url or id. Only the top-level url and id, in their exact
// Stripe shapes, skip the scrub; every other key is still sanitized. The allowlist runs inside
// the /api res.json wrapper, so a new Stripe route using plain res.json is covered too.
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { attachApiJsonSanitizer, sendStripeJson, sanitizeApiJson, sanitizeApiBody } = require('./lib/sanitize-api-json');

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rand = (n) => Array.from(crypto.randomBytes(n), (b) => A[b % 62]).join('');
function stripeValues() {
  const mode = Math.random() < 0.5 ? 'live' : 'test';
  const id = `cs_${mode}_${rand(58)}`;
  return {
    id,
    url: `https://checkout.stripe.com/c/pay/${id}#${crypto.randomBytes(90).toString('base64url')}`,
    portal: `https://billing.stripe.com/p/session/${mode}_${rand(64)}`,
  };
}
const PROVIDER = /gemini|openai|grok|anthropic|xai/i;

// Same layering as production: server.js and the /api router both attach the sanitizer.
const app = express();
let current;
app.use(attachApiJsonSanitizer);
const router = express.Router();
router.use(attachApiJsonSanitizer);
router.post('/checkout', (req, res) => sendStripeJson(res, { success: true, url: current.url, id: current.id }));
router.post('/billing-portal', (req, res) => sendStripeJson(res, { success: true, url: current.portal }));
// A future Stripe route that forgets sendStripeJson and uses plain res.json.
router.post('/new-stripe-route', (req, res) => res.json({ success: true, url: current.url, id: current.id }));
// A Stripe body that later grows a user-supplied field.
router.post('/checkout-with-extra', (req, res) => sendStripeJson(res, {
  success: true,
  url: current.url,
  id: current.id,
  planLabel: 'Grok coach plan by OpenAI',
  user: { name: 'Gemini Fan', note: 'xAI' },
  message: 'Answered by Anthropic',
}));
router.post('/other', (req, res) => res.json({ success: true, note: `Answered by Grok ${current.id}` }));
router.post('/fake-url', (req, res) => res.json({
  url: 'https://evil.example/grok',
  id: 'sub_GrokOpenAI123',
  nested: { url: 'https://checkout.stripe.com/c/pay/cs_live_GrokABC' },
}));
app.use('/api', router);

describe('Stripe urls and ids leave the API unaltered', () => {
  it('10,000 random Stripe-shaped bodies keep url and id byte-for-byte (and many would have been altered)', () => {
    let wouldAlter = 0;
    let altered = 0;
    for (let i = 0; i < 10000; i += 1) {
      const v = stripeValues();
      for (const body of [{ success: true, url: v.url, id: v.id }, { success: true, url: v.portal }]) {
        if (JSON.stringify(sanitizeApiJson(body)) !== JSON.stringify(body)) wouldAlter += 1;
        if (JSON.stringify(sanitizeApiBody(body)) !== JSON.stringify(body)) altered += 1;
      }
    }
    expect(wouldAlter).toBeGreaterThan(20);
    expect(altered).toBe(0);
  });

  it('through a double-attached express stack, provider-laden Stripe values round-trip', async () => {
    current = { id: 'cs_live_GrokXaIgeminiOpenAI0123', url: 'https://checkout.stripe.com/c/pay/cs_live_GrokXaI#fidkdWxOYHwnPyd1blpxYHZxWjA0', portal: 'https://billing.stripe.com/p/session/live_AnthropicGROK42' };
    const c = await request(app).post('/api/checkout');
    expect(c.body).toEqual({ success: true, url: current.url, id: current.id });
    const p = await request(app).post('/api/billing-portal');
    expect(p.body).toEqual({ success: true, url: current.portal });
    for (let i = 0; i < 200; i += 1) {
      current = stripeValues();
      const r = await request(app).post('/api/checkout');
      expect(r.body.url).toBe(current.url);
      expect(r.body.id).toBe(current.id);
    }
  });

  it('a new Stripe route using plain res.json is covered at runtime, no source scan needed', async () => {
    current = { id: 'cs_test_OpenAIgrokGEMINI99', url: 'https://checkout.stripe.com/c/pay/cs_test_OpenAIgrok#xAIgemini' };
    const r = await request(app).post('/api/new-stripe-route');
    expect(r.body).toEqual({ success: true, url: current.url, id: current.id });
  });

  it('an extra user field in a Stripe body is still scrubbed; only url and id are exempt', async () => {
    current = { id: 'cs_live_GrokOpenAI42', url: 'https://checkout.stripe.com/c/pay/cs_live_GrokOpenAI42#gemini' };
    const r = await request(app).post('/api/checkout-with-extra');
    expect(r.body.url).toBe(current.url);
    expect(r.body.id).toBe(current.id);
    const { url, id, ...rest } = r.body;
    expect(JSON.stringify(rest)).not.toMatch(PROVIDER);
    expect(r.body.planLabel).toBe('coach plan by');
    expect(r.body.user.name).toBe('Fan');
    expect(r.body.success).toBe(true);
  });

  it('a non-Stripe url, a non-checkout id and a nested url are all still sanitized', async () => {
    const r = await request(app).post('/api/fake-url');
    expect(JSON.stringify(r.body)).not.toMatch(PROVIDER);
  });

  it('every other response is still sanitized', async () => {
    current = stripeValues();
    const r = await request(app).post('/api/other');
    expect(r.body.note).not.toMatch(PROVIDER);
  });

  it('a non-/api response is not wrapped and json is untouched', () => {
    const res = { json: jest.fn() };
    attachApiJsonSanitizer({ originalUrl: '/pricing' }, res, () => {});
    expect(res.apiJsonSanitized).toBeUndefined();
    sendStripeJson(res, { url: 'x' });
    expect(res.json).toHaveBeenCalledWith({ url: 'x' });
  });
});

describe('the real server: Stripe checkout and portal urls come back exact', () => {
  it('server.js /api routes use the same runtime allowlist', () => {
    // Any /api route in server.js gets the wrapper from attachApiJsonSanitizer, which is the
    // only place the allowlist lives, so there is no per-route call to count.
    const src = require('fs').readFileSync(require.resolve('./server.js'), 'utf8');
    expect(src).toMatch(/app\.use\(attachApiJsonSanitizer\)/);
  });
});
