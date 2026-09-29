/**
 * Quiet Premium comps: access comes from settings.compPremiumUntil, not a cron
 * and not subscription_expires_at. Stripe may set the stored tier back to free.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('./server.js');
const storage = require('./server/storage.js');
const { effectiveTier } = storage;
const { jwtSecret } = require('./lib/fitmunch-checkout');
const { parseCompUntil } = require('./scripts/set-comp');

const originalGetUserById = storage.getUserById;
const originalUpdateUserSubscription = storage.updateUserSubscription;
const originalDb = storage.db;

const future = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function compUser(overrides = {}) {
  return {
    id: 'u-comp',
    email: 'comp@example.com',
    subscriptionTier: 'premium',
    stripeCustomerId: 'cus_comp',
    settings: { compPremiumUntil: future(), attribution: { source: 'ig' } },
    ...overrides,
  };
}

function installStripe(listData) {
  app._private.setStripeForTests({
    subscriptions: {
      list: jest.fn(async () => ({ data: listData || [] })),
    },
    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
    },
  });
}

afterEach(() => {
  storage.getUserById = originalGetUserById;
  storage.updateUserSubscription = originalUpdateUserSubscription;
  storage.db = originalDb;
});

afterAll(() => {
  app._private.setStripeForTests(null);
});

describe('effectiveTier', () => {
  test('a future comp gives premium while the stored tier is free', () => {
    const until = future();
    expect(effectiveTier({
      subscriptionTier: 'free',
      settings: { compPremiumUntil: until },
    })).toBe('premium');
    expect(effectiveTier({
      subscriptionTier: 'free',
      settings: JSON.stringify({ compPremiumUntil: until }),
    })).toBe('premium');
  });

  test('a past or invalid comp gives free', () => {
    expect(effectiveTier({
      subscriptionTier: 'free',
      settings: { compPremiumUntil: past() },
    })).toBe('free');
    expect(effectiveTier({
      subscriptionTier: 'free',
      settings: { compPremiumUntil: 'not-a-date' },
    })).toBe('free');
    expect(effectiveTier({ subscriptionTier: 'free', settings: {} })).toBe('free');
    expect(effectiveTier(null)).toBe('free');
  });

  test('a paid tier is unaffected by the comp field or subscription_expires_at', () => {
    expect(effectiveTier({
      subscriptionTier: 'premium',
      settings: { compPremiumUntil: past() },
    })).toBe('premium');
    expect(effectiveTier({
      subscriptionTier: 'pt-pro',
      settings: { compPremiumUntil: future() },
    })).toBe('pt-pro');
    expect(effectiveTier({
      subscriptionTier: 'free',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      settings: {},
    })).toBe('free');

    const src = fs.readFileSync(path.join(__dirname, 'server/storage.js'), 'utf8');
    const fn = src.slice(src.indexOf('function effectiveTier'), src.indexOf('function withMemoryLock'));
    expect(fn).toContain('compPremiumUntil');
    expect(fn).not.toContain('subscriptionExpiresAt');
    expect(fn).not.toContain('subscription_expires_at');
  });
});

describe('Stripe cannot wipe a comp by setting the tier to free', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
  });

  test('subscription.deleted keeps the oldest access via the comp date', async () => {
    const user = compUser();
    const until = user.settings.compPremiumUntil;
    installStripe([]);
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [user] }) }),
    };
    storage.updateUserSubscription = jest.fn(async (id, tier, expiresAt) => {
      expect(id).toBe('u-comp');
      expect(tier).toBe('free');
      expect(expiresAt).toBeNull();
      user.subscriptionTier = tier;
    });

    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't=1,v1=x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_old', customer: 'cus_comp', status: 'canceled' } },
      }))
      .expect(200);

    expect(storage.updateUserSubscription).toHaveBeenCalledTimes(1);
    expect(user.settings.compPremiumUntil).toBe(until);
    expect(user.settings.attribution.source).toBe('ig');
    expect(effectiveTier(user)).toBe('premium');
  });

  test('sync-subscription reports premium after it stores free', async () => {
    const user = compUser();
    const until = user.settings.compPremiumUntil;
    installStripe([{
      id: 'sub_dead',
      status: 'canceled',
      customer: 'cus_comp',
      items: { data: [{ price: { id: 'price_1ToYrXGMuYRuJYDrwHtvWD1c' } }] },
    }]);
    storage.getUserById = jest.fn(async () => user);
    storage.updateUserSubscription = jest.fn(async (id, tier, expiresAt) => {
      expect(tier).toBe('free');
      expect(expiresAt).toBeNull();
      user.subscriptionTier = tier;
    });
    const token = jwt.sign({ userId: 'u-comp', email: user.email }, jwtSecret());

    const res = await request(app)
      .post('/api/stripe/sync-subscription')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(res.body.tier).toBe('premium');
    expect(res.body.synced).toBe(true);
    expect(user.subscriptionTier).toBe('free');
    expect(user.settings.compPremiumUntil).toBe(until);
    expect(effectiveTier(user)).toBe('premium');
    expect(storage.updateUserSubscription).toHaveBeenCalledWith('u-comp', 'free', null);
  });

  test('a comp already stored as free still survives sync', async () => {
    const user = compUser({ subscriptionTier: 'free' });
    installStripe([]);
    storage.getUserById = jest.fn(async () => user);
    storage.updateUserSubscription = jest.fn(async () => {
      throw new Error('sync should not rewrite an already-free comp');
    });
    const token = jwt.sign({ userId: 'u-comp' }, jwtSecret());

    const res = await request(app)
      .post('/api/stripe/sync-subscription')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.tier).toBe('premium');
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
    expect(effectiveTier(user)).toBe('premium');
  });
});

describe('comp script and free-limit UI', () => {
  test('set-comp parses a Sydney end-of-day and refuses to run without a database', () => {
    expect(parseCompUntil('2026-10-04')).toBe('2026-10-04T12:59:59.999Z');
    expect(parseCompUntil('2026-06-04')).toBe('2026-06-04T13:59:59.999Z');
    expect(parseCompUntil('2026-10-04T00:00:00.000Z')).toBe('2026-10-04T00:00:00.000Z');

    const src = fs.readFileSync(path.join(__dirname, 'scripts/set-comp.js'), 'utf8');
    expect(src).toContain("subscription_tier = 'free'");
    expect(src).toContain('compPremiumUntil');
    expect(src).not.toMatch(/require\(['"]stripe['"]\)/);

    const env = { ...process.env };
    delete env.DATABASE_URL;
    const missing = spawnSync(process.execPath, ['scripts/set-comp.js'], {
      cwd: __dirname,
      env,
      encoding: 'utf8',
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/Usage:/);

    const noDb = spawnSync(process.execPath, ['scripts/set-comp.js', 'cus_UtYZSAIWGzZnoz', '2026-10-04'], {
      cwd: __dirname,
      env,
      encoding: 'utf8',
    });
    expect(noDb.status).toBe(1);
    expect(noDb.stderr).toMatch(/DATABASE_URL is required/);
    expect(noDb.stdout).toBe('');
  });

  test('the free limit never auto-redirects to checkout', () => {
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const start = appHtml.indexOf('function maybeUpgrade');
    const end = appHtml.indexOf('async function loadBillingUsage');
    const fn = appHtml.slice(start, end);
    expect(fn).toContain("nav('billing')");
    expect(fn).not.toContain('startCheckout');
    expect(fn).not.toContain('setTimeout');
    expect(appHtml).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*startCheckout/);
    expect(appHtml).not.toContain('Opening Premium trial');
  });

  test('login, auth/me, AI limits, meal planner, and receipt scan read effectiveTier', () => {
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(api.match(/effectiveTier\(user\)/g)).toHaveLength(7);
    expect(fs.readFileSync(path.join(__dirname, 'meal-planner.js'), 'utf8')).toContain('return effectiveTier(user)');
    expect(fs.readFileSync(path.join(__dirname, 'receipt-scanner.js'), 'utf8')).toContain('return effectiveTier(user)');
    const updateFn = fs.readFileSync(path.join(__dirname, 'server/storage.js'), 'utf8');
    const writer = updateFn.slice(
      updateFn.indexOf('async function updateUserSubscription'),
      updateFn.indexOf('// Quiet comp')
    );
    expect(writer).toContain('subscriptionTier: tier');
    expect(writer).not.toContain('compPremiumUntil');
    expect(writer).not.toMatch(/settings:/);
  });
});
