'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const activation = require('./lib/activation-events');

const UUID = '00000000-0000-4000-8000-00000000a711';
const SECRET = 'fitmunch-dev-secret';

beforeEach(() => {
  activation.resetActivationForTests();
  process.env.JWT_SECRET = SECRET;
  delete process.env.ACTIVATION_TEST_BACKDATE;
  delete process.env.ACTIVATION_TEST_TOKEN;
});

afterEach(() => {
  activation.resetActivationForTests();
  delete process.env.ACTIVATION_TEST_BACKDATE;
  delete process.env.ACTIVATION_TEST_TOKEN;
});

describe('activation event contract', () => {
  test('the three event names are fixed', () => {
    expect(activation.EVENT_NAMES).toEqual(['trial_started', 'first_meal_logged', 'day7_return']);
  });

  test('inserts use ON CONFLICT DO NOTHING on (user_id, event_name)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib/activation-events.js'), 'utf8');
    expect(src).toMatch(/ON CONFLICT \(user_id, event_name\) DO NOTHING/);
    const ddl = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');
    expect(ddl).toContain('CONSTRAINT activation_events_user_event_key UNIQUE (user_id, event_name)');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS activation_events');
  });

  test('trial_started is scheduled only inside the checkout trial branch', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib/stripe-webhook.js'), 'utf8');
    const block = src.slice(src.indexOf("case 'checkout.session.completed'"), src.indexOf("case 'customer.subscription.created'"));
    const gate = block.indexOf("session.metadata?.trial !== '0'");
    const call = block.indexOf('recordTrialStartedForCheckout');
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(gate);
  });

  test('the meal write schedules first_meal_logged and does not await it', () => {
    const src = fs.readFileSync(path.join(__dirname, 'server/storage.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function logMeal'), src.indexOf('async function getMealLogsByDate'));
    expect(fn).toContain('scheduleFirstMealLogged');
    expect(fn).not.toMatch(/await[^\n]*scheduleFirstMealLogged/);
  });
});

describe('activation writes do not block', () => {
  test('schedule returns while the insert never settles', async () => {
    let started = false;
    activation.setActivationQueryForTests(() => {
      started = true;
      return new Promise(() => {});
    });
    const t0 = Date.now();
    activation.scheduleActivationEvent({
      userId: UUID,
      eventName: 'trial_started',
      source: 'stripe_webhook',
      metadata: { plan: 'premium' },
    });
    activation.scheduleFirstMealLogged(UUID, 4);
    expect(Date.now() - t0).toBeLessThan(50);
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBe(true);
  });

  test('a rejected insert is logged and does not throw', async () => {
    const lines = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      lines.push(args.map(String).join(' '));
    });
    activation.setActivationQueryForTests(async () => {
      throw Object.assign(new Error('db down'), { code: '57P01' });
    });
    expect(() => activation.scheduleActivationEvent({
      userId: UUID,
      eventName: 'day7_return',
      source: 'api',
    })).not.toThrow();
    await activation.whenActivationIdle();
    expect(lines.some((line) => line.includes('[activation]') && line.includes('57P01'))).toBe(true);
    spy.mockRestore();
  });

  test('unknown names and non-uuid users are ignored', async () => {
    const sqls = [];
    activation.setActivationQueryForTests(async (sql) => {
      sqls.push(sql);
      return { rows: [], rowCount: 0 };
    });
    activation.scheduleActivationEvent({ userId: UUID, eventName: 'page_view', source: 'api' });
    activation.scheduleActivationEvent({ userId: 'not-a-uuid', eventName: 'trial_started', source: 'stripe_webhook' });
    activation.scheduleFirstMealLogged('not-a-uuid', 1);
    activation.recordTrialStartedForCheckout(
      { metadata: { plan: 'premium', userId: 'not-a-uuid' } },
      null,
      'evt_x'
    );
    await activation.whenActivationIdle();
    expect(sqls).toEqual([]);
  });
});

describe('day7_return scheduling', () => {
  test('a valid session on /api schedules the check', async () => {
    const calls = [];
    activation.setActivationQueryForTests(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ created_at: new Date(), due: false }], rowCount: 1 };
    });
    const token = jwt.sign({ userId: UUID }, SECRET);
    activation.noteAuthenticatedRequest({
      method: 'GET',
      originalUrl: '/api/auth/me?token=secret',
      headers: { authorization: `Bearer ${token}` },
    });
    await activation.whenActivationIdle();
    expect(calls.some((call) => call.sql.includes("'day7_return'"))).toBe(true);
    const meta = JSON.parse(calls[0].params[1]);
    expect(meta.path).toBe('/api/auth/me');
    expect(JSON.stringify(calls)).not.toContain('secret');
  });

  test('homepage, health without a bearer, and a bad token do not query', async () => {
    const sqls = [];
    activation.setActivationQueryForTests(async (sql) => {
      sqls.push(sql);
      return { rows: [] };
    });
    const token = jwt.sign({ userId: UUID }, SECRET);
    activation.noteAuthenticatedRequest({ method: 'GET', originalUrl: '/', headers: { authorization: `Bearer ${token}` } });
    activation.noteAuthenticatedRequest({ method: 'GET', originalUrl: '/api/health', headers: {} });
    activation.noteAuthenticatedRequest({
      method: 'GET',
      originalUrl: '/api/auth/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await activation.whenActivationIdle();
    expect(sqls).toEqual([]);
  });
});

describe('test-account backdate guard', () => {
  const real = '11111111-1111-4111-8111-111111111111';
  const marked = '22222222-2222-4222-8222-222222222222';

  test('the flag off does not read or update anyone', async () => {
    const sqls = [];
    activation.setActivationQueryForTests(async (sql) => {
      sqls.push(sql);
      return { rows: [{ email: 'activation-test@fitmunch.com.au' }] };
    });
    const result = await activation.backdateActivationTestSignup(marked, 8);
    expect(result.status).toBe(404);
    expect(sqls).toEqual([]);
  });

  test('a real customer is refused and not updated', async () => {
    process.env.ACTIVATION_TEST_BACKDATE = '1';
    const sqls = [];
    activation.setActivationQueryForTests(async (sql) => {
      sqls.push(sql);
      if (/UPDATE/i.test(sql)) throw new Error('real customer was updated');
      return { rows: [{ email: 'member@example.com' }] };
    });
    const result = await activation.backdateActivationTestSignup(real, 30);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(sqls.some((sql) => /UPDATE/i.test(sql))).toBe(false);
  });

  test('the marked test account is the only email the update accepts', async () => {
    process.env.ACTIVATION_TEST_BACKDATE = '1';
    const sqls = [];
    activation.setActivationQueryForTests(async (sql) => {
      sqls.push(sql);
      if (/^SELECT/i.test(sql.trim())) return { rows: [{ email: 'activation-test+day7@fitmunch.com.au' }] };
      return { rows: [{ created_at: new Date('2026-01-01T00:00:00.000Z') }] };
    });
    const result = await activation.backdateActivationTestSignup(marked, 8);
    expect(result.ok).toBe(true);
    const update = sqls.find((sql) => /UPDATE users/i.test(sql));
    expect(update).toMatch(/email ~\*/);
    expect(activation.TEST_ACCOUNT_EMAIL.test('activation-test+day7@fitmunch.com.au')).toBe(true);
    expect(activation.TEST_ACCOUNT_EMAIL.test('member@fitmunch.com.au')).toBe(false);
    expect(activation.TEST_ACCOUNT_EMAIL.test('activation-test@gmail.com')).toBe(false);
  });
});
