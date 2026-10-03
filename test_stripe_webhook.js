/**
 * Stripe webhook brand filter, idempotency, signature, and guest linking.
 * Stripe is mocked. No network and no live keys.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcrypt');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';
process.env.STRIPE_COACH_39_PRICE_ID = process.env.STRIPE_COACH_39_PRICE_ID || 'price_coach39_test';
process.env.STRIPE_COACH_79_PRICE_ID = process.env.STRIPE_COACH_79_PRICE_ID || 'price_coach79_test';

const app = require('./server.js');
const storage = require('./server/storage.js');
const emailApi = require('./server/email.js');
const stripeEvents = require('./lib/stripe-events');
const {
  PRICE_IDS,
  buildSubscriptionCheckoutParams,
  isFitMunchSubscription,
} = require('./lib/fitmunch-checkout');

const COACH_39 = process.env.STRIPE_COACH_39_PRICE_ID;
const original = {
  getUserByEmail: storage.getUserByEmail,
  getUserById: storage.getUserById,
  createUser: storage.createUser,
  updateUserSubscription: storage.updateUserSubscription,
  updateUserCoachBilling: storage.updateUserCoachBilling,
  findUserByNormalizedEmail: storage.findUserByNormalizedEmail,
  db: storage.db,
};

function restoreStorage() {
  storage.getUserByEmail = original.getUserByEmail;
  storage.getUserById = original.getUserById;
  storage.createUser = original.createUser;
  storage.updateUserSubscription = original.updateUserSubscription;
  storage.updateUserCoachBilling = original.updateUserCoachBilling;
  storage.findUserByNormalizedEmail = original.findUserByNormalizedEmail;
  storage.db = original.db;
}

function emptyDb() {
  storage.db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

function constructEvent(body) {
  return JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body));
}

function postEvent(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function loggedText(spy) {
  return spy.mock.calls.map((args) => args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch (_) { return String(arg); }
  }).join(' ')).join('\n');
}

beforeEach(() => {
  emptyDb();
  storage.updateUserSubscription = jest.fn(async () => {});
  storage.updateUserCoachBilling = jest.fn(async () => {});
  storage.findUserByNormalizedEmail = async () => null;
  stripeEvents.resetStripeEventsForTests();
});

afterEach(() => {
  restoreStorage();
  app._private.setStripeForTests(null);
});

describe('FitMunch subscription identity', () => {
  test("{brand:'wipper', plan:'premium'} is not FitMunch", () => {
    const wipper = {
      id: 'sub_wipper_plan',
      status: 'active',
      metadata: { brand: 'wipper', plan: 'premium' },
      items: { data: [{ price: { id: 'price_wipper_299' } }] },
    };
    expect(isFitMunchSubscription(wipper)).toBe(false);
    expect(isFitMunchSubscription({ metadata: { plan: 'premium' } })).toBe(false);
    expect(isFitMunchSubscription({ metadata: { plan: 'pt-starter' } })).toBe(false);
    expect(isFitMunchSubscription({ metadata: { plan: 'pt-pro' } })).toBe(false);
    expect(isFitMunchSubscription({
      metadata: { app: 'fitmunch' },
    })).toBe(true);
    expect(isFitMunchSubscription({
      metadata: { brand: 'FitMunch' },
    })).toBe(true);
    expect(isFitMunchSubscription({
      metadata: { product: 'fitmunch' },
    })).toBe(true);
    expect(isFitMunchSubscription({
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    })).toBe(true);
    expect(isFitMunchSubscription({
      items: { data: [{ price: { product: 'prod_UoBDFNLbc6pTS4' } }] },
    })).toBe(true);
  });

  test('a wipper plan named premium is not cancelled, deduped, or provisioned', async () => {
    const subs = [
      {
        id: 'sub_old',
        customer: 'cus_mix',
        status: 'active',
        created: 10,
        metadata: { product: 'fitmunch', plan: 'premium' },
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        latest_invoice: { amount_paid: 0 },
      },
      {
        id: 'sub_new',
        customer: 'cus_mix',
        status: 'active',
        created: 30,
        metadata: { product: 'fitmunch', app: 'fitmunch', plan: 'premium' },
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        latest_invoice: { id: 'in_new', amount_paid: 1999, charge: 'ch_new' },
      },
      {
        id: 'sub_wipper_plan',
        customer: 'cus_mix',
        status: 'active',
        created: 40,
        metadata: { brand: 'wipper', plan: 'premium' },
        items: { data: [{ price: { id: 'price_wipper_299' } }] },
        latest_invoice: { id: 'in_wipper', amount_paid: 29900, charge: 'ch_wipper' },
      },
    ];
    const refunds = [];
    const cancels = [];
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => ({ data: subs.filter((sub) => sub.customer === 'cus_mix') })),
        cancel: jest.fn(async (sid) => {
          const sub = subs.find((row) => row.id === sid);
          sub.status = 'canceled';
          cancels.push(sid);
          return sub;
        }),
      },
      refunds: {
        create: jest.fn(async (params) => {
          refunds.push(params);
          return { id: 're_1', ...params };
        }),
      },
      webhooks: { constructEvent },
    });

    const res = await postEvent({
      id: 'evt_mix',
      type: 'customer.subscription.created',
      data: { object: subs[1] },
    });
    expect(res.status).toBe(200);
    expect(subs.find((sub) => sub.id === 'sub_old').status).toBe('active');
    expect(subs.find((sub) => sub.id === 'sub_new').status).toBe('canceled');
    expect(subs.find((sub) => sub.id === 'sub_wipper_plan').status).toBe('active');
    expect(cancels).toEqual(['sub_new']);
    expect(refunds.map((row) => row.charge)).toEqual(['ch_new']);
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });
});

describe('webhook brand filter and idempotency', () => {
  test('checkout params stamp metadata.app on the session and the subscription', () => {
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_member',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'member@example.com',
    });
    expect(params.metadata.app).toBe('fitmunch');
    expect(params.subscription_data.metadata.app).toBe('fitmunch');
    const ddl = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');
    const events = fs.readFileSync(path.join(__dirname, 'lib/stripe-events.js'), 'utf8');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS stripe_events');
    expect(ddl).toContain('event_id TEXT PRIMARY KEY');
    expect(ddl).toContain('received_at');
    expect(ddl).toContain('processed_at');
    expect(events).toContain('ON CONFLICT (event_id) DO NOTHING');
  });

  test('Wipper and Estimate checkout.session.completed are ignored with no email and no DB write', async () => {
    const sendWelcomeEmail = jest.spyOn(emailApi, 'sendWelcomeEmail').mockResolvedValue({ success: true });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    try {
      for (const event of [
        {
          id: 'evt_wipper',
          type: 'checkout.session.completed',
          data: {
            object: {
              customer: 'cus_wipper',
              customer_details: { email: 'wipper.person@example.com', name: 'Wipper Person' },
              metadata: { app: 'wipper', plan: 'deposit' },
              line_items: { data: [{ price: { id: 'price_wipper_299', product: 'prod_wipper' } }] },
            },
          },
        },
        {
          id: 'evt_estimate',
          type: 'checkout.session.completed',
          data: {
            object: {
              customer: 'cus_estimate',
              customer_details: { email: 'estimate.person@example.com', name: 'Estimate Person' },
              metadata: { app: 'estimate', plan: 'premium' },
              line_items: { data: [{ price: { id: 'price_estimate_hq', product: 'prod_estimate' } }] },
            },
          },
        },
      ]) {
        const res = await postEvent(event);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
      }
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(storage.updateUserSubscription).not.toHaveBeenCalled();
      expect(storage.updateUserCoachBilling).not.toHaveBeenCalled();
      expect(stripeEvents.stripeEventCountForTests()).toBe(0);
      const text = loggedText(log);
      expect(text).toContain('ignored: other product');
      expect(text).not.toMatch(/wipper\.person@example\.com|estimate\.person@example\.com|cus_wipper|cus_estimate|price_wipper|price_estimate/i);
      expect(text).not.toMatch(/\bselect\b|\binsert\b/i);
    } finally {
      sendWelcomeEmail.mockRestore();
      log.mockRestore();
    }
  });

  test('a FitMunch checkout grants access and sends one email, including on a second delivery', async () => {
    const user = {
      id: 'u-member',
      email: 'member@example.com',
      stripeCustomerId: 'cus_member',
      subscriptionTier: 'free',
      settings: {},
    };
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [user] }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    };
    storage.updateUserSubscription = jest.fn(async (_id, tier, expiresAt) => {
      user.subscriptionTier = tier;
      user.subscriptionExpiresAt = expiresAt;
    });
    const sendWelcomeEmail = jest.spyOn(emailApi, 'sendWelcomeEmail').mockResolvedValue({ success: true, messageId: 'msg_1' });
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    const event = {
      id: 'evt_fit_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_member',
          customer_details: { email: 'member@example.com', name: 'Member' },
          metadata: { plan: 'premium', app: 'fitmunch', priceId: PRICE_IDS.premium },
        },
      },
    };
    try {
      const first = await postEvent(event);
      const second = await postEvent(event);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(user.subscriptionTier).toBe('premium');
      expect(user.subscriptionExpiresAt).toBeInstanceOf(Date);
      expect(user.subscriptionExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(storage.updateUserSubscription).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledWith('member@example.com', 'Member', 'Premium');
      expect(stripeEvents.stripeEventCountForTests()).toBe(1);
    } finally {
      sendWelcomeEmail.mockRestore();
    }
  });

  test('a duplicate-sub event delivered twice cancels and refunds at most once', async () => {
    const subs = [
      {
        id: 'sub_keep',
        customer: 'cus_dup',
        status: 'trialing',
        created: 10,
        metadata: { product: 'fitmunch' },
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      },
      {
        id: 'sub_dup',
        customer: 'cus_dup',
        status: 'active',
        created: 40,
        metadata: { product: 'fitmunch', app: 'fitmunch' },
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        latest_invoice: { id: 'in_dup', amount_paid: 1999, charge: 'ch_dup' },
      },
    ];
    const stripe = {
      subscriptions: {
        list: jest.fn(async () => ({ data: subs })),
        cancel: jest.fn(async (sid, params, options) => {
          const sub = subs.find((row) => row.id === sid);
          sub.status = 'canceled';
          stripe.cancels.push({ sid, params, options });
          return sub;
        }),
      },
      refunds: {
        create: jest.fn(async (params, options) => {
          stripe.refundsMade.push({ params, options });
          return { id: 're_dup', ...params };
        }),
      },
      cancels: [],
      refundsMade: [],
      webhooks: { constructEvent },
    };
    app._private.setStripeForTests(stripe);
    const event = {
      id: 'evt_dup_once',
      type: 'customer.subscription.created',
      data: { object: subs[1] },
    };
    const first = await postEvent(event);
    const second = await postEvent(event);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stripe.cancels).toHaveLength(1);
    expect(stripe.cancels[0].sid).toBe('sub_dup');
    expect(stripe.cancels[0].options.idempotencyKey).toContain('evt_dup_once');
    expect(stripe.refundsMade).toHaveLength(1);
    expect(stripe.refundsMade[0].params).toEqual({ charge: 'ch_dup', reason: 'duplicate' });
    expect(stripe.refundsMade[0].options.idempotencyKey).toContain('ch_dup');
    expect(stripe.refundsMade[0].options.idempotencyKey).not.toContain('evt_dup_once');
    expect(subs.find((sub) => sub.id === 'sub_keep').status).toBe('trialing');
  });

  test('a bad signature returns 400 Invalid signature and logs only err.type', async () => {
    const err = new Error('No signatures found matching the expected signature for payload ada@example.com');
    err.type = 'StripeSignatureVerificationError';
    app._private.setStripeForTests({
      webhooks: {
        constructEvent() { throw err; },
      },
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await postEvent({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });
      expect(res.status).toBe(400);
      expect(res.text).toBe('Invalid signature');
      const text = loggedText(spy);
      expect(text).not.toContain('ada@example.com');
      expect(text).not.toContain('No signatures found');
      expect(spy).toHaveBeenCalledWith('Webhook sig failed:', 'StripeSignatureVerificationError');
    } finally {
      spy.mockRestore();
    }
  });

  test('a throwing Stripe call inside each event type returns 200 and logs type and code only', async () => {
    const err = new Error('No such subscription: sub_secret cus_secret ada@example.com SELECT * FROM users');
    err.type = 'StripeInvalidRequestError';
    err.code = 'resource_missing';
    const fail = jest.fn(async () => { throw err; });
    app._private.setStripeForTests({
      subscriptions: { list: fail, retrieve: fail, cancel: fail },
      customers: { retrieve: fail, list: fail, search: fail },
      invoices: { retrieve: fail },
      refunds: { create: fail },
      webhooks: { constructEvent },
    });
    const events = [
      {
        id: 'evt_throw_checkout',
        type: 'checkout.session.completed',
        data: { object: { customer: 'cus_member', metadata: { app: 'fitmunch', plan: 'premium', priceId: PRICE_IDS.premium } } },
      },
      {
        id: 'evt_throw_created',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', customer: 'cus_member', status: 'active', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } },
      },
      {
        id: 'evt_throw_updated',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_member', status: 'active', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } },
      },
      {
        id: 'evt_throw_deleted',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', customer: 'cus_member', status: 'canceled', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } },
      },
      {
        id: 'evt_throw_invoice',
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_1', customer: 'cus_member', subscription: 'sub_secret' } },
      },
    ];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const event of events) {
        const res = await postEvent(event);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
      }
      expect(fail).toHaveBeenCalled();
      const text = loggedText(spy);
      expect(text).toContain('StripeInvalidRequestError');
      expect(text).toContain('resource_missing');
      expect(text).not.toContain('ada@example.com');
      expect(text).not.toContain('sub_secret');
      expect(text).not.toContain('cus_secret');
      expect(text).not.toMatch(/SELECT \*/);
    } finally {
      spy.mockRestore();
    }
  });

  test('a database connection failure is a 500 so Stripe can retry', async () => {
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    const claim = jest.spyOn(stripeEvents, 'claimStripeEvent').mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await postEvent({
        id: 'evt_db_down',
        type: 'checkout.session.completed',
        data: { object: { metadata: { app: 'fitmunch', plan: 'premium' } } },
      });
      expect(res.status).toBe(500);
      expect(res.text).toBe('Handler error');
      const text = loggedText(spy);
      expect(text).not.toContain('connect ECONNREFUSED');
      expect(spy).toHaveBeenCalledWith('Webhook handler error:', undefined, 'ECONNREFUSED');
    } finally {
      claim.mockRestore();
      spy.mockRestore();
    }
  });
});

