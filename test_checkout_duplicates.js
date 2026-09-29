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
      { id: 'evt_1', type: 'checkout.session.completed', data: { object: { customer_details: {}, metadata: { plan: 'premium' } } } },
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
    expect(logged).toMatch(/kept oldest sub_old/);
    expect(logged).toMatch(/cancelled newer sub_new/);
    expect(logged).toMatch(/cus_existing/);
    warn.mockRestore();
  });

  test('checkout.session.completed also keeps the oldest', async () => {
    fake.S.subs.push(fitmunchSub('sub_old', 10), fitmunchSub('sub_new', 20));
    await postEvent({
      id: 'evt_cs',
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_existing', metadata: { plan: 'premium' }, customer_details: {} } },
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
      data: { object: { id: 'sub_new', customer: 'cus_existing', status: 'canceled' } },
    }).expect(200);
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();

    fake.S.subs.find((s) => s.id === 'sub_old').status = 'canceled';
    await postEvent({
      id: 'evt_del_last',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', customer: 'cus_existing', status: 'canceled' } },
    }).expect(200);
    expect(storage.updateUserSubscription).toHaveBeenCalledWith('u1', 'free', null);
  });
});

describe('checkout entry guards', () => {
  test('an incomplete subscription blocks another checkout', async () => {
    fake.S.subs.push({
      id: 'sub_incomplete',
      customer: 'cus_existing',
      status: 'incomplete',
      created: 50,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    const res = await post().expect(200);
    expect(res.body.alreadySubscribed).toBe(true);
    expect(fake.S.sessions).toHaveLength(0);
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
    const first = await request(app).post('/api/stripe/checkout-sessions').send(body).expect(200);
    const second = await request(app).post('/api/stripe/checkout-sessions').send(body).expect(200);
    expect(first.body.url).toBeTruthy();
    expect(second.body.url).toBe(first.body.url);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].params.subscription_data.trial_period_days).toBe(14);
    expect(fake.S.sessions[0].params.line_items[0].price).toBe(PRICE_IDS.premium);

    fake.complete(fake.S.sessions[0].id);
    const third = await request(app).post('/api/stripe/checkout-sessions').send(body).expect(200);
    expect(third.body.alreadySubscribed).toBe(true);
    expect(fake.S.sessions).toHaveLength(1);
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
