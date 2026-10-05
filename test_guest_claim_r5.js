/**
 * PR #52 round 5: claim-resend replies at one fixed time, shared (Postgres)
 * rate limits, owner-email check, WEBHOOK_RETRY counting and alert, vendored
 * Chart.js hygiene.
 */
const request = require('supertest');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const fs = require('fs');
const path = require('path');
const app = require('./server.js');
const storage = require('./server/storage.js');
const emailApi = require('./server/email.js');
const stripeEvents = require('./lib/stripe-events');
const guestClaim = require('./lib/guest-claim');
const counters = require('./lib/shared-counters');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');

const orig = { ...storage };
let ipCounter = 0;
const nextIp = () => `192.0.2.${(ipCounter += 1) % 250}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] == null) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const done = () => {
    for (const k of Object.keys(prev)) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
  return Promise.resolve().then(fn).finally(done);
}

function noUsers() {
  storage.db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
}

function fakeCounterDb() {
  const rate = new Map();
  const retries = new Map();
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('DELETE FROM')) return { rows: [] };
    if (sql.includes('INSERT INTO rate_limit_counters')) {
      const key = params.slice(0, 3).join('|');
      const hits = (rate.get(key) || 0) + 1;
      rate.set(key, hits);
      return { rows: [{ hits }] };
    }
    if (sql.includes('INSERT INTO stripe_webhook_retries')) {
      const row = retries.get(params[0]) || { retries: 0, alerted: false, type: params[1] };
      row.retries += 1;
      retries.set(params[0], row);
      return { rows: [{ retries: row.retries }] };
    }
    if (sql.includes('UPDATE stripe_webhook_retries')) {
      const row = retries.get(params[0]);
      if (row && !row.alerted) { row.alerted = true; return { rows: [{ event_id: params[0] }] }; }
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
  return { query, rate, retries, calls };
}

const PAYER = 'guest.payer@example.com';
function guestSession(extra = {}) {
  return {
    id: 'cs_guest_1', customer: 'cus_guest', status: 'complete', payment_status: 'paid',
    created: 1000, metadata: { app: 'fitmunch', plan: 'premium' },
    customer_details: { email: PAYER }, ...extra,
  };
}
function stripeWith({ sessions, customers, delayMs = 0 }) {
  return {
    customers: { list: jest.fn(async ({ email }) => {
      await sleep(delayMs);
      return { data: customers.filter((c) => c.email.toLowerCase() === String(email).toLowerCase()) };
    }) },
    checkout: { sessions: {
      list: jest.fn(async ({ customer }) => {
        await sleep(delayMs);
        return { data: sessions.filter((s) => s.customer === customer) };
      }),
    } },
  };
}
function ask(email, ip = nextIp()) {
  return request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', ip).send({ email });
}
async function timed(email) {
  const t0 = Date.now();
  const res = await ask(email);
  return { res, ms: Date.now() - t0 };
}

// These tests rotate X-Forwarded-For to get a fresh rate-limit bucket per
// request, so simulate one trusted proxy (as on Vercel): req.ip is then the
// right-most hop. test_rate_limit_ip.js covers the untrusted case.
const trustProxyBefore = app.get('trust proxy');
beforeAll(() => app.set('trust proxy', 1));
afterAll(() => app.set('trust proxy', trustProxyBefore));

beforeEach(() => {
  stripeEvents.resetStripeEventsForTests();
  guestClaim.resetGuestClaimsForTests();
  noUsers();
});
afterEach(() => {
  Object.assign(storage, orig);
  app._private.setStripeForTests(null);
  jest.restoreAllMocks();
});

describe('claim-resend replies at one fixed time', () => {
  test('a match and a miss reply within 50ms of each other, with slow Stripe and a slow send', async () => {
    await withEnv({ CLAIM_RESEND_WINDOW_MS: '500' }, async () => {
      const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockImplementation(async () => {
        await sleep(120);
        return { success: true };
      });
      app._private.setStripeForTests(stripeWith({
        delayMs: 80,
        customers: [{ id: 'cus_guest', email: PAYER }],
        sessions: [guestSession()],
      }));
      // Warm up supertest's server and the require cache so the first
      // measured request isn't paying start-up cost.
      await ask('warmup@example.com');
      const hits = [];
      const misses = [];
      for (let i = 0; i < 2; i += 1) {
        hits.push(await timed(i ? PAYER : 'Guest.Payer@Example.com'));
        misses.push(await timed(`nobody${i}@example.com`));
      }
      misses.push(await timed('not-an-email'));
      for (const { res } of [...hits, ...misses]) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, message: guestClaim.RESEND_GENERIC_REPLY });
      }
      expect(send).toHaveBeenCalledTimes(2);
      const all = [...hits, ...misses].map((x) => x.ms);
      if (process.env.FM_TIMING_LOG) console.log('claim-resend timing', JSON.stringify({ hits: hits.map((x) => x.ms), misses: misses.map((x) => x.ms) }));
      expect(Math.min(...all)).toBeGreaterThanOrEqual(495);
      const avg = (xs) => xs.reduce((a, b) => a + b.ms, 0) / xs.length;
      expect(Math.abs(avg(hits) - avg(misses))).toBeLessThan(50);
      expect(Math.max(...all) - Math.min(...all)).toBeLessThan(50);
    });
  });

  test('a send that overruns its cap still replies on time and is logged', async () => {
    await withEnv({ CLAIM_RESEND_WINDOW_MS: '300' }, async () => {
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(emailApi, 'sendClaimLinkEmail').mockImplementation(() => sleep(2000).then(() => ({ success: true })));
      app._private.setStripeForTests(stripeWith({ customers: [{ id: 'cus_guest', email: PAYER }], sessions: [guestSession()] }));
      const { res, ms } = await timed(PAYER);
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(350);
      expect(errors.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('CLAIM_RESEND_TIMEOUT: send');
    });
  });

  test('a Stripe lookup that hangs still replies on time with the generic reply', async () => {
    await withEnv({ CLAIM_RESEND_WINDOW_MS: '300' }, async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
      const stripe = stripeWith({ customers: [], sessions: [] });
      stripe.customers.list = jest.fn(() => new Promise(() => {}));
      app._private.setStripeForTests(stripe);
      const { res, ms } = await timed(PAYER);
      expect(res.body.message).toBe(guestClaim.RESEND_GENERIC_REPLY);
      expect(ms).toBeLessThan(350);
      expect(send).not.toHaveBeenCalled();
    });
  });
});

describe('claim-resend only sends when the Stripe email still equals the checkout email', () => {
  test('a changed Stripe email gets nothing at either address, with the same reply', async () => {
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({
      customers: [{ id: 'cus_guest', email: 'new@example.com' }],
      sessions: [guestSession({ customer_details: { email: 'old@example.com' } })],
    }));
    const a = await ask('new@example.com');
    const b = await ask('old@example.com');
    expect(a.body).toEqual(b.body);
    expect(a.body.message).toBe(guestClaim.RESEND_GENERIC_REPLY);
    expect(send).not.toHaveBeenCalled();
  });

  test('case-insensitive match, and customer_email is used when customer_details is missing', async () => {
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({
      customers: [{ id: 'cus_guest', email: 'Guest.Payer@Example.COM' }],
      sessions: [guestSession({ customer_details: undefined, customer_email: 'GUEST.payer@example.com' })],
    }));
    await ask('guest.payer@example.com');
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('no recorded checkout email means no send', async () => {
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({
      customers: [{ id: 'cus_guest', email: PAYER }],
      sessions: [guestSession({ customer_details: { email: null } })],
    }));
    await ask(PAYER);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('claim-resend rate limits are shared through Postgres', () => {
  test('per-IP and per-email counts go to rate_limit_counters, hashed', async () => {
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({ customers: [{ id: 'cus_guest', email: PAYER }], sessions: [guestSession()] }));
    // setStripeForTests resets counters, so install the fake DB after it.
    const db = fakeCounterDb();
    counters.setSharedCounterQueryForTests(db.query);
    const ip = '198.51.100.23';
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await ask(PAYER, ip)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // Per email: 5 asks reached the handler, only 3 sends in the hour.
    expect(send).toHaveBeenCalledTimes(3);
    const inserts = db.calls.filter((c) => c.sql.includes('INSERT INTO rate_limit_counters'));
    expect(inserts.map((c) => c.params[0])).toEqual(expect.arrayContaining(['claim-resend-ip', 'claim-resend-email']));
    const flat = JSON.stringify(db.calls.map((c) => c.params));
    expect(flat).not.toContain(PAYER);
    expect(flat).not.toContain(ip);
    for (const c of inserts) expect(c.params[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a second instance sees the first instance counts (same table)', async () => {
    const db = fakeCounterDb();
    counters.setSharedCounterQueryForTests(db.query);
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) await counters.hitRateCounter('claim-resend-ip', '203.0.113.9', { windowMs: 900000, now });
    // Memory is per instance; clearing it must not reset a DB-backed count.
    const query = db.query;
    counters.resetSharedCountersForTests();
    counters.setSharedCounterQueryForTests(query);
    expect(await counters.hitRateCounter('claim-resend-ip', '203.0.113.9', { windowMs: 900000, now })).toBe(6);
  });

  test('a DB failure falls back to memory and says so', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    counters.setSharedCounterQueryForTests(async () => { throw Object.assign(new Error('down'), { code: '08006' }); });
    expect(await counters.hitRateCounter('s', 'k', { windowMs: 1000, now: 5000 })).toBe(1);
    expect(await counters.hitRateCounter('s', 'k', { windowMs: 1000, now: 5500 })).toBe(2);
    expect(await counters.hitRateCounter('s', 'k', { windowMs: 1000, now: 6000 })).toBe(1);
    expect(errors.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('RATE_COUNTER_DB_FAILED');
  });

  test('the migration creates both tables', () => {
    const ddl = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS rate_limit_counters');
    expect(ddl).toContain('PRIMARY KEY (scope, key_hash, window_start)');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS stripe_webhook_retries');
  });
});

describe('repeated WEBHOOK_RETRY for one event', () => {
  const premSub = (id, cus, status = 'active') => ({
    id, customer: cus, status, created: 100, current_period_end: 2000000000,
    metadata: { app: 'fitmunch', product: 'fitmunch', plan: 'premium' },
    items: { data: [{ price: { id: PRICE_IDS.premium, product: 'prod_UoBDFNLbc6pTS4' } }] },
  });
  function setupFailingReread() {
    const users = [{ id: 'u1', email: 'm@example.com', stripeCustomerId: 'cus_m', subscriptionTier: 'premium', settings: {} }];
    storage.db = { select: () => ({ from: () => ({ where: async () => users }) }) };
    storage.getUserById = async () => users[0];
    storage.updateUserSubscription = jest.fn();
    app._private.setStripeForTests({
      webhooks: { constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)) },
      subscriptions: {
        retrieve: jest.fn(async () => { throw new TypeError('boom'); }),
        list: jest.fn(async () => ({ data: [] })),
      },
      customers: { retrieve: jest.fn(async () => ({ id: 'cus_m', metadata: { brand: 'fitmunch' } })), list: jest.fn(async () => ({ data: [] })) },
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    return jest.spyOn(console, 'error').mockImplementation(() => {});
  }
  const post = (event) => request(app).post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x').set('Content-Type', 'application/json').send(JSON.stringify(event));

  test('the 3rd retry logs WEBHOOK_RETRY_REPEATED with id and type, and alerts once without blocking', async () => {
    await withEnv({ VERCEL_ENV: 'production', ALERT_EMAIL_TO: 'ops@example.com' }, async () => {
      const errors = setupFailingReread();
      const db = fakeCounterDb();
      counters.setSharedCounterQueryForTests(db.query);
      // The alert send never resolves: the webhook must still answer.
      const sendEmail = jest.spyOn(emailApi, 'sendEmail').mockImplementation(() => new Promise(() => {}));
      const event = { id: 'evt_repeat_1', type: 'customer.subscription.updated', data: { object: premSub('sub_1', 'cus_m') } };
      const logs = [];
      for (let i = 0; i < 4; i += 1) {
        const t0 = Date.now();
        const res = await post(event);
        expect(res.status).toBe(500);
        expect(Date.now() - t0).toBeLessThan(1000);
        logs.push(errors.mock.calls.map((c) => c.join(' ')).join('\n'));
        errors.mockClear();
      }
      expect(logs[0]).not.toContain('WEBHOOK_RETRY_REPEATED');
      expect(logs[1]).not.toContain('WEBHOOK_RETRY_REPEATED');
      expect(logs[2]).toContain('WEBHOOK_RETRY_REPEATED event=evt_repeat_1 type=customer.subscription.updated retries=3');
      expect(logs[3]).toContain('retries=4');
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const msg = sendEmail.mock.calls[0][0];
      expect(msg.to).toBe('ops@example.com');
      expect(msg.bodyText).toContain('evt_repeat_1');
      expect(msg.bodyText).not.toContain('m@example.com');
      expect(db.retries.get('evt_repeat_1')).toMatchObject({ retries: 4, alerted: true });
    });
  });

  test('memory fallback counts per event id, and other events keep their own count', async () => {
    await withEnv({ VERCEL_ENV: null }, async () => {
      const errors = setupFailingReread();
      const sendEmail = jest.spyOn(emailApi, 'sendEmail').mockResolvedValue({ success: true });
      const a = { id: 'evt_a', type: 'customer.subscription.updated', data: { object: premSub('sub_1', 'cus_m') } };
      const b = { ...a, id: 'evt_b' };
      await post(a); await post(b); await post(a); await post(b);
      expect(errors.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('WEBHOOK_RETRY_REPEATED');
      await post(a);
      const logged = errors.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('WEBHOOK_RETRY_REPEATED event=evt_a');
      expect(logged).not.toContain('event=evt_b');
      // Not production: no email.
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});

describe('vendored Chart.js', () => {
  test('has no sourceMappingURL to a missing .map', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public/js/chart.umd.min.js'), 'utf8');
    expect(js).not.toMatch(/sourceMappingURL/);
  });
});
