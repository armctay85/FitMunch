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
// The per-IP and per-email limits have their own tests below.
process.env.QUICK_CHECKOUT_IP_MAX_PER_HOUR = '100000';
process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR = '100000';
process.env.STRIPE_CUSTOMERS_IP_MAX_PER_HOUR = '100000';
process.env.STRIPE_CUSTOMERS_USER_MAX_PER_HOUR = '100000';
process.env.QUICK_CHECKOUT_EMAIL_MAX_PER_HOUR = '100000';

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
    expect(second.body).toEqual(first.body);
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
  function seedVictimCustomerOnly() {
    fake.S.customers.push({
      id: 'cus_victim',
      email: 'victim@example.com',
      created: 1,
      metadata: { brand: 'wipper', product: 'wipper' },
      invoice_settings: { default_payment_method: 'pm_saved_card' },
    });
  }

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

  test('a stranger using a live subscriber email gets no checkout; the subscriber is emailed a sign-in link', async () => {
    seedVictim();
    const emailApi = require('./server/email.js');
    const signIn = jest.spyOn(emailApi, 'sendSignInToManageEmail').mockResolvedValue({ success: true });
    const res = await request(app).post('/api/quick-checkout')
      .send({ email: 'victim@example.com', plan: 'premium' })
      .expect(200);
    expect(res.body).toEqual({ success: true, signIn: true, message: 'You already have FitMunch Premium on this email. We sent you a sign-in link.' });
    expect(signIn).toHaveBeenCalledWith('victim@example.com');
    expect(fake.customers.create).not.toHaveBeenCalled();
    expect(fake.S.sessions).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toMatch(/cus_victim|pm_saved_card|checkout\.stripe/);
    expect(fake.S.subs.find((s) => s.id === 'sub_victim').status).toBe('active');
    signIn.mockRestore();
  });

  test('a new email goes straight to Checkout on a fresh FitMunch customer with no saved cards', async () => {
    seedVictimCustomerOnly();
    const res = await request(app).post('/api/quick-checkout')
      .send({ email: 'victim@example.com', plan: 'premium' })
      .expect(200);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    const created = fake.customers.create.mock.calls[0][0];
    expect(created.metadata.brand).toBe('fitmunch');
    expect(created.metadata.fm_canonical_email).toBe('victim@example.com');
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].customer).not.toBe('cus_victim');
    expect(JSON.stringify(fake.S.sessions[0].params)).not.toMatch(/allow_redisplay|saved_payment_method|pm_saved_card|cus_victim/);
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
    expect(res.body).toEqual({ success: true, url: fake.S.sessions[0].url, id: fake.S.sessions[0].id, trial: true });
  });

  test('a subscriber gets the sign-in reply, a new email gets Checkout, and neither leaks Stripe ids', async () => {
    seedVictim();
    const known = await request(app).post('/api/quick-checkout')
      .send({ email: 'victim@example.com', plan: 'premium' });
    const unknown = await request(app).post('/api/quick-checkout')
      .send({ email: 'nobody@example.com', plan: 'premium' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual({ success: true, signIn: true, message: 'You already have FitMunch Premium on this email. We sent you a sign-in link.' });
    expect(unknown.body.url).toBe(fake.S.sessions[0].url);
    expect(JSON.stringify(known.body)).not.toMatch(/cus_victim|sub_victim|alreadySubscribed/i);
    expect(JSON.stringify(unknown.body)).not.toMatch(/cus_victim|sub_victim|alreadySubscribed/i);
    // The live subscriber gets a sign-in email; only the unknown email gets a customer.
    const createdEmails = fake.customers.create.mock.calls.map((call) => call[0].email).sort();
    expect(createdEmails).toEqual(['nobody@example.com']);
    expect(fake.S.sessions.every((session) => session.customer !== 'cus_victim')).toBe(true);
  });

  test('two simultaneous submits from the same browser yield one session', async () => {
    const send = () => request(app).post('/api/quick-checkout')
      .set('User-Agent', 'FitMunchPrivacyTest/1.0')
      .send({ email: 'double@example.com', plan: 'premium' });
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('double@example.com'));
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).not.toEqual(expect.stringContaining('cus_'));
  });

  test('a client nonce dedupes a double submit and never reuses a customer found by email', async () => {
    const send = () => request(app).post('/api/quick-checkout')
      .set('Idempotency-Key', 'browser-attempt-42')
      .set('User-Agent', 'FitMunchPrivacyTest/1.0')
      .send({ email: 'nonce@example.com', plan: 'premium' });
    const [first, second] = await Promise.all([send(), send()]);
    expect(second.body).toEqual(first.body);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.customers.create.mock.calls[0][1].idempotencyKey).toEqual(expect.stringContaining('browser-attempt-42'));
  });

  test('checkout-sessions does not reuse a customer found by email', async () => {
    seedVictim();
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
    await send('nonce-tab-a').expect(200);
    await send('nonce-tab-b').expect(200);
    expect(fake.S.sessions).toHaveLength(2);
    expect(fake.S.sessions[0].id).not.toBe(fake.S.sessions[1].id);
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
    await send('one@example.com').expect(200);
    await send('two@example.com').expect(200);
    expect(fake.S.sessions).toHaveLength(2);
    expect(fake.S.sessions[0].id).not.toBe(fake.S.sessions[1].id);
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

describe('email-first trial and yearly Premium', () => {
  const ANNUAL = 'price_testAnnual14999';
  const {
    tierForPriceId,
    planForPriceId,
    subscriptionTierUpdateFromStripe,
    normalizeCheckoutPlan,
  } = require('./lib/fitmunch-checkout');

  function seedSubscriber() {
    fake.S.customers.push({ id: 'cus_victim', email: 'victim@example.com', created: 1, metadata: { brand: 'fitmunch', product: 'fitmunch' } });
  }

  afterEach(() => {
    delete process.env.STRIPE_PRICE_PREMIUM_ANNUAL;
  });

  test('guest Premium checkout returns to the success page, and cancel goes back to the email step', async () => {
    const res = await request(app).post('/api/quick-checkout')
      .send({ email: 'first@example.com', plan: 'premium', nonce: 'ef-1' })
      .expect(200);
    expect(res.body.url).toBe(fake.S.sessions[0].url);
    expect(res.body.trial).toBe(true);
    const params = fake.S.sessions[0].params;
    expect(params.success_url).toBe('https://www.fitmunch.com.au/success.html?session_id={CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe('https://www.fitmunch.com.au/login.html?plan=premium&cancelled=1#register');
    expect(params.line_items[0].price).toBe(PRICE_IDS.premium);
    expect(params.payment_method_collection).toBe('always');
    expect(params.subscription_data.trial_period_days).toBe(14);
  });

  test('a double submit makes one customer and one session, never on an existing customer', async () => {
    seedSubscriber();
    const send = () => request(app).post('/api/quick-checkout')
      .send({ email: 'someone@example.com', plan: 'premium', nonce: 'ef-double' });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body).toEqual(b.body);
    expect(fake.customers.create).toHaveBeenCalledTimes(1);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].params.customer).not.toBe('cus_victim');
  });


  test('yearly plan is refused while STRIPE_PRICE_PREMIUM_ANNUAL is unset', async () => {
    const res = await request(app).post('/api/quick-checkout')
      .send({ email: 'yr@example.com', plan: 'premium-annual', nonce: 'yr-0' });
    expect(res.status).toBe(400);
    expect(fake.S.sessions).toHaveLength(0);
    const cfg = await request(app).get('/api/pricing/config').expect(200);
    expect(cfg.body.premiumAnnual).toBe(false);
  });

  test('a malformed annual env value is treated as unset', async () => {
    process.env.STRIPE_PRICE_PREMIUM_ANNUAL = 'not-a-price';
    const cfg = await request(app).get('/api/pricing/config').expect(200);
    expect(cfg.body.premiumAnnual).toBe(false);
    expect(require('./lib/fitmunch-checkout').priceIdForPlan('premium-annual')).toBeNull();
  });

  test('yearly plan uses the env price, a 14-day trial, and maps to the premium tier', async () => {
    process.env.STRIPE_PRICE_PREMIUM_ANNUAL = ` ${ANNUAL} `;
    const cfg = await request(app).get('/api/pricing/config').expect(200);
    expect(cfg.body.premiumAnnual).toBe(true);
    await request(app).post('/api/quick-checkout')
      .send({ email: 'yr@example.com', plan: 'premium-annual', nonce: 'yr-1' })
      .expect(200);
    const params = fake.S.sessions[0].params;
    expect(params.line_items[0].price).toBe(ANNUAL);
    expect(params.metadata.plan).toBe('premium-annual');
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(params.cancel_url).toContain('billing=annual');
    expect(planForPriceId(ANNUAL)).toBe('premium-annual');
    expect(tierForPriceId(ANNUAL)).toBe('premium');
    expect(tierForPriceId(PRICE_IDS.premium)).toBe('premium');
    expect(subscriptionTierUpdateFromStripe({ status: 'trialing', items: { data: [{ price: { id: ANNUAL } }] } }).tier).toBe('premium');
    expect(normalizeCheckoutPlan('premium-annual', 'consumer')).toBe('premium-annual');
  });

  test('signed-in yearly checkout still blocks a second live subscription (PR 21)', async () => {
    process.env.STRIPE_PRICE_PREMIUM_ANNUAL = ANNUAL;
    const token = jwt.sign({ userId: 'u1', email: 'steph@example.com', role: 'consumer' }, jwtSecret());
    await request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'premium' }).expect(200);
    fake.S.sessions.forEach((cs) => fake.complete(cs.id));
    const second = await request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'premium-annual' }).expect(200);
    expect(second.body.alreadySubscribed).toBe(true);
    expect(second.body.url).toBeNull();
  });
});

