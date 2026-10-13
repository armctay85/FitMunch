'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('./server/storage', () => {
  const actual = jest.requireActual('./server/storage');
  return {
    ...actual,
    trackEvent: jest.fn(async () => {}),
    getFunnelStats: jest.fn(async () => ({ days: 14, totalEvents: 0, events: [], steps: [] })),
  };
});

const request = require('supertest');
const storage = require('./server/storage');
const app = require('./server');
const {
  LANDING_PAGES,
  FUNNEL_STEPS,
  landingPageFromPath,
  isPremiumTrialCta,
  expandAnalyticsEvents,
  checkoutStartEvent,
  trialStartedEvent,
  trialStartedFromCheckoutSession,
  summarizeFunnel,
  scheduleFunnelEvent,
  setFunnelSinkForTests,
  resetFunnelEventsForTests,
} = require('./lib/funnel-events');
const {
  buildSubscriptionCheckoutParams,
  createFitMunchCheckoutSession,
  PRICE_IDS,
} = require('./lib/fitmunch-checkout');

const SEARCH_LANDERS = [
  '/high-protein-shopping-list',
  '/budget-meal-plan',
  '/ai-meal-plan-shopping-list',
  '/ai-meal-planner-australia',
  '/budget-meal-planner',
  '/shopper',
  '/receipt-nutrition-scanner',
  '/haul-teardown',
  '/supermarket-meal-planner',
  '/grocery-meal-planner',
  '/meal-prep-shopping-list',
];

function audSession(id) {
  return {
    id,
    url: `https://checkout.stripe.com/c/pay/${id}`,
    currency: 'aud',
    locale: 'en-GB',
    adaptive_pricing: { enabled: false },
    branding_settings: { display_name: 'FitMunch' },
  };
}

