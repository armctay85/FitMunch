'use strict';

const fs = require('fs');
const path = require('path');
const {
  accountCreatedEvent,
  expandAnalyticsEvents,
  scheduleFunnelEvent,
  setFunnelSinkForTests,
  resetFunnelEventsForTests,
} = require('./lib/funnel-events');

afterEach(() => resetFunnelEventsForTests());

describe('account_created funnel event', () => {
  it('carries role and clean UTM tags only, never PII', () => {
    const ev = accountCreatedEvent({
      role: 'consumer',
      attribution: {
        utm_source: 'seo',
        utm_campaign: 'coles-budget-meal-plan',
        utm_medium: 'a@b.com',
        utm_content: 'x?token=abc',
        email: 'a@b.com',
      },
    });
    expect(ev.eventType).toBe('account_created');
    expect(ev.eventData).toEqual({
      step: 'account_created',
      role: 'consumer',
      utm_source: 'seo',
      utm_campaign: 'coles-budget-meal-plan',
    });
  });

  it('falls back to consumer for an unknown role', () => {
    expect(accountCreatedEvent({ role: 'admin' }).eventData.role).toBe('consumer');
  });

  it('cannot be forged through the public analytics endpoint', () => {
    const out = expandAnalyticsEvents([{ eventType: 'account_created', eventData: { role: 'pt' } }]);
    expect(out).toEqual([]);
  });

  it('dedupes per user id', () => {
    const seen = [];
    setFunnelSinkForTests((e) => seen.push(e.eventType));
    scheduleFunnelEvent(accountCreatedEvent({ role: 'pt' }), 'account:1');
    scheduleFunnelEvent(accountCreatedEvent({ role: 'pt' }), 'account:1');
    expect(seen).toEqual(['account_created']);
  });

  it('register route schedules it after createUser, inside a guard', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const create = src.indexOf('storage.createUser(normalizedEmail');
    const fire = src.indexOf('funnel.accountCreatedEvent(');
    expect(create).toBeGreaterThan(0);
    expect(fire).toBeGreaterThan(create);
    expect(src.slice(fire, fire + 200)).toContain('`account:${user.id}`');
  });
});

describe('fm-track on app pages', () => {
  for (const file of ['app.html', 'coach-upgrade.html']) {
    it(`${file} loads fm-track.js once`, () => {
      const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
      expect(html.match(/<script src="\/js\/fm-track\.js\?v=[0-9a-f]{12}" defer><\/script>/g)).toHaveLength(1);
    });
  }
});

describe('account_created role tag (PR 75 QA S1)', () => {
  it('register maps a consumer (client without a PT) to consumer, keeps PT-invited clients as client', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(src).toContain("funnel.accountCreatedEvent({ role: role === 'client' && !ptId ? 'consumer' : role, attribution: req.body.attribution })");
  });

  it('account_created sits between trial_cta_click and checkout_start in the funnel', () => {
    const { FUNNEL_STEPS, summarizeFunnel } = require('./lib/funnel-events');
    expect(FUNNEL_STEPS.indexOf('account_created')).toBe(FUNNEL_STEPS.indexOf('trial_cta_click') + 1);
    expect(FUNNEL_STEPS.indexOf('checkout_start')).toBe(FUNNEL_STEPS.indexOf('account_created') + 1);
    expect(typeof summarizeFunnel).toBe('function');
  });
});
