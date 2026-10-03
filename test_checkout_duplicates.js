/**
 * Duplicate-subscription harness, ported from the local reproduction.
 * Simulated Stripe only: no network and no live keys.
 *
 * Before the fix, scenarios C, D, E and F each left 2 live subscriptions
 * (and E/F created 2 customers). These expectations are the corrected contract:
 * one customer, one checkout session, one live FitMunch subscription.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';

const app = require('./server.js');
const { jwtSecret, PRICE_IDS, stripeIdempotencyKey, IDEMPOTENCY_BUCKET_MS } = require('./lib/fitmunch-checkout');
const storage = require('./server/storage.js');

const originalGetUserById = storage.getUserById;
const originalUpdateUserSubscription = storage.updateUserSubscription;
const originalDb = storage.db;

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFakeStripe() {
  const S = {
    customers: [],
    sessions: [],
    subs: [],
    writes: [],
    cancels: [],
    refunds: [],
    portals: [],
    idempo: {},
    n: 0,
  };
  const id = (p) => `${p}_${++S.n}`;
  const fake = {
    S,
    customers: {
      create: jest.fn(async (p, opts) => {
        const key = opts && opts.idempotencyKey;
        if (key && S.idempo[key]) return S.idempo[key];
        await tick(20);
        const c = { id: id('cus'), created: S.n, ...p };
        S.customers.push(c);
        S.writes.push('customers.create');
        if (key) S.idempo[key] = c;
        return c;
      }),
      list: jest.fn(async ({ email } = {}) => {
        await tick(10);
        const data = S.customers.filter((c) => !email || String(c.email || '').toLowerCase() === String(email).toLowerCase());
        return { data };
      }),
      search: jest.fn(async () => {
        await tick(10);
        return { data: S.customers.slice() };
      }),
      retrieve: jest.fn(async (customerId) => {
        const found = S.customers.find((c) => c.id === customerId);
        if (found) return found;
        if (customerId === 'cus_existing' || customerId === 'cus_other') {
          return {
            id: customerId,
            email: 'steph@example.com',
            metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'u1' },
          };
        }
        const err = new Error('No such customer: ' + customerId);
        err.code = 'resource_missing';
        throw err;
      }),
    },
    subscriptions: {
      list: jest.fn(async ({ customer } = {}) => {
        await tick(15);
        return { data: S.subs.filter((s) => !customer || s.customer === customer) };
      }),
      cancel: jest.fn(async (sid, params) => {
        const s = S.subs.find((x) => x.id === sid);
        if (!s) throw new Error('missing sub ' + sid);
        s.status = 'canceled';
        S.writes.push('subscriptions.cancel');
        S.cancels.push({ id: sid, params });
        return s;
      }),
    },
    checkout: {
      sessions: {
        list: jest.fn(async ({ customer, status } = {}) => {
          await tick(10);
          const data = S.sessions.filter((s) => {
            if (customer && s.customer !== customer) return false;
            if (status && s.status !== status) return false;
            return true;
          });
          return { data };
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn(async (params) => {
          S.writes.push('billingPortal.sessions.create');
          S.portals.push(params);
          return { url: `https://billing.stripe.com/p/session/${params.customer}`, customer: params.customer };
        }),
      },
    },
    refunds: {
      create: jest.fn(async (params) => {
        S.writes.push('refunds.create');
        S.refunds.push(params);
        const refund = { id: id('re'), ...params };
        return refund;
      }),
    },
    invoices: {
      retrieve: jest.fn(async (invoiceId) => ({ id: invoiceId, amount_paid: 0 })),
    },
    rawRequest: jest.fn(async (method, requestPath, params, options) => {
      await tick(20);
      if (method === 'POST' && requestPath === '/v1/checkout/sessions') {
        const key = options && options.idempotencyKey;
        if (key && S.idempo[key]) return S.idempo[key];
        const cs = {
          id: id('cs'),
          url: 'https://checkout.stripe.com/c/pay/x',
          currency: 'aud',
          locale: 'en-GB',
          adaptive_pricing: { enabled: false },
          branding_settings: { display_name: 'FitMunch' },
          status: 'open',
          customer: params.customer,
          metadata: params.metadata || {},
          created: Date.now() / 1000,
          params,
        };
        S.sessions.push(cs);
        S.writes.push('checkout.sessions.create');
        if (key) S.idempo[key] = cs;
        return cs;
      }
      if (method === 'POST' && /\/expire$/.test(requestPath)) {
        const sessionId = requestPath.split('/')[4];
        const cs = S.sessions.find((s) => s.id === sessionId);
        if (cs) cs.status = 'expired';
        return { id: sessionId, status: 'expired' };
      }
      throw new Error('unexpected ' + requestPath);
    }),
    webhooks: { constructEvent: (body) => JSON.parse(body.toString()) },
    complete(csId) {
      const cs = S.sessions.find((x) => x.id === csId);
      if (!cs || cs.status !== 'open') return null;
      cs.status = 'complete';
      const sub = {
        id: id('sub'),
        customer: cs.customer,
        status: 'trialing',
        created: Date.now() / 1000 + S.n,
        trial_days: cs.params.subscription_data.trial_period_days,
        items: { data: [{ price: { id: cs.params.line_items[0].price } }] },
        metadata: { product: 'fitmunch', plan: cs.params.metadata.plan },
      };
      S.subs.push(sub);
      return sub;
    },
  };
  return fake;
}

let users;
let fake;

function installStorage() {
  storage.getUserById = jest.fn(async (uid) => {
    await tick(10);
    if (!users[uid]) return null;
    return { ...users[uid] };
  });
  storage.updateUserSubscription = jest.fn(async () => {});
  storage.db = {
    update: () => ({
      set: (v) => ({
        where: async () => {
          await tick(10);
          Object.values(users).forEach((u) => {
            if (u.id === 'u1') Object.assign(u, v);
          });
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
}

const tokenFor = (userId, extra = {}) => jwt.sign(
  { userId, email: users[userId]?.email || 'steph@example.com', name: 'Steph', role: 'client', ...extra },
  jwtSecret()
);

const post = () => request(app).post('/api/checkout').set('Authorization', `Bearer ${tokenFor('u1')}`)
  .set('Origin', 'https://www.fitmunch.com.au').send({ plan: 'premium' });

function report(label, stripeFake) {
  const live = stripeFake.S.subs.filter((s) => ['active', 'trialing', 'incomplete'].includes(s.status));
  const out = {
    scenario: label,
    customers_created: stripeFake.S.customers.length,
    checkout_sessions_created: stripeFake.S.sessions.length,
    subscriptions_live: live.length,
    subscriptions_live_customers: [...new Set(live.map((s) => s.customer))].length,
    charges_today_AUD: 0,
    charges_at_trial_end_AUD: +(live.length * 19.99).toFixed(2),
  };
  console.log('RESULT ' + JSON.stringify(out));
  return out;
}

beforeEach(() => {
  fake = makeFakeStripe();
  app._private.setStripeForTests(fake);
  users = {
    u1: { id: 'u1', email: 'steph@example.com', name: 'Steph', subscriptionTier: 'free', stripeCustomerId: 'cus_existing' },
  };
  installStorage();
});

afterAll(() => {
  storage.getUserById = originalGetUserById;
  storage.updateUserSubscription = originalUpdateUserSubscription;
  storage.db = originalDb;
  app._private.setStripeForTests(null);
});

describe('checkout duplicate harness', () => {
  test('A single click, complete checkout => 1 sub', async () => {
    const r = await post().expect(200);
    fake.complete(fake.S.sessions[0].id);
    const o = report('A single checkout', fake);
    expect(r.body.url).toBeTruthy();
    expect(o.subscriptions_live).toBe(1);
    expect(o.customers_created).toBe(0);
    expect(o.checkout_sessions_created).toBe(1);
    expect(o.charges_today_AUD).toBe(0);
    expect(o.charges_at_trial_end_AUD).toBe(19.99);
    expect(fake.S.sessions[0].params.mode).toBe('subscription');
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
    expect(fake.S.sessions[0].params.line_items[0].price).toBe(PRICE_IDS.premium);
    expect(fake.rawRequest.mock.calls[0][3].idempotencyKey).toEqual(expect.stringContaining(PRICE_IDS.premium));
    expect(fake.rawRequest.mock.calls[0][3].idempotencyKey).toEqual(expect.stringContaining('cus_existing'));
  });

  test('B second checkout AFTER completion is blocked', async () => {
    await post().expect(200);
    fake.complete(fake.S.sessions[0].id);
    const r2 = await post().expect(200);
    const o = report('B sequential re-checkout after completion', fake);
    expect(r2.body.alreadySubscribed).toBe(true);
    expect(r2.body.url).toBeNull();
    expect(o.checkout_sessions_created).toBe(1);
    expect(o.subscriptions_live).toBe(1);
    expect(o.charges_at_trial_end_AUD).toBe(19.99);
  });

  test('C double-submit (two concurrent POST /api/checkout), both sessions completed', async () => {
    const [r1, r2] = await Promise.all([post(), post()]);
    fake.S.sessions.forEach((cs) => fake.complete(cs.id));
    const o = report('C double-submit concurrent', fake);
    expect(r1.body.url).toBeTruthy();
    expect(r2.body.url).toBe(r1.body.url);
    expect(o.checkout_sessions_created).toBe(1);
    expect(o.subscriptions_live).toBe(1);
    expect(o.subscriptions_live_customers).toBe(1);
    expect(o.charges_today_AUD).toBe(0);
    expect(o.charges_at_trial_end_AUD).toBe(19.99);
  });

  test('D two tabs sequential, neither completed yet, then both completed', async () => {
    const first = await post().expect(200);
    const second = await post().expect(200);
    fake.S.sessions.forEach((cs) => fake.complete(cs.id));
    const o = report('D two open sessions (tab/back/retry)', fake);
    expect(second.body.url).toBe(first.body.url);
    expect(o.checkout_sessions_created).toBe(1);
    expect(o.subscriptions_live).toBe(1);
    expect(o.charges_at_trial_end_AUD).toBe(19.99);
  });

  test('E new user (no stripeCustomerId) double-submit => 1 customer', async () => {
    users.u1.stripeCustomerId = null;
    const [r1, r2] = await Promise.all([post(), post()]);
    fake.S.sessions.forEach((cs) => fake.complete(cs.id));
    const o = report('E new-user double-submit', fake);
    expect(r1.body.url).toBeTruthy();
    expect(r2.body.url).toBe(r1.body.url);
    expect(o.customers_created).toBe(1);
    expect(o.subscriptions_live_customers).toBe(1);
    expect(o.subscriptions_live).toBe(1);
    expect(o.checkout_sessions_created).toBe(1);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('u1'));
    expect(users.u1.stripeCustomerId).toBe(fake.S.customers[0].id);

    const r3 = await post();
    const after = report('E after guard pass', fake);
    expect(r3.body.alreadySubscribed).toBe(true);
    expect(after.subscriptions_live).toBe(1);
    expect(after.customers_created).toBe(1);
    expect(after.charges_at_trial_end_AUD).toBe(19.99);
  });

  test('F /api/quick-checkout twice same email => 1 customer, 1 sub', async () => {
    const q = () => request(app).post('/api/quick-checkout').send({ email: 'steph@example.com', plan: 'premium' });
    const first = await q().expect(200);
    const second = await q().expect(200);
    fake.S.sessions.forEach((cs) => fake.complete(cs.id));
    const o = report('F quick-checkout x2', fake);
    expect(second.body.url).toBe(first.body.url);
    expect(o.customers_created).toBe(1);
    expect(o.subscriptions_live).toBe(1);
    expect(o.subscriptions_live_customers).toBe(1);
    expect(o.checkout_sessions_created).toBe(1);
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('steph@example.com'));
  });

  test('G webhook retries (same event delivered 3x) cause no Stripe writes', async () => {
    const before = fake.S.writes.length;
    const evs = [
      { id: 'evt_1', type: 'checkout.session.completed', data: { object: { customer_details: {}, metadata: { plan: 'premium', app: 'fitmunch' } } } },
      { id: 'evt_2', type: 'customer.subscription.created', data: { object: { customer: 'cus_existing', status: 'trialing', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } } },
    ];
    for (const ev of evs) {
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/stripe/webhook').set('stripe-signature', 't=1,v1=x')
          .set('Content-Type', 'application/json').send(JSON.stringify(ev)).expect(200);
      }
    }
    console.log('RESULT ' + JSON.stringify({ scenario: 'G webhook x3 retries', stripe_writes_from_webhook: fake.S.writes.length - before }));
    expect(fake.S.writes.length - before).toBe(0);
  });
});

describe('webhook keeps the oldest FitMunch subscription', () => {
  function fitmunchSub(subId, created, extra = {}) {
    return {
      id: subId,
      customer: 'cus_existing',
      status: 'trialing',
      created,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      metadata: { product: 'fitmunch', plan: 'premium' },
      ...extra,
    };
  }

  function postEvent(event) {
    return request(app).post('/api/stripe/webhook').set('stripe-signature', 't=1,v1=x')
      .set('Content-Type', 'application/json').send(JSON.stringify(event));
  }

  test('cancels the newer subscription, prorates, and refunds a charge', async () => {
    fake.S.subs.push(
      fitmunchSub('sub_old', 100),
      fitmunchSub('sub_new', 300, {
        status: 'active',
        latest_invoice: { id: 'in_new', amount_paid: 1999, charge: 'ch_dup' },
      }),
      {
        id: 'sub_foreign',
        customer: 'cus_existing',
        status: 'active',
        created: 400,
        items: { data: [{ price: { id: 'price_not_fitmunch' } }] },
        metadata: { product: 'other' },
      }
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await postEvent({
      id: 'evt_dup',
      type: 'customer.subscription.created',
      data: { object: fake.S.subs[1] },
    });
    expect(res.status).toBe(200);
    expect(fake.S.subs.find((s) => s.id === 'sub_old').status).toBe('trialing');
    expect(fake.S.subs.find((s) => s.id === 'sub_new').status).toBe('canceled');
    expect(fake.S.subs.find((s) => s.id === 'sub_foreign').status).toBe('active');
    expect(fake.S.cancels).toEqual([
      { id: 'sub_new', params: { prorate: true, invoice_now: true } },
    ]);
    expect(fake.S.refunds).toEqual([{ charge: 'ch_dup', reason: 'duplicate' }]);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/kept the oldest and cancelled the newer one/);
    expect(logged).toMatch(/refunded the duplicate charge/);
    expect(logged).not.toMatch(/sub_old|sub_new|cus_existing|ch_dup/);
    warn.mockRestore();
  });

  test('checkout.session.completed also keeps the oldest', async () => {
    fake.S.subs.push(fitmunchSub('sub_old', 10), fitmunchSub('sub_new', 20));
    await postEvent({
      id: 'evt_cs',
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_existing', metadata: { plan: 'premium', app: 'fitmunch' }, customer_details: {} } },
    }).expect(200);
    expect(fake.S.subs.find((s) => s.id === 'sub_old').status).toBe('trialing');
    expect(fake.S.subs.find((s) => s.id === 'sub_new').status).toBe('canceled');
  });

  test('a zero-dollar trial duplicate is cancelled without a refund', async () => {
    fake.S.subs.push(
      fitmunchSub('sub_old', 10),
      fitmunchSub('sub_trial', 20, { latest_invoice: { amount_paid: 0, charge: 'ch_zero' } })
    );
    await postEvent({
      id: 'evt_zero',
      type: 'customer.subscription.created',
      data: { object: fake.S.subs[1] },
    }).expect(200);
    expect(fake.S.subs.find((s) => s.id === 'sub_trial').status).toBe('canceled');
    expect(fake.S.refunds).toHaveLength(0);
  });

  test('subscription.deleted does not downgrade while another live sub remains', async () => {
    fake.S.subs.push(fitmunchSub('sub_old', 10), fitmunchSub('sub_new', 20, { status: 'canceled' }));
    storage.db.select = () => ({
      from: () => ({ where: async () => [{ id: 'u1', stripeCustomerId: 'cus_existing' }] }),
    });
    await postEvent({
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_new', customer: 'cus_existing', status: 'canceled', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } },
    }).expect(200);
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();

    fake.S.subs.find((s) => s.id === 'sub_old').status = 'canceled';
    await postEvent({
      id: 'evt_del_last',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', customer: 'cus_existing', status: 'canceled', items: { data: [{ price: { id: PRICE_IDS.premium } }] } } },
    }).expect(200);
    expect(storage.updateUserSubscription).toHaveBeenCalledWith('u1', 'free', null);
  });
});

describe('checkout entry guards', () => {
  test('an incomplete subscription does not block another checkout', async () => {
    fake.S.subs.push({
      id: 'sub_incomplete',
      customer: 'cus_existing',
      status: 'incomplete',
      created: 50,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    const res = await post().expect(200);
    expect(res.body.url).toBeTruthy();
    expect(res.body.alreadySubscribed).toBeUndefined();
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].params.customer).toBe('cus_existing');
    expect(fake.S.subs.find((s) => s.id === 'sub_incomplete').status).toBe('incomplete');
  });

  test('checkout keeps the oldest live sub and cancels the newer one', async () => {
    fake.S.subs.push(
      {
        id: 'sub_old',
        customer: 'cus_existing',
        status: 'trialing',
        created: 10,
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      },
      {
        id: 'sub_new',
        customer: 'cus_existing',
        status: 'trialing',
        created: 90,
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        latest_invoice: { amount_paid: 1999, charge: 'ch_newer' },
      }
    );
    const res = await post().expect(200);
    expect(res.body.alreadySubscribed).toBe(true);
    expect(fake.S.subs.find((s) => s.id === 'sub_old').status).toBe('trialing');
    expect(fake.S.subs.find((s) => s.id === 'sub_new').status).toBe('canceled');
    expect(fake.S.cancels[0]).toEqual({ id: 'sub_new', params: { prorate: true, invoice_now: true } });
    expect(fake.S.refunds[0]).toEqual({ charge: 'ch_newer', reason: 'duplicate' });
    expect(fake.S.sessions).toHaveLength(0);
  });

  test('public /api/stripe/checkout-sessions does not open a second session', async () => {
    const body = {
      priceId: PRICE_IDS.premium,
      customerId: 'cus_existing',
      successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
      cancelUrl: 'https://www.fitmunch.com.au/pricing',
    };
    const postSession = () => request(app).post('/api/stripe/checkout-sessions')
      .set('Idempotency-Key', 'public-checkout-once')
      .send(body);
    const first = await postSession().expect(200);
    const second = await postSession().expect(200);
    expect(first.body.url).toBeTruthy();
    expect(second.body.url).toBe(first.body.url);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
    expect(fake.S.sessions[0].params.line_items[0].price).toBe(PRICE_IDS.premium);

    fake.complete(fake.S.sessions[0].id);
    const third = await postSession().expect(200);
    expect(third.body.success).toBe(true);
    expect(third.body.url).toBe(first.body.url);
    expect(third.body.alreadySubscribed).toBeUndefined();
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].customer).not.toBe('cus_existing');
    expect(fake.S.sessions[0].params.saved_payment_method_options).toBeUndefined();
    expect(JSON.stringify(fake.S.sessions[0].params)).not.toMatch(/allow_redisplay|saved_payment_method/);
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.S.subs.filter((s) => s.status === 'trialing')).toHaveLength(1);
  });

  test('checkout-sessions rejects a non-catalog price', async () => {
    const res = await request(app).post('/api/stripe/checkout-sessions').send({
      priceId: 'price_not_fitmunch',
      customerId: 'cus_existing',
      successUrl: 'https://www.fitmunch.com.au/app.html',
      cancelUrl: 'https://www.fitmunch.com.au/pricing',
    }).expect(400);
    expect(res.body.success).toBe(false);
    expect(fake.S.sessions).toHaveLength(0);
  });
});

describe('billing portal auth', () => {
  test('logged out is 401 and ignores a customer id in the body', async () => {
    const res = await request(app).post('/api/billing-portal')
      .send({ customerId: 'cus_victim' })
      .expect(401);
    expect(res.body.error).toMatch(/authentication required/i);
    expect(fake.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test('a logged-in user cannot open another customer portal', async () => {
    users.u2 = {
      id: 'u2',
      email: 'other@example.com',
      name: 'Other',
      subscriptionTier: 'premium',
      stripeCustomerId: 'cus_other',
    };
    const res = await request(app).post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor('u2')}`)
      .send({ customerId: 'cus_existing' })
      .expect(200);
    expect(fake.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(fake.S.portals[0].customer).toBe('cus_other');
    expect(fake.S.portals[0].customer).not.toBe('cus_existing');
    expect(res.body.url).toContain('cus_other');
    expect(res.body.url).not.toContain('cus_victim');
  });

  test('a user with no Stripe customer cannot pass someone else\'s id', async () => {
    users.u1.stripeCustomerId = null;
    const res = await request(app).post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor('u1')}`)
      .send({ customerId: 'cus_victim' })
      .expect(400);
    expect(res.body.error).toMatch(/no billing account/i);
    expect(fake.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('client checkout dedupe', () => {
  test('login and app disable the checkout control and share one in-flight request', () => {
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const success = fs.readFileSync(path.join(__dirname, 'public/success.html'), 'utf8');
    expect(login).toContain('if (authInFlight || checkoutInFlight) return;');
    expect(login).toContain('btn.disabled = true');
    expect(login).toContain("await fetch('/api/checkout'");
    expect(appHtml).toContain('if (checkoutInFlight) return checkoutInFlight;');
    expect(appHtml).toContain('btn.disabled = true');
    expect(appHtml).toContain("startCheckout('premium', this)");
    expect(success).toContain("localStorage.getItem('fm_token')");
    expect(success).toContain('Authorization');
    expect(success).not.toContain('customerId: sessionCustomerId');
    expect(success).toContain('if (portalInFlight) return portalInFlight;');
  });
});

function publicCheckoutShape(res) {
  return {
    status: res.status,
    success: res.body.success,
    keys: Object.keys(res.body).sort(),
    urlIsCheckout: typeof res.body.url === 'string' && res.body.url.includes('checkout.stripe.com'),
    hasId: typeof res.body.id === 'string' && res.body.id.length > 0,
    alreadySubscribed: Object.prototype.hasOwnProperty.call(res.body, 'alreadySubscribed'),
    message: Object.prototype.hasOwnProperty.call(res.body, 'message'),
  };
}

describe('unauthenticated checkout privacy', () => {
  function seedVictim() {
    fake.S.customers.push({
      id: 'cus_victim',
      email: 'victim@example.com',
      created: 1,
      metadata: { brand: 'wipper', product: 'wipper' },
      invoice_settings: { default_payment_method: 'pm_saved_card' },
    });
    fake.S.subs.push({
      id: 'sub_victim',
      customer: 'cus_victim',
      status: 'active',
      created: 10,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      metadata: { product: 'fitmunch', brand: 'FitMunch' },
    });
  }

  test('a stranger using an existing customer email gets a new FitMunch customer and no saved cards', async () => {
    seedVictim();
    const res = await request(app).post('/api/quick-checkout')
      .send({ email: 'victim@example.com', plan: 'premium' })
      .expect(200);

    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    const created = fake.customers.create.mock.calls[0][0];
    expect(created.email).toBe('victim@example.com');
    expect(created.metadata.brand).toBe('fitmunch');
    expect(created.metadata.product).toBe('fitmunch');
    expect(fake.S.customers.find((c) => c.id === 'cus_victim')).toBeTruthy();
    expect(res.body.success).toBe(true);
    expect(res.body.alreadySubscribed).toBeUndefined();
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].customer).not.toBe('cus_victim');
    expect(fake.S.sessions[0].customer).toBe(fake.S.customers.find((c) => c.id !== 'cus_victim').id);
    expect(fake.S.sessions[0].params.saved_payment_method_options).toBeUndefined();
    expect(fake.S.sessions[0].params.allow_redisplay).toBeUndefined();
    expect(JSON.stringify(fake.S.sessions[0].params)).not.toMatch(/allow_redisplay|saved_payment_method|pm_saved_card|cus_victim/);
    expect(fake.S.sessions[0].params.line_items[0].price).toBe('price_1ToYrXGMuYRuJYDrwHtvWD1c');
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
    expect(fake.S.subs.find((s) => s.id === 'sub_victim').status).toBe('active');
  });

  test('known and unknown emails get the same response shape and status', async () => {
    seedVictim();
    const known = await request(app).post('/api/quick-checkout')
      .send({ email: 'victim@example.com', plan: 'premium' });
    const unknown = await request(app).post('/api/quick-checkout')
      .send({ email: 'nobody@example.com', plan: 'premium' });

    expect(publicCheckoutShape(known)).toEqual(publicCheckoutShape(unknown));
    expect(known.status).toBe(200);
    expect(known.body.id).not.toBe(unknown.body.id);
    expect(JSON.stringify(known.body)).not.toMatch(/cus_victim|alreadySubscribed|subscribed/i);
    expect(JSON.stringify(unknown.body)).not.toMatch(/cus_victim|alreadySubscribed|subscribed/i);
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    const createdEmails = fake.customers.create.mock.calls.map((call) => call[0].email).sort();
    expect(createdEmails).toEqual(['nobody@example.com', 'victim@example.com']);
    expect(fake.S.sessions.every((session) => session.customer !== 'cus_victim')).toBe(true);
  });

  test('two simultaneous submits from the same browser yield one session', async () => {
    const send = () => request(app).post('/api/quick-checkout')
      .set('User-Agent', 'FitMunchPrivacyTest/1.0')
      .send({ email: 'double@example.com', plan: 'premium' });
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.url).toBe(first.body.url);
    expect(second.body.id).toBe(first.body.id);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('double@example.com'));
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).not.toEqual(expect.stringContaining('cus_'));
  });

  test('a client nonce dedupes a double submit without looking up customers by email', async () => {
    const send = () => request(app).post('/api/quick-checkout')
      .set('Idempotency-Key', 'browser-attempt-42')
      .set('User-Agent', 'FitMunchPrivacyTest/1.0')
      .send({ email: 'nonce@example.com', plan: 'premium' });
    const [first, second] = await Promise.all([send(), send()]);
    expect(second.body.url).toBe(first.body.url);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('browser-attempt-42'));
  });

  test('public customer create and checkout-sessions do not reuse a customer found by email', async () => {
    seedVictim();
    const created = await request(app).post('/api/stripe/customers')
      .send({ email: 'victim@example.com', name: 'Stranger', metadata: { userId: 'u1', isTest: true } })
      .expect(200);
    expect(created.body.id).not.toBe('cus_victim');
    expect(created.body.email).toBe('victim@example.com');
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    const customer = fake.S.customers.find((c) => c.id === created.body.id);
    expect(customer.metadata.brand).toBe('fitmunch');
    expect(customer.metadata.userId).toBeUndefined();
    expect(customer.metadata.isTest).toBe(true);

    const session = await request(app).post('/api/stripe/checkout-sessions').send({
      priceId: PRICE_IDS.premium,
      customerId: 'cus_victim',
      successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
      cancelUrl: 'https://www.fitmunch.com.au/pricing',
    }).expect(200);
    expect(session.body.alreadySubscribed).toBeUndefined();
    expect(session.body.url).toBeTruthy();
    expect(fake.S.sessions[0].customer).not.toBe('cus_victim');
    expect(JSON.stringify(fake.S.sessions[0].params)).not.toMatch(/saved_payment_method|allow_redisplay|pm_saved_card/);
  });
});

describe('logged-in customer reuse is the linked FitMunch customer', () => {
  test('reuses the linked FitMunch customer and ignores another customer with the same email', async () => {
    fake.S.customers.push(
      {
        id: 'cus_linked',
        email: 'not-the-login-email@example.com',
        metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'u1' },
      },
      {
        id: 'cus_same_email',
        email: 'steph@example.com',
        metadata: { brand: 'wipper', product: 'wipper' },
        invoice_settings: { default_payment_method: 'pm_other_brand' },
      }
    );
    fake.S.subs.push({
      id: 'sub_other',
      customer: 'cus_same_email',
      status: 'active',
      created: 5,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    users.u1.stripeCustomerId = 'cus_linked';

    const res = await post().expect(200);
    expect(res.body.url).toBeTruthy();
    expect(res.body.alreadySubscribed).toBeUndefined();
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    expect(fake.customers.create).not.toHaveBeenCalled();
    expect(fake.S.sessions[0].customer).toBe('cus_linked');
    expect(fake.S.sessions[0].params.customer).toBe('cus_linked');
  });

  test('a linked customer from another brand is not reused', async () => {
    fake.S.customers.push({
      id: 'cus_foreign',
      email: 'steph@example.com',
      metadata: { brand: 'wipper', product: 'wipper' },
      invoice_settings: { default_payment_method: 'pm_foreign' },
    });
    users.u1.stripeCustomerId = 'cus_foreign';

    const res = await post().expect(200);
    expect(res.body.url).toBeTruthy();
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    const created = fake.customers.create.mock.calls[0][0];
    expect(created.metadata.brand).toBe('fitmunch');
    expect(fake.S.sessions[0].customer).not.toBe('cus_foreign');
    expect(fake.S.sessions[0].params.customer).toBe(fake.S.customers.find((c) => c.metadata.brand === 'fitmunch' && c.id !== 'cus_foreign').id);
    expect(users.u1.stripeCustomerId).toBe(fake.S.sessions[0].customer);
    expect(JSON.stringify(fake.S.sessions[0].params)).not.toMatch(/pm_foreign|saved_payment_method|allow_redisplay/);
  });

  test('a logged-in user with no stripe id does not attach a customer found by email', async () => {
    fake.S.customers.push({
      id: 'cus_by_email',
      email: 'steph@example.com',
      metadata: { brand: 'fitmunch', product: 'fitmunch' },
    });
    users.u1.stripeCustomerId = null;

    const res = await post().expect(200);
    expect(res.body.url).toBeTruthy();
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    expect(fake.S.sessions[0].customer).not.toBe('cus_by_email');
    expect(users.u1.stripeCustomerId).toBe(fake.S.sessions[0].customer);
    expect(fake.customers.create.mock.calls[0][0].metadata.brand).toBe('fitmunch');
  });

  test('a legacy linked customer with a live FitMunch sub stays already subscribed', async () => {
    fake.S.customers.push({
      id: 'cus_legacy',
      email: 'steph@example.com',
      metadata: {},
    });
    fake.S.subs.push({
      id: 'sub_legacy',
      customer: 'cus_legacy',
      status: 'trialing',
      created: 15,
      items: { data: [{ price: { id: 'price_1ToYrXGMuYRuJYDrwHtvWD1c' } }] },
    });
    users.u1.stripeCustomerId = 'cus_legacy';

    const res = await post().expect(200);
    expect(res.body.alreadySubscribed).toBe(true);
    expect(res.body.url).toBeNull();
    expect(fake.customers.create).not.toHaveBeenCalled();
    expect(fake.S.sessions).toHaveLength(0);
    expect(users.u1.stripeCustomerId).toBe('cus_legacy');
    expect(fake.S.subs.find((s) => s.id === 'sub_legacy').status).toBe('trialing');
  });

  test('an active subscription on the linked FitMunch customer still blocks a second checkout', async () => {
    fake.S.subs.push({
      id: 'sub_live',
      customer: 'cus_existing',
      status: 'active',
      created: 20,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      metadata: { product: 'fitmunch' },
    });
    const res = await post().expect(200);
    expect(res.body.alreadySubscribed).toBe(true);
    expect(res.body.url).toBeNull();
    expect(fake.S.sessions).toHaveLength(0);
  });
});

describe('guest subscriptions across customers', () => {
  function postEvent(event) {
    return request(app).post('/api/stripe/webhook').set('stripe-signature', 't=1,v1=x')
      .set('Content-Type', 'application/json').send(JSON.stringify(event));
  }

  function fitmunchGuest(customerId, email) {
    return {
      id: customerId,
      email,
      metadata: { brand: 'fitmunch', product: 'fitmunch' },
    };
  }

  function liveSub(subId, customerId, created, status = 'trialing') {
    return {
      id: subId,
      customer: customerId,
      status,
      created,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
      metadata: { product: 'fitmunch', plan: 'premium' },
    };
  }

  test('two guest checkouts, same email, different nonces: both stay trialing and neither is cancelled', async () => {
    const send = (nonce) => request(app).post('/api/quick-checkout')
      .set('Idempotency-Key', nonce)
      .send({ email: 'guest@example.com', plan: 'premium' });
    const first = await send('nonce-tab-a').expect(200);
    const second = await send('nonce-tab-b').expect(200);
    expect(first.body.id).not.toBe(second.body.id);
    expect(fake.S.sessions).toHaveLength(2);
    const older = fake.complete(fake.S.sessions[0].id);
    const newer = fake.complete(fake.S.sessions[1].id);
    expect(older.created).toBeLessThan(newer.created);

    await postEvent({
      id: 'evt_two_guests',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: newer.customer,
          customer_details: { email: 'guest@example.com' },
          metadata: { plan: 'premium', app: 'fitmunch', email: 'guest@example.com' },
        },
      },
    }).expect(200);

    const live = fake.S.subs.filter((sub) => sub.status === 'trialing');
    expect(live).toHaveLength(2);
    expect(fake.S.subs.find((sub) => sub.id === older.id).status).toBe('trialing');
    expect(fake.S.subs.find((sub) => sub.id === newer.id).status).toBe('trialing');
    expect(fake.S.cancels).toHaveLength(0);
    expect(fake.S.refunds).toHaveLength(0);
  });

  test('a guest customer with the same email never cancels the linked user sub', async () => {
    fake.S.customers.push(
      fitmunchGuest('cus_member', 'member@example.com'),
      fitmunchGuest('cus_guest_same', 'member@example.com')
    );
    fake.S.subs.push(
      liveSub('sub_member', 'cus_member', 100),
      liveSub('sub_guest_older', 'cus_guest_same', 1)
    );
    storage.db.select = () => ({
      from: () => ({ where: async () => [{ id: 'u1', stripeCustomerId: 'cus_member' }] }),
    });

    await postEvent({
      id: 'evt_guest_vs_member',
      type: 'customer.subscription.created',
      data: { object: fake.S.subs.find((sub) => sub.id === 'sub_guest_older') },
    }).expect(200);

    expect(fake.S.subs.find((sub) => sub.id === 'sub_member').status).toBe('trialing');
    expect(fake.S.cancels.map((row) => row.id)).not.toContain('sub_member');
  });

  test('other-brand customers with the same email are untouched', async () => {
    fake.S.customers.push(
      fitmunchGuest('cus_g1', 'shared@example.com'),
      fitmunchGuest('cus_g2', 'shared@example.com'),
      {
        id: 'cus_wipper',
        email: 'shared@example.com',
        metadata: { brand: 'wipper', product: 'wipper' },
      }
    );
    fake.S.subs.push(
      liveSub('sub_g1', 'cus_g1', 10),
      liveSub('sub_g2', 'cus_g2', 40),
      {
        id: 'sub_wipper',
        customer: 'cus_wipper',
        status: 'active',
        created: 5,
        items: { data: [{ price: { id: 'price_other_brand' } }] },
        metadata: { product: 'wipper', brand: 'Wipper' },
      }
    );

    await postEvent({
      id: 'evt_brand_boundary',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_g2',
          customer_details: { email: 'shared@example.com' },
          metadata: { plan: 'premium', app: 'fitmunch' },
        },
      },
    }).expect(200);

    expect(fake.S.subs.find((sub) => sub.id === 'sub_g1').status).toBe('trialing');
    expect(fake.S.subs.find((sub) => sub.id === 'sub_g2').status).toBe('trialing');
    expect(fake.S.subs.find((sub) => sub.id === 'sub_wipper').status).toBe('active');
    expect(fake.S.cancels).toHaveLength(0);
    const listedCustomers = fake.subscriptions.list.mock.calls.map((call) => call[0] && call[0].customer);
    expect(listedCustomers).not.toContain('cus_wipper');
  });

  test('a guest sub that becomes active does not cancel another guest customer', async () => {
    fake.S.customers.push(
      fitmunchGuest('cus_old_guest', 'retry@example.com'),
      fitmunchGuest('cus_new_guest', 'retry@example.com')
    );
    const older = liveSub('sub_kept', 'cus_old_guest', 10);
    const newer = liveSub('sub_paid', 'cus_new_guest', 80, 'incomplete');
    fake.S.subs.push(older, newer);
    newer.status = 'active';

    await postEvent({
      id: 'evt_incomplete_paid',
      type: 'customer.subscription.updated',
      data: { object: newer },
    }).expect(200);

    expect(fake.S.subs.find((sub) => sub.id === 'sub_kept').status).toBe('trialing');
    expect(fake.S.subs.find((sub) => sub.id === 'sub_paid').status).toBe('active');
    expect(fake.S.cancels).toHaveLength(0);
  });

  test('a stranger checking out first with the victim email does not cancel the victim guest sub', async () => {
    fake.S.customers.push(
      fitmunchGuest('cus_stranger', 'victim@example.com'),
      fitmunchGuest('cus_victim', 'victim@example.com')
    );
    const stranger = liveSub('sub_stranger', 'cus_stranger', 1);
    const victim = liveSub('sub_victim', 'cus_victim', 80, 'active');
    victim.latest_invoice = { id: 'in_victim', amount_paid: 1999, charge: 'ch_victim' };
    fake.S.subs.push(stranger, victim);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await postEvent({
        id: 'evt_stranger_email',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_victim',
            customer_details: { email: 'victim@example.com' },
            metadata: { plan: 'premium', app: 'fitmunch', priceId: PRICE_IDS.premium },
          },
        },
      }).expect(200);
      expect(fake.S.subs.find((sub) => sub.id === 'sub_stranger').status).toBe('trialing');
      expect(fake.S.subs.find((sub) => sub.id === 'sub_victim').status).toBe('active');
      expect(fake.S.cancels).toHaveLength(0);
      expect(fake.S.refunds).toHaveLength(0);
      const text = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(text).toContain('[checkout] guest duplicate flagged');
      expect(text).not.toMatch(/victim@example.com|cus_victim|cus_stranger|sub_victim|sub_stranger/);
    } finally {
      warn.mockRestore();
    }
  });

  test('two customers tied to the same user still cancel the newer subscription', async () => {
    fake.S.customers.push(
      {
        id: 'cus_owner_old',
        email: 'owner@example.com',
        metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'user-1' },
      },
      {
        id: 'cus_owner_new',
        email: 'owner@example.com',
        metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'user-1' },
      }
    );
    fake.S.subs.push(
      liveSub('sub_owner_old', 'cus_owner_old', 10),
      liveSub('sub_owner_new', 'cus_owner_new', 90, 'active')
    );
    await postEvent({
      id: 'evt_same_user',
      type: 'customer.subscription.created',
      data: { object: fake.S.subs.find((sub) => sub.id === 'sub_owner_new') },
    }).expect(200);
    expect(fake.S.subs.find((sub) => sub.id === 'sub_owner_old').status).toBe('trialing');
    expect(fake.S.subs.find((sub) => sub.id === 'sub_owner_new').status).toBe('canceled');
    expect(fake.S.cancels.map((row) => row.id)).toContain('sub_owner_new');
    expect(fake.S.cancels.map((row) => row.id)).not.toContain('sub_owner_old');
  });

  test('a nonce replay with a different email returns a different session', async () => {
    const send = (email) => request(app).post('/api/quick-checkout')
      .set('Idempotency-Key', 'replayed-nonce')
      .send({ email, plan: 'premium' });
    const first = await send('one@example.com').expect(200);
    const second = await send('two@example.com').expect(200);
    expect(second.body.id).not.toBe(first.body.id);
    expect(fake.S.sessions).toHaveLength(2);
    expect(fake.customers.create.mock.calls.map((call) => call[0].email).sort())
      .toEqual(['one@example.com', 'two@example.com']);
  });

  test('checkout-sessions without a nonce or email does not reuse a session', async () => {
    const body = {
      priceId: PRICE_IDS.premium,
      customerId: 'cus_existing',
      successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
      cancelUrl: 'https://www.fitmunch.com.au/pricing',
    };
    const first = await request(app).post('/api/stripe/checkout-sessions').send(body).expect(200);
    const second = await request(app).post('/api/stripe/checkout-sessions').send(body).expect(200);
    expect(second.body.id).not.toBe(first.body.id);
    expect(fake.S.sessions).toHaveLength(2);
    expect(fake.S.sessions.every((session) => session.customer !== 'cus_existing')).toBe(true);
  });
});

describe('idempotency key bucket', () => {
  test('same user and price share a key inside one minute and change on the next', () => {
    const now = 1_700_000_000_000;
    const a = stripeIdempotencyKey(['checkout', 'user-1', PRICE_IDS.premium], now);
    const b = stripeIdempotencyKey(['checkout', 'user-1', PRICE_IDS.premium], now + 1000);
    const c = stripeIdempotencyKey(['checkout', 'user-1', PRICE_IDS.premium], now + IDEMPOTENCY_BUCKET_MS);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(a).toContain(PRICE_IDS.premium);
    expect(a.length).toBeLessThanOrEqual(255);
  });
});
