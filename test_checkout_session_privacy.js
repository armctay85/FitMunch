/**
 * GET /api/checkout/session is unauthenticated. It must not leak the payer's
 * email or Stripe customer id, and must not be cached.
 */
const request = require('supertest');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const app = require('./server.js');

const session = {
  id: 'cs_test_privacy',
  payment_status: 'paid',
  metadata: { plan: 'premium', app: 'fitmunch' },
  customer: 'cus_victim123',
  customer_email: 'victim@example.com',
  customer_details: { email: 'victim@example.com', name: 'Victim' },
};

// Another product on the shared Stripe account.
const otherBrandSession = {
  id: 'cs_test_other_brand',
  status: 'complete',
  payment_status: 'paid',
  metadata: { plan: 'growth', app: 'wipper' },
  customer: 'cus_other123',
};

let fakeStripe;
beforeAll(() => {
  fakeStripe = ({
    checkout: { sessions: { retrieve: jest.fn(async (id) => {
      if (id === otherBrandSession.id) return otherBrandSession;
      if (id !== session.id) { const e = new Error('No such checkout.session: cs_secret_internal sk_test_leak'); e.statusCode = 404; throw e; }
      return session;
    }) } },
  });
  app._private.setStripeForTests(fakeStripe);
});

afterAll(() => app._private.setStripeForTests(null));

describe('GET /api/checkout/session privacy', () => {
  test('returns plan only, no email or customer id, and no-store', async () => {
    const res = await request(app).get('/api/checkout/session').query({ session_id: session.id });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('premium');
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('customerId');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/victim@example\.com/);
    expect(raw).not.toMatch(/cus_/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('unknown session is 404 with no-store and no Stripe error echo', async () => {
    const res = await request(app).get('/api/checkout/session').query({ session_id: 'cs_nope' });
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/cs_secret_internal|sk_test_leak|No such checkout/);
  });

  test('a session for another product on the shared Stripe account is 404', async () => {
    const res = await request(app).get('/api/checkout/session').query({ session_id: otherBrandSession.id });
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ error: 'Session not found.' });
    expect(JSON.stringify(res.body)).not.toMatch(/growth|paid|cus_|guestCheckout/);
  });

  test('missing session_id is 400 with no-store', async () => {
    const res = await request(app).get('/api/checkout/session');
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('Stripe not configured is 503 with no-store', async () => {
    app._private.setStripeForTests(null);
    try {
      const res = await request(app).get('/api/checkout/session').query({ session_id: session.id });
      expect(res.status).toBe(503);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    } finally {
      app._private.setStripeForTests(fakeStripe);
    }
  });
});