describe('trial guard (Elite QA PR 78 M1)', () => {
  const emailApi = require('./server/email.js');
  const { canonicalTrialEmail } = require('./lib/trial-guard');
  const { endReusedCardTrial } = require('./lib/stripe-webhook');
  let signIn;

  beforeEach(() => {
    signIn = jest.spyOn(emailApi, 'sendSignInToManageEmail').mockResolvedValue({ success: true });
  });
  afterEach(() => {
    signIn.mockRestore();
  });

  function priorCustomer(id, email, sub) {
    fake.S.customers.push({ id, email, created: 1, metadata: { brand: 'fitmunch', product: 'fitmunch' } });
    if (sub) {
      fake.S.subs.push({
        id: `sub_${id}`,
        customer: id,
        created: 2,
        items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        metadata: { product: 'fitmunch', plan: 'premium' },
        ...sub,
      });
    }
  }

  const start = (email) => request(app).post('/api/quick-checkout').send({ email, plan: 'premium', nonce: `n-${email}` });

  test('canonical email: lower-case, no +tag, no gmail dots', () => {
    expect(canonicalTrialEmail('Jo.Bloggs+fit@GMail.com')).toBe('jobloggs@gmail.com');
    expect(canonicalTrialEmail('jo.bloggs@googlemail.com')).toBe('jobloggs@gmail.com');
    expect(canonicalTrialEmail('Jo.Bloggs+x@Example.com')).toBe('jo.bloggs@example.com');
  });

  for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
    test(`a signed-out ${status} subscriber gets a sign-in email and no second subscription`, async () => {
      priorCustomer('cus_live', 'live@example.com', { status, trial_start: 1 });
      const res = await start('live@example.com').expect(200);
      expect(res.body).toEqual({ success: true, signIn: true, message: 'You already have FitMunch Premium on this email. We sent you a sign-in link.' });
      expect(signIn).toHaveBeenCalledWith('live@example.com');
      expect(fake.S.sessions).toHaveLength(0);
      expect(fake.customers.create).not.toHaveBeenCalled();
    });
  }

  const variants = [
    ['the same email', 'used@gmail.com'],
    ['upper-case', 'USED@GMAIL.COM'],
    ['a plus-address', 'used+again@gmail.com'],
    ['gmail dots', 'u.s.e.d@gmail.com'],
  ];
  for (const [label, email] of variants) {
    test(`${label} after an ended trial gets no second trial`, async () => {
      priorCustomer('cus_used', 'used@gmail.com', { status: 'canceled', trial_start: 1, trial_end: 2 });
      const res = await start(email).expect(200);
      expect(fake.S.sessions).toHaveLength(1);
      expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBeUndefined();
      expect(fake.S.sessions[0].params.metadata.trial).toBe('0');
      // The page shows this before it sends the browser to Stripe.
      expect(res.body).toEqual({
        success: true,
        url: fake.S.sessions[0].url,
        id: fake.S.sessions[0].id,
        trial: false,
        notice: 'Your trial was used; Premium starts today at A$19.99 a month.',
      });
    });
  }

  describe('quick-checkout trial matrix: Stripe Checkout create args', () => {
    const YEARLY = 'price_testAnnualMatrix14999';
    const prevAnnual = process.env.STRIPE_PRICE_PREMIUM_ANNUAL;
    beforeEach(() => { process.env.STRIPE_PRICE_PREMIUM_ANNUAL = YEARLY; });
    afterAll(() => {
      if (prevAnnual === undefined) delete process.env.STRIPE_PRICE_PREMIUM_ANNUAL;
      else process.env.STRIPE_PRICE_PREMIUM_ANNUAL = prevAnnual;
    });

    const cases = [
      ['new email', 'premium', false],
      ['new email', 'premium-annual', false],
      ['trial-used email', 'premium', true],
      ['trial-used email', 'premium-annual', true],
    ];
    for (const [who, plan, used] of cases) {
      test(`${who} on ${plan}: price matches plan, trial_period_days ${used ? 'absent' : '14'}`, async () => {
        const email = `${used ? 'used' : 'fresh'}-${plan}@example.com`;
        if (used) priorCustomer(`cus_${plan}`, email, { status: 'canceled', trial_start: 1, trial_end: 2 });
        const res = await request(app).post('/api/quick-checkout').send({ email, plan, nonce: `m-${email}` }).expect(200);
        expect(fake.S.sessions).toHaveLength(1);
        const params = fake.S.sessions[0].params;
        expect(params.mode).toBe('subscription');
        expect(params.line_items).toHaveLength(1);
        expect(params.line_items[0].price).toBe(plan === 'premium' ? PRICE_IDS.premium : YEARLY);
        if (used) {
          expect(Object.prototype.hasOwnProperty.call(params.subscription_data, 'trial_period_days')).toBe(false);
          expect(params.metadata.trial).toBe('0');
          expect(res.body.trial).toBe(false);
        } else {
          expect(params.subscription_data.trial_period_days).toBe(14);
        }
      });
    }
  });

  test('trial-used email copy is exact', () => {
    expect(emailApi.TRIAL_USED_COPY.premium).toBe('Your trial was used; Premium starts today at A$19.99 a month.');
  });

  test('another brand on the shared Stripe account does not block a FitMunch trial', async () => {
    fake.S.customers.push({ id: 'cus_w', email: 'w@example.com', created: 1, metadata: { brand: 'wipper', product: 'wipper' } });
    fake.S.subs.push({ id: 'sub_w', customer: 'cus_w', status: 'active', trial_start: 1, items: { data: [{ price: { id: 'price_wipper' } }] }, metadata: { product: 'wipper' } });
    await start('w@example.com').expect(200);
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
  });

  test('a Stripe failure is a generic error with no account detail', async () => {
    fake.customers.list.mockRejectedValueOnce(new Error('boom'));
    const res = await start('err@example.com');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toMatch(/boom|cus_|sub_/);
    expect(fake.S.sessions).toHaveLength(0);
  });

  test('the same card on a new customer ends the trial now', async () => {
    fake.S.customers.push({ id: 'cus_first', email: 'a@example.com', metadata: { brand: 'fitmunch', fm_trial_card: 'fpSAME' } });
    fake.S.customers.push({ id: 'cus_second', email: 'b@example.com', metadata: { brand: 'fitmunch' } });
    const sub = {
      id: 'sub_second', customer: 'cus_second', status: 'trialing',
      items: { data: [{ price: { id: PRICE_IDS.premium } }] }, metadata: { product: 'fitmunch' },
      default_payment_method: { id: 'pm_2', card: { fingerprint: 'fpSAME' } },
    };
    fake.customers.search = jest.fn(async ({ query }) => {
      const m = /metadata\['fm_trial_card'\]:'([^']+)'/.exec(query);
      return { data: fake.S.customers.filter((c) => m && c.metadata && c.metadata.fm_trial_card === m[1]) };
    });
    fake.customers.update = jest.fn(async (id, p) => ({ id, ...p }));
    fake.subscriptions.retrieve = jest.fn(async () => sub);
    fake.subscriptions.update = jest.fn(async (id, p) => ({ id, ...p }));
    const ended = await endReusedCardTrial(fake, { subscription: 'sub_second', metadata: { plan: 'premium' } }, 'premium');
    expect(ended).toBe(true);
    expect(fake.subscriptions.update).toHaveBeenCalledWith('sub_second', { trial_end: 'now', proration_behavior: 'none' });
    expect(fake.customers.update).toHaveBeenCalledWith('cus_second', { metadata: { fm_trial_card: 'fpSAME', fm_trial_used: '1' } });
  });

  test('a new card keeps its trial and is recorded', async () => {
    const sub = {
      id: 'sub_n', customer: 'cus_n', status: 'trialing',
      items: { data: [{ price: { id: PRICE_IDS.premium } }] }, metadata: { product: 'fitmunch' },
      default_payment_method: { id: 'pm_n', card: { fingerprint: 'fpNEW' } },
    };
    fake.customers.search = jest.fn(async () => ({ data: [] }));
    fake.customers.update = jest.fn(async (id, p) => ({ id, ...p }));
    fake.subscriptions.retrieve = jest.fn(async () => sub);
    fake.subscriptions.update = jest.fn();
    expect(await endReusedCardTrial(fake, { subscription: 'sub_n' }, 'premium')).toBe(false);
    expect(fake.subscriptions.update).not.toHaveBeenCalled();
    expect(fake.customers.update).toHaveBeenCalledWith('cus_n', { metadata: { fm_trial_card: 'fpNEW', fm_trial_used: '1' } });
  });

  test('Coach checkouts are not touched by the card check', async () => {
    fake.subscriptions.retrieve = jest.fn();
    expect(await endReusedCardTrial(fake, { subscription: 'sub_c' }, 'coach-39')).toBe(false);
    expect(fake.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

describe('welcome email after a no-trial checkout (Maximus, PR 78)', () => {
  const emailApi = require('./server/email.js');
  const { buildSubscriptionCheckoutParams } = require('./lib/fitmunch-checkout');

  async function sentText(args) {
    process.env.RESEND_API_KEY = 'test-key';
    const calls = [];
    const prev = global.fetch;
    global.fetch = jest.fn(async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: 'e1' }) }; });
    try {
      await emailApi.sendWelcomeEmail(...args);
    } finally {
      global.fetch = prev;
      delete process.env.RESEND_API_KEY;
    }
    return `${calls[0].html}\n${calls[0].text}`;
  }

  test('trial-used payer is told Premium started and the first charge is today', async () => {
    const out = await sentText(['a@example.com', '', 'Premium', 'https://www.fitmunch.com.au/login.html#claim=x', { trial: false }]);
    expect(out).toContain('Premium has started.');
    expect(out).toContain('Your first charge is today.');
    expect(out).not.toMatch(/Your trial has started|trial is live|No charge until the trial ends/);
  });

  test('a normal trial keeps the trial copy', async () => {
    const out = await sentText(['a@example.com', '', 'Premium', 'https://www.fitmunch.com.au/login.html#claim=x']);
    expect(out).toContain('Your trial has started.');
    expect(out).toContain('No charge until the trial ends.');
  });

  test('a no-trial Checkout carries metadata trial=0 for the webhook', () => {
    const p = buildSubscriptionCheckoutParams({ customerId: 'cus_x', priceId: PRICE_IDS.premium, plan: 'premium', trial: false });
    expect(p.metadata.trial).toBe('0');
    expect(p.subscription_data.trial_period_days).toBeUndefined();
    const t = buildSubscriptionCheckoutParams({ customerId: 'cus_x', priceId: PRICE_IDS.premium, plan: 'premium' });
    expect(t.metadata.trial).toBeUndefined();
  });

  test('the webhook skips trial_started when no trial applies', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib', 'stripe-webhook.js'), 'utf8');
    expect(src).toContain("!ended && session.metadata?.trial !== '0'");
  });

});

