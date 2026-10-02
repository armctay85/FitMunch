'use strict';

const fs = require('fs');
const path = require('path');

const {
  EXPERIMENTS,
  assignVariant,
  sanitizeVariant,
  variantTagForVisitor,
  variantFromCookieHeader,
  applyTag,
} = require('./public/js/fm-ab');
const {
  expandAnalyticsEvents,
  checkoutStartEvent,
  trialStartedFromCheckoutSession,
  rememberCheckoutVariant,
  setFunnelSinkForTests,
  resetFunnelEventsForTests,
} = require('./lib/funnel-events');
const {
  buildSubscriptionCheckoutParams,
  createFitMunchCheckoutSession,
  PRICE_IDS,
} = require('./lib/fitmunch-checkout');

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

describe('variant assignment', () => {
  afterEach(() => {
    resetFunnelEventsForTests();
    delete process.env.DATABASE_URL;
  });

  it('ships the example experiment disabled, so every visitor stays on control', () => {
    expect(EXPERIMENTS.home_fold_note.enabled).toBe(false);
    expect(EXPERIMENTS.home_fold_note.variants).toEqual(['control', 'kicker']);
    const enabled = { ...EXPERIMENTS.home_fold_note, enabled: true };
    let kickerId = '';
    let controlId = '';
    for (let i = 0; i < 40; i++) {
      const id = `visitor-${i}`;
      const variant = assignVariant(id, enabled);
      if (variant === 'kicker' && !kickerId) kickerId = id;
      if (variant === 'control' && !controlId) controlId = id;
    }
    expect(kickerId).not.toBe('');
    expect(controlId).not.toBe('');
    expect(assignVariant(kickerId, EXPERIMENTS.home_fold_note)).toBe('control');
    expect(assignVariant(kickerId, enabled)).toBe('kicker');
    expect(assignVariant(kickerId, enabled)).toBe(assignVariant(kickerId, enabled));
    expect(variantTagForVisitor(kickerId)).toBe('home_fold_note:control');
    expect(variantTagForVisitor(kickerId, { home_fold_note: enabled })).toBe('home_fold_note:kicker');
  });

  it('reads the assignment cookie and drops anything that is not a variant tag', () => {
    expect(variantFromCookieHeader('fm_vid=v_abc; fm_ab=home_fold_note:control')).toBe('home_fold_note:control');
    expect(variantFromCookieHeader('fm_ab=home_fold_note%3Acontrol')).toBe('home_fold_note:control');
    expect(variantFromCookieHeader('fm_ab=person@example.com')).toBe('');
    expect(sanitizeVariant('<script>')).toBe('');
  });

  it('applies only the enabled example variant, and leaves control unmarked', () => {
    const calls = [];
    const doc = { documentElement: { setAttribute: (...args) => calls.push(args) } };
    applyTag(doc, 'home_fold_note:control');
    expect(calls).toEqual([]);
    applyTag(doc, 'home_fold_note:kicker');
    expect(calls).toEqual([['data-ab-home-fold-note', 'kicker']]);
  });

  it('records the variant on landing, trial click, checkout start, and trial started', async () => {
    const fromView = expandAnalyticsEvents([{
      eventType: 'page_view',
      sessionId: 's_home',
      eventData: { path: '/', variant: 'home_fold_note:control', email: 'ada@example.com' },
    }]);
    expect(fromView.find((event) => event.eventType === 'landing_page_view').eventData.variant)
      .toBe('home_fold_note:control');
    expect(JSON.stringify(fromView)).not.toMatch(/ada@example.com/);

    const fromClick = expandAnalyticsEvents([{
      eventType: 'trial_cta_click',
      sessionId: 's_home',
      eventData: {
        path: '/',
        plan: 'premium',
        cta: 'hero_trial',
        variant: 'home_fold_note:kicker',
      },
    }]);
    expect(fromClick[0].eventData).toMatchObject({
      step: 'trial_cta_click',
      plan: 'premium',
      variant: 'home_fold_note:kicker',
    });

    expect(checkoutStartEvent({ plan: 'premium' }).eventData.variant).toBeUndefined();

    const logged = [];
    setFunnelSinkForTests((event) => logged.push(event));
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'person@example.com',
    });
    const rawRequest = jest.fn(async () => audSession('cs_variant'));
    await createFitMunchCheckoutSession({ rawRequest }, params, { variant: 'home_fold_note:control' });
    expect(rawRequest.mock.calls[0][2]).toBe(params);
    expect(params.metadata.variant).toBeUndefined();
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(logged).toEqual([{
      eventType: 'checkout_start',
      eventData: { step: 'checkout_start', plan: 'premium', variant: 'home_fold_note:control' },
    }]);

    const trial = trialStartedFromCheckoutSession({
      id: 'cs_variant',
      customer: 'cus_123',
      customer_details: { email: 'a@b.co', name: 'Ada Lovelace' },
      metadata: { email: 'a@b.co', plan: 'premium' },
    }, 'webhook');
    expect(trial.eventData).toEqual({
      step: 'trial_started',
      plan: 'premium',
      source: 'webhook',
      variant: 'home_fold_note:control',
    });
    expect(JSON.stringify(trial)).not.toMatch(/a@b\.co|Ada|cus_123/);

    rememberCheckoutVariant('cs_other', 'not an email but bad tag!!!');
    expect(trialStartedFromCheckoutSession({ id: 'cs_other', metadata: { plan: 'premium' } }, 'webhook').eventData.variant)
      .toBeUndefined();
  });

  it('keeps the live homepage copy and leaves social proof empty', () => {
    const home = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    const social = require('./public/js/fm-social-proof');
    expect(home).toContain('<h1>Your body wrote the trolley.</h1>');
    expect(home).toContain('Start the 14-day trial');
    expect(home).toContain('14-day trial, then <span>$19.99 a month</span>');
    expect(home).not.toContain('role="dialog"');
    expect(home).toContain('data-fm-social-proof');
    expect(home).toContain('/js/fm-ab.js');
    expect(home).toContain('/fonts/bricolage-grotesque-latin.woff2');
    expect(home).not.toContain('fonts.googleapis.com');
    expect(social.DEFAULT_ITEMS).toEqual([]);
    expect(social.usableItems([{ quote: 'Nice app', rating: 5, name: 'Sam', count: 1000 }])).toEqual([]);
    expect(social.usableItems([{
      quote: 'PLACEHOLDER: not a real review.',
      source: 'PLACEHOLDER source',
      sourceUrl: 'https://example.com/placeholder',
      placeholder: true,
      name: 'Sam',
    }])).toEqual([{
      quote: 'PLACEHOLDER: not a real review.',
      source: 'PLACEHOLDER source',
      sourceUrl: 'https://example.com/placeholder',
      placeholder: true,
    }]);
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    expect(login).toContain('/js/fm-ab.js');
    const shopper = fs.readFileSync(path.join(__dirname, 'public/shopper.html'), 'utf8');
    expect(shopper).not.toContain('fm-exit');
    expect(shopper).not.toContain('fm-ab.js');
  });
});
