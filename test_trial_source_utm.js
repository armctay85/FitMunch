'use strict';

/**
 * Meal-plan pages are trial doors (src -> source_page) and first-touch UTMs
 * travel from any landing page into Stripe session and subscription metadata.
 * Simulated Stripe only. No live keys.
 */

process.env.QUICK_CHECKOUT_IP_MAX_PER_HOUR = '100000';
process.env.QUICK_CHECKOUT_EMAIL_MAX_PER_HOUR = '100000';
process.env.CHECKOUT_SESSIONS_IP_MAX_PER_HOUR = '100000';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { JSDOM } = require('jsdom');
const app = require('./server.js');
const storage = require('./server/storage.js');
const {
  sanitizeSourcePage,
  sanitizeCheckoutUtm,
  buildSubscriptionCheckoutParams,
  jwtSecret,
  PRICE_IDS,
} = require('./lib/fitmunch-checkout');

const GUIDE_LINKS = [
  ['/weekly-meal-plan-australia', 'Weekly meal plan Australia'],
  ['/quick-weeknight-dinners', 'Quick weeknight dinners'],
  ['/macro-tracking-or-a-meal-plan', 'Macro tracking or a meal plan'],
  ['/how-to-plan-meals-when-you-are-busy', 'How to plan meals when you are busy'],
  ['/meal-plan-and-workout-plan', 'Meal plan and workout plan'],
  ['/how-to-plan-meals-in-australia', 'How to plan meals in Australia'],
  ['/lunches-for-work', 'Lunches for work'],
];

const TRACK = path.join(__dirname, 'public/js/fm-track.js');

function memoryStorage() {
  const box = () => {
    const map = new Map();
    return {
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) { map.set(key, String(value)); },
      removeItem(key) { map.delete(key); },
    };
  };
  return { local: box(), session: box() };
}

function runTrack(store, href, documentExtras) {
  const url = new URL(href);
  const posts = [];
  const sandbox = {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      hostname: url.hostname,
      href: url.href,
    },
    document: Object.assign({
      title: 'FitMunch',
      referrer: '',
      readyState: 'complete',
      addEventListener() {},
    }, documentExtras || {}),
    navigator: {
      sendBeacon(_url, blob) {
        posts.push(blob && blob._text ? blob._text : '');
        return true;
      },
    },
    sessionStorage: store.session,
    localStorage: store.local,
    Blob: class Blob {
      constructor(parts) { this._text = parts.join(''); }
    },
    URLSearchParams,
    JSON,
    Object,
    Math,
    Date,
    console,
    fetch() { return Promise.resolve(); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TRACK, 'utf8'), sandbox, { filename: 'fm-track.js' });
  return { posts, track: sandbox.FMTrack };
}

function makeFakeStripe() {
  const S = { customers: [], sessions: [], n: 0 };
  const nextId = (prefix) => `${prefix}_${++S.n}`;
  const fake = {
    S,
    customers: {
      create: jest.fn(async (params) => {
        const customer = { id: nextId('cus'), ...params };
        S.customers.push(customer);
        return customer;
      }),
      list: jest.fn(async () => ({ data: [] })),
      search: jest.fn(async () => ({ data: [] })),
      retrieve: jest.fn(async (customerId) => {
        const found = S.customers.find((customer) => customer.id === customerId);
        if (found) return found;
        if (customerId === 'cus_member') {
          return {
            id: customerId,
            email: 'ada@example.com',
            metadata: { brand: 'fitmunch', product: 'fitmunch', userId: 'u-ada' },
          };
        }
        const err = new Error('No such customer');
        err.code = 'resource_missing';
        throw err;
      }),
    },
    subscriptions: {
      list: jest.fn(async () => ({ data: [] })),
    },
    checkout: {
      sessions: {
        list: jest.fn(async ({ customer, status } = {}) => ({
          data: S.sessions.filter((session) => {
            if (customer && session.customer !== customer) return false;
            if (status && session.status !== status) return false;
            return true;
          }),
        })),
      },
    },
    rawRequest: jest.fn(async (method, requestPath, params) => {
      if (method === 'POST' && requestPath === '/v1/checkout/sessions') {
        const session = {
          id: nextId('cs'),
          url: 'https://checkout.stripe.com/c/pay/x',
          currency: 'aud',
          locale: 'en-GB',
          adaptive_pricing: { enabled: false },
          branding_settings: { display_name: 'FitMunch' },
          status: 'open',
          customer: params.customer,
          metadata: { ...(params.metadata || {}) },
          created: S.n,
          params,
        };
        S.sessions.push(session);
        return session;
      }
      if (method === 'POST' && /\/expire$/.test(requestPath)) return { status: 'expired' };
      throw new Error('unexpected ' + requestPath);
    }),
  };
  return fake;
}

