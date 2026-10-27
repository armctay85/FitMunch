'use strict';

/**
 * Activation events against Postgres: unique (user_id, event_name),
 * each trigger, and a failed or hung write that still returns the meal.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Uses its own schema.
 */
const BASE = process.env.TEST_DATABASE_URL;
if (!BASE && process.env.CI) throw new Error('test_activation_events_pg: TEST_DATABASE_URL is required in CI');
if (BASE && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(BASE)) {
  throw new Error('TEST_DATABASE_URL looks like a real database');
}
const SCHEMA = 'activation_events_test';
const URL = BASE && `${BASE}${BASE.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const maybe = BASE ? describe : describe.skip;
const PREV_URL = process.env.DATABASE_URL;
const PREV_SSL = process.env.DATABASE_SSL;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_activation_test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server.js');
const { ensureSchema, getPool } = require('./lib/db-migrate');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');
const activation = require('./lib/activation-events');
const { endAppPools } = require('./test/end-app-pools');

const TRIAL = '00000000-0000-4000-8000-00000000a701';
const MEAL = '00000000-0000-4000-8000-00000000a702';
const HAD = '00000000-0000-4000-8000-00000000a703';
const DAY = '00000000-0000-4000-8000-00000000a704';
const REAL = '00000000-0000-4000-8000-00000000a705';
const MARK = '00000000-0000-4000-8000-00000000a706';
const TOKEN = 'activation-test-token-value';

const bearer = (id) => `Bearer ${jwt.sign({ userId: id, name: 'T' }, process.env.JWT_SECRET)}`;

function stripeStub(sub) {
  return {
    charges: { create: jest.fn() },
    paymentIntents: { create: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
    },
    subscriptions: {
      retrieve: jest.fn(async () => sub),
      list: jest.fn(async () => ({ data: [] })),
      update: jest.fn(async (id, patch) => ({ id, ...patch })),
    },
    customers: {
      retrieve: jest.fn(async () => ({
        id: sub.customer,
        metadata: { brand: 'fitmunch', product: 'fitmunch' },
      })),
      search: jest.fn(async () => ({ data: [] })),
      update: jest.fn(async (id, patch) => ({ id, ...patch })),
    },
  };
}

function trialSub(overrides = {}) {
  return {
    id: 'sub_act_trial',
    customer: 'cus_act_trial',
    status: 'trialing',
    created: 1,
    metadata: { product: 'fitmunch', plan: 'premium' },
    items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    current_period_end: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
    ...overrides,
  };
}

function checkoutEvent(id, metadata, extra = {}) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${id}`,
        customer: 'cus_act_trial',
        subscription: 'sub_act_trial',
        metadata: { plan: 'premium', app: 'fitmunch', priceId: PRICE_IDS.premium, userId: TRIAL, ...metadata },
        ...extra,
      },
    },
  };
}