describe('guest checkout links on signup', () => {
  function makeCheckoutStripe() {
    const S = { customers: [], sessions: [], subs: [], n: 0, idempo: {} };
    const id = (prefix) => `${prefix}_${++S.n}`;
    const stripe = {
      S,
      customers: {
        create: jest.fn(async (params, opts) => {
          const key = opts && opts.idempotencyKey;
          if (key && S.idempo[key]) return S.idempo[key];
          const customer = { id: id('cus'), ...params };
          S.customers.push(customer);
          if (key) S.idempo[key] = customer;
          return customer;
        }),
        list: jest.fn(async ({ email } = {}) => ({
          data: S.customers.filter((customer) => !email || String(customer.email || '').toLowerCase() === String(email).toLowerCase()),
        })),
        search: jest.fn(async () => ({ data: S.customers.slice() })),
        retrieve: jest.fn(async (customerId) => {
          const found = S.customers.find((customer) => customer.id === customerId);
          if (found) return found;
          const missing = new Error('missing');
          missing.code = 'resource_missing';
          missing.type = 'StripeInvalidRequestError';
          throw missing;
        }),
      },
      checkout: {
        sessions: {
          retrieve: jest.fn(async (sessionId) => {
            const session = S.sessions.find((row) => row.id === sessionId);
            if (session) return session;
            const missing = new Error('missing');
            missing.code = 'resource_missing';
            throw missing;
          }),
        },
      },
      subscriptions: {
        list: jest.fn(async ({ customer } = {}) => ({
          data: S.subs.filter((sub) => !customer || sub.customer === customer),
        })),
        retrieve: jest.fn(async (subId) => {
          const sub = S.subs.find((row) => row.id === subId);
          if (sub) return sub;
          const missing = new Error('missing');
          missing.code = 'resource_missing';
          throw missing;
        }),
        cancel: jest.fn(async (sid) => {
          const sub = S.subs.find((row) => row.id === sid);
          if (sub) sub.status = 'canceled';
          return sub;
        }),
      },
      rawRequest: jest.fn(async (method, requestPath, params) => {
        if (method === 'POST' && requestPath === '/v1/checkout/sessions') {
          const session = {
            id: id('cs'),
            url: 'https://checkout.stripe.com/c/pay/x',
            currency: 'aud',
            locale: 'en-GB',
            adaptive_pricing: { enabled: false },
            branding_settings: { display_name: 'FitMunch' },
            status: 'open',
            customer: params.customer,
            metadata: params.metadata || {},
            created: Math.floor(Date.now() / 1000),
            params,
          };
          S.sessions.push(session);
          return session;
        }
        throw new Error('unexpected ' + requestPath);
      }),
      webhooks: { constructEvent },
      complete(csId) {
        const session = S.sessions.find((row) => row.id === csId);
        session.status = 'complete';
        const sub = {
          id: id('sub'),
          customer: session.customer,
          status: 'trialing',
          created: 100 + S.n,
          current_period_end: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
          items: { data: [{ price: { id: session.params.line_items[0].price } }] },
          metadata: {
            ...((session.params.subscription_data && session.params.subscription_data.metadata) || {}),
            product: 'fitmunch',
          },
        };
        S.subs.push(sub);
        session.subscription = sub.id;
        return sub;
      },
    };
    return stripe;
  }

  function installAccounts() {
    const users = {};
    storage.getUserByEmail = jest.fn(async (email) => users[String(email || '').trim().toLowerCase()] || null);
    storage.getUserById = jest.fn(async (id) => Object.values(users).find((user) => user.id === id) || null);
    storage.createUser = jest.fn(async (email, name, passwordHash) => {
      const user = {
        id: `u-${Object.keys(users).length + 1}`,
        email: String(email).trim().toLowerCase(),
        name,
        subscriptionTier: 'free',
        stripeCustomerId: null,
        settings: {},
        passwordHash: passwordHash || 'stub',
        emailVerified: false,
      };
      users[user.email] = user;
      return user;
    });
    storage.updateUserSubscription = jest.fn(async (id, tier, expiresAt) => {
      const user = Object.values(users).find((row) => row.id === id);
      user.subscriptionTier = tier;
      user.subscriptionExpiresAt = expiresAt;
    });
    storage.updateUserCoachBilling = jest.fn(async (id, coach, existing) => {
      const user = Object.values(users).find((row) => row.id === id);
      user.settings = { ...(existing || user.settings || {}), coach };
      return user.settings.coach;
    });
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      update: () => ({
        set: (values) => ({
          where: async () => {
            const user = Object.values(users).find((row) => !row.stripeCustomerId || row.stripeCustomerId === values.stripeCustomerId);
            if (user && values.stripeCustomerId) user.stripeCustomerId = values.stripeCustomerId;
          },
        }),
      }),
    };
    return users;
  }

  function claimTokenFor(stripe, sessionId) {
    const { mintGuestClaimToken } = require('./lib/guest-claim');
    const session = stripe.S.sessions.find((row) => row.id === sessionId);
    return mintGuestClaimToken({
      sessionId: session.id,
      customerId: session.customer,
      sessionCreated: session.created,
    });
  }

  test('a guest Premium checkout does not link on signup until the claim token is redeemed', async () => {
    const stripe = makeCheckoutStripe();
    app._private.setStripeForTests(stripe);
    const checkout = await request(app)
      .post('/api/quick-checkout')
      .send({ email: 'guest.premium@example.com', plan: 'premium' });
    expect(checkout.status).toBe(200);
    const sub = stripe.complete(checkout.body.id);
    const users = installAccounts();
    const createdBefore = stripe.customers.create.mock.calls.length;

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Guest Premium', email: '  Guest.Premium@Example.com ', password: 'password1' });

    expect(res.status).toBe(201);
    const user = users['guest.premium@example.com'];
    expect(user.emailVerified).toBe(false);
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');
    expect(stripe.customers.create.mock.calls.length).toBe(createdBefore);

    const claim = claimTokenFor(stripe, checkout.body.id);
    const claimed = await request(app)
      .post('/api/stripe/claim-guest')
      .set('Authorization', 'Bearer ' + res.body.token)
      .send({ token: claim });
    expect(claimed.status).toBe(200);
    expect(user.stripeCustomerId).toBe(sub.customer);
    expect(user.subscriptionTier).toBe('premium');
    expect(user.subscriptionExpiresAt).toBeInstanceOf(Date);

    users['other.premium@example.com'] = {
      id: 'u-other',
      email: 'other.premium@example.com',
      subscriptionTier: 'free',
      stripeCustomerId: null,
      settings: {},
      emailVerified: false,
    };
    const jwt = require('jsonwebtoken');
    const { jwtSecret } = require('./lib/fitmunch-checkout');
    const reused = await request(app)
      .post('/api/stripe/claim-guest')
      .set('Authorization', 'Bearer ' + jwt.sign({ userId: 'u-other' }, jwtSecret()))
      .send({ token: claim });
    expect(reused.status).toBe(409);
    expect(users['other.premium@example.com'].stripeCustomerId).toBeNull();
    expect(user.stripeCustomerId).toBe(sub.customer);
    expect(stripe.customers.create.mock.calls.length).toBe(createdBefore);
  });

  test('a guest Coach checkout links coach billing only when the claim token is redeemed', async () => {
    const stripe = makeCheckoutStripe();
    app._private.setStripeForTests(stripe);
    const checkout = await request(app)
      .post('/api/coach/checkout')
      .send({ email: 'guest.coach@example.com', plan: 'coach-39' });
    expect(checkout.status).toBe(200);
    const sub = stripe.complete(checkout.body.id);
    expect(sub.items.data[0].price.id).toBe(COACH_39);
    const users = installAccounts();

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Guest Coach', email: 'guest.coach@example.com', password: 'password1', role: 'pt' });

    expect(res.status).toBe(201);
    const user = users['guest.coach@example.com'];
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');

    const claimed = await request(app)
      .post('/api/stripe/claim-guest')
      .set('Authorization', 'Bearer ' + res.body.token)
      .send({ token: claimTokenFor(stripe, checkout.body.id) });
    expect(claimed.status).toBe(200);
    expect(user.stripeCustomerId).toBe(sub.customer);
    expect(user.settings.coach.tier).toBe('trial');
    expect(user.settings.coach.plan).toBe('coach-39');
    expect(user.subscriptionTier).toBe('free');
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('a guest Wipper customer with the same email is not linked', async () => {
    const stripe = makeCheckoutStripe();
    stripe.S.customers.push({
      id: 'cus_wipper_guest',
      email: 'shared.wipper@example.com',
      metadata: { brand: 'wipper', product: 'wipper' },
    });
    stripe.S.subs.push({
      id: 'sub_wipper_guest',
      customer: 'cus_wipper_guest',
      status: 'active',
      created: 5,
      metadata: { brand: 'wipper', plan: 'premium' },
      items: { data: [{ price: { id: 'price_wipper_299' } }] },
    });
    app._private.setStripeForTests(stripe);
    const users = installAccounts();

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Shared', email: 'shared.wipper@example.com', password: 'password1' });

    expect(res.status).toBe(201);
    const user = users['shared.wipper@example.com'];
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');
    expect(user.settings.coach).toBeUndefined();
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('an email already linked to another customer is not relinked', async () => {
    const stripe = makeCheckoutStripe();
    stripe.S.customers.push({
      id: 'cus_guest_live',
      email: 'ada@example.com',
      metadata: { brand: 'fitmunch', product: 'fitmunch' },
    });
    stripe.S.subs.push({
      id: 'sub_guest_live',
      customer: 'cus_guest_live',
      status: 'active',
      created: 20,
      metadata: { product: 'fitmunch', app: 'fitmunch', plan: 'premium' },
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    app._private.setStripeForTests(stripe);
    const users = installAccounts();
    const passwordHash = await bcrypt.hash('password1', 4);
    users['ada@example.com'] = {
      id: 'u-ada',
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash,
      stripeCustomerId: 'cus_kept',
      subscriptionTier: 'starter',
      settings: {},
    };

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password1' });

    expect(res.status).toBe(200);
    expect(users['ada@example.com'].stripeCustomerId).toBe('cus_kept');
    expect(users['ada@example.com'].subscriptionTier).toBe('starter');
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  test('unverified register and login do not link a guest, and lookup trims the email', async () => {
    const stripe = makeCheckoutStripe();
    stripe.S.customers.push({
      id: 'cus_victim',
      email: 'victim@example.com',
      metadata: { brand: 'fitmunch', product: 'fitmunch' },
    });
    stripe.S.subs.push({
      id: 'sub_victim',
      customer: 'cus_victim',
      status: 'trialing',
      created: 4,
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      metadata: { app: 'fitmunch', plan: 'premium' },
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    app._private.setStripeForTests(stripe);
    const users = installAccounts();
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Victim', email: '  VICTIM@Example.com ', password: 'password1' });
    expect(registered.status).toBe(201);
    const user = users['victim@example.com'];
    expect(user.email).toBe('victim@example.com');
    expect(user.emailVerified).toBe(false);
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: '  VICTIM@Example.com ', password: 'password1' });
    expect(login.status).toBe(200);
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('a claim token for a different Stripe customer is rejected', async () => {
    const { mintGuestClaimToken } = require('./lib/guest-claim');
    const jwt = require('jsonwebtoken');
    const { jwtSecret } = require('./lib/fitmunch-checkout');
    const users = installAccounts();
    users['owner@example.com'] = {
      id: 'u-owner',
      email: 'owner@example.com',
      subscriptionTier: 'free',
      stripeCustomerId: null,
      settings: {},
      emailVerified: true,
    };
    const created = Math.floor(Date.now() / 1000);
    const token = mintGuestClaimToken({
      sessionId: 'cs_victim',
      customerId: 'cus_victim',
      sessionCreated: created,
    });
    app._private.setStripeForTests({
      checkout: {
        sessions: {
          retrieve: async () => ({
            id: 'cs_victim',
            customer: 'cus_other',
            status: 'complete',
            created,
            metadata: { app: 'fitmunch', plan: 'premium', priceId: PRICE_IDS.premium },
          }),
        },
      },
    });
    const res = await request(app)
      .post('/api/stripe/claim-guest')
      .set('Authorization', 'Bearer ' + jwt.sign({ userId: 'u-owner' }, jwtSecret()))
      .send({ token });
    expect(res.status).toBe(400);
    expect(users['owner@example.com'].stripeCustomerId).toBeNull();
    expect(users['owner@example.com'].subscriptionTier).toBe('free');
  });
});

describe('webhook access, claims, and retries', () => {
  function linkedUser(tier = 'free') {
    const user = {
      id: 'u1',
      email: 'm@example.com',
      stripeCustomerId: 'cus_m',
      subscriptionTier: tier,
      settings: {},
      emailVerified: true,
    };
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [user] }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    };
    storage.updateUserSubscription = jest.fn(async (_id, next, expiresAt) => {
      user.subscriptionTier = next;
      user.subscriptionExpiresAt = expiresAt;
    });
    return user;
  }

  function checkoutEvent(id) {
    return {
      id,
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_m',
          customer_details: { email: 'm@example.com', name: 'Member' },
          metadata: { app: 'fitmunch', plan: 'premium', priceId: PRICE_IDS.premium },
        },
      },
    };
  }

  test('an in-progress claim returns 409 and a stale claim is reclaimed', async () => {
    const user = linkedUser();
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    const event = checkoutEvent('evt_stale');
    await stripeEvents.claimStripeEvent(event.id, event.type);
    const busy = await postEvent(event);
    expect(busy.status).toBe(409);
    expect(user.subscriptionTier).toBe('free');
    stripeEvents.ageStripeEventForTests(event.id, stripeEvents.STALE_CLAIM_MS + 1000);
    const again = await postEvent(event);
    expect(again.status).toBe(200);
    expect(user.subscriptionTier).toBe('premium');
    expect(user.subscriptionExpiresAt).toBeInstanceOf(Date);
  });

  test('processed stripe events past the retention window are pruned idempotently', async () => {
    await stripeEvents.claimStripeEvent('evt_old', 'invoice.paid');
    await stripeEvents.markStripeEventProcessed('evt_old');
    await stripeEvents.claimStripeEvent('evt_open', 'invoice.paid');
    stripeEvents.ageStripeEventForTests('evt_old', stripeEvents.EVENT_RETENTION_MS + 1000);
    stripeEvents.ageStripeEventForTests('evt_open', stripeEvents.EVENT_RETENTION_MS + 1000);
    await stripeEvents.pruneStripeEvents();
    expect(stripeEvents.stripeEventCountForTests()).toBe(1);
    await stripeEvents.pruneStripeEvents();
    expect(stripeEvents.stripeEventCountForTests()).toBe(1);
  });

  test('connection drops and statement timeouts are retried', async () => {
    const cases = [
      { message: 'Connection terminated unexpectedly' },
      { message: 'timeout exceeded when trying to connect' },
      { message: 'Connection terminated due to connection timeout' },
      { message: 'canceling statement due to statement timeout', code: '57014' },
    ];
    for (const item of cases) {
      stripeEvents.resetStripeEventsForTests();
      const user = linkedUser();
      let fail = true;
      storage.updateUserSubscription = jest.fn(async (_id, tier, expiresAt) => {
        if (fail) {
          fail = false;
          throw Object.assign(new Error(item.message), item.code ? { code: item.code } : {});
        }
        user.subscriptionTier = tier;
        user.subscriptionExpiresAt = expiresAt;
      });
      app._private.setStripeForTests({
        subscriptions: { list: jest.fn(async () => ({ data: [] })) },
        webhooks: { constructEvent },
      });
      const event = checkoutEvent('evt_outage_' + (item.code || String(cases.indexOf(item))));
      const first = await postEvent(event);
      const second = await postEvent(event);
      expect(first.status).toBe(500);
      expect(second.status).toBe(200);
      expect(user.subscriptionTier).toBe('premium');
    }
  });

  test('a permanent database error while claiming returns 500', async () => {
    linkedUser();
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    const claim = jest.spyOn(stripeEvents, 'claimStripeEvent').mockRejectedValueOnce(
      Object.assign(new Error('password authentication failed'), { code: '28P01' })
    );
    try {
      const res = await postEvent(checkoutEvent('evt_claim_perm'));
      expect(res.status).toBe(500);
      expect(res.text).toBe('Handler error');
    } finally {
      claim.mockRestore();
    }
  });

  test('a non-temporary duplicate cleanup error still grants access', async () => {
    const user = linkedUser();
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => { throw new TypeError('list failed'); }),
      },
      webhooks: { constructEvent },
    });
    const res = await postEvent(checkoutEvent('evt_cleanup'));
    expect(res.status).toBe(200);
    expect(user.subscriptionTier).toBe('premium');
  });

  test('a Stripe permission error during cleanup is retryable after access is granted', async () => {
    const user = linkedUser();
    const err = Object.assign(new Error('restricted'), { type: 'StripePermissionError', statusCode: 403 });
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => { throw err; }) },
      webhooks: { constructEvent },
    });
    const res = await postEvent(checkoutEvent('evt_perm'));
    expect(res.status).toBe(500);
    expect(user.subscriptionTier).toBe('premium');
  });

  test('a late created or checkout event does not re-grant a canceled subscription', async () => {
    const user = linkedUser('premium');
    const live = {
      id: 'sub_1',
      customer: 'cus_m',
      status: 'canceled',
      created: 100,
      current_period_end: 2000000000,
      metadata: { app: 'fitmunch', product: 'fitmunch', plan: 'premium' },
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    };
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => ({ data: [live] })),
        retrieve: jest.fn(async () => live),
      },
      webhooks: { constructEvent },
    });
    await postEvent({ id: 'evt_del_late', type: 'customer.subscription.deleted', data: { object: { ...live } } });
    expect(user.subscriptionTier).toBe('free');
    await postEvent({
      id: 'evt_created_late',
      type: 'customer.subscription.created',
      data: { object: { ...live, status: 'trialing' } },
    });
    expect(user.subscriptionTier).not.toBe('premium');
    user.subscriptionTier = 'free';
    await postEvent({
      id: 'evt_checkout_late',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_m',
          subscription: 'sub_1',
          metadata: { app: 'fitmunch', plan: 'premium', priceId: PRICE_IDS.premium },
        },
      },
    });
    expect(user.subscriptionTier).not.toBe('premium');
  });

  test('a webhook does not link an unverified user by Stripe customer email', async () => {
    const user = {
      id: 'u-sq',
      email: 'victim3@example.com',
      stripeCustomerId: null,
      subscriptionTier: 'free',
      settings: {},
      emailVerified: false,
    };
    storage.findUserByNormalizedEmail = async () => user;
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      update: () => ({
        set: (values) => ({
          where: async () => {
            if (values.stripeCustomerId) user.stripeCustomerId = values.stripeCustomerId;
          },
        }),
      }),
    };
    const sub = {
      id: 'sub_v3',
      customer: 'cus_v3',
      status: 'trialing',
      created: 100,
      current_period_end: 2000000000,
      metadata: { app: 'fitmunch', plan: 'premium' },
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    };
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => ({ data: [sub] })),
        retrieve: jest.fn(async () => sub),
      },
      customers: {
        retrieve: jest.fn(async () => ({
          id: 'cus_v3',
          email: 'Victim3@Example.com',
          metadata: { brand: 'fitmunch' },
        })),
      },
      webhooks: { constructEvent },
    });
    const res = await postEvent({ id: 'evt_email_link', type: 'customer.subscription.created', data: { object: sub } });
    expect(res.status).toBe(200);
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('a changed Stripe customer email does not link the subscription to that inbox', async () => {
    const user = {
      id: 'u-bob',
      email: 'bob@example.com',
      stripeCustomerId: null,
      subscriptionTier: 'free',
      settings: {},
      emailVerified: true,
    };
    storage.findUserByNormalizedEmail = async () => user;
    storage.db = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      update: () => ({
        set: (values) => ({
          where: async () => {
            if (values.stripeCustomerId) user.stripeCustomerId = values.stripeCustomerId;
          },
        }),
      }),
    };
    const sub = {
      id: 'sub_al',
      customer: 'cus_alice',
      status: 'active',
      created: 100,
      current_period_end: 2000000000,
      metadata: { app: 'fitmunch', plan: 'premium' },
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    };
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => ({ data: [sub] })),
        retrieve: jest.fn(async () => sub),
      },
      customers: {
        retrieve: jest.fn(async () => ({
          id: 'cus_alice',
          email: 'bob@example.com',
          metadata: { brand: 'fitmunch' },
        })),
      },
      webhooks: { constructEvent },
    });
    const res = await postEvent({ id: 'evt_email_change', type: 'customer.subscription.updated', data: { object: sub } });
    expect(res.status).toBe(200);
    expect(user.stripeCustomerId).toBeNull();
    expect(user.subscriptionTier).toBe('free');
  });

  test('a retry after a welcome email was sent does not send a second one', async () => {
    linkedUser();
    const sendWelcomeEmail = jest.spyOn(emailApi, 'sendWelcomeEmail').mockResolvedValue({ success: true, messageId: 'msg_1' });
    const mark = jest.spyOn(stripeEvents, 'markStripeEventProcessed').mockRejectedValueOnce(
      Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    );
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [] })) },
      webhooks: { constructEvent },
    });
    const event = checkoutEvent('evt_welcome_once');
    try {
      const first = await postEvent(event);
      const second = await postEvent(event);
      expect(first.status).toBe(500);
      expect(second.status).toBe(200);
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    } finally {
      sendWelcomeEmail.mockRestore();
      mark.mockRestore();
    }
  });

  test('login logs an error label and not the raw message', async () => {
    storage.getUserByEmail = async () => {
      throw new Error('password authentication failed for user secret@example.com');
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'password1' });
      expect(res.status).toBe(500);
      const text = loggedText(spy);
      expect(text).toContain('Login error');
      expect(text).not.toContain('secret@example.com');
      expect(text).not.toContain('password authentication failed');
    } finally {
      spy.mockRestore();
    }
  });
});
