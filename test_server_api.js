/**
 * HTTP-level checks for server.js (health, JSON 404 for unknown /api routes).
 */
const request = require('supertest');
const app = require('./server.js');

describe('Server API shell', () => {
  it('GET /api/health returns ok JSON without deploy or config internals', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('fitmunch');
    expect(res.body.deploy).toBeUndefined();
    expect(res.body.ready).toBeUndefined();
    expect(res.body.runtime).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/jwt|stripeWebhook|gemini|resend/i);
  });

  it('GET /funnel and /funnel.html require an analytics key', async () => {
    await request(app).get('/funnel').expect(401);
    await request(app).get('/funnel.html').expect(401);
  });

  it('GET /api/stripe-test is not a public probe', async () => {
    const res = await request(app).get('/api/stripe-test').expect(404);
    expect(res.body.success).toBe(false);
  });

  it('GET unknown /api path returns JSON 404', async () => {
    const res = await request(app)
      .get('/api/__smoke_no_such_route__')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('GET /app.html is a login wall until the client has a session', async () => {
    const res = await request(app).get('/app.html').expect(200);
    expect(res.text).toContain('Sign in to FitMunch');
    expect(res.text).toContain('html:not(.fm-authed)');
    expect(res.text).toContain("localStorage.getItem('fm_token')");
  });

  it('GET /app redirects to /app.html', async () => {
    await request(app).get('/app').expect(302).expect('Location', '/app.html');
  });

  it('GET / serves the home page HTML', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text.length).toBeGreaterThan(100);
  });

  it('GET auth aliases redirect to register/login surfaces', async () => {
    await request(app).get('/signup').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/sign-up').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/register').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/auth').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/register?plan=premium').expect(301).expect('Location', '/login.html?plan=premium#register');
  });
});

describe('Stripe subscription tier updates', () => {
  const { subscriptionTierUpdateFromStripe } = app._private;

  it('maps active Premium subscriptions to a tier and timestamp expiry', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'active',
      current_period_end: 1798761600,
      items: { data: [{ price: { id: 'price_1ToYrXGMuYRuJYDrwHtvWD1c' } }] },
    });

    expect(update.tier).toBe('premium');
    expect(update.expiresAt).toBeInstanceOf(Date);
    expect(update.expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('falls back to item period end for trialing subscriptions', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'trialing',
      items: {
        data: [{
          current_period_end: 1798765200,
          price: { id: 'price_1T3SyDGMuYRuJYDrF8mvMrwi' },
        }],
      },
    });

    expect(update.tier).toBe('pro');
    expect(update.expiresAt.toISOString()).toBe('2027-01-01T01:00:00.000Z');
  });

  it('downgrades non-live subscription states without writing a string as expiry', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'canceled',
      id: 'sub_should_not_be_stored_as_timestamp',
      items: { data: [{ price: { id: 'price_1T3SvgGMuYRuJYDrOyR2hYoq' } }] },
    });

    expect(update).toEqual({ tier: 'free', expiresAt: null });
  });
});
