'use strict';
// Stripe Checkout / Billing Portal urls and ids carry long random parts that hit a provider
// word by chance (measured on main: 862 of 100,000 checkouts, about 1 in 116), and the /api
// sanitizer then broke the url or id. Stripe responses now bypass the sanitizer.
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { attachApiJsonSanitizer, sendStripeJson, sanitizeApiJson } = require('./lib/sanitize-api-json');

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rand = (n) => Array.from(crypto.randomBytes(n), (b) => A[b % 62]).join('');
function stripeValues() {
  const id = `cs_live_${rand(58)}`;
  return {
    id,
    url: `https://checkout.stripe.com/c/pay/${id}#${crypto.randomBytes(90).toString('base64url')}`,
    portal: `https://billing.stripe.com/p/session/live_${rand(64)}`,
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
router.post('/other', (req, res) => res.json({ success: true, note: `Answered by Grok ${current.id}` }));
app.use('/api', router);

describe('Stripe urls and ids leave the API unaltered', () => {
  it('10,000 random Stripe-shaped values pass sendStripeJson byte-for-byte (and many would have been altered)', () => {
    let wouldAlter = 0;
    let altered = 0;
    for (let i = 0; i < 10000; i += 1) {
      const v = stripeValues();
      const body = { success: true, url: v.url, id: v.id, portal: v.portal };
      if (JSON.stringify(sanitizeApiJson(body)) !== JSON.stringify(body)) wouldAlter += 1;
      let sent;
      const res = { jsonUnsanitized: (b) => { sent = b; }, json: (b) => { sent = sanitizeApiJson(b); } };
      sendStripeJson(res, body);
      if (JSON.stringify(sent) !== JSON.stringify(body)) altered += 1;
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

  it('every other response is still sanitized', async () => {
    current = stripeValues();
    const r = await request(app).post('/api/other');
    expect(r.body.note).not.toMatch(PROVIDER);
  });

  it('a non-/api response has no bypass and json is untouched', () => {
    const res = { json: jest.fn() };
    attachApiJsonSanitizer({ originalUrl: '/pricing' }, res, () => {});
    expect(res.jsonUnsanitized).toBeUndefined();
    sendStripeJson(res, { url: 'x' });
    expect(res.json).toHaveBeenCalledWith({ url: 'x' });
  });

  it('every Stripe url/id response in server.js goes through sendStripeJson', () => {
    const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
    expect((src.match(/sendStripeJson\(res, /g) || []).length).toBe(6);
    expect(src).not.toMatch(/res\.json\(\{[^}]*url: (result|portal)\.url/);
    expect(src).not.toMatch(/res\.json\(\s*\{\s*success: true,\s*url: result\.url/);
    expect(src).not.toMatch(/res\.json\((\{ success: true, \.\.\.)?checkoutJson/);
  });
});
