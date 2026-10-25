'use strict';
/**
 * Payment-failed send claims against Postgres.
 * A 503 whose release throws leaves a pending row. A retry inside the
 * takeover window does not send and does not say the customer was emailed.
 * Once that pending claim is stale, the retry sends once.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_payment_failed_email_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) {
  throw new Error('TEST_DATABASE_URL looks like a real database');
}
const maybe = URL ? describe : describe.skip;
const PREV_URL = process.env.DATABASE_URL;
const PREV_SSL = process.env.DATABASE_SSL;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const request = require('supertest');
const app = require('./server.js');
const emailApi = require('./server/email.js');
const stripeEvents = require('./lib/stripe-events');
const { ensureSchema, getPool } = require('./lib/db-migrate');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');
const { paymentFailedSendKey } = require('./lib/stripe-webhook');

function makeStripe(status) {
  const sub = {
    id: 'sub_pf_pg',
    customer: 'cus_pf_pg',
    status,
    items: { data: [{ price: { id: PRICE_IDS.premium } }] },
  };
  return {
    sub,
    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
    },
    subscriptions: {
      retrieve: jest.fn(async () => sub),
      list: jest.fn(async () => ({ data: [sub] })),
    },
    customers: {
      retrieve: jest.fn(async () => ({ id: 'cus_pf_pg', email: 'member@example.com' })),
    },
  };
}

function invoice(overrides = {}) {
  return {
    id: 'in_fail_release',
    customer: 'cus_pf_pg',
    customer_email: 'member@example.com',
    subscription: 'sub_pf_pg',
    attempt_count: 1,
    next_payment_attempt: 1893456000,
    amount_due: 1999,
    currency: 'aud',
    lines: { data: [{ price: { id: PRICE_IDS.premium } }] },
    ...overrides,
  };
}

function failedEvent(id, overrides) {
  return { id, type: 'invoice.payment_failed', data: { object: invoice(overrides) } };
}

function post(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

async function sendStatus(sendKey) {
  const found = await getPool().query(
    'SELECT status FROM stripe_welcome_sends WHERE send_key = $1',
    [sendKey]
  );
  return found.rows[0] ? found.rows[0].status : null;
}

async function wipe() {
  const pool = getPool();
  await pool.query(
    `DELETE FROM stripe_welcome_sends
     WHERE send_key LIKE 'payment_failed:in_fail_release%'
        OR send_key LIKE 'payment_failed:in_fail_race%'`
  );
  await pool.query(`DELETE FROM stripe_events WHERE event_id LIKE 'evt_pf_%'`);
  await pool.query(`DELETE FROM stripe_webhook_retries WHERE event_id LIKE 'evt_pf_%'`);
}

maybe('payment failed send claims (postgres)', () => {
  jest.setTimeout(30000);
  let customer;
  let owner;

  beforeAll(async () => {
    const ready = await ensureSchema();
    if (!ready) throw new Error('schema was not ensured');
  });

  beforeEach(async () => {
    delete process.env.ALERT_EMAIL_TO;
    app._private.setStripeForTests(makeStripe('active'));
    customer = jest.spyOn(emailApi, 'sendPaymentFailedEmail').mockResolvedValue({ success: true });
    owner = jest.spyOn(emailApi, 'sendPaymentFailedOwnerAlert').mockResolvedValue({ success: true });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await wipe();
  });

  afterEach(async () => {
    delete process.env.ALERT_EMAIL_TO;
    customer.mockRestore();
    owner.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
    app._private.setStripeForTests(null);
    await wipe();
  });

  afterAll(() => {
    if (PREV_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = PREV_URL;
    if (PREV_SSL === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = PREV_SSL;
  });

  test('a 503 whose claim release throws is sent once on the stale retry', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    customer.mockResolvedValueOnce({ success: false, error: 'Resend error: 503 {}' });
    const release = jest.spyOn(stripeEvents, 'releaseNotificationSend').mockRejectedValueOnce(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    );
    const event = failedEvent('evt_pf_release_1');
    const customerKey = paymentFailedSendKey(event, event.data.object, 'customer');
    try {
      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBe('pending');

      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBe('pending');

      await stripeEvents.ageNotificationSendForTests(customerKey, stripeEvents.STALE_CLAIM_MS + 1000);
      expect((await post(event)).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
      expect(await sendStatus(customerKey)).toBe('sent');

      expect((await post(failedEvent('evt_pf_release_2'))).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(owner).toHaveBeenCalledTimes(1);
    } finally {
      release.mockRestore();
    }
  });

  test('two events for one attempt send the customer email once', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const overrides = { id: 'in_fail_race' };
    const [first, second] = await Promise.all([
      post(failedEvent('evt_pf_race_a', overrides)),
      post(failedEvent('evt_pf_race_b', overrides)),
    ]);
    expect([first.status, second.status]).toContain(200);
    const followUps = [];
    if (first.status !== 200) followUps.push(post(failedEvent('evt_pf_race_a', overrides)));
    if (second.status !== 200) followUps.push(post(failedEvent('evt_pf_race_b', overrides)));
    const retried = await Promise.all(followUps);
    for (const res of retried) expect(res.status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0][1].customerNotified).toBe(true);
    const customerKey = paymentFailedSendKey(
      { id: 'evt_pf_race_a' },
      invoice(overrides),
      'customer'
    );
    expect(await sendStatus(customerKey)).toBe('sent');
  });
});
