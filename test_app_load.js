'use strict';

/**
 * Load test (Wilson, PR 78 crash fix): the app must require cleanly with the
 * frozen PRICE_IDS, and yearly Premium resolves only from the env var.
 */

describe('app load with frozen PRICE_IDS', () => {
  const ENV = 'STRIPE_PRICE_PREMIUM_ANNUAL';
  afterEach(() => {
    delete process.env[ENV];
    jest.resetModules();
  });

  for (const envValue of [undefined, 'price_testAnnual14999']) {
    it(`requires server.js and the checkout modules without throwing (${envValue ? 'env set' : 'env unset'})`, () => {
      if (envValue) process.env[ENV] = envValue;
      jest.isolateModules(() => {
        expect(() => require('./lib/fitmunch-checkout')).not.toThrow();
        expect(() => require('./lib/stripe-webhook')).not.toThrow();
        expect(() => require('./lib/trial-guard')).not.toThrow();
        expect(() => require('./server.js')).not.toThrow();
        const { PRICE_IDS } = require('./lib/fitmunch-checkout');
        expect(Object.isFrozen(PRICE_IDS)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(PRICE_IDS, 'premium-annual')).toBe(false);
      });
    });
  }

  it('premium-annual resolves from the env when set', () => {
    process.env[ENV] = 'price_testAnnual14999';
    jest.isolateModules(() => {
      const c = require('./lib/fitmunch-checkout');
      expect(c.ALLOWED_PLANS.has('premium-annual')).toBe(true);
      expect(c.priceIdForPlan('premium-annual')).toBe('price_testAnnual14999');
      expect(c.planForPriceId('price_testAnnual14999')).toBe('premium-annual');
      expect(c.allFitMunchPriceIds()).toContain('price_testAnnual14999');
    });
  });

  it('premium-annual is null when unset, and /api/quick-checkout returns 400', async () => {
    let app;
    let c;
    jest.isolateModules(() => {
      c = require('./lib/fitmunch-checkout');
      app = require('./server.js');
    });
    expect(c.priceIdForPlan('premium-annual')).toBeNull();
    const request = require('supertest');
    app._private.setStripeForTests({});
    try {
      const res = await request(app).post('/api/quick-checkout').send({ email: 'a@example.com', plan: 'premium-annual' });
      expect(res.status).toBe(400);
    } finally {
      app._private.setStripeForTests(null);
    }
  });
});