describe('checkout plan allowlist (prototype keys never reach Stripe)', () => {
  const { priceIdForPlan } = require('./lib/fitmunch-checkout');
  const BAD = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'starter-x'];
  const NON_STRINGS = [123, true, ['premium'], { plan: 'premium' }];
  // Recursive: counts top-level fns (rawRequest) and nested ones (checkout.sessions.create, subscriptions.*).
  const count = (o, seen = new Set()) => {
    if (!o || seen.has(o)) return 0;
    seen.add(o);
    return Object.entries(o).reduce((n, [k, v]) => {
      if (k === 'S') return n;
      if (typeof v === 'function' && v.mock) return n + v.mock.calls.length;
      if (v && typeof v === 'object') return n + count(v, seen);
      return n;
    }, 0);
  };
  const stripeCalls = () => count(fake) + fake.S.sessions.length + fake.S.customers.length;

  test.each([...BAD, ...NON_STRINGS])('quick-checkout plan %p => 400, zero Stripe calls', async (plan) => {
    const r = await request(app).post('/api/quick-checkout').send({ email: 'x@example.com', plan });
    expect(r.status).toBe(400);
    expect(stripeCalls()).toBe(0);
    expect(fake.S.customers).toHaveLength(0);
  });
  test.each([...BAD, ...NON_STRINGS])('checkout plan %p => 400, zero Stripe calls', async (plan) => {
    const r = await request(app).post('/api/checkout').set('Authorization', `Bearer ${tokenFor('u1')}`)
      .set('Origin', 'https://www.fitmunch.com.au').send({ plan });
    expect(r.status).toBe(400);
    expect(stripeCalls()).toBe(0);
  });
  test('PRICE_IDS has no prototype and is frozen; helper only maps allowed plans', () => {
    expect(Object.getPrototypeOf(PRICE_IDS)).toBeNull();
    expect(Object.isFrozen(PRICE_IDS)).toBe(true);
    for (const p of [...BAD, ...NON_STRINGS, undefined, null]) expect(priceIdForPlan(p)).toBeNull();
    expect(priceIdForPlan('premium')).toBe(PRICE_IDS.premium);
  });
});