function memberToken() {
  return jwt.sign(
    { userId: 'u-ada', email: 'ada@example.com', name: 'Ada', role: 'client' },
    jwtSecret()
  );
}

function sessionMeta(fake, index = 0) {
  const session = fake.S.sessions[index];
  return {
    session: session.params.metadata,
    subscription: session.params.subscription_data.metadata,
    idempotencyKey: fake.rawRequest.mock.calls[index][3].idempotencyKey,
  };
}

function bootLogin(url, prepare) {
  const html = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (requestUrl, opts) => {
        calls.push({ url: requestUrl, body: JSON.parse(opts.body) });
        const signedIn = String(requestUrl).includes('quick-checkout');
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => (signedIn
            ? { success: true, signIn: true, message: 'Check your email' }
            : { success: true, alreadySubscribed: true, url: null }),
        };
      };
      if (prepare) prepare(window);
    },
  });
  return { dom, calls };
}

describe('checkout attribution sanitise', () => {
  it('keeps a lowercase slug and drops anything else from source_page', () => {
    expect(sanitizeSourcePage('weekly-meal-plan-australia')).toBe('weekly-meal-plan-australia');
    expect(sanitizeSourcePage('  lunches-for-work  ')).toBe('lunches-for-work');
    expect(sanitizeSourcePage('a'.repeat(64))).toBe('a'.repeat(64));
    for (const bad of ['', '   ', 'Weekly', 'has space', 'a_b', 'a.b', 'a/b', '../x', 'a'.repeat(65), null, 1, {}, []]) {
      expect(sanitizeSourcePage(bad)).toBe('');
    }
  });

  it('lowercases utm values that match the charset and drops the rest', () => {
    expect(sanitizeCheckoutUtm({ source: 'X', medium: 'Social', campaign: 'DrewCCI' })).toEqual({
      source: 'x',
      medium: 'social',
      campaign: 'drewcci',
    });
    expect(sanitizeCheckoutUtm({ utm_source: 'x', utm_campaign: 'drew.cci_1' })).toEqual({
      source: 'x',
      medium: '',
      campaign: 'drew.cci_1',
    });
    expect(sanitizeCheckoutUtm({ source: '  x  ', campaign: 'a'.repeat(64) }).source).toBe('x');
    expect(sanitizeCheckoutUtm({ campaign: 'a'.repeat(64) }).campaign).toHaveLength(64);
    for (const bad of ['has space', 'a@b.com', 'x?y', 'a'.repeat(65), '', '   ']) {
      expect(sanitizeCheckoutUtm({ source: bad }).source).toBe('');
    }
    expect(sanitizeCheckoutUtm(null)).toEqual({ source: '', medium: '', campaign: '' });
    expect(sanitizeCheckoutUtm(['x'])).toEqual({ source: '', medium: '', campaign: '' });
    expect(sanitizeCheckoutUtm({ source: 1, medium: {}, campaign: true })).toEqual({
      source: '',
      medium: '',
      campaign: '',
    });
  });

  it('writes source_page and the three utm keys on both metadata objects, and omits blanks', () => {
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'ada@example.com',
      sourcePage: 'weekly-meal-plan-australia',
      utm: { source: 'X', campaign: 'DrewCCI' },
    });
    const expected = {
      source_page: 'weekly-meal-plan-australia',
      utm_source: 'x',
      utm_campaign: 'drewcci',
    };
    expect(params.metadata).toMatchObject(expected);
    expect(params.subscription_data.metadata).toMatchObject(expected);
    expect(params.metadata.utm_medium).toBeUndefined();
    expect(params.subscription_data.metadata.utm_medium).toBeUndefined();
    expect(params.metadata).not.toBe(params.subscription_data.metadata);
    expect(params.metadata.email).toBe('ada@example.com');
    expect(params.subscription_data.metadata.email).toBeUndefined();

    const clean = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      plan: 'premium',
      sourcePage: 'Not a slug',
      utm: { source: 'bad value', medium: 'ok.medium', campaign: '' },
    });
    expect(clean.metadata.source_page).toBeUndefined();
    expect(clean.metadata.utm_source).toBeUndefined();
    expect(clean.metadata.utm_medium).toBe('ok.medium');
    expect(clean.metadata.utm_campaign).toBeUndefined();
    expect(clean.subscription_data.metadata.utm_medium).toBe('ok.medium');
    expect(JSON.stringify(clean)).not.toContain('source_page');
  });
});

