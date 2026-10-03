const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const app = require('./server');
const { setFunnelSinkForTests, resetFunnelEventsForTests } = require('./lib/funnel-events');
const { handleSmokeCheckout, smokeParams, isSmokeStripeSession } = require('./lib/smoke-checkout-endpoint');
const { jwtSecret, PRICE_IDS } = require('./lib/fitmunch-checkout');

const SMOKE_EMAIL = 'smoke-prod@fitmunch.com.au';

function liveSession(params) {
  return {
    id: 'cs_live_abc123456789',
    url: 'https://checkout.stripe.com/c/pay/cs_live_abc123456789',
    currency: 'aud',
    locale: 'en-GB',
    branding_settings: { display_name: 'FitMunch' },
    metadata: params.metadata,
  };
}

function storageFor(user) {
  return {
    async getUserById() { return user; },
    effectiveTier() { return 'free'; },
    async withStripeCustomerLock(key, fn) { return fn(); },
    async updateUserSubscription() { throw new Error('smoke wrote to the database'); },
  };
}

function stripeFactory(sessionFor) {
  const calls = [];
  return {
    calls,
    async rawRequest(method, requestPath, params) {
      calls.push({ method, requestPath, params });
      if (String(requestPath).endsWith('/expire')) return { id: 'cs_live_abc123456789', status: 'expired' };
      return sessionFor(params);
    },
    customers: { create() { throw new Error('customer create'); } },
  };
}

function sign(email) {
  return jwt.sign({ userId: 'user-smoke', email }, jwtSecret());
}

async function postSmoke(deps, { token, bearer } = {}) {
  const mini = express();
  mini.use(express.json());
  mini.post('/api/internal/smoke/checkout', (req, res) => handleSmokeCheckout(req, res, deps));
  const req = request(mini).post('/api/internal/smoke/checkout');
  if (token) req.set('x-fitmunch-smoke-token', token);
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  return req.send({});
}

describe('smoke checkout endpoint', () => {
  afterEach(() => resetFunnelEventsForTests());

  it('is mounted on the app and stays a 404 without the smoke token', async () => {
    const previous = process.env.SMOKE_TOKEN;
    delete process.env.SMOKE_TOKEN;
    const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(source).toContain('mountSmokeCheckout');
    const res = await request(app).post('/api/internal/smoke/checkout').send({});
    if (previous == null) delete process.env.SMOKE_TOKEN;
    else process.env.SMOKE_TOKEN = previous;
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not found' });
  });

  it('returns 404 for the wrong token and 403 for another account', async () => {
    const wrong = await postSmoke({ token: 'correct-token', email: SMOKE_EMAIL, getStripe: () => null }, {
      token: 'wrong-token',
    });
    expect(wrong.status).toBe(404);

    const other = await postSmoke({ token: 'correct-token', email: SMOKE_EMAIL, getStripe: () => null }, {
      token: 'correct-token',
      bearer: sign('buyer@example.com'),
    });
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toContain('buyer@example.com');
  });

  it('returns 503 when the server has no Stripe client', async () => {
    const res = await postSmoke({
      token: 'correct-token',
      email: SMOKE_EMAIL,
      getStripe: () => null,
      storage: storageFor({ id: 'user-smoke' }),
    }, { token: 'correct-token', bearer: sign(SMOKE_EMAIL) });
    expect(res.status).toBe(503);
    expect(res.body.missing).toEqual(['stripe']);
  });

  it('creates a live session with the production price, expires it, and skips funnel and customers', async () => {
    const funnel = [];
    setFunnelSinkForTests((event) => funnel.push(event));
    const stripe = stripeFactory(liveSession);
    const storage = storageFor({ id: 'user-smoke', email: SMOKE_EMAIL });
    const res = await postSmoke({
      token: 'correct-token',
      email: SMOKE_EMAIL,
      getStripe: () => stripe,
      storage,
    }, { token: 'correct-token', bearer: sign(SMOKE_EMAIL) });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('live');
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect(res.body.session.startsWith('cs_live_')).toBe(true);
    expect(res.body.expired).toBe(true);
    expect(res.body.storage).toBe('ok');
    const create = stripe.calls.find((call) => call.requestPath === '/v1/checkout/sessions');
    expect(create.params.customer).toBeUndefined();
    expect(create.params.customer_email).toBe(SMOKE_EMAIL);
    expect(create.params.metadata.smoke).toBe('true');
    expect(create.params.line_items[0].price).toBe(PRICE_IDS.premium);
    expect(stripe.calls.some((call) => call.requestPath.endsWith('/expire'))).toBe(true);
    expect(funnel).toEqual([]);
    expect(JSON.stringify(stripe.calls)).not.toContain('customers');
  });

  it('expires a test-mode session and refuses it', async () => {
    const stripe = stripeFactory(() => ({
      id: 'cs_test_abc123456789',
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc123456789',
      currency: 'aud',
    }));
    const res = await postSmoke({
      token: 'correct-token',
      email: SMOKE_EMAIL,
      getStripe: () => stripe,
      storage: storageFor({ id: 'user-smoke' }),
    }, { token: 'correct-token', bearer: sign(SMOKE_EMAIL) });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('test_session_refused');
    expect(res.body.url).toBeUndefined();
    expect(stripe.calls.some((call) => call.requestPath.endsWith('/expire'))).toBe(true);
  });

  it('hides internal failures behind smoke_failed and logs the detail server-side', async () => {
    const errors = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));
    const storage = storageFor({ id: 'user-smoke' });
    storage.getUserById = async () => { throw new Error('relation "users" does not exist'); };
    const res = await postSmoke({
      token: 'correct-token',
      email: SMOKE_EMAIL,
      getStripe: () => stripeFactory(liveSession),
      storage,
    }, { token: 'correct-token', bearer: sign(SMOKE_EMAIL) });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'smoke_failed' });
    expect(JSON.stringify(res.body)).not.toContain('relation');
    expect(errors.some((line) => line.includes('relation') && line.includes('users') && line.includes('does not exist'))).toBe(true);
  });

  it('does not return a payable URL when expire fails', async () => {
    const stripe = {
      async rawRequest(method, requestPath, params) {
        if (String(requestPath).endsWith('/expire')) throw new Error('expire down');
        return liveSession(params);
      },
    };
    const res = await postSmoke({
      token: 'correct-token',
      email: SMOKE_EMAIL,
      getStripe: () => stripe,
      storage: storageFor({ id: 'user-smoke' }),
    }, { token: 'correct-token', bearer: sign(SMOKE_EMAIL) });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('expire_failed');
    expect(res.body.url).toBeUndefined();
  });

  it('does not reference the live secret key or the funnel checkout helper', () => {
    const source = fs.readFileSync(path.join(__dirname, 'lib/smoke-checkout-endpoint.js'), 'utf8');
    const script = fs.readFileSync(path.join(__dirname, 'scripts/smoke-prod.mjs'), 'utf8');
    expect(source).not.toContain('STRIPE_SECRET_KEY');
    expect(script).not.toContain('STRIPE_SECRET_KEY');
    expect(source).not.toContain('createFitMunchCheckoutSession');
    expect(source).not.toContain('scheduleFunnelEvent');
    const params = smokeParams(SMOKE_EMAIL);
    expect(params.customer).toBeUndefined();
    expect(params.metadata.smoke).toBe('true');
    expect(isSmokeStripeSession({ metadata: { smoke: 'true' } })).toBe(true);
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(server).toContain('Ignoring smoke checkout session');
  });
});