describe('quick-checkout limits, customer tag, pagination and backfill (PR 78 r2)', () => {
  afterEach(() => {
    process.env.QUICK_CHECKOUT_IP_MAX_PER_HOUR = '100000';
    process.env.QUICK_CHECKOUT_EMAIL_MAX_PER_HOUR = '100000';
  });

  test('per-IP limit: the next request after the cap is a generic 429', async () => {
    process.env.QUICK_CHECKOUT_IP_MAX_PER_HOUR = '1';
    const ip = '203.0.113.77';
    const go = (n) => request(app).post('/api/quick-checkout').set('X-Forwarded-For', ip)
      .send({ email: `ip${n}@example.com`, plan: 'premium', nonce: `ip-${n}` });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await go(i)).status);
    expect(statuses).toContain(429);
    const limited = await go(9);
    if (limited.status === 429) expect(JSON.stringify(limited.body)).not.toMatch(/cus_|sub_|subscrib/i);
  });

  test('per-email limit: one normalised email cannot be looked up in bulk', async () => {
    process.env.QUICK_CHECKOUT_EMAIL_MAX_PER_HOUR = '2';
    const spellings = ['Bulk.Look@gmail.com', 'bulklook+a@gmail.com', 'b.u.l.k.look@googlemail.com', 'BULKLOOK@gmail.com'];
    const res = [];
    for (const [i, email] of spellings.entries()) {
      res.push(await request(app).post('/api/quick-checkout').send({ email, plan: 'premium', nonce: `bl-${i}` }));
    }
    expect(res.slice(0, 2).map((r) => r.status)).toEqual([200, 200]);
    expect(res[2].status).toBe(429);
    expect(res[2].body).toEqual({ success: false, error: 'Too many checkout attempts. Please try again later.' });
    expect(fake.customers.list.mock.calls.length).toBeGreaterThan(0);
  });

  test('createFitMunchCustomer stores fm_canonical_email on every path (QA r2 S2)', async () => {
    const { createFitMunchCustomer } = require('./lib/fitmunch-checkout');
    await createFitMunchCustomer(fake, { userId: 'u9', email: 'Jo.Smith+x@GMail.com' });
    const created = fake.customers.create.mock.calls.at(-1)[0];
    expect(created.metadata.fm_canonical_email).toBe('josmith@gmail.com');
    expect(created.metadata.brand).toBe('fitmunch');
  });

  test('trial history reads every page of customers and subscriptions (QA r2 S5)', async () => {
    const { trialHistoryForEmail, allPages } = require('./lib/trial-guard');
    const pages = [
      { data: [{ id: 'a' }], has_more: true },
      { data: [{ id: 'b' }], has_more: false },
    ];
    const seen = [];
    const out = await allPages(async (q) => { seen.push(q); return pages[seen.length - 1]; }, { limit: 1 });
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
    expect(seen[1].starting_after).toBe('a');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const capped = await allPages(async () => ({ data: [{ id: `p${n++}` }], has_more: true }), { limit: 1 });
    expect(capped).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith('[trial-guard] pagination cap hit', { pages: 10, records: 10 });
    warn.mockRestore();

    const stripe = {
      customers: {
        list: jest.fn(async () => ({ data: [{ id: 'cus_p', email: 'page@example.com', metadata: { brand: 'fitmunch' } }], has_more: false })),
      },
      subscriptions: {
        list: jest.fn(async (q) => (q.starting_after
          ? { data: [{ id: 'sub_old', status: 'canceled', trial_start: 1, metadata: { product: 'fitmunch' }, items: { data: [{ price: { id: PRICE_IDS.premium } }] } }], has_more: false }
          : { data: [{ id: 'sub_x', status: 'canceled', metadata: { product: 'other' }, items: { data: [] } }], has_more: true })),
      },
    };
    const history = await trialHistoryForEmail(stripe, 'page@example.com');
    expect(history.trialUsed).toBe(true);
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(2);
  });

  test('backfill script refuses live keys and only plans FitMunch customers (test mode only)', async () => {
    const backfill = require('./scripts/backfill-canonical-email');
    for (const key of ['sk_live_x', 'rk_live_x', '', undefined, 'pk_test_x']) {
      expect(() => backfill.assertTestKey(key)).toThrow(/test-mode key/);
    }
    expect(() => backfill.assertTestKey('sk_test_x')).not.toThrow();
    await expect(backfill.run({ stripe: {}, key: 'sk_live_x' })).rejects.toThrow(/test-mode key/);
    const plan = backfill.plannedUpdates([
      { id: 'c1', email: 'Jo.Smith@gmail.com', metadata: { brand: 'fitmunch' } },
      { id: 'c2', email: 'done@example.com', metadata: { brand: 'fitmunch', fm_canonical_email: 'done@example.com' } },
      { id: 'c3', email: 'w@example.com', metadata: { brand: 'wipper', product: 'wipper' } },
    ]);
    expect(plan).toEqual([{ id: 'c1', fm_canonical_email: 'josmith@gmail.com' }]);
  });
});