describe('first-touch UTMs survive navigation', () => {
  it('stores utm_source=x and utm_campaign=drewcci on the first page and keeps them', () => {
    const store = memoryStorage();
    runTrack(store, 'https://www.fitmunch.com.au/?utm_source=x&utm_campaign=drewcci');
    const first = JSON.parse(store.local.getItem('fm_attribution'));
    expect(first).toMatchObject({ utm_source: 'x', utm_campaign: 'drewcci', landing: '/' });
    expect(store.session.getItem('fm_attribution')).toBe(store.local.getItem('fm_attribution'));

    runTrack(store, 'https://www.fitmunch.com.au/weekly-meal-plan-australia');
    runTrack(store, 'https://www.fitmunch.com.au/login.html?plan=premium&src=weekly-meal-plan-australia&utm_source=homepage&utm_campaign=free_signup#register');
    expect(JSON.parse(store.local.getItem('fm_attribution'))).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'drewcci',
    });
  });

  it('uses sessionStorage when localStorage is blocked', () => {
    const store = memoryStorage();
    store.local.getItem = () => { throw new Error('blocked'); };
    store.local.setItem = () => { throw new Error('blocked'); };
    runTrack(store, 'https://www.fitmunch.com.au/lunches-for-work?utm_source=x&utm_medium=social&utm_campaign=drewcci');
    expect(JSON.parse(store.session.getItem('fm_attribution'))).toMatchObject({
      utm_source: 'x',
      utm_medium: 'social',
      utm_campaign: 'drewcci',
      landing: '/lunches-for-work',
    });
  });
});

describe('login.html sends sourcePage and utm', () => {
  it('sends the meal-plan src and first-touch UTMs on both checkout calls', async () => {
    const stored = JSON.stringify({ utm_source: 'x', utm_campaign: 'drewcci', landing: '/' });
    const { dom, calls } = bootLogin(
      'https://www.fitmunch.com.au/login.html?plan=premium&src=weekly-meal-plan-australia&utm_source=homepage&utm_campaign=free_signup#register',
      (window) => {
        window.localStorage.setItem('fm_attribution', stored);
      }
    );
    const email = dom.window.document.getElementById('reg-email');
    email.value = 'ada@example.com';
    await dom.window.doEmailFirstTrial();
    try {
      await dom.window.redirectAfterAuth('token');
    } catch (_) {
      /* jsdom may refuse the follow-on navigation after the checkout request */
    }
    expect(calls.map((call) => call.url)).toEqual(['/api/quick-checkout', '/api/checkout']);
    for (const call of calls) {
      expect(call.body.sourcePage).toBe('weekly-meal-plan-australia');
      expect(call.body.utm).toEqual({ source: 'x', campaign: 'drewcci' });
    }
    expect(calls[0].body).toMatchObject({ email: 'ada@example.com', plan: 'premium' });
    expect(calls[1].body.plan).toBe('premium');
    expect(dom.window.location.search).toContain('src=weekly-meal-plan-australia');
  });

  it('reads UTMs from the login URL when nothing was stored', async () => {
    const { dom, calls } = bootLogin(
      'https://www.fitmunch.com.au/login.html?plan=premium&src=lunches-for-work&utm_source=x&utm_campaign=drewcci#register'
    );
    dom.window.localStorage.removeItem('fm_attribution');
    dom.window.sessionStorage.removeItem('fm_attribution');
    dom.window.document.getElementById('reg-email').value = 'ada@example.com';
    await dom.window.doEmailFirstTrial();
    expect(calls[0].body.sourcePage).toBe('lunches-for-work');
    expect(calls[0].body.utm).toEqual({ source: 'x', campaign: 'drewcci' });
  });

  it('reads sessionStorage when localStorage throws', async () => {
    const { dom, calls } = bootLogin(
      'https://www.fitmunch.com.au/login.html?plan=premium&src=quick-weeknight-dinners#register',
      (window) => {
        window.sessionStorage.setItem('fm_attribution', JSON.stringify({
          utm_source: 'x',
          utm_medium: 'social',
          utm_campaign: 'drewcci',
        }));
        window.localStorage.getItem = () => { throw new Error('blocked'); };
        window.localStorage.setItem = () => { throw new Error('blocked'); };
      }
    );
    dom.window.document.getElementById('reg-email').value = 'ada@example.com';
    await dom.window.doEmailFirstTrial();
    expect(calls[0].body.utm).toEqual({ source: 'x', medium: 'social', campaign: 'drewcci' });
    expect(calls[0].body.sourcePage).toBe('quick-weeknight-dinners');
  });

  it('keeps the register attribution payload, and does not attach tracking to coach checkout', () => {
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    expect(login).toContain("localStorage.getItem('fm_attribution'");
    expect(login).toContain('...(attribution ? { attribution } : {})');
    const coach = login.slice(login.indexOf("'/api/coach/checkout'"), login.indexOf("'/api/checkout'"));
    expect(coach).toContain('JSON.stringify({ plan: checkoutPlan })');
    expect(coach).not.toContain('checkoutTracking');
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(api).toContain("jsonb_build_object('attribution', $1::jsonb)");
  });
});

