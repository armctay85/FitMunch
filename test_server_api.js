/**
 * HTTP-level checks for server.js (health, JSON 404 for unknown /api routes).
 */
const request = require('supertest');
const app = require('./server.js');

describe('Server API shell', () => {
  it('GET /api/health returns ok JSON', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('fitmunch');
  });

  it('GET unknown /api path returns JSON 404', async () => {
    const res = await request(app)
      .get('/api/__smoke_no_such_route__')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('GET / serves the home page HTML', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text.length).toBeGreaterThan(100);
  });

  it('GET auth aliases redirect to register/login surfaces', async () => {
    await request(app).get('/signup').expect(301).expect('Location', '/login.html?plan=premium#register');
    await request(app).get('/sign-up').expect(301).expect('Location', '/login.html?plan=premium#register');
    await request(app).get('/register').expect(301).expect('Location', '/login.html?plan=premium#register');
    await request(app).get('/auth').expect(301).expect('Location', '/login.html?plan=premium#register');
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
