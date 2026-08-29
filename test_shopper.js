'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const butler = require('./lib/fitness-butler');
const specials = require('./lib/public-specials');
const { PRICE_IDS, PREMIUM_PRICE_AUD_CENTS, FITMUNCH_CHECKOUT_BRAND } = require('./lib/fitmunch-checkout');

const INDEX = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const SHOPPER = fs.readFileSync(path.join(__dirname, 'public/shopper.html'), 'utf8');
const CHECKOUT = fs.readFileSync(path.join(__dirname, 'lib/fitmunch-checkout.js'), 'utf8');

const FORBIDDEN_PAGE = [
  /we will never connect Link/i,
  /never connect Link/i,
  /Link-pay/i,
  /paid Wool(?:ies|worths)/i,
  /we (already )?pay Wool/i,
  /HealthKit/i,
  /Apple Watch/i,
  /capture=["']environment["']/,
  /getUserMedia/,
  /photograph your receipt/i,
  /trolley\/cart/i,
  /\/cart\b/,
  /login\.woolworths/i,
];

function commitBody(overrides) {
  return {
    goal: 'cut',
    diet: 'none',
    people: 1,
    days: 7,
    stores: ['woolworths', 'coles', 'aldi'],
    secondTripCost: 18,
    pantry: [],
    ...overrides,
  };
}

describe('Shopper is its own surface', () => {
  it('GET /shopper serves the Fitness Butler page', async () => {
    const res = await request(app).get('/shopper').expect(200);
    expect(res.text).toContain('Commit the week. Approve the trolley.');
    expect(res.text).toContain('id="commit-form"');
    expect(res.text).toContain('Approve this shop');
    expect(res.text).toContain('Draft trolley');
    expect(res.text).toContain('$19.99');
    expect(res.text).toContain('14-day trial');
    expect(res.text).not.toContain('Your body wrote the trolley.');
  });

  it('GET /butler sends people to /shopper', async () => {
    await request(app).get('/butler').expect(302).expect('Location', '/shopper');
  });

  it('does not restyle the shopper as a scanner or wallet', () => {
    expect(SHOPPER).not.toMatch(/wallet/i);
    expect(SHOPPER).not.toMatch(/receipt camera|viewfinder|photograph your receipt/i);
    expect(SHOPPER).toContain('health engine');
    expect(SHOPPER).toContain('A receipt is one input');
  });

  it('does not edit the homepage and does not put never-Link copy there', () => {
    expect(INDEX).not.toContain('Commit the week. Approve the trolley.');
    expect(INDEX).not.toMatch(/we will never connect Link/i);
    expect(INDEX).not.toMatch(/never connect Link/i);
  });
});

describe('Honesty: no false pay, no scrape, no never-Link', () => {
  it('shopper page forbids Link-pay claims, Woolies-paid claims, and never-Link copy', () => {
    for (const re of FORBIDDEN_PAGE) {
      expect(SHOPPER).not.toMatch(re);
    }
  });

  it('public specials URLs are stranger-openable and never cart/login', () => {
    for (const url of specials.allPublicUrls()) {
      expect(specials.isPublicStoreUrl(url)).toBe(true);
      expect(url).not.toMatch(specials.BLOCKED_PATH);
    }
    expect(specials.searchUrl('woolworths', 'chicken breast')).toContain('woolworths.com.au/shop/search');
    expect(specials.searchUrl('coles', 'chicken breast')).toContain('coles.com.au/search');
    expect(specials.searchUrl('aldi', 'chicken breast')).toContain('aldi.com.au');
    expect(specials.isPublicStoreUrl('https://www.woolworths.com.au/shop/cart')).toBe(false);
    expect(specials.isPublicStoreUrl('https://www.coles.com.au/checkout')).toBe(false);
    expect(specials.isPublicStoreUrl('https://www.woolworths.com.au/shop/login')).toBe(false);
  });

  it('cash door is still the existing $19.99 FitMunch trial', () => {
    expect(PRICE_IDS.premium).toBe('price_1ToYrXGMuYRuJYDrwHtvWD1c');
    expect(PREMIUM_PRICE_AUD_CENTS).toBe(1999);
    expect(FITMUNCH_CHECKOUT_BRAND).toBe('FitMunch');
    expect(CHECKOUT).toContain("adaptive_pricing: { enabled: false }");
    expect(CHECKOUT).toContain("price_1ToYrXGMuYRuJYDrwHtvWD1c");
    expect(SHOPPER).toContain('$19.99');
  });
});

describe('Week commit writes a draft trolley', () => {
  it('POST /api/shopper/commit returns a draft with public-specials prices', async () => {
    const res = await request(app).post('/api/shopper/commit').send(commitBody()).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('draft');
    expect(res.body.approvedAt).toBeNull();
    expect(res.body.trolley.items.length).toBeGreaterThan(6);
    expect(res.body.takeaway.tickets.length).toBeGreaterThan(0);
    expect(res.body.honesty.trolleyApi).toBe(false);
    expect(res.body.honesty.spendRaised).toBe(false);
    expect(res.body.honesty.storeCheckout).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/laterPayRail|we will never connect Link|Link-pay/i);

    for (const item of res.body.trolley.items) {
      expect(item.assignedStore).toBeTruthy();
      expect(item.sourceUrl).toBeTruthy();
      expect(specials.isPublicStoreUrl(item.sourceUrl)).toBe(true);
    }
  });

  it('vegetarian week drops meat and fish', () => {
    const meat = butler.commitWeek(commitBody({ diet: 'vegetarian' }));
    const ids = meat.trolley.items.map((i) => i.id);
    expect(ids).not.toContain('chicken-breast-1kg');
    expect(ids).not.toContain('lean-mince-500g');
    expect(ids).not.toContain('tuna-4pk');
    expect(ids).toContain('tofu-300g');
    expect(ids).toContain('chickpeas-400g');
  });

  it('pantry items are omitted from the trolley', () => {
    const full = butler.commitWeek(commitBody());
    const skipped = butler.commitWeek(commitBody({ pantry: ['oats', 'eggs'] }));
    expect(full.trolley.items.some((i) => i.id === 'oats-750g')).toBe(true);
    expect(skipped.trolley.items.some((i) => i.id === 'oats-750g')).toBe(false);
    expect(skipped.trolley.items.some((i) => i.id === 'eggs-12')).toBe(false);
  });
});

