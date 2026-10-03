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
  metadata: { plan: 'premium' },
  customer: 'cus_victim123',
  customer_email: 'victim@example.com',
  customer_details: { email: 'victim@example.com', name: 'Victim' },
};

beforeAll(() => {
  app._private.setStripeForTests({
    checkout: { sessions: { retrieve: jest.fn(async (id) => {
      if (id !== session.id) { const e = new Error('No such session'); e.statusCode = 404; throw e; }
      return session;
    }) } },
  });
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

  test('unknown session is 404 with no-store', async () => {
    const res = await request(app).get('/api/checkout/session').query({ session_id: 'cs_nope' });
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});