describe('funnel event helper', () => {
  afterEach(() => {
    resetFunnelEventsForTests();
    delete process.env.DATABASE_URL;
  });

  it('names the five drop-off steps in order', () => {
    expect(FUNNEL_STEPS).toEqual([
      'landing_page_view',
      'trial_cta_click',
      'account_created',
      'checkout_start',
      'trial_started',
    ]);
  });

  it('tags the homepage and each search lander, and ignores other pages', () => {
    expect(landingPageFromPath('/')).toBe('home');
    expect(landingPageFromPath('/index.html')).toBe('home');
    expect(landingPageFromPath('/index')).toBe('home');
    for (const route of SEARCH_LANDERS) {
      expect(landingPageFromPath(route)).toBe(route.slice(1));
      expect(landingPageFromPath(`${route}/`)).toBe(route.slice(1));
      expect(landingPageFromPath(`${route}.html`)).toBe(route.slice(1));
    }
    expect(Object.keys(LANDING_PAGES).sort()).toEqual(['/', ...SEARCH_LANDERS].sort());
    for (const route of ['/pricing', '/login', '/login.html', '/for-pts', '/app.html', '/best-pt-software-australia']) {
      expect(landingPageFromPath(route)).toBe('');
    }
  });

  it('treats Premium trial anchors as the trial CTA and leaves PT trials out', () => {
    expect(isPremiumTrialCta({ plan: 'premium', href: '/login.html?plan=premium#register' })).toBe(true);
    expect(isPremiumTrialCta({ href: '/login.html?plan=premium&utm_source=seo#register' })).toBe(true);
    expect(isPremiumTrialCta({ cta: 'hero_trial', href: '/login.html?plan=premium#register' })).toBe(true);
    expect(isPremiumTrialCta({ plan: 'starter', href: '/login.html?plan=starter#register', label: 'Start 14-day trial' })).toBe(false);
    expect(isPremiumTrialCta({ plan: 'pro', cta: 'pt_trial' })).toBe(false);
    expect(isPremiumTrialCta({ plan: 'pt-starter' })).toBe(false);
    expect(isPremiumTrialCta({ href: '/#first-scan', cta: 'scanner_scan_mine', label: 'Photograph your receipt' })).toBe(false);
  });

  it('promotes a landing page view and a premium CTA without doubling a batch that already has them', () => {
    const fromBeacon = expandAnalyticsEvents([
      {
        eventType: 'page_view',
        sessionId: 's_home',
        eventData: { path: '/', title: 'FitMunch', email: 'ada@example.com', name: 'Ada' },
      },
    ]);
    expect(fromBeacon.map((event) => event.eventType)).toEqual(['page_view', 'landing_page_view']);
    expect(fromBeacon[1].eventData).toMatchObject({ step: 'landing_page_view', page: 'home', path: '/' });
    expect(fromBeacon[1].userId).toBeNull();
    expect(JSON.stringify(fromBeacon)).not.toMatch(/ada@example.com|Ada/);

    const explicit = expandAnalyticsEvents([
      {
        eventType: 'page_view',
        sessionId: 's_woolies',
        eventData: { path: '/supermarket-meal-planner', utm_source: 'seo', utm_campaign: 'supermarket-meal-planner' },
      },
      {
        eventType: 'landing_page_view',
        sessionId: 's_woolies',
        eventData: { path: '/supermarket-meal-planner', page: '<script>', utm_source: 'seo' },
      },
    ]);
    const landings = explicit.filter((event) => event.eventType === 'landing_page_view');
    expect(landings).toHaveLength(1);
    expect(landings[0].eventData.page).toBe('supermarket-meal-planner');
    expect(landings[0].eventData.utm_source).toBe('seo');
    expect(JSON.stringify(landings[0])).not.toContain('<script>');

    expect(expandAnalyticsEvents([
      { eventType: 'page_view', eventData: { path: '/pricing' } },
    ]).map((event) => event.eventType)).toEqual(['page_view']);
  });

  it('promotes a premium CTA click and drops forged server steps and PT clicks', () => {
    const clicks = expandAnalyticsEvents([
      {
        eventType: 'cta_click',
        sessionId: 's_cta',
        userId: 'should-not-stick',
        eventData: {
          path: '/grocery-meal-planner',
          href: '/login.html?plan=premium#register',
          plan: 'premium',
          cta: 'grocery-meal-planner_trial',
          label: '14-day trial, then A$19.99 a month',
          email: 'buyer@example.com',
        },
      },
      {
        eventType: 'trial_cta_click',
        sessionId: 's_cta',
        eventData: {
          path: '/grocery-meal-planner',
          plan: 'premium',
          cta: 'grocery-meal-planner_trial',
        },
      },
    ]);
    const trials = clicks.filter((event) => event.eventType === 'trial_cta_click');
    expect(trials).toHaveLength(1);
    expect(trials[0].userId).toBeNull();
    expect(trials[0].eventData).toMatchObject({
      step: 'trial_cta_click',
      page: 'grocery-meal-planner',
      plan: 'premium',
      cta: 'grocery-meal-planner_trial',
    });
    expect(JSON.stringify(trials[0])).not.toMatch(/buyer@example.com/);

    const pt = expandAnalyticsEvents([
      {
        eventType: 'cta_click',
        eventData: { path: '/for-pts', plan: 'starter', href: '/login.html?plan=starter#register', label: 'Start 14-day trial' },
      },
    ]);
    expect(pt.map((event) => event.eventType)).toEqual(['cta_click']);

    expect(expandAnalyticsEvents([
      { eventType: 'trial_started', eventData: { email: 'forged@example.com', plan: 'premium' } },
      { eventType: 'checkout_start', eventData: { email: 'forged@example.com' } },
    ])).toEqual([]);
  });

  it('checkout start and trial started keep plan and source only', () => {
    const started = checkoutStartEvent({ plan: 'premium', email: 'person@example.com', name: 'Pat' });
    expect(started).toEqual({
      eventType: 'checkout_start',
      eventData: { step: 'checkout_start', plan: 'premium' },
    });

    const session = {
      id: 'cs_secret',
      customer: 'cus_123',
      customer_details: { email: 'a@b.co', name: 'Ada Lovelace' },
      metadata: { email: 'a@b.co', plan: 'premium', name: 'Ada' },
    };
    const trial = trialStartedFromCheckoutSession(session, 'webhook');
    expect(trial).toEqual({
      eventType: 'trial_started',
      eventData: { step: 'trial_started', plan: 'premium', source: 'webhook' },
    });
    expect(JSON.stringify(trial)).not.toMatch(/a@b\.co|Ada|cus_123|cs_secret|email|name/i);
    expect(trialStartedEvent({ plan: 'nope', source: 'webhook', email: 'x@y.z' }).eventData.plan).toBeUndefined();
  });

  it('rolls the five steps up and splits landing views by page', () => {
    const summary = summarizeFunnel([
      { eventType: 'landing_page_view', sessionId: 's_1', eventData: { page: 'home', step: 'landing_page_view' } },
      { eventType: 'landing_page_view', sessionId: 's_1', eventData: { page: 'shopper', step: 'landing_page_view' } },
      { eventType: 'trial_cta_click', sessionId: 's_1', eventData: { page: 'home', plan: 'premium' } },
      { eventType: 'checkout_start', sessionId: null, eventData: { plan: 'premium', step: 'checkout_start' } },
      { eventType: 'trial_started', sessionId: null, eventData: { plan: 'premium', source: 'webhook', email: 'hidden@example.com' } },
      { eventType: 'page_view', sessionId: 's_9', eventData: { path: '/pricing' } },
    ], 14, new Date('2026-10-02T00:00:00.000Z'));

    expect(summary.steps).toEqual([
      { step: 'landing_page_view', count: 2, sessions: 1 },
      { step: 'trial_cta_click', count: 1, sessions: 1 },
      { step: 'account_created', count: 0, sessions: 0 },
      { step: 'checkout_start', count: 1, sessions: 0 },
      { step: 'trial_started', count: 1, sessions: 0 },
    ]);
    expect(summary.events.map((row) => [row.eventType, row.page, row.plan, row.count])).toEqual([
      ['landing_page_view', 'home', '', 1],
      ['landing_page_view', 'shopper', '', 1],
      ['trial_cta_click', 'home', 'premium', 1],
      ['checkout_start', '', 'premium', 1],
      ['trial_started', '', 'premium', 1],
      ['page_view', '', '', 1],
    ]);
    expect(JSON.stringify(summary)).not.toContain('hidden@example.com');
  });

  it('records checkout_start only after a real session, without changing the Stripe call', async () => {
    const logged = [];
    setFunnelSinkForTests((event) => logged.push(event));
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'person@example.com',
    });
    const rawRequest = jest.fn(async () => audSession('cs_once'));
    const session = await createFitMunchCheckoutSession({ rawRequest }, params);
    const again = await createFitMunchCheckoutSession({ rawRequest }, params);

    expect(session).toEqual(audSession('cs_once'));
    expect(again.id).toBe('cs_once');
    expect(rawRequest).toHaveBeenCalledTimes(2);
    expect(rawRequest.mock.calls[0][0]).toBe('POST');
    expect(rawRequest.mock.calls[0][1]).toBe('/v1/checkout/sessions');
    expect(rawRequest.mock.calls[0][2]).toBe(params);
    expect(params.metadata.email).toBe('person@example.com');
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(logged).toEqual([{
      eventType: 'checkout_start',
      eventData: { step: 'checkout_start', plan: 'premium' },
    }]);
    expect(storage.trackEvent).not.toHaveBeenCalled();
  });

  it('does not record checkout_start when the session is refused', async () => {
    const logged = [];
    setFunnelSinkForTests((event) => logged.push(event));
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'person@example.com',
    });
    const rawRequest = jest.fn(async (method, requestPath) => {
      if (String(requestPath).endsWith('/expire')) return { status: 'expired' };
      return {
        id: 'cs_bad',
        url: 'https://checkout.stripe.com/c/pay/cs_bad',
        currency: 'usd',
        branding_settings: { display_name: 'FitMunch' },
      };
    });
    await expect(createFitMunchCheckoutSession({ rawRequest }, params)).rejects.toThrow(/FitMunch AUD/);
    expect(logged).toEqual([]);
  });

  it('still returns the session if the funnel sink throws', async () => {
    setFunnelSinkForTests(() => {
      throw new Error('sink down');
    });
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'person@example.com',
    });
    const rawRequest = jest.fn(async () => audSession('cs_ok'));
    await expect(createFitMunchCheckoutSession({ rawRequest }, params)).resolves.toMatchObject({ id: 'cs_ok' });
  });

  it('does not write server events when there is no database', () => {
    delete process.env.DATABASE_URL;
    scheduleFunnelEvent(trialStartedEvent({ plan: 'premium', email: 'a@b.co' }), 'trial:evt_1');
    scheduleFunnelEvent(trialStartedEvent({ plan: 'premium', email: 'a@b.co' }), 'trial:evt_1');
    expect(storage.trackEvent).not.toHaveBeenCalled();
  });
});

