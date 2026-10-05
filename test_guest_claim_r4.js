/**
 * PR #52 round 4: 7-day claim links, "Email me a new link", deployed-env
 * secret checks, retry-by-default webhook re-reads, conditional customer
 * link, session brand filter, malformed login body.
 */
const request = require('supertest');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const app = require('./server.js');
const storage = require('./server/storage.js');
const emailApi = require('./server/email.js');
const stripeEvents = require('./lib/stripe-events');
const guestClaim = require('./lib/guest-claim');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');
const { PgDialect } = require('drizzle-orm/pg-core');

const orig = { ...storage };
const DAY = 24 * 60 * 60;
let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

function paramVals(cond) {
  const out = [];
  (function walk(x, d) {
    if (!x || d > 8) return;
    if (x.constructor && x.constructor.name === 'Param') { out.push(x.value); return; }
    if (Array.isArray(x.queryChunks)) x.queryChunks.forEach((y) => walk(y, d + 1));
  })(cond, 0);
  return out;
}

function installUsers(users, { updateResult } = {}) {
  const fx = { tierWrites: [], updates: [] };
  storage.db = {
    select: () => ({ from: () => ({ where: async (cond) => {
      const [val] = paramVals(cond);
      return users.filter((u) => u.stripeCustomerId && u.stripeCustomerId === val);
    } }) }),
    update: () => ({ set: (values) => ({ where: (cond) => {
      fx.updates.push({ values, cond });
      const run = async () => {
        if (updateResult) return updateResult;
        const [id] = paramVals(cond);
        const u = users.find((x) => x.id === id);
        if (u && !u.stripeCustomerId) { Object.assign(u, values); return [{ id }]; }
        return [];
      };
      return { returning: run, then: (a, b) => run().then(a, b) };
    } }) }),
  };
  storage.getUserById = async (id) => users.find((u) => u.id === id) || null;
  storage.updateUserSubscription = jest.fn(async (id, tier) => {
    fx.tierWrites.push({ id, tier });
    const u = users.find((x) => x.id === id);
    if (u) u.subscriptionTier = tier;
  });
  storage.updateUserCoachBilling = jest.fn(async (_id, c) => c);
  return fx;
}

const premSub = (id, cus, status = 'active') => ({
  id, customer: cus, status, created: 100, current_period_end: 2000000000,
  metadata: { app: 'fitmunch', product: 'fitmunch', plan: 'premium' },
  items: { data: [{ price: { id: PRICE_IDS.premium, product: 'prod_UoBDFNLbc6pTS4' } }] },
});

function postEvent(event) {
  return request(app).post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] == null) delete process.env[k];
    else process.env[k] = vars[k];
  }
  guestClaim.resetGuestClaimsForTests();
  const done = () => {
    for (const k of Object.keys(prev)) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
    guestClaim.resetGuestClaimsForTests();
  };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
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
});
afterEach(() => {
  Object.assign(storage, orig);
  app._private.setStripeForTests(null);
  jest.restoreAllMocks();
});

describe('claim link window', () => {
  test('a link works for 7 days from issue, whenever the checkout happened', () => {
    const now = Date.UTC(2026, 9, 5, 0, 0, 0);
    expect(guestClaim.CLAIM_TTL_SECONDS).toBeGreaterThanOrEqual(7 * DAY);
    const token = guestClaim.mintGuestClaimToken({ sessionId: 'cs_old', customerId: 'cus_old' }, now);
    expect(token).not.toBe('');
    const at = (seconds) => guestClaim.readGuestClaimToken(token, now + seconds * 1000);
    expect(at(3601)).toMatchObject({ sessionId: 'cs_old', customerId: 'cus_old' });
    expect(at(3601).expired).toBeUndefined();
    expect(at(7 * DAY - 60).expired).toBeUndefined();
    expect(at(7 * DAY + 1).expired).toBe(true);
    expect(at(0).exp).toBe(Math.floor(now / 1000) + 7 * DAY);
  });

  test('the welcome email and the resend email state the real window', async () => {
    const sent = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'em_1' }) };
    });
    await withEnv({ RESEND_API_KEY: 're_test' }, async () => {
      await emailApi.sendWelcomeEmail('guest@example.com', 'Guest', 'Premium', 'https://www.fitmunch.com.au/login.html#claim=abc');
      await emailApi.sendClaimLinkEmail('guest@example.com', 'https://www.fitmunch.com.au/login.html#claim=def');
    });
    expect(sent).toHaveLength(2);
    for (const payload of sent) {
      expect(payload.html).toContain('This link works once, within 7 days.');
      expect(payload.text).toContain('This link works once, within 7 days.');
      expect(payload.html + payload.text).not.toMatch(/expires soon/i);
      // No tracking options or pixels of our own; Resend tracking is per domain.
      expect(Object.keys(payload).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
      expect(payload.html).not.toMatch(/<img/i);
    }
  });
});