describe('removed /api/complete-subscription', () => {
  test('is gone: 404, no customer data, a paid session is never retrieved', async () => {
    fake.checkout.sessions.retrieve = jest.fn(async () => ({
      id: 'cs_live_x', payment_status: 'paid', status: 'complete',
      customer: { id: 'cus_victim', email: 'victim@example.com', address: { line1: '1 Victim St' } },
    }));
    const res = await request(app).post('/api/complete-subscription').send({ sessionId: 'cs_live_x' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body || {})).not.toMatch(/customer|address|subscription|victim/i);
    expect(fake.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe/customers is authed and own-account only', () => {
  const count = (o, seen = new Set()) => {
    if (!o || seen.has(o)) return 0;
    seen.add(o);
    return Object.entries(o).reduce((n, [k, v]) => {
      if (k === 'S') return n;
      if (typeof v === 'function' && v.mock) return n + v.mock.calls.length;
      if (v && typeof v === 'object') return n + count(v, seen);
      return n;
    }, 0);
  };
  const body = { email: 'victim@example.com', name: 'Stranger', metadata: { userId: 'u2', isTest: true } };

  test.each([
    ['no header', null],
    ['forged token', 'Bearer not-a-jwt'],
    ['wrong secret', `Bearer ${jwt.sign({ userId: 'u1' }, 'wrong-secret')}`],
    ['expired token', `Bearer ${jwt.sign({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 60 }, jwtSecret())}`],
    ['alg none', `Bearer ${jwt.sign({ userId: 'u1' }, null, { algorithm: 'none' })}`],
    ['HS512 with the real secret', `Bearer ${jwt.sign({ userId: 'u1' }, jwtSecret(), { algorithm: 'HS512' })}`],
  ])('%s => 401, zero Stripe calls', async (_label, auth) => {
    let r = request(app).post('/api/stripe/customers');
    if (auth) r = r.set('Authorization', auth);
    const res = await r.send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Authentication required.' });
    expect(count(fake)).toBe(0);
    expect(fake.S.customers).toHaveLength(0);
  });

  test('authed user with a linked customer gets their own, client email/metadata ignored', async () => {
    const res = await request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${tokenFor('u1')}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cus_existing');
    expect(res.body.email).toBe('steph@example.com');
    expect(fake.customers.list).not.toHaveBeenCalled();
    expect(fake.customers.search).not.toHaveBeenCalled();
    expect(fake.S.customers).toHaveLength(0);
  });

  test('authed user without a customer gets one created from their own account', async () => {
    users.u1.stripeCustomerId = null;
    const res = await request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${tokenFor('u1')}`).send(body);
    expect(res.status).toBe(200);
    expect(fake.S.customers).toHaveLength(1);
    const c = fake.S.customers[0];
    expect(res.body.id).toBe(c.id);
    expect(c.email).toBe('steph@example.com');
    expect(c.metadata.userId).toBe('u1');
    expect(c.metadata.isTest).toBeUndefined();
    expect(JSON.stringify(c)).not.toMatch(/victim|Stranger/);
  });

  test('over the per-user limit => 429', async () => {
    process.env.STRIPE_CUSTOMERS_USER_MAX_PER_HOUR = '2';
    try {
      const t = tokenFor('u1', { userId: 'u-limit' });
      users['u-limit'] = { id: 'u-limit', email: 'lim@example.com', name: 'L', subscriptionTier: 'free', stripeCustomerId: 'cus_existing' };
      const go = () => request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${t}`).send({});
      expect((await go()).status).toBe(200);
      expect((await go()).status).toBe(200);
      expect((await go()).status).toBe(429);
    } finally {
      process.env.STRIPE_CUSTOMERS_USER_MAX_PER_HOUR = '100000';
    }
  });

  test('over the per-IP limit => 429, even unauthenticated, with zero Stripe calls', async () => {
    process.env.STRIPE_CUSTOMERS_IP_MAX_PER_HOUR = '1';
    try {
      const ip = '203.0.113.77';
      await request(app).post('/api/stripe/customers').set('X-Forwarded-For', ip).send({});
      const res = await request(app).post('/api/stripe/customers').set('X-Forwarded-For', ip).send({});
      expect(res.status).toBe(429);
      expect(count(fake)).toBe(0);
    } finally {
      process.env.STRIPE_CUSTOMERS_IP_MAX_PER_HOUR = '100000';
    }
  });
});

describe('shared rate limits on guest checkout-sessions', () => {
  const calls = (o, seen = new Set()) => {
    if (!o || seen.has(o)) return 0;
    seen.add(o);
    return Object.entries(o).reduce((n, [k, v]) => {
      if (k === 'S') return n;
      if (typeof v === 'function' && v.mock) return n + v.mock.calls.length;
      if (v && typeof v === 'object') return n + calls(v, seen);
      return n;
    }, 0);
  };
  const body = (i) => ({
    priceId: PRICE_IDS.premium,
    customerId: 'cus_existing',
    successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
    cancelUrl: 'https://www.fitmunch.com.au/pricing',
    nonce: `limit-${i}`,
  });

  test('limit 2: the 3rd request gets 429 and makes no Stripe call', async () => {
    process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR = '2';
    try {
      const ip = '198.51.100.23';
      const go = (i) => request(app).post('/api/stripe/checkout-sessions').set('X-Forwarded-For', ip)
        .set('Idempotency-Key', `cs-limit-${i}-${Date.now()}`).send(body(i));
      expect((await go(1)).status).toBe(200);
      expect((await go(2)).status).toBe(200);
      const customersBefore = fake.S.customers.length;
      const sessionsBefore = fake.S.sessions.length;
      const callsBefore = calls(fake);
      const third = await go(3);
      expect(third.status).toBe(429);
      expect(third.body).toEqual({ success: false, message: 'Too many checkout attempts. Please try again later.' });
      expect(third.headers['retry-after']).toBe('3600');
      expect(fake.S.customers.length).toBe(customersBefore);
      expect(fake.S.sessions.length).toBe(sessionsBefore);
      expect(calls(fake)).toBe(callsBefore);
    } finally {
      process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR = '100000';
    }
  });

  test('fails closed: shared counter down => 503, zero Stripe calls', async () => {
    const counters = require('./lib/shared-counters');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    counters.setSharedCounterQueryForTests(async () => { throw Object.assign(new Error('postgres://u:p@h/db down'), { code: 'ECONNREFUSED' }); });
    try {
      const a = await request(app).post('/api/stripe/checkout-sessions').send(body(9));
      expect(a.status).toBe(503);
      const b = await request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${tokenFor('u1')}`).send({});
      expect(b.status).toBe(503);
      expect(calls(fake)).toBe(0);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/postgres:\/\/|u:p@/);
    } finally {
      counters.setSharedCounterQueryForTests(null);
      spy.mockRestore();
    }
  });
});

describe('error logs are redacted', () => {
  test('checkout-sessions failure logs no secret or connection string', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const boom = jest.fn(async () => { throw new Error('Invalid API Key provided: sk_test_123 DATABASE_URL=postgres://u:p@h/db'); });
    fake.checkout.sessions.create = boom;
    fake.rawRequest = boom;
    try {
      const res = await request(app).post('/api/stripe/checkout-sessions').send({
        priceId: PRICE_IDS.premium,
        customerId: 'cus_existing',
        successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
        cancelUrl: 'https://www.fitmunch.com.au/pricing',
      });
      expect(res.status).toBe(500);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/sk_test_|postgres:|DATABASE_URL/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('retired pt-starter / pt-pro checkout plans', () => {
  const stripeCalls = (o, seen = new Set()) => {
    if (!o || seen.has(o)) return 0;
    seen.add(o);
    return Object.entries(o).reduce((n, [k, v]) => {
      if (k === 'S') return n;
      if (typeof v === 'function' && v.mock) return n + v.mock.calls.length;
      if (v && typeof v === 'object') return n + stripeCalls(v, seen);
      return n;
    }, 0);
  };
  const checkout = require('./lib/fitmunch-checkout');

  test.each([
    ['pt-starter', 'client'],
    ['pt-pro', 'client'],
    ['pt-starter', 'pt'],
    ['pt-pro', 'pt'],
    ['starter', 'pt'],
    ['pro', 'pt'],
  ])('/api/checkout plan %s (role %s) => 400, zero Stripe calls', async (plan, role) => {
    const res = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${tokenFor('u1', { role })}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ plan });
    expect(res.status).toBe(400);
    expect(stripeCalls(fake)).toBe(0);
  });

  test.each(['pt-starter', 'pt-pro'])('/api/quick-checkout plan %s => 400, zero Stripe calls', async (plan) => {
    const res = await request(app).post('/api/quick-checkout').send({ email: 'steph@example.com', plan });
    expect(res.status).toBe(400);
    expect(stripeCalls(fake)).toBe(0);
  });

  test.each([
    ['PT-STARTER'], [' pt-pro '], ['pt-starter\t'], ['Pt-Pro'],
  ])('/api/checkout and /api/quick-checkout reject %j => 400, zero Stripe calls', async (plan) => {
    const a = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${tokenFor('u1', { role: 'pt' })}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ plan });
    expect(a.status).toBe(400);
    const b = await request(app).post('/api/quick-checkout').send({ email: 'steph@example.com', plan });
    expect(b.status).toBe(400);
    expect(stripeCalls(fake)).toBe(0);
  });

  const sessionBody = (priceId, i) => ({
    priceId,
    customerId: 'cus_existing',
    successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
    cancelUrl: 'https://www.fitmunch.com.au/pricing',
    nonce: `retired-${i}`,
  });
  test.each([
    ['price_1T3SvgGMuYRuJYDrOyR2hYoq'],
    ['price_1T3SyDGMuYRuJYDrF8mvMrwi'],
  ])('/api/stripe/checkout-sessions with retired %s => 400, zero Stripe calls', async (priceId) => {
    const res = await request(app).post('/api/stripe/checkout-sessions').send(sessionBody(priceId, priceId));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Unknown FitMunch price.' });
    expect(stripeCalls(fake)).toBe(0);
    expect(fake.S.customers).toHaveLength(0);
    expect(fake.S.sessions).toHaveLength(0);
  });

  test('/api/stripe/checkout-sessions still sells premium', async () => {
    const res = await request(app).post('/api/stripe/checkout-sessions').send(sessionBody(PRICE_IDS.premium, 'p'));
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });

  test('app.html offers no checkout for retired pt-* plans', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    expect(html).not.toMatch(/startCheckout\(\s*['"]pt-/i);
  });

  test('signup with plan pt-starter / pt-pro no longer forces a trainer account', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'api_server.js'), 'utf8');
    const want = src.slice(src.indexOf('const wantPt ='), src.indexOf('if (wantPt)'));
    expect(want).not.toMatch(/pt-starter|pt-pro/);
  });

  test('priceIdForPlan rejects pt-*; PRICE_IDS entries are kept', () => {
    expect(checkout.priceIdForPlan('pt-starter')).toBeNull();
    expect(checkout.priceIdForPlan('pt-pro')).toBeNull();
    expect(checkout.PRICE_IDS['pt-starter']).toBe('price_1T3SvgGMuYRuJYDrOyR2hYoq');
    expect(checkout.PRICE_IDS['pt-pro']).toBe('price_1T3SyDGMuYRuJYDrF8mvMrwi');
    expect(checkout.priceIdForPlan('premium')).toBe(PRICE_IDS.premium);
  });

  test.each([
    ['price_1T3SvgGMuYRuJYDrOyR2hYoq', 'pt-starter', 'starter'],
    ['price_1T3SyDGMuYRuJYDrF8mvMrwi', 'pt-pro', 'pro'],
  ])('existing subscriber on %s still maps (plan %s, tier %s)', (priceId, plan, tier) => {
    expect(checkout.planForPriceId(priceId)).toBe(plan);
    const sub = { status: 'active', current_period_end: 2000000000, items: { data: [{ price: { id: priceId } }] } };
    expect(checkout.subscriptionTierUpdateFromStripe(sub).tier).toBe(tier);
    expect(checkout.allFitMunchPriceIds()).toContain(priceId);
  });
});

describe('#83 follow-ups', () => {
  test('POST /api/stripe/customers logs no DB URL or Stripe key when storage throws', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const orig = storage.getUserById;
    storage.getUserById = jest.fn(async () => { throw new Error('connect failed DATABASE_URL=postgres://u:p@h/db Invalid API Key provided: sk_test_123'); });
    try {
      const res = await request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${tokenFor('u1')}`).send({});
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toMatch(/postgres:|sk_test_|DATABASE_URL/);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/postgres:|u:p@|sk_test_|DATABASE_URL/);
    } finally {
      storage.getUserById = orig;
      spy.mockRestore();
    }
  });

  test('a validly signed token with no userId gets 401, not 404', async () => {
    const t = jwt.sign({ email: 'nouser@example.com', role: 'client' }, jwtSecret());
    const res = await request(app).post('/api/stripe/customers').set('Authorization', `Bearer ${t}`).send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Authentication required.' });
  });

  test('failClosed: a 0 or non-finite hit count throws RATE_COUNTER_UNAVAILABLE', async () => {
    const counters = require('./lib/shared-counters');
    for (const rows of [[{ hits: 0 }], [{ hits: 'NaN' }], []]) {
      counters.setSharedCounterQueryForTests(async () => ({ rows }));
      try {
        await expect(counters.hitRateCounter('t', 'k', { windowMs: 1000, failClosed: true }))
          .rejects.toMatchObject({ code: 'RATE_COUNTER_UNAVAILABLE' });
      } finally {
        counters.setSharedCounterQueryForTests(null);
      }
    }
  });
});