describe('home meal planning guides', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

  it('links all 7 guides from #plan-from-here and the footer in CTA green', () => {
    const start = html.indexOf('id="plan-from-here"');
    const plan = html.slice(start, html.indexOf('</section>', start));
    expect(plan).toContain('<h3>Meal planning guides</h3>');
    expect(plan).toContain('The same health engine, from the shop you already do and from a week of meals.');
    expect(html).not.toContain('Four ways into the same health engine');
    expect(html).toContain('.guide-links a{color:#0f7a32;font-weight:700;text-decoration:none}');
    expect(html).toMatch(/\.footer-links a\.guide-link\{[^}]*background:#0f7a32/);
    for (const [href, label] of GUIDE_LINKS) {
      expect(plan).toContain(`<a href="${href}">${label}</a>`);
      expect(html).toContain(`<a class="guide-link" href="${href}">${label}</a>`);
    }
    const block = plan.slice(plan.indexOf('class="guide-block"'));
    expect(block).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b|\biga\b|\$|\u2014/i);
    expect(block).not.toMatch(/\bA\$\d/);
  });
});

describe('Stripe metadata from the trial flow', () => {
  const original = {
    getUserById: storage.getUserById,
    updateUserSubscription: storage.updateUserSubscription,
    db: storage.db,
  };
  let fake;

  beforeEach(() => {
    fake = makeFakeStripe();
    app._private.setStripeForTests(fake);
    storage.getUserById = jest.fn(async (id) => {
      if (id !== 'u-ada') return null;
      return {
        id: 'u-ada',
        email: 'ada@example.com',
        name: 'Ada',
        subscriptionTier: 'free',
        stripeCustomerId: 'cus_member',
      };
    });
    storage.updateUserSubscription = jest.fn(async () => {});
  });

  afterEach(() => {
    storage.getUserById = original.getUserById;
    storage.updateUserSubscription = original.updateUserSubscription;
    storage.db = original.db;
  });

  afterAll(() => {
    app._private.setStripeForTests(null);
  });

  function trackedBody(extra = {}) {
    return {
      email: 'ada@example.com',
      plan: 'premium',
      nonce: 'nonce-drewcci',
      sourcePage: 'weekly-meal-plan-australia',
      utm: { source: 'x', campaign: 'drewcci' },
      ...extra,
    };
  }

  it('a home landing of utm_source=x and utm_campaign=drewcci is on both metadata objects', async () => {
    const store = memoryStorage();
    runTrack(store, 'https://www.fitmunch.com.au/?utm_source=x&utm_campaign=drewcci');
    const { dom, calls } = bootLogin(
      'https://www.fitmunch.com.au/login.html?plan=premium&src=weekly-meal-plan-australia#register',
      (window) => {
        window.localStorage.setItem('fm_attribution', store.local.getItem('fm_attribution'));
      }
    );
    dom.window.document.getElementById('reg-email').value = 'ada@example.com';
    await dom.window.doEmailFirstTrial();
    const body = calls[0].body;
    expect(body.utm).toEqual({ source: 'x', campaign: 'drewcci' });
    expect(body.sourcePage).toBe('weekly-meal-plan-australia');

    const quick = await request(app).post('/api/quick-checkout').send(body).expect(200);
    expect(quick.body.url).toContain('checkout.stripe.com');
    const guest = sessionMeta(fake, 0);
    expect(guest.session).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'drewcci',
      source_page: 'weekly-meal-plan-australia',
    });
    expect(guest.subscription).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'drewcci',
      source_page: 'weekly-meal-plan-australia',
    });
    expect(guest.session.utm_medium).toBeUndefined();
    expect(guest.subscription.utm_medium).toBeUndefined();
    expect(guest.idempotencyKey).not.toContain('drewcci');
    expect(guest.idempotencyKey).not.toContain('weekly-meal-plan-australia');
    expect(guest.idempotencyKey).not.toMatch(/utm_|source_page/);

    const authed = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${memberToken()}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ plan: 'premium', sourcePage: body.sourcePage, utm: body.utm })
      .expect(200);
    expect(authed.body.url).toContain('checkout.stripe.com');
    const member = sessionMeta(fake, 1);
    expect(member.session).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'drewcci',
      source_page: 'weekly-meal-plan-australia',
      userId: 'u-ada',
    });
    expect(member.subscription).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'drewcci',
      source_page: 'weekly-meal-plan-australia',
    });
    expect(member.idempotencyKey).not.toContain('drewcci');
    expect(member.idempotencyKey).not.toContain('weekly-meal-plan-australia');
    expect(member.idempotencyKey).not.toMatch(/utm_|source_page/);
  });

  it('drops a bad source page and a bad utm before either metadata object', async () => {
    await request(app).post('/api/quick-checkout').send({
      email: 'bad@example.com',
      plan: 'premium',
      nonce: 'nonce-bad',
      sourcePage: 'Not A Slug',
      utm: { source: 'X', medium: 'has space', campaign: 'DrewCCI' },
    }).expect(200);
    const guest = sessionMeta(fake, 0);
    expect(guest.session.utm_source).toBe('x');
    expect(guest.session.utm_campaign).toBe('drewcci');
    expect(guest.session.utm_medium).toBeUndefined();
    expect(guest.session.source_page).toBeUndefined();
    expect(guest.subscription).toMatchObject({ utm_source: 'x', utm_campaign: 'drewcci' });
    expect(guest.subscription.source_page).toBeUndefined();

    await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({
        plan: 'premium',
        sourcePage: 'meal_plan',
        utm: { source: 'ok_source', medium: 'a'.repeat(65), campaign: 'ok-campaign' },
      })
      .expect(200);
    const member = sessionMeta(fake, 1);
    expect(member.session.source_page).toBeUndefined();
    expect(member.session.utm_source).toBe('ok_source');
    expect(member.session.utm_medium).toBeUndefined();
    expect(member.session.utm_campaign).toBe('ok-campaign');
    expect(member.subscription.utm_source).toBe('ok_source');
    expect(member.subscription.utm_campaign).toBe('ok-campaign');
  });

  it('an already-open session is reused and does not gain later utm or source_page', async () => {
    const first = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ plan: 'premium' })
      .expect(200);
    const second = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ plan: 'premium', sourcePage: 'lunches-for-work', utm: { source: 'x', campaign: 'drewcci' } })
      .expect(200);
    expect(second.body.url).toBe(first.body.url);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.rawRequest).toHaveBeenCalledTimes(1);
    expect(fake.S.sessions[0].params.metadata.utm_source).toBeUndefined();
    expect(fake.S.sessions[0].params.metadata.source_page).toBeUndefined();
    expect(fake.S.sessions[0].params.subscription_data.metadata.utm_campaign).toBeUndefined();
  });

  it('a repeated guest nonce returns the first session, so later utm is not written', async () => {
    const send = (utm) => request(app).post('/api/quick-checkout').send({
      email: 'guest@example.com',
      plan: 'premium',
      nonce: 'same-nonce',
      ...(utm ? { utm, sourcePage: 'lunches-for-work' } : {}),
    });
    const first = await send(null).expect(200);
    const second = await send({ source: 'x', campaign: 'drewcci' }).expect(200);
    expect(second.body.url).toBe(first.body.url);
    expect(fake.S.sessions).toHaveLength(1);
    expect(fake.S.sessions[0].params.metadata.utm_source).toBeUndefined();
    expect(fake.S.sessions[0].params.subscription_data.metadata.source_page).toBeUndefined();
  });
});
