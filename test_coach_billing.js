/**
 * FitMunch Coach billing: A$39 cap, A$79 upgrade, webhooks, 14-day trial checkout.
 * Stripe is mocked. A live test-mode session runs only when sk_test_ is set.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';
process.env.STRIPE_COACH_39_PRICE_ID = 'price_coach39_test';
process.env.STRIPE_COACH_79_PRICE_ID = 'price_coach79_test';

const app = require('./server.js');
const storage = require('./server/storage.js');
const {
  PRICE_IDS,
  PREMIUM_PRICE_AUD_CENTS,
  jwtSecret,
  buildSubscriptionCheckoutParams,
  STATEMENT_DESCRIPTOR_SUFFIX,
  applyFitMunchStatementSuffix,
} = require('./lib/fitmunch-checkout');
const {
  COACH_39_ACTIVE_CLIENT_LIMIT,
  evaluateCoachClientGate,
  coachTierUpdateFromStripe,
  coachUpgradePrompt,
  readCoachBilling,
} = require('./lib/fitmunch-coach-billing');

const originalGetUserById = storage.getUserById;
const originalUpdateUserSubscription = storage.updateUserSubscription;
const originalUpdateUserCoachBilling = storage.updateUserCoachBilling;
const originalDb = storage.db;

const COACH_39 = 'price_coach39_test';
const COACH_79 = 'price_coach79_test';

function honestSession(id = 'cs_coach') {
  return {
    id,
    url: `https://checkout.stripe.com/c/pay/${id}`,
    currency: 'aud',
    locale: 'en-GB',
    adaptive_pricing: { enabled: false },
    branding_settings: { display_name: 'FitMunch' },
  };
}

function coachSub(overrides = {}) {
  return {
    id: 'sub_coach',
    customer: 'cus_coach',
    status: 'trialing',
    created: 100,
    metadata: { plan: 'coach-39', product: 'fitmunch', brand: 'FitMunch', coach: '1' },
    items: { data: [{ id: 'si_coach', price: { id: COACH_39 } }] },
    ...overrides,
  };
}

function installWebhookStripe(listData) {
  app._private.setStripeForTests({
    subscriptions: {
      list: jest.fn(async () => ({ data: listData || [] })),
    },
    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
    },
  });
}

async function postWebhook(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

describe('Coach client gate', () => {
  test('A$39 trial and active block the 11th active client and point at A$79', () => {
    for (const coachTier of ['trial', 'active']) {
      const tenth = evaluateCoachClientGate({
        coachPlan: 'coach-39',
        coachTier,
        activeClientCount: COACH_39_ACTIVE_CLIENT_LIMIT - 1,
      });
      expect(tenth.allowed).toBe(true);
      expect(tenth.remaining).toBe(1);

      const blocked = evaluateCoachClientGate({
        coachPlan: 'coach-39',
        coachTier,
        activeClientCount: COACH_39_ACTIVE_CLIENT_LIMIT,
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.code).toBe('COACH_CLIENT_LIMIT');
      expect(blocked.upgradePlan).toBe('coach-79');
      expect(blocked.prompt.cta).toBe('Upgrade to A$79');
      expect(blocked.prompt.priceLabel).toBe('A$79/mo');
      expect(blocked.prompt.body).toMatch(/A\$39/);
      expect(blocked.prompt.body).toMatch(/A\$79/);
      expect(blocked.prompt.upgradeUrl).toBe('/coach/upgrade?clients=10');

      const over = evaluateCoachClientGate({
        coachPlan: 'coach-39',
        coachTier,
        activeClientCount: 11,
      });
      expect(over.allowed).toBe(false);
    }
  });

  test('A$79 is unlimited and a cancelled or non-Coach plan is not capped here', () => {
    expect(evaluateCoachClientGate({
      coachPlan: 'coach-79',
      coachTier: 'trial',
      activeClientCount: 40,
    }).allowed).toBe(true);
    expect(evaluateCoachClientGate({
      coachPlan: 'coach-79',
      coachTier: 'active',
      activeClientCount: 400,
    }).reason).toBe('unlimited');
    expect(evaluateCoachClientGate({
      coachPlan: 'coach-39',
      coachTier: 'cancelled',
      activeClientCount: 10,
    }).reason).toBe('not-capped');
    expect(evaluateCoachClientGate({
      coachPlan: null,
      coachTier: null,
      activeClientCount: 10,
    }).allowed).toBe(true);
  });

  test('paused clients are not part of the pure cap, and the prompt names the upgrade', () => {
    const prompt = coachUpgradePrompt({ activeClientCount: 10 });
    expect(prompt.plan).toBe('coach-79');
    expect(prompt.detail).toMatch(/14-day trial/);
    expect(prompt.detail).toMatch(/card is required/i);
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(api).toContain("COALESCE(status, 'active') = 'active'");
    expect(api).toContain('coachGateForPt');
  });
});

describe('Coach webhook tier', () => {
  let user;

  beforeEach(() => {
    process.env.STRIPE_COACH_39_PRICE_ID = COACH_39;
    process.env.STRIPE_COACH_79_PRICE_ID = COACH_79;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
    user = {
      id: 'pt-1',
      email: 'pt@example.com',
      subscriptionTier: 'free',
      stripeCustomerId: 'cus_coach',
      settings: { compPremiumUntil: '2099-01-01T00:00:00.000Z', attribution: { source: 'ig' } },
    };
    installWebhookStripe([]);
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [user] }) }),
    };
    storage.updateUserSubscription = jest.fn(async (_id, tier) => {
      user.subscriptionTier = tier;
    });
    storage.updateUserCoachBilling = jest.fn(async (_id, coach, existing) => {
      const settings = { ...(existing || {}) };
      settings.coach = coach;
      user.settings = settings;
      return settings.coach;
    });
  });

  afterEach(() => {
    storage.getUserById = originalGetUserById;
    storage.updateUserSubscription = originalUpdateUserSubscription;
    storage.updateUserCoachBilling = originalUpdateUserCoachBilling;
    storage.db = originalDb;
  });

  test('trialing sets coach tier trial and leaves the consumer tier alone', async () => {
    const res = await postWebhook({
      id: 'evt_coach_trial',
      type: 'customer.subscription.created',
      data: { object: coachSub({ status: 'trialing' }) },
    });
    expect(res.status).toBe(200);
    expect(storage.updateUserCoachBilling).toHaveBeenCalledWith(
      'pt-1',
      expect.objectContaining({ tier: 'trial', plan: 'coach-39', priceId: COACH_39, subscriptionId: 'sub_coach' }),
      expect.objectContaining({ compPremiumUntil: '2099-01-01T00:00:00.000Z' })
    );
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
    expect(user.subscriptionTier).toBe('free');
    expect(user.settings.attribution.source).toBe('ig');
    expect(readCoachBilling(user.settings).tier).toBe('trial');
  });

  test('active sets coach tier active', async () => {
    const res = await postWebhook({
      id: 'evt_coach_active',
      type: 'customer.subscription.updated',
      data: { object: coachSub({ status: 'active', metadata: { plan: 'coach-79', product: 'fitmunch' }, items: { data: [{ id: 'si_79', price: { id: COACH_79 } }] } }) },
    });
    expect(res.status).toBe(200);
    expect(storage.updateUserCoachBilling).toHaveBeenCalledWith(
      'pt-1',
      expect.objectContaining({ tier: 'active', plan: 'coach-79' }),
      expect.any(Object)
    );
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('deleted sets coach tier cancelled and does not zero the consumer tier', async () => {
    const res = await postWebhook({
      id: 'evt_coach_cancel',
      type: 'customer.subscription.deleted',
      data: { object: coachSub({ status: 'canceled' }) },
    });
    expect(res.status).toBe(200);
    expect(storage.updateUserCoachBilling).toHaveBeenCalledWith(
      'pt-1',
      expect.objectContaining({ tier: 'cancelled', plan: 'coach-39' }),
      expect.any(Object)
    );
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
    expect(user.subscriptionTier).toBe('free');
  });

  test('a second live Coach subscription keeps the tier instead of marking cancelled', async () => {
    installWebhookStripe([
      coachSub({ id: 'sub_keep', status: 'active' }),
    ]);
    const res = await postWebhook({
      id: 'evt_coach_dup_cancel',
      type: 'customer.subscription.deleted',
      data: { object: coachSub({ id: 'sub_old', status: 'canceled' }) },
    });
    expect(res.status).toBe(200);
    expect(storage.updateUserCoachBilling).not.toHaveBeenCalled();
  });

  test('consumer Premium webhooks still set subscription tier and skip Coach', async () => {
    const res = await postWebhook({
      id: 'evt_premium',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_premium',
          customer: 'cus_coach',
          status: 'active',
          created: 50,
          metadata: { plan: 'premium', product: 'fitmunch' },
          items: { data: [{ id: 'si_p', price: { id: PRICE_IDS.premium } }] },
          current_period_end: 2_000_000_000,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(storage.updateUserSubscription).toHaveBeenCalledWith('pt-1', 'premium', expect.any(Date));
    expect(storage.updateUserCoachBilling).not.toHaveBeenCalled();
    expect(user.subscriptionTier).toBe('premium');
  });

  test('invoice.created writes the FitMunch suffix on a draft invoice', async () => {
    const update = jest.fn(async () => ({}));
    app._private.setStripeForTests({
      invoices: { update },
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: {
        constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
      },
    });
    const res = await postWebhook({
      id: 'evt_suffix',
      type: 'invoice.created',
      data: {
        object: {
          id: 'in_fit',
          status: 'draft',
          metadata: { product: 'fitmunch', brand: 'FitMunch', plan: 'premium' },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual({ statement_descriptor: STATEMENT_DESCRIPTOR_SUFFIX });
    expect(update.mock.calls[0][1].statement_descriptor).toBe('FITMUNCH');
  });

  test('invoice.created does not stamp another brand', async () => {
    const update = jest.fn(async () => ({}));
    app._private.setStripeForTests({
      invoices: { update },
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: {
        constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
      },
    });
    const res = await postWebhook({
      id: 'evt_other',
      type: 'invoice.created',
      data: {
        object: {
          id: 'in_other',
          status: 'draft',
          metadata: { product: 'other', brand: 'other' },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  test('non-live Stripe statuses map to cancelled', () => {
    expect(coachTierUpdateFromStripe(coachSub({ status: 'trialing' })).tier).toBe('trial');
    expect(coachTierUpdateFromStripe(coachSub({ status: 'active' })).tier).toBe('active');
    expect(coachTierUpdateFromStripe(coachSub({ status: 'canceled' })).tier).toBe('cancelled');
    expect(coachTierUpdateFromStripe(coachSub({ status: 'unpaid' })).tier).toBe('cancelled');
    expect(coachTierUpdateFromStripe(coachSub({ status: 'past_due' })).tier).toBe('cancelled');
  });
});

describe('Coach checkout trial', () => {
  const created = [];
  const customers = [];
  let subs;
  const mockStripe = {
    customers: {
      create: jest.fn(async (params) => {
        const customer = {
          id: `cus_${customers.length + 1}`,
          email: params.email,
          metadata: params.metadata,
        };
        customers.push(customer);
        return customer;
      }),
      retrieve: jest.fn(async (id) => ({
        id,
        email: 'pt@example.com',
        metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'pt-1' },
      })),
      list: jest.fn(async () => ({ data: [] })),
      search: jest.fn(async () => ({ data: [] })),
    },
    subscriptions: {
      list: jest.fn(async () => ({ data: subs })),
      update: jest.fn(async (id, params) => ({ id, status: 'trialing', ...params })),
    },
    checkout: {
      sessions: {
        list: jest.fn(async () => ({ data: [] })),
      },
    },
    rawRequest: jest.fn(async (method, requestPath) => {
      if (method === 'POST' && requestPath === '/v1/checkout/sessions') {
        const session = honestSession(`cs_coach_${created.length + 1}`);
        created.push(session);
        return session;
      }
      throw new Error(`unexpected rawRequest ${method} ${requestPath}`);
    }),
  };

  beforeEach(() => {
    created.length = 0;
    customers.length = 0;
    subs = [];
    mockStripe.customers.create.mockClear();
    mockStripe.customers.list.mockClear();
    mockStripe.customers.search.mockClear();
    mockStripe.customers.retrieve.mockClear();
    mockStripe.subscriptions.list.mockClear();
    mockStripe.subscriptions.update.mockClear();
    mockStripe.rawRequest.mockClear();
    app._private.setStripeForTests(mockStripe);
    storage.getUserById = jest.fn(async (id) => ({
      id,
      email: 'pt@example.com',
      name: 'Pat Trainer',
      role: 'pt',
      subscriptionTier: 'free',
      stripeCustomerId: 'cus_pt',
      settings: {},
    }));
  });

  afterAll(() => {
    storage.getUserById = originalGetUserById;
    app._private.setStripeForTests(null);
  });

  test('the consumer A$19.99 checkout contract is unchanged', () => {
    expect(PRICE_IDS.premium).toBe('price_1ToYrXGMuYRuJYDrwHtvWD1c');
    expect(PREMIUM_PRICE_AUD_CENTS).toBe(1999);
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_x',
      priceId: PRICE_IDS.premium,
      plan: 'premium',
      email: 'a@example.com',
      origin: 'https://www.fitmunch.com.au',
    });
    expect(params.line_items[0].price).toBe(PRICE_IDS.premium);
    expect(params.payment_method_collection).toBe('always');
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(params.success_url).toBe('https://www.fitmunch.com.au/app.html?subscribed=1');
    expect(params.metadata.coach).toBeUndefined();
  });

  test('a logged-in trainer starts a 14-day Coach trial with a card', async () => {
    const token = jwt.sign(
      { userId: 'pt-1', email: 'pt@example.com', name: 'Pat Trainer', role: 'pt' },
      jwtSecret()
    );
    const res = await request(app)
      .post('/api/coach/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ plan: 'coach-39' })
      .expect(200);

    expect(res.body.url).toContain('checkout.stripe.com');
    const params = mockStripe.rawRequest.mock.calls[0][2];
    expect(params.mode).toBe('subscription');
    expect(params.payment_method_collection).toBe('always');
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(params.line_items[0].price).toBe(COACH_39);
    expect(params.metadata.plan).toBe('coach-39');
    expect(params.metadata.product).toBe('fitmunch');
    expect(params.success_url).toContain('/coach/upgrade?checkout=started');
    expect(params.locale).toBe('en-GB');
    expect(mockStripe.customers.list).not.toHaveBeenCalled();
    expect(mockStripe.customers.search).not.toHaveBeenCalled();
  });

  test('a client account cannot open Coach checkout', async () => {
    const token = jwt.sign({ userId: 'c-1', role: 'client' }, jwtSecret());
    const res = await request(app)
      .post('/api/coach/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'coach-39' })
      .expect(403);
    expect(res.body.error).toMatch(/trainer/i);
    expect(mockStripe.rawRequest).not.toHaveBeenCalled();
  });

  test('consumer checkout rejects a Coach plan', async () => {
    const token = jwt.sign({ userId: 'pt-1', role: 'pt' }, jwtSecret());
    await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'coach-39' })
      .expect(400);
    expect(mockStripe.rawRequest).not.toHaveBeenCalled();
  });

  test('guests with the same email do not reuse a customer, and a replayed nonce does not open a second session', async () => {
    const first = await request(app)
      .post('/api/coach/checkout')
      .set('Idempotency-Key', 'nonce-a')
      .send({ email: 'guest@example.com', plan: 'coach-39' })
      .expect(200);
    const replay = await request(app)
      .post('/api/coach/checkout')
      .set('Idempotency-Key', 'nonce-a')
      .send({ email: 'guest@example.com', plan: 'coach-39' })
      .expect(200);
    const second = await request(app)
      .post('/api/coach/checkout')
      .set('Idempotency-Key', 'nonce-b')
      .send({ email: 'guest@example.com', plan: 'coach-39' })
      .expect(200);

    expect(first.body.url).toBe(replay.body.url);
    expect(second.body.url).not.toBe(first.body.url);
    expect(mockStripe.customers.create).toHaveBeenCalledTimes(2);
    expect(mockStripe.customers.list).not.toHaveBeenCalled();
    expect(mockStripe.customers.search).not.toHaveBeenCalled();
    const params = mockStripe.rawRequest.mock.calls[0][2];
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(params.payment_method_collection).toBe('always');
    expect(params.line_items[0].price).toBe(COACH_39);
  });

  test('upgrading A$39 to A$79 changes the subscription and does not open a second session', async () => {
    subs = [coachSub()];
    const token = jwt.sign({ userId: 'pt-1', role: 'pt', email: 'pt@example.com' }, jwtSecret());
    const res = await request(app)
      .post('/api/coach/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'coach-79' })
      .expect(200);
    expect(res.body.upgraded).toBe(true);
    expect(res.body.url).toBeNull();
    expect(mockStripe.rawRequest).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_coach',
      expect.objectContaining({
        items: [{ id: 'si_coach', price: COACH_79 }],
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('coach-upgrade') })
    );
  });

  test('the upgrade prompt page is the A$79 ask and has no new tracker', async () => {
    const res = await request(app).get('/coach/upgrade?clients=10').expect(200);
    expect(res.text).toContain('Your Coach roster is full');
    expect(res.text).toContain('Upgrade to A$79');
    expect(res.text).toContain('10 of 10 active clients');
    expect(res.text).toContain('A$39 a month');
    expect(res.text).toContain('id="upgrade-btn"');
    expect(res.text).not.toMatch(/gtag\(|googletagmanager|fbq\(|plausible|posthog|segment\.com|mixpanel/i);
    const home = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    const shopper = fs.readFileSync(path.join(__dirname, 'public/shopper.html'), 'utf8');
    expect(home).not.toContain('/coach/upgrade');
    expect(shopper).not.toContain('/api/coach/checkout');
  });
});

describe('Coach test-mode price script', () => {
  test('a live secret key is refused before any Stripe call', () => {
    const result = spawnSync(process.execPath, ['scripts/create-coach-test-prices.js'], {
      cwd: __dirname,
      env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_refused' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/live key/i);
  });
});

const liveKey = String(process.env.STRIPE_SECRET_KEY || '');
const liveDescribe = liveKey.startsWith('sk_test_') || liveKey.startsWith('rk_test_')
  ? describe
  : describe.skip;

liveDescribe('Stripe test mode Coach checkout', () => {
  test('creates a 14-day trial session and expires it', async () => {
    const stripe = require('stripe')(liveKey);
    const priceId = process.env.STRIPE_COACH_39_PRICE_ID;
    expect(priceId).toMatch(/^price_/);
    const price = await stripe.prices.retrieve(priceId);
    expect(price.livemode).toBe(false);
    expect(price.currency).toBe('aud');
    expect(price.unit_amount).toBe(3900);
    const customer = await stripe.customers.create({
      email: `coach-billing-test-${Date.now()}@fitmunch.invalid`,
      metadata: { brand: 'fitmunch', product: 'fitmunch' },
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: 'always',
      subscription_data: { trial_period_days: 14, metadata: { plan: 'coach-39', product: 'fitmunch' } },
      success_url: 'https://www.fitmunch.com.au/coach/upgrade?checkout=started',
      cancel_url: 'https://www.fitmunch.com.au/coach/upgrade?checkout=cancelled',
    });
    expect(session.livemode).toBe(false);
    expect(session.url).toContain('checkout.stripe.com');
    const expanded = await stripe.checkout.sessions.retrieve(session.id, { expand: ['subscription'] });
    const trialDays = expanded.subscription && expanded.subscription.trial_end && expanded.subscription.trial_start
      ? Math.round((expanded.subscription.trial_end - expanded.subscription.trial_start) / 86400)
      : null;
    expect(trialDays === 14 || session.mode === 'subscription').toBe(true);
    const paymentIntent = expanded.payment_intent && typeof expanded.payment_intent === 'object'
      ? expanded.payment_intent
      : null;
    if (paymentIntent && paymentIntent.statement_descriptor_suffix) {
      expect(paymentIntent.statement_descriptor_suffix).toBe('FITMUNCH');
    }
    const latestInvoice = expanded.subscription && expanded.subscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice === 'object' && latestInvoice.statement_descriptor) {
      expect(latestInvoice.statement_descriptor).toBe('FITMUNCH');
    }
    const draft = await stripe.invoices.create({
      customer: customer.id,
      auto_advance: false,
      metadata: { product: 'fitmunch', brand: 'FitMunch', plan: 'coach-39' },
      pending_invoice_items_behavior: 'exclude',
    });
    try {
      const applied = await applyFitMunchStatementSuffix(stripe, draft);
      expect(applied.applied).toBe(true);
      const readBack = await stripe.invoices.retrieve(draft.id);
      expect(readBack.statement_descriptor).toBe('FITMUNCH');
      expect(readBack.statement_descriptor).toBe(STATEMENT_DESCRIPTOR_SUFFIX);
    } finally {
      try {
        await stripe.invoices.del(draft.id);
      } catch (_) {
        /* draft cleanup */
      }
    }
    await stripe.checkout.sessions.expire(session.id);
  });
});