describe('#98 lows: limiter attached at the route', () => {
  const counters = require('./lib/shared-counters');
  const body = (i) => ({
    priceId: PRICE_IDS.premium,
    customerId: 'cus_existing',
    successUrl: 'https://www.fitmunch.com.au/app.html?subscribed=1',
    cancelUrl: 'https://www.fitmunch.com.au/pricing',
    nonce: `lim98-${i}`,
  });
  test('11 guest checkout-sessions from one IP: the 11th is 429 (default limit 10)', async () => {
    const prev = process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR;
    delete process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR;
    counters.resetSharedCountersForTests();
    try {
      const codes = [];
      for (let i = 0; i < 11; i++) {
        codes.push((await request(app).post('/api/stripe/checkout-sessions').set('Idempotency-Key', `lim98-${i}`).send(body(i))).status);
      }
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR = prev == null ? '100000' : prev;
      counters.resetSharedCountersForTests();
    }
  });
  test('route-level: counter returns 0 hits => 503 with Retry-After 60, no Stripe call', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    counters.setSharedCounterQueryForTests(async () => ({ rows: [{ hits: 0 }] }));
    try {
      const res = await request(app).post('/api/stripe/checkout-sessions').send(body('zero'));
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('60');
      expect(fake.S.sessions).toHaveLength(0);
      expect(fake.S.customers).toHaveLength(0);
    } finally {
      counters.setSharedCounterQueryForTests(null);
      spy.mockRestore();
    }
  });
});

describe('#92 low: portal return_url', () => {
  test.each([
    [{ returnTo: 'app' }, 'https://www.fitmunch.com.au/app.html#billing'],
    [{}, 'https://www.fitmunch.com.au/pricing'],
  ])('body %j returns to %s', async (body, url) => {
    const res = await request(app).post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor('u1')}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send(body);
    expect(res.status).toBe(200);
    expect(fake.S.portals[0].return_url).toBe(url);
  });
});
