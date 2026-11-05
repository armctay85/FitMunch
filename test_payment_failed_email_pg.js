'use strict';
/**
 * Payment-failed send claims against Postgres.
 * A 503 whose release throws leaves a pending row. A retry inside the
 * takeover window does not send and does not say the customer was emailed.
 * Once that pending claim is stale, the retry sends once.
 *
 * Also covers the three claim races that a memory map cannot prove:
 * a stale takeover while the first send is still in flight, a fresh
 * in-flight claim, and a send that succeeded while mark-sent failed.
 * The provider double follows Resend: one Idempotency-Key is one delivery,
 * an in-flight repeat is concurrent_idempotent_requests, and a later repeat
 * replays the first acceptance.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Real Postgres, not pg-mem:
 * the claim SQL uses INSERT ON CONFLICT, UPDATE ... WHERE claimed_at <
 * NOW() - INTERVAL, and rowCount, which is what production runs.
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
     WHERE send_key LIKE 'payment_failed:in_fail_%'`
  );
  await pool.query(`DELETE FROM stripe_events WHERE event_id LIKE 'evt_pf_%'`);
  await pool.query(`DELETE FROM stripe_webhook_retries WHERE event_id LIKE 'evt_pf_%'`);
}

async function claimRow(sendKey) {
  const found = await getPool().query(
    'SELECT status, claim_token FROM stripe_welcome_sends WHERE send_key = $1',
    [sendKey]
  );
  return found.rows[0] || null;
}

async function ageEvent(eventId) {
  await getPool().query(
    `UPDATE stripe_events
     SET received_at = NOW() - ($2::bigint * INTERVAL '1 millisecond')
     WHERE event_id = $1 AND processed_at IS NULL`,
    [eventId, stripeEvents.STALE_CLAIM_MS + 1000]
  );
}

async function waitFor(predicate, label) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(label || 'timed out');
}

// supertest does not send until something awaits the request.
function start(pending) {
  pending.then(() => {}, () => {});
  return pending;
}

// Same rules Resend documents for Idempotency-Key. begin() is the request
// arriving. finish() is that request being accepted. A second begin while
// the first is in flight is not a second delivery.
function resendDouble() {
  const keys = new Map();
  let deliveries = 0;
  return {
    get deliveries() { return deliveries; },
    begin(key) {
      const row = keys.get(key);
      if (row && row.status === 'inflight') return { concurrent: true };
      if (row && row.status === 'sent') return { replay: true, messageId: row.id };
      keys.set(key, { status: 'inflight' });
      return { started: true };
    },
    finish(key) {
      const row = keys.get(key);
      if (!row || row.status !== 'inflight') throw new Error('finish without an in-flight send');
      deliveries += 1;
      const id = `msg_${deliveries}`;
      row.status = 'sent';
      row.id = id;
      return { success: true, messageId: id };
    },
  };
}

const CONCURRENT_ERROR = 'Resend error: 409 {"name":"concurrent_idempotent_requests","message":"in progress"}';

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

  test('a fresh in-flight claim does not send a second delivery', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    customer.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await held;
      return { success: true };
    });
    const overrides = { id: 'in_fail_inflight' };
    const firstEvent = failedEvent('evt_pf_inflight_a', overrides);
    const customerKey = paymentFailedSendKey(firstEvent, firstEvent.data.object, 'customer');
    let first = Promise.resolve();
    try {
      first = start(post(firstEvent));
      await waitFor(() => calls === 1, 'first send did not start');
      expect(await sendStatus(customerKey)).toBe('pending');
      const second = await post(failedEvent('evt_pf_inflight_b', overrides));
      expect(second.status).toBe(500);
      expect(calls).toBe(1);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBe('pending');
      release();
      expect((await first).status).toBe(200);
      expect(calls).toBe(1);
      expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
      expect(await sendStatus(customerKey)).toBe('sent');
      expect((await post(failedEvent('evt_pf_inflight_b', overrides))).status).toBe(200);
      expect(calls).toBe(1);
      expect(owner).toHaveBeenCalledTimes(1);
      for (const call of owner.mock.calls) expect(call[1].customerNotified).toBe(true);
    } finally {
      release();
      await first.catch(() => {});
    }
  });

  test('a stale takeover cannot double-deliver or let the old claim mark or release', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const gate = resendDouble();
    let calls = 0;
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    const secondHeld = new Promise((resolve) => { releaseSecond = resolve; });
    customer.mockImplementation(async (_to, opts) => {
      calls += 1;
      const key = opts.idempotencyKey;
      const attempt = gate.begin(key);
      if (attempt.started) {
        await firstHeld;
        return gate.finish(key);
      }
      if (attempt.concurrent) {
        await secondHeld;
        return { success: false, error: CONCURRENT_ERROR };
      }
      return { success: true, messageId: attempt.messageId };
    });
    const overrides = { id: 'in_fail_takeover' };
    const event = failedEvent('evt_pf_takeover', overrides);
    const customerKey = paymentFailedSendKey(event, event.data.object, 'customer');
    let first = Promise.resolve();
    let second = Promise.resolve();
    try {
      first = start(post(event));
      await waitFor(() => calls === 1, 'first send did not start');
      const original = await claimRow(customerKey);
      expect(original.status).toBe('pending');
      expect(original.claim_token).toEqual(expect.any(String));
      await stripeEvents.ageNotificationSendForTests(customerKey, stripeEvents.STALE_CLAIM_MS + 1000);
      await ageEvent('evt_pf_takeover');
      second = start(post(event));
      await waitFor(() => calls === 2, 'takeover did not send');
      const taken = await claimRow(customerKey);
      expect(taken.status).toBe('pending');
      expect(taken.claim_token).toEqual(expect.any(String));
      expect(taken.claim_token).not.toBe(original.claim_token);
      await stripeEvents.releaseNotificationSend(customerKey, original.claim_token);
      expect(await claimRow(customerKey)).toEqual({
        status: 'pending',
        claim_token: taken.claim_token,
      });
      await expect(stripeEvents.markNotificationSent(customerKey, original.claim_token))
        .rejects.toThrow(/sent mark failed/);
      expect(await claimRow(customerKey)).toEqual({
        status: 'pending',
        claim_token: taken.claim_token,
      });
      expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
      expect(customer.mock.calls[1][1].idempotencyKey).toBe(customerKey);
      expect(owner).not.toHaveBeenCalled();

      releaseSecond();
      expect((await second).status).toBe(500);
      expect(owner).not.toHaveBeenCalled();
      expect(gate.deliveries).toBe(0);
      releaseFirst();
      expect((await first).status).toBe(500);
      expect(gate.deliveries).toBe(1);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBeNull();

      expect((await post(event)).status).toBe(200);
      expect(gate.deliveries).toBe(1);
      expect(calls).toBe(3);
      expect(customer.mock.calls[2][1].idempotencyKey).toBe(customerKey);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
      expect(owner.mock.calls[0][1].idempotencyKey).toBe(
        paymentFailedSendKey(event, event.data.object, 'owner:ops@example.com')
      );
      expect(await sendStatus(customerKey)).toBe('sent');

      expect((await post(failedEvent('evt_pf_takeover_2', overrides))).status).toBe(200);
      expect(calls).toBe(3);
      expect(gate.deliveries).toBe(1);
      expect(owner).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.allSettled([first, second]);
    }
  });

  test('a successful send whose mark fails is delivered once on the later retry', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const gate = resendDouble();
    customer.mockImplementation(async (_to, opts) => {
      const attempt = gate.begin(opts.idempotencyKey);
      if (attempt.concurrent) return { success: false, error: CONCURRENT_ERROR };
      if (attempt.replay) return { success: true, messageId: attempt.messageId };
      return gate.finish(opts.idempotencyKey);
    });
    const mark = jest.spyOn(stripeEvents, 'markNotificationSent').mockRejectedValueOnce(
      Object.assign(new Error('write failed'), { code: 'WEBHOOK_RETRY' })
    );
    const overrides = { id: 'in_fail_mark' };
    const event = failedEvent('evt_pf_mark', overrides);
    const customerKey = paymentFailedSendKey(event, event.data.object, 'customer');
    try {
      expect((await post(event)).status).toBe(500);
      expect(gate.deliveries).toBe(1);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBe('pending');

      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(gate.deliveries).toBe(1);
      expect(owner).not.toHaveBeenCalled();
      expect(await sendStatus(customerKey)).toBe('pending');

      await stripeEvents.ageNotificationSendForTests(customerKey, stripeEvents.STALE_CLAIM_MS + 1000);
      expect((await post(event)).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(customer.mock.calls[1][1].idempotencyKey).toBe(customerKey);
      expect(gate.deliveries).toBe(1);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
      expect(await sendStatus(customerKey)).toBe('sent');

      expect((await post(failedEvent('evt_pf_mark_2', overrides))).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(gate.deliveries).toBe(1);
      expect(owner).toHaveBeenCalledTimes(1);
      for (const call of owner.mock.calls) expect(call[1].customerNotified).toBe(true);
    } finally {
      mark.mockRestore();
    }
  });
});