function postEvent(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

async function eventsFor(userId) {
  const pool = getPool();
  const result = await pool.query(
    'SELECT event_name, source, metadata FROM activation_events WHERE user_id = $1 ORDER BY event_name',
    [userId]
  );
  return result.rows;
}

async function insertUser(id, email, extra = {}) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, stripe_customer_id, created_at)
     VALUES ($1, $2, 'Activation', 'x', $3, COALESCE($4::timestamptz, now()))`,
    [id, email, extra.customer || null, extra.createdAt || null]
  );
}

maybe('activation events (postgres)', () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    const { Pool } = require('pg');
    const admin = new Pool({ connectionString: BASE });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    const ready = await ensureSchema();
    if (!ready) throw new Error('schema was not ensured');
  });

  beforeEach(async () => {
    activation.resetActivationForTests();
    delete process.env.ACTIVATION_TEST_BACKDATE;
    delete process.env.ACTIVATION_TEST_TOKEN;
    app._private.setStripeForTests(null);
    const pool = getPool();
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE stripe_events, stripe_welcome_sends');
  });

  afterEach(() => {
    activation.resetActivationForTests();
    delete process.env.ACTIVATION_TEST_BACKDATE;
    delete process.env.ACTIVATION_TEST_TOKEN;
    app._private.setStripeForTests(null);
  });

  afterAll(async () => {
    await endAppPools();
    if (PREV_URL == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = PREV_URL;
    if (PREV_SSL == null) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = PREV_SSL;
  });

  test('unique constraint rejects a second (user_id, event_name)', async () => {
    const pool = getPool();
    const defs = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'activation_events'::regclass
       ORDER BY conname`
    );
    const byName = Object.fromEntries(defs.rows.map((row) => [row.conname, row.def]));
    expect(byName.activation_events_user_event_key).toMatch(/UNIQUE \(user_id, event_name\)/);
    await insertUser(DAY, 'day@example.com');
    await pool.query(
      `INSERT INTO activation_events (user_id, event_name, source) VALUES ($1, 'day7_return', 'api')`,
      [DAY]
    );
    await expect(pool.query(
      `INSERT INTO activation_events (user_id, event_name, source) VALUES ($1, 'day7_return', 'api')`,
      [DAY]
    )).rejects.toMatchObject({ code: '23505' });
    activation.scheduleActivationEvent({ userId: DAY, eventName: 'day7_return', source: 'api' });
    activation.scheduleActivationEvent({ userId: DAY, eventName: 'day7_return', source: 'api' });
    await activation.whenActivationIdle();
    const rows = await eventsFor(DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe('day7_return');
  });

  test('checkout.session.completed records trial_started once and does not charge', async () => {
    await insertUser(TRIAL, 'trial@example.com', { customer: 'cus_act_trial' });
    const stub = stripeStub(trialSub());
    app._private.setStripeForTests(stub);
    const first = await postEvent(checkoutEvent('evt_act_trial_1', {}));
    const second = await postEvent(checkoutEvent('evt_act_trial_2', {}));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await activation.whenActivationIdle();
    const rows = await eventsFor(TRIAL);
    expect(rows.map((row) => row.event_name)).toEqual(['trial_started']);
    expect(rows[0].source).toBe('stripe_webhook');
    expect(rows[0].metadata.plan).toBe('premium');
    expect(rows[0].metadata.fixture).toBeUndefined();
    expect(stub.charges.create).not.toHaveBeenCalled();
    expect(stub.paymentIntents.create).not.toHaveBeenCalled();
    expect(stub.refunds.create).not.toHaveBeenCalled();
  });

  test('a repeat card and a used trial do not record trial_started', async () => {
    await insertUser(TRIAL, 'trial-skip@example.com', { customer: 'cus_act_trial' });
    const reused = trialSub({
      default_payment_method: { id: 'pm_act', card: { fingerprint: 'fpACTUSED' } },
    });
    const stub = stripeStub(reused);
    stub.customers.search = jest.fn(async () => ({
      data: [{ id: 'cus_earlier', metadata: { fm_trial_card: 'fpACTUSED' } }],
    }));
    app._private.setStripeForTests(stub);
    expect((await postEvent(checkoutEvent('evt_act_reused', {}))).status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(TRIAL)).toEqual([]);
    expect(stub.subscriptions.update).toHaveBeenCalledWith('sub_act_trial', {
      trial_end: 'now',
      proration_behavior: 'none',
    });
    expect(stub.charges.create).not.toHaveBeenCalled();

    const pool = getPool();
    await pool.query('TRUNCATE stripe_events');
    app._private.setStripeForTests(stripeStub(trialSub({ status: 'active' })));
    expect((await postEvent(checkoutEvent('evt_act_no_trial', { trial: '0' }))).status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(TRIAL)).toEqual([]);
  });

  test('coach checkout does not record trial_started', async () => {
    await insertUser(TRIAL, 'coach-act@example.com', { customer: 'cus_act_trial' });
    app._private.setStripeForTests(stripeStub(trialSub()));
    expect((await postEvent(checkoutEvent('evt_act_coach', { plan: 'coach-39' }))).status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(TRIAL)).toEqual([]);
  });

  test('the first meal log records first_meal_logged once', async () => {
    await insertUser(MEAL, 'meal@example.com');
    const log = (name) => request(app)
      .post('/api/meals/log')
      .set('Authorization', bearer(MEAL))
      .send({ foodName: name, calories: 180, mealType: 'breakfast' });
    expect((await log('Oats')).status).toBe(200);
    await activation.whenActivationIdle();
    expect((await log('Soup')).status).toBe(200);
    await activation.whenActivationIdle();
    const rows = await eventsFor(MEAL);
    expect(rows.map((row) => row.event_name)).toEqual(['first_meal_logged']);
    expect(rows[0].source).toBe('meal_log');
    expect(rows[0].metadata.mealId).toEqual(expect.any(Number));
  });

  test('an account that already had a meal does not get first_meal_logged', async () => {
    await insertUser(HAD, 'had@example.com');
    const pool = getPool();
    await pool.query(
      `INSERT INTO meal_logs (user_id, meal_type, food_name, calories) VALUES ($1, 'lunch', 'Older meal', 400)`,
      [HAD]
    );
    const res = await request(app)
      .post('/api/meals/log')
      .set('Authorization', bearer(HAD))
      .send({ foodName: 'New oats', calories: 150, mealType: 'breakfast' });
    expect(res.status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(HAD)).toEqual([]);
  });

  test('day7_return fires at 7 days and not before, once', async () => {
    await insertUser(DAY, 'day7@example.com');
    const me = () => request(app).get('/api/auth/me').set('Authorization', bearer(DAY));
    expect((await me()).status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(DAY)).toEqual([]);

    const pool = getPool();
    await pool.query(`UPDATE users SET created_at = now() - interval '6 days 23 hours' WHERE id = $1`, [DAY]);
    activation.clearDay7Cache(DAY);
    expect((await me()).status).toBe(200);
    await activation.whenActivationIdle();
    expect(await eventsFor(DAY)).toEqual([]);

    await pool.query(`UPDATE users SET created_at = now() - interval '7 days' WHERE id = $1`, [DAY]);
    activation.clearDay7Cache(DAY);
    expect((await me()).status).toBe(200);
    await activation.whenActivationIdle();
    expect((await me()).status).toBe(200);
    await activation.whenActivationIdle();
    const rows = await eventsFor(DAY);
    expect(rows.map((row) => row.event_name)).toEqual(['day7_return']);
    expect(rows[0].source).toBe('api');
    expect(rows[0].metadata.path).toBe('/api/auth/me');
  });

  test('only the marked test account can be backdated, and that simulates day 7', async () => {
    await insertUser(REAL, 'member@example.com');
    await insertUser(MARK, 'activation-test+day7@fitmunch.com.au');
    const pool = getPool();
    const before = await pool.query('SELECT created_at FROM users WHERE id = $1', [REAL]);

    process.env.ACTIVATION_TEST_BACKDATE = '1';
    process.env.ACTIVATION_TEST_TOKEN = TOKEN;
    const headers = { Authorization: bearer(REAL), 'X-Activation-Test-Token': TOKEN };
    const refused = await request(app)
      .post('/api/internal/activation-test/backdate')
      .set(headers)
      .send({ daysAgo: 30 });
    expect(refused.status).toBe(403);
    const after = await pool.query('SELECT created_at FROM users WHERE id = $1', [REAL]);
    expect(new Date(after.rows[0].created_at).getTime()).toBe(new Date(before.rows[0].created_at).getTime());

    delete process.env.ACTIVATION_TEST_BACKDATE;
    const hidden = await request(app)
      .post('/api/internal/activation-test/backdate')
      .set('Authorization', bearer(MARK))
      .set('X-Activation-Test-Token', TOKEN)
      .send({ daysAgo: 8 });
    expect(hidden.status).toBe(404);

    process.env.ACTIVATION_TEST_BACKDATE = '1';
    const wrong = await request(app)
      .post('/api/internal/activation-test/backdate')
      .set('Authorization', bearer(MARK))
      .set('X-Activation-Test-Token', 'not-the-token-value')
      .send({ daysAgo: 8 });
    expect(wrong.status).toBe(404);

    const moved = await request(app)
      .post('/api/internal/activation-test/backdate')
      .set('Authorization', bearer(MARK))
      .set('X-Activation-Test-Token', TOKEN)
      .send({ daysAgo: 8 });
    expect(moved.status).toBe(200);
    const age = await pool.query(
      `SELECT created_at <= now() - interval '7 days' AS due FROM users WHERE id = $1`,
      [MARK]
    );
    expect(age.rows[0].due).toBe(true);

    expect((await request(app).get('/api/auth/me').set('Authorization', bearer(MARK))).status).toBe(200);
    await activation.whenActivationIdle();
    expect((await eventsFor(MARK)).map((row) => row.event_name)).toEqual(['day7_return']);

    const fixtureRefused = await request(app)
      .post('/api/internal/activation-test/trial-fixture')
      .set('Authorization', bearer(REAL))
      .set('X-Activation-Test-Token', TOKEN);
    expect(fixtureRefused.status).toBe(403);
    expect(await eventsFor(REAL)).toEqual([]);

    const fixture = await request(app)
      .post('/api/internal/activation-test/trial-fixture')
      .set('Authorization', bearer(MARK))
      .set('X-Activation-Test-Token', TOKEN);
    expect(fixture.status).toBe(200);
    const names = (await eventsFor(MARK)).map((row) => row.event_name).sort();
    expect(names).toEqual(['day7_return', 'trial_started']);
    const trial = (await eventsFor(MARK)).find((row) => row.event_name === 'trial_started');
    expect(trial.metadata.fixture).toBe(true);
    expect(trial.source).toBe('stripe_webhook');
  });

  test('a hung activation write still returns the meal', async () => {
    await insertUser(MEAL, 'meal-hang@example.com');
    activation.setActivationQueryForTests(() => new Promise(() => {}));
    const t0 = Date.now();
    const hung = await request(app)
      .post('/api/meals/log')
      .set('Authorization', bearer(MEAL))
      .send({ foodName: 'Hung oats', calories: 100, mealType: 'snack' });
    expect(hung.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1500);
    const meals = await getPool().query('SELECT id FROM meal_logs WHERE user_id = $1', [MEAL]);
    expect(meals.rows).toHaveLength(1);
  });

  test('a failed activation write is logged and still returns the meal', async () => {
    await insertUser(MEAL, 'meal-fail@example.com');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    activation.setActivationQueryForTests(async () => {
      throw Object.assign(new Error('activation down'), { code: '57P01' });
    });
    const failed = await request(app)
      .post('/api/meals/log')
      .set('Authorization', bearer(MEAL))
      .send({ foodName: 'Failed oats', calories: 110, mealType: 'snack' });
    expect(failed.status).toBe(200);
    await activation.whenActivationIdle();
    expect(spy.mock.calls.some((args) => String(args[0]).includes('[activation]'))).toBe(true);
    const meals = await getPool().query('SELECT id FROM meal_logs WHERE user_id = $1', [MEAL]);
    expect(meals.rows).toHaveLength(1);
    expect(await eventsFor(MEAL)).toEqual([]);
    spy.mockRestore();
  });

  test('GET / and GET /api/health do not touch activation storage', async () => {
    let calls = 0;
    activation.setActivationQueryForTests(() => {
      calls += 1;
      return new Promise(() => {});
    });
    const home = await request(app).get('/');
    const health = await request(app).get('/api/health');
    expect(home.status).toBe(200);
    expect(health.status).toBe(200);
    expect(calls).toBe(0);
  });
});