describe('claim secret in deployed environments', () => {
  test('VERCEL_ENV production or preview counts as deployed, not only NODE_ENV', () => {
    const { isDeployedEnv, guestClaimSecretProblem } = guestClaim;
    expect(isDeployedEnv({ NODE_ENV: 'production' })).toBe(true);
    expect(isDeployedEnv({ VERCEL_ENV: 'production', NODE_ENV: 'development' })).toBe(true);
    expect(isDeployedEnv({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(isDeployedEnv({ VERCEL_ENV: 'development' })).toBe(false);
    expect(isDeployedEnv({ NODE_ENV: 'test' })).toBe(false);
    expect(guestClaimSecretProblem({ VERCEL_ENV: 'production' })).toBe('missing');
    expect(guestClaimSecretProblem({ VERCEL_ENV: 'preview', GUEST_CLAIM_SECRET: 'short' })).toBe('too-short');
    expect(guestClaimSecretProblem({ VERCEL_ENV: 'production', GUEST_CLAIM_SECRET: 'x'.repeat(31) })).toBe('too-short');
    expect(guestClaimSecretProblem({ VERCEL_ENV: 'production', GUEST_CLAIM_SECRET: 'x'.repeat(64) })).toBe('');
    expect(guestClaimSecretProblem({ NODE_ENV: 'test' })).toBe('');
  });

  test('VERCEL_ENV=production with NODE_ENV=development and no secret mints nothing', () => {
    withEnv({ VERCEL_ENV: 'production', NODE_ENV: 'development', GUEST_CLAIM_SECRET: null }, () => {
      expect(guestClaim.mintGuestClaimToken({ sessionId: 'cs_a', customerId: 'cus_a' })).toBe('');
    });
    withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'development', GUEST_CLAIM_SECRET: 'too-short-secret' }, () => {
      expect(guestClaim.mintGuestClaimToken({ sessionId: 'cs_a', customerId: 'cus_a' })).toBe('');
    });
  });

  test('a missing or short secret fails the boot check and /api/health loudly, without the value', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    await withEnv({ VERCEL_ENV: 'production', GUEST_CLAIM_SECRET: null }, async () => {
      guestClaim.warnMissingGuestClaimSecret();
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'misconfigured', service: 'fitmunch' });
    });
    const shortValue = 'shortsecretvalue';
    await withEnv({ VERCEL_ENV: 'production', GUEST_CLAIM_SECRET: shortValue }, async () => {
      guestClaim.warnMissingGuestClaimSecret();
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
    });
    const logged = errors.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('GUEST_CLAIM_SECRET is not set');
    expect(logged).toContain('shorter than 32 bytes');
    expect(logged).not.toContain(shortValue);
    await withEnv({ VERCEL_ENV: 'production', GUEST_CLAIM_SECRET: 'k'.repeat(64) }, async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      const token = guestClaim.mintGuestClaimToken({ sessionId: 'cs_ok', customerId: 'cus_ok' });
      expect(token).not.toBe('');
      expect(guestClaim.readGuestClaimToken(token)).toMatchObject({ sessionId: 'cs_ok' });
    });
  });
});

