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
  '/ai-meal-planner-australia',
  '/budget-meal-planner',
  '/shopper',
  '/receipt-nutrition-scanner',
  '/haul-teardown',
  '/woolworths-meal-planner',
  '/coles-meal-planner',
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

  it('names the four drop-off steps in order', () => {
    expect(FUNNEL_STEPS).toEqual([
      'landing_page_view',
      'trial_cta_click',
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
    for (const route of ['/pricing', '/login', '/login.html', '/demo', '/for-pts', '/app.html', '/best-pt-software-australia']) {
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
        eventData: { path: '/woolworths-meal-planner', utm_source: 'seo', utm_campaign: 'woolworths-meal-planner' },
      },
      {
        eventType: 'landing_page_view',
        sessionId: 's_woolies',
        eventData: { path: '/woolworths-meal-planner', page: '<script>', utm_source: 'seo' },
      },
    ]);
    const landings = explicit.filter((event) => event.eventType === 'landing_page_view');
    expect(landings).toHaveLength(1);
    expect(landings[0].eventData.page).toBe('woolworths-meal-planner');
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
          path: '/coles-meal-planner',
          href: '/login.html?plan=premium#register',
          plan: 'premium',
          cta: 'coles-meal-planner_trial',
          label: '14-day trial, then A$19.99 a month',
          email: 'buyer@example.com',
        },
      },
      {
        eventType: 'trial_cta_click',
        sessionId: 's_cta',
        eventData: {
          path: '/coles-meal-planner',
          plan: 'premium',
          cta: 'coles-meal-planner_trial',
        },
      },
    ]);
    const trials = clicks.filter((event) => event.eventType === 'trial_cta_click');
    expect(trials).toHaveLength(1);
    expect(trials[0].userId).toBeNull();
    expect(trials[0].eventData).toMatchObject({
      step: 'trial_cta_click',
      page: 'coles-meal-planner',
      plan: 'premium',
      cta: 'coles-meal-planner_trial',
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

  it('rolls the four steps up and splits landing views by page', () => {
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
    const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(serverSrc).toContain('trialStartedFromCheckoutSession(session, \'webhook\')');
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
        .query({ key: 'test-key' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Internal server error' });
      expectNoSql(res.body);
    } finally {
      if (previous == null) delete process.env.FM_ANALYTICS_KEY;
      else process.env.FM_ANALYTICS_KEY = previous;
    }
  });
});