describe('Cheapest mix splits only when the save beats a second trip', () => {
  it('stays at one store when the second trip costs more than the save', () => {
    const plan = butler.commitWeek(commitBody({ secondTripCost: 40 }));
    expect(plan.split.shouldSplit).toBe(false);
    expect(plan.split.verdict).toBe('stay');
    expect(plan.split.extraTrips).toBeGreaterThanOrEqual(0);
    expect(plan.takeaway.tickets).toHaveLength(1);
    expect(plan.split.basketSave).toBeLessThanOrEqual(plan.split.secondTripCost);
  });

  it('splits when the trolley save beats a cheap second trip', () => {
    const plan = butler.commitWeek(commitBody({ secondTripCost: 2 }));
    expect(plan.split.shouldSplit).toBe(true);
    expect(plan.split.verdict).toBe('split');
    expect(plan.split.extraTrips).toBeGreaterThan(0);
    expect(plan.split.basketSave).toBeGreaterThan(plan.split.tripCost);
    expect(plan.takeaway.tickets.length).toBeGreaterThan(1);
    expect(plan.split.net).toBeCloseTo(plan.split.basketSave - plan.split.tripCost, 2);
  });

  it('never splits for a $0 save', () => {
    const plan = butler.commitWeek(commitBody({ stores: ['aldi'], secondTripCost: 0 }));
    expect(plan.split.shouldSplit).toBe(false);
    expect(plan.takeaway.tickets).toHaveLength(1);
    expect(plan.takeaway.tickets[0].store).toBe('aldi');
  });
});

describe('One-tap approve does not pay and does not scrape', () => {
  it('POST /api/shopper/approve locks the draft without a spend', async () => {
    const draftRes = await request(app).post('/api/shopper/commit').send(commitBody()).expect(200);
    const res = await request(app).post('/api/shopper/approve').send(draftRes.body).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('approved');
    expect(res.body.approvedAt).toBeTruthy();
    expect(res.body.honesty.spendRaised).toBe(false);
    expect(res.body.honesty.trolleyApi).toBe(false);
    expect(res.body.honesty.storeCheckout).toBe(false);
    expect(res.body.takeaway.kind).toBe('user-finishes-at-store');
    expect(JSON.stringify(res.body)).not.toMatch(/paid Wool|we already pay|Link-pay|never connect Link/i);
  });

  it('approve without a draft fails closed', async () => {
    const res = await request(app).post('/api/shopper/approve').send({}).expect(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/shopper names the draft-and-approve job', async () => {
    const res = await request(app).get('/api/shopper').expect(200);
    expect(res.body.page).toBe('/shopper');
    expect(res.body.job).toMatch(/draft trolley/i);
    expect(res.body.job).toMatch(/approve/i);
    expect(res.body.honesty.trolleyApi).toBe(false);
    expect(res.body.cashDoor.trial).toMatch(/\$19\.99/);
    expect(JSON.stringify(res.body)).not.toMatch(/never connect Link/i);
  });
});