describe('Email me a new link', () => {
  const PAYER = 'Guest.Payer@Example.com';
  function stripeWith({ sessions, customers }) {
    return {
      customers: { list: jest.fn(async ({ email }) => ({
        data: customers.filter((c) => c.email === email || c.email.toLowerCase() === email),
      })) },
      checkout: { sessions: {
        list: jest.fn(async ({ customer }) => ({ data: sessions.filter((s) => s.customer === customer) })),
        retrieve: jest.fn(async (id) => sessions.find((s) => s.id === id)),
      } },
    };
  }
  const guestSession = (extra = {}) => ({
    id: 'cs_guest_1', customer: 'cus_guest', status: 'complete', payment_status: 'no_payment_required',
    created: 1000, metadata: { app: 'fitmunch', plan: 'premium' },
    customer_details: { email: 'guest.payer@example.com' }, ...extra,
  });

  async function ask(email) {
    return request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', nextIp()).send({ email });
  }

  test('sends a fresh 7-day link to the Stripe customer email, and replies the same for every input', async () => {
    installUsers([]);
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    const stripe = stripeWith({
      customers: [
        { id: 'cus_guest', email: PAYER },
        { id: 'cus_logged', email: 'member@example.com' },
        { id: 'cus_wipper', email: 'other@example.com' },
        { id: 'cus_open', email: 'open@example.com' },
      ],
      sessions: [
        guestSession(),
        guestSession({ id: 'cs_logged', customer: 'cus_logged', client_reference_id: 'u-member', customer_details: { email: 'member@example.com' } }),
        guestSession({ id: 'cs_wipper', customer: 'cus_wipper', metadata: { app: 'wipper', plan: 'growth' }, customer_details: { email: 'other@example.com' } }),
        guestSession({ id: 'cs_open', customer: 'cus_open', status: 'open', payment_status: 'unpaid', customer_details: { email: 'open@example.com' } }),
      ],
    });
    app._private.setStripeForTests(stripe);
    const inputs = ['guest.payer@example.com', 'nobody@example.com', 'member@example.com', 'other@example.com',
      'open@example.com', 'not-an-email', '', 'x'.repeat(300) + '@example.com'];
    const bodies = [];
    for (const input of inputs) {
      const res = await ask(input);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      bodies.push(JSON.stringify(res.body));
    }
    const objectBody = await request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', nextIp()).send({ email: { $ne: '' } });
    bodies.push(JSON.stringify(objectBody.body));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual({ success: true, message: guestClaim.RESEND_GENERIC_REPLY });

    expect(send).toHaveBeenCalledTimes(1);
    const [to, url] = send.mock.calls[0];
    expect(to).toBe(PAYER);
    expect(url).toMatch(/^https:\/\/www\.fitmunch\.com\.au\/login\.html#claim=/);
    const token = decodeURIComponent(url.split('#claim=')[1]);
    const parsed = guestClaim.readGuestClaimToken(token);
    expect(parsed).toMatchObject({ sessionId: 'cs_guest_1', customerId: 'cus_guest' });
    expect(parsed.exp * 1000 - Date.now()).toBeGreaterThan(7 * DAY * 1000 - 60000);
  });

  test('no link when an account already holds the customer', async () => {
    installUsers([{ id: 'u1', email: 'guest.payer@example.com', stripeCustomerId: 'cus_guest' }]);
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({ customers: [{ id: 'cus_guest', email: PAYER }], sessions: [guestSession()] }));
    const res = await ask('guest.payer@example.com');
    expect(res.body.message).toBe(guestClaim.RESEND_GENERIC_REPLY);
    expect(send).not.toHaveBeenCalled();
  });

  test('per-email throttle: the fourth ask in an hour sends nothing and replies the same', async () => {
    installUsers([]);
    const send = jest.spyOn(emailApi, 'sendClaimLinkEmail').mockResolvedValue({ success: true });
    app._private.setStripeForTests(stripeWith({ customers: [{ id: 'cus_guest', email: PAYER }], sessions: [guestSession()] }));
    const replies = [];
    for (let i = 0; i < 4; i += 1) replies.push((await ask('guest.payer@example.com')).body.message);
    expect(new Set(replies).size).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('per-IP rate limit answers 429 after 5 asks', async () => {
    installUsers([]);
    app._private.setStripeForTests(stripeWith({ customers: [], sessions: [] }));
    const ip = '198.51.100.77';
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', ip).send({ email: `p${i}@example.com` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  test('a Stripe outage still gives the generic reply and logs no email', async () => {
    installUsers([]);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stripe = stripeWith({ customers: [], sessions: [] });
    stripe.customers.list = jest.fn(async () => { throw Object.assign(new Error('down for guest.payer@example.com'), { type: 'StripeConnectionError' }); });
    app._private.setStripeForTests(stripe);
    const res = await ask('guest.payer@example.com');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(guestClaim.RESEND_GENERIC_REPLY);
    expect(errors.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('guest.payer');
  });

  test('login.html has the resend form and success.html links to it', () => {
    const fs = require('fs');
    const path = require('path');
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    const success = fs.readFileSync(path.join(__dirname, 'public/success.html'), 'utf8');
    expect(login).toContain('Email me a new link');
    expect(login).toContain("fetch('/api/stripe/claim-resend'");
    expect(login).toContain("window.location.hash === '#new-link'");
    expect(success).toContain('/login.html#new-link');
    expect(success).toContain('within 7 days');
  });
});

describe('session lookup brand filter', () => {
  test('non-FitMunch sessions on the shared account are 404; FitMunch keeps the contract', async () => {
    const sessions = {
      cs_fm: { id: 'cs_fm', status: 'complete', payment_status: 'paid', metadata: { app: 'fitmunch', plan: 'premium' }, customer: 'cus_fm', customer_details: { email: 'a@example.com' } },
      cs_wipper: { id: 'cs_wipper', status: 'complete', payment_status: 'paid', metadata: { app: 'wipper', plan: 'growth' }, customer: 'cus_w' },
      cs_bare: { id: 'cs_bare', status: 'complete', payment_status: 'paid', metadata: {}, customer: 'cus_b' },
    };
    app._private.setStripeForTests({ checkout: { sessions: { retrieve: jest.fn(async (id) => sessions[id]) } } });
    const fm = await request(app).get('/api/checkout/session').query({ session_id: 'cs_fm' });
    expect(fm.status).toBe(200);
    expect(fm.headers['cache-control']).toBe('no-store');
    expect(fm.body).toEqual({ plan: 'premium', planLabel: 'premium', paymentStatus: 'paid', guestCheckout: true });
    for (const id of ['cs_wipper', 'cs_bare']) {
      const res = await request(app).get('/api/checkout/session').query({ session_id: id });
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({ error: 'Session not found.' });
    }
  });
});

describe('webhook re-read errors retry by default', () => {
  const typeErr = () => new TypeError('x is undefined');
  const missing = () => Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
  const badParam = () => Object.assign(new Error('bad param'), { type: 'StripeInvalidRequestError', code: 'parameter_invalid', statusCode: 400 });

  function setup(retrieveImpl) {
    const users = [{ id: 'u1', email: 'm@example.com', stripeCustomerId: 'cus_m', subscriptionTier: 'premium', settings: {} }];
    const fx = installUsers(users);
    const live = premSub('sub_1', 'cus_m', 'active');
    const stripe = {
      webhooks: { constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)) },
      subscriptions: {
        retrieve: jest.fn(retrieveImpl || (async () => live)),
        list: jest.fn(async () => ({ data: [live] })),
        cancel: jest.fn(),
      },
      customers: { retrieve: jest.fn(async () => ({ id: 'cus_m', metadata: { brand: 'fitmunch' } })), list: jest.fn(async () => ({ data: [] })), search: jest.fn(async () => ({ data: [] })) },
    };
    app._private.setStripeForTests(stripe);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    return { users, fx, stripe, live };
  }

  test.each([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ])('%s: a TypeError on re-read answers 500, keeps the tier, and the retry is processed', async (type) => {
    let fail = true;
    const { users, stripe, live } = setup(async () => { if (fail) throw typeErr(); return live; });
    const event = { id: `evt_te_${type}`, type, data: { object: premSub('sub_1', 'cus_m', type.endsWith('deleted') ? 'canceled' : 'active') } };
    const first = await postEvent(event);
    expect(first.status).toBe(500);
    expect(users[0].subscriptionTier).toBe('premium');
    fail = false;
    const retry = await postEvent(event);
    expect(retry.status).toBe(200);
    expect(users[0].subscriptionTier).toBe('premium');
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });

  test('checkout.session.completed: a TypeError on the subscription re-read answers 500', async () => {
    setup(async () => { throw typeErr(); });
    const res = await postEvent({ id: 'evt_te_checkout', type: 'checkout.session.completed', data: { object: {
      id: 'cs_1', customer: 'cus_m', subscription: 'sub_1', status: 'complete',
      metadata: { app: 'fitmunch', plan: 'premium', priceId: PRICE_IDS.premium, userId: 'u1' },
    } } });
    expect(res.status).toBe(500);
  });

  test('invoice brand check: a TypeError on re-read answers 500; resource_missing is acked', async () => {
    setup(async () => { throw typeErr(); });
    const invoice = { id: 'in_1', customer: 'cus_m', subscription: 'sub_1' };
    expect((await postEvent({ id: 'evt_inv_te', type: 'invoice.payment_failed', data: { object: invoice } })).status).toBe(500);
    setup(async () => { throw missing(); });
    expect((await postEvent({ id: 'evt_inv_missing', type: 'invoice.payment_failed', data: { object: invoice } })).status).toBe(200);
  });

  test('allow-listed permanent errors are acked: resource_missing on delete cancels, invalid request changes nothing', async () => {
    const a = setup(async () => { throw missing(); });
    const del = await postEvent({ id: 'evt_missing_del', type: 'customer.subscription.deleted', data: { object: premSub('sub_1', 'cus_m', 'canceled') } });
    expect(del.status).toBe(200);
    expect(a.users[0].subscriptionTier).toBe('free');

    const b = setup(async () => { throw badParam(); });
    const upd = await postEvent({ id: 'evt_bad_upd', type: 'customer.subscription.updated', data: { object: premSub('sub_1', 'cus_m', 'active') } });
    expect(upd.status).toBe(200);
    expect(b.users[0].subscriptionTier).toBe('premium');
    expect(b.fx.tierWrites).toHaveLength(0);
  });

  test('classifier: only the allow-list is permanent', () => {
    const { isPermanentStripeReadError, retryableReadError } = require('./lib/webhook-error');
    expect(isPermanentStripeReadError(missing())).toBe(true);
    expect(isPermanentStripeReadError(badParam())).toBe(true);
    for (const err of [typeErr(), new Error('x'), 'boom', null, { type: 'StripeAPIError' },
      { type: 'StripeInvalidRequestError', statusCode: 429 }, { type: 'StripeInvalidRequestError', statusCode: 500 },
      { code: 'resource_missing', statusCode: 503 }]) {
      expect(isPermanentStripeReadError(err)).toBe(false);
    }
    const wrapped = retryableReadError(typeErr());
    expect(wrapped.code).toBe('WEBHOOK_RETRY');
    expect(require('./lib/webhook-error').isTransientWebhookError(wrapped)).toBe(true);
    expect(retryableReadError(missing())).toBeNull();
  });
});

describe('customer link is conditional on an empty stripe_customer_id', () => {
  test('the UPDATE carries stripe_customer_id IS NULL', async () => {
    const users = [{ id: 'u1', email: 'a@example.com', stripeCustomerId: null, settings: {} }];
    const fx = installUsers(users);
    const { linkUserToStripeCustomer } = require('./lib/fitmunch-account-link');
    const out = await linkUserToStripeCustomer(users[0], 'cus_new', null);
    expect(out.linked).toBe(true);
    const rendered = new PgDialect().sqlToQuery(fx.updates[0].cond).sql;
    expect(rendered).toContain('"users"."stripe_customer_id" is null');
    expect(rendered).toContain('"users"."id" = $1');
  });

  test('a concurrent redeem that lost the race (0 rows) is refused, not overwritten', async () => {
    const users = [{ id: 'u1', email: 'a@example.com', stripeCustomerId: null, settings: {} }];
    installUsers(users, { updateResult: [] });
    // The other redeem stored a different customer between our read and write.
    storage.getUserById = jest.fn()
      .mockResolvedValueOnce({ ...users[0] })
      .mockResolvedValue({ ...users[0], stripeCustomerId: 'cus_other' });
    const { linkUserToStripeCustomer } = require('./lib/fitmunch-account-link');
    const out = await linkUserToStripeCustomer(users[0], 'cus_new', premSub('sub_n', 'cus_new'));
    expect(out).toMatchObject({ linked: false, reason: 'different-customer' });
    expect(storage.updateUserSubscription).not.toHaveBeenCalled();
  });

  test('a skipped unique index is logged loudly with the duplicate count', async () => {
    const { checkStripeCustomerIndex } = require('./lib/db-migrate');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const missingIndex = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: 2 }] });
    expect(await checkStripeCustomerIndex(missingIndex)).toEqual({ ok: false, duplicates: 2 });
    const logged = errors.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('STRIPE_CUSTOMER_INDEX_MISSING');
    expect(logged).toContain('groups=2');
    errors.mockClear();
    const present = jest.fn().mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await checkStripeCustomerIndex(present)).toEqual({ ok: true, duplicates: 0 });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('login body validation', () => {
  test.each([
    ['number password', { email: 'a@example.com', password: 1 }],
    ['array email', { email: ['a@example.com'], password: 'pw' }],
    ['object email', { email: { $gt: '' }, password: 'pw' }],
    ['oversized password', { email: 'a@example.com', password: 'p'.repeat(2000) }],
    ['array body', ['a@example.com', 'pw']],
  ])('malformed body (%s) is 400, not 500', async (_label, body) => {
    const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