describe('funnel beacon and private viewer', () => {
  it('the browser beacon tags the same landers and posts the funnel steps', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/fm-track.js'), 'utf8');
    for (const [route, page] of Object.entries(LANDING_PAGES)) {
      expect(src).toContain(`'${route}': '${page}'`);
    }
    expect(src).toContain("eventType: 'landing_page_view'");
    expect(src).toContain("eventType: 'trial_cta_click'");
    expect(src).toContain("'/api/analytics/events'");
  });

  it('the webhook records trial started from the checkout session and the viewer names the steps', () => {
    const webhookSrc = fs.readFileSync(path.join(__dirname, 'lib/stripe-webhook.js'), 'utf8');
    expect(webhookSrc).toContain('trialStartedFromCheckoutSession(session, \'webhook\')');
    const html = fs.readFileSync(path.join(__dirname, 'private/funnel.html'), 'utf8');
    expect(html).toContain('Conversion funnel');
    expect(html).toContain('landing_page_view');
    expect(html).toContain('trial_cta_click');
    expect(html).toContain('checkout_start');
    expect(html).toContain('trial_started');
    expect(html).not.toContain('FM_ANALYTICS_KEY');
  });

  it('POST /api/analytics/events stores the landing step and the trial click, and ignores forged trial starts', async () => {
    storage.trackEvent.mockClear();
    const view = await request(app)
      .post('/api/analytics/events')
      .send({
        events: [{
          eventType: 'page_view',
          sessionId: 's_home',
          eventData: { path: '/', email: 'ada@example.com', name: 'Ada' },
        }],
      })
      .expect(200);
    expect(view.body.eventsProcessed).toBe(2);
    const viewTypes = storage.trackEvent.mock.calls.map((call) => call[1]);
    expect(viewTypes).toEqual(['page_view', 'landing_page_view']);
    expect(storage.trackEvent.mock.calls[1][0]).toBeNull();
    expect(storage.trackEvent.mock.calls[1][2]).toMatchObject({ page: 'home', step: 'landing_page_view' });
    expect(JSON.stringify(storage.trackEvent.mock.calls)).not.toMatch(/ada@example.com/);

    storage.trackEvent.mockClear();
    const click = await request(app)
      .post('/api/analytics/events')
      .send({
        events: [
          {
            eventType: 'cta_click',
            sessionId: 's_home',
            eventData: { path: '/', plan: 'premium', href: '/login.html?plan=premium#register', cta: 'hero_trial' },
          },
          {
            eventType: 'trial_cta_click',
            sessionId: 's_home',
            eventData: { path: '/', plan: 'premium', cta: 'hero_trial' },
          },
        ],
      })
      .expect(200);
    expect(click.body.eventsProcessed).toBe(2);
    expect(storage.trackEvent.mock.calls.map((call) => call[1])).toEqual(['cta_click', 'trial_cta_click']);

    storage.trackEvent.mockClear();
    const forged = await request(app)
      .post('/api/analytics/events')
      .send({
        events: [{ eventType: 'trial_started', eventData: { email: 'forged@example.com', plan: 'premium' } }],
      })
      .expect(200);
    expect(forged.body.eventsProcessed).toBe(0);
    expect(storage.trackEvent).not.toHaveBeenCalled();
  });

  function sqlFailure() {
    const err = new Error(
      'Failed query: insert into "analytics_events" ("user_id", "event_type", "event_data", "session_id") values ($1, $2, $3, $4)\nparams: not-a-uuid,page_view,{},secret-param'
    );
    err.cause = new Error('invalid input syntax for type uuid: "not-a-uuid"');
    err.stack = 'Error: Failed query\n    at trackEvent (/app/server/storage.js:267:3)';
    return err;
  }

  function expectNoSql(body) {
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/failed query/i);
    expect(text).not.toMatch(/params\s*:/i);
    expect(text).not.toMatch(/insert into/i);
    expect(text).not.toMatch(/analytics_events/);
    expect(text).not.toMatch(/invalid input syntax/i);
    expect(text).not.toMatch(/secret-param/);
    expect(text).not.toMatch(/not-a-uuid/);
    expect(text).not.toMatch(/storage\.js/);
  }

  it('POST /api/analytics/events returns 400 for a non-uuid user id and does not insert', async () => {
    storage.trackEvent.mockClear();
    const res = await request(app)
      .post('/api/analytics/events')
      .send({
        events: [{ eventType: 'page_view', userId: 'not-a-uuid', eventData: { path: '/' } }],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid events data' });
    expect(storage.trackEvent).not.toHaveBeenCalled();
    expectNoSql(res.body);
  });

  it('POST /api/analytics/events returns 400 for a null byte in the event type', async () => {
    storage.trackEvent.mockClear();
    const res = await request(app)
      .post('/api/analytics/events')
      .send({ events: [{ eventType: 'page_view\u0000', eventData: {} }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid events data');
    expect(storage.trackEvent).not.toHaveBeenCalled();
  });

  it('a failing analytics insert returns a generic message with no SQL text', async () => {
    storage.trackEvent.mockRejectedValueOnce(sqlFailure());
    const res = await request(app)
      .post('/api/analytics/events')
      .send({
        events: [{ eventType: 'page_view', sessionId: 's_home', eventData: { path: '/pricing' } }],
      });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error' });
    expectNoSql(res.body);
  });

  it('a failing funnel stats query returns a generic message with no SQL text', async () => {
    const previous = process.env.FM_ANALYTICS_KEY;
    process.env.FM_ANALYTICS_KEY = 'test-key';
    storage.getFunnelStats.mockRejectedValueOnce(sqlFailure());
    try {
      const res = await request(app)
        .get('/api/analytics/funnel')
        .set('x-fm-analytics-key', 'test-key');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Internal server error' });
      expectNoSql(res.body);
    } finally {
      if (previous == null) delete process.env.FM_ANALYTICS_KEY;
      else process.env.FM_ANALYTICS_KEY = previous;
    }
  });
});

describe('/demo is retired', () => {
  test.each(['/demo', '/demo.html', '/try'])('%s => 301 to the homepage worked example', async (route) => {
    const res = await require('supertest')(require('./server')).get(route);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/#proof');
  });
  test('sitemap no longer lists /demo', () => {
    expect(require('fs').readFileSync(require('path').join(__dirname, 'public/sitemap.xml'), 'utf8')).not.toMatch(/fitmunch\.com\.au\/demo</);
  });
});

describe('read-only funnel key (FM_FUNNEL_READ_KEY)', () => {
  const READ = 'read-only-test-value';
  const FULL = 'full-test-value';
  let prevRead;
  let prevFull;
  beforeEach(() => {
    prevRead = process.env.FM_FUNNEL_READ_KEY;
    prevFull = process.env.FM_ANALYTICS_KEY;
    process.env.FM_FUNNEL_READ_KEY = READ;
    process.env.FM_ANALYTICS_KEY = FULL;
    storage.getFunnelStats.mockResolvedValueOnce({
      days: 14,
      totalEvents: 99,
      asOf: '2026-10-14T00:00:00.000Z',
      events: [{ eventType: 'trial_cta_click', page: '/pricing', plan: 'premium', count: 7, sessions: 5 }],
      steps: [
        { step: 'landing_page_view', count: 40, sessions: 30 },
        { step: 'trial_cta_click', count: 7, sessions: 5 },
        { step: 'account_created', count: 4, sessions: 4 },
        { step: 'checkout_start', count: 3, sessions: 3 },
        { step: 'trial_started', count: 2, sessions: 2 },
      ],
    });
  });
  afterEach(() => {
    if (prevRead == null) delete process.env.FM_FUNNEL_READ_KEY; else process.env.FM_FUNNEL_READ_KEY = prevRead;
    if (prevFull == null) delete process.env.FM_ANALYTICS_KEY; else process.env.FM_ANALYTICS_KEY = prevFull;
    storage.getFunnelStats.mockReset();
    storage.getFunnelStats.mockImplementation(async () => ({ days: 14, totalEvents: 0, events: [], steps: [] }));
  });

  it('returns the four counts only, nothing else', async () => {
    const res = await request(app).get('/api/analytics/funnel').set('x-fm-funnel-key', READ);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      days: 14,
      asOf: '2026-10-14T00:00:00.000Z',
      counts: { landingViews: 40, trialClicks: 7, checkoutStarts: 3, trialStarts: 2 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/events|sessions|page|plan|pricing|account_created/);
  });

  it('wrong read key, or read key in the query string, => 401', async () => {
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-funnel-key', READ + 'x')).status).toBe(401);
    expect((await request(app).get('/api/analytics/funnel').query({ key: READ })).status).toBe(401);
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', READ)).status).toBe(401);
  });

  it('disabled when FM_FUNNEL_READ_KEY is unset or empty', async () => {
    delete process.env.FM_FUNNEL_READ_KEY;
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-funnel-key', READ)).status).toBe(401);
    process.env.FM_FUNNEL_READ_KEY = '';
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-funnel-key', '')).status).toBe(401);
  });

  it('does not open the private /funnel page or other routes', async () => {
    expect((await request(app).get('/funnel').set('x-fm-funnel-key', READ)).status).toBe(401);
    const post = await request(app).post('/api/analytics/funnel').set('x-fm-funnel-key', READ).send({});
    expect(post.status).not.toBe(200);
  });

  it('the full analytics key still returns the full stats', async () => {
    const res = await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', FULL);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.steps).toHaveLength(5);
  });
});

describe('funnel GET: shared limiter, header-only keys', () => {
  const counters = require('./lib/shared-counters');
  let prev;
  beforeEach(() => {
    prev = { full: process.env.FM_ANALYTICS_KEY, read: process.env.FM_FUNNEL_READ_KEY, max: process.env.FUNNEL_IP_MAX_PER_10_MIN };
    process.env.FM_ANALYTICS_KEY = 'full-limit-test';
    counters.resetSharedCountersForTests();
  });
  afterEach(() => {
    for (const [k, v] of [['FM_ANALYTICS_KEY', prev.full], ['FM_FUNNEL_READ_KEY', prev.read], ['FUNNEL_IP_MAX_PER_10_MIN', prev.max]]) {
      if (v == null) delete process.env[k]; else process.env[k] = v;
    }
    counters.setSharedCounterQueryForTests(null);
    counters.resetSharedCountersForTests();
  });

  it('the full key in ?key= is refused; the header works', async () => {
    expect((await request(app).get('/api/analytics/funnel').query({ key: 'full-limit-test' })).status).toBe(401);
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', 'full-limit-test')).status).toBe(200);
  });

  it('wrong keys hit 429 after the per-IP limit (no Retry-After guessing past it)', async () => {
    process.env.FUNNEL_IP_MAX_PER_10_MIN = '3';
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', `wrong-${i}`)).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const ok = await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', 'full-limit-test');
    expect(ok.status).toBe(429);
    expect(ok.headers['retry-after']).toBe('600');
  });

  it('fails closed: counter down => 503 even with the right key', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    counters.setSharedCounterQueryForTests(async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); });
    try {
      const before = storage.getFunnelStats.mock.calls.length;
      const res = await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', 'full-limit-test');
      expect(res.status).toBe(503);
      expect(storage.getFunnelStats.mock.calls.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it('read key: env unset and a header of "undefined" => 401', async () => {
    delete process.env.FM_FUNNEL_READ_KEY;
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-funnel-key', 'undefined')).status).toBe(401);
  });

  it('full key: env unset and a header of "undefined" => 401', async () => {
    delete process.env.FM_ANALYTICS_KEY;
    expect((await request(app).get('/api/analytics/funnel').set('x-fm-analytics-key', 'undefined')).status).toBe(401);
  });

  it('safeKeyEqual compares with crypto.timingSafeEqual (no ===)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const fn = src.slice(src.indexOf('function safeKeyEqual'), src.indexOf('\n}\n', src.indexOf('function safeKeyEqual')));
    expect(fn).toMatch(/crypto\.timingSafeEqual\(a, b\)/);
    expect(fn).not.toMatch(/===|!==/);
  });

  it('the private funnel page keeps the key in sessionStorage and sends it only as a header', () => {
    const html = fs.readFileSync(path.join(__dirname, 'private/funnel.html'), 'utf8');
    expect(html).toContain("headers: { 'x-fm-analytics-key': key }");
    expect(html).toMatch(/sessionStorage\.setItem\(KEY, key\)/);
    expect(html).toMatch(/sessionStorage\.getItem\(KEY\)/);
    expect(html).not.toMatch(/localStorage/);
    expect(html).not.toMatch(/[?&]key=|URLSearchParams|location\.search/);
  });
});
