'use strict';

const request = require('supertest');
const app = require('./server.js');
const store = require('./lib/coach-store');
const staples = require('./lib/staple-items');
const shopper = require('./lib/fitness-butler-shopper');
const { sanitizePlan, stripFragments } = require('./lib/sanitize-plan');

const STORES = ['woolworths', 'coles', 'aldi'];
const POISON_BASES = {
  woolworths: 'https://www.woolworths.com.au/shop/browse/specials?searchTerm=',
  coles: 'https://www.coles.com.au/catalogues-and-specials?q=',
  aldi: 'https://www.aldi.com.au/special-buys?q=',
};
const GOOD_BASES = {
  woolworths: 'https://www.woolworths.com.au/shop/search/products?searchTerm=',
  coles: 'https://www.coles.com.au/search?q=',
  aldi: 'https://www.aldi.com.au/en/search/?q=',
};

const CASES = [
  ['Chicken breast $12.50 half price', 'Chicken breast'],
  ['Tuna 2 for $5', 'Tuna'],
  ['Oats save $1.20 on special', 'Oats'],
  ['Eggs 2 for 1', 'Eggs'],
  ['Greek yoghurt 50% off catalogue', 'Greek yoghurt'],
  ['Beef mince was $9 w35', 'Beef mince'],
  ['Bread loaf Aug 25 2026', 'Bread loaf'],
  ['Pasta 99c', 'Pasta'],
  ['Cottage cheese AUD 3.50 save 30c', 'Cottage cheese'],
  ['Frozen berries week 36 deal', 'Frozen berries'],
  ['Spinach buy one get one free', 'Spinach'],
  ['Bananas 1/2 price', 'Bananas'],
  ['Rice 25/08/2026', 'Rice'],
  ['Cucumber (2026-W36)', 'Cucumber'],
  ['Olive oil save 20 percent', 'Olive oil'],
  ['Milk half-price', 'Milk'],
  ['Beans BOGO', 'Beans'],
  ['Tins 3 for 2', 'Tins'],
  ['Coke Down Down', 'Coke'],
  ['Snack wk40', 'Snack'],
  ['Bar (2026-W40)', 'Bar'],
  ['Juice 01/09/2026', 'Juice'],
  ['Yoghurt €4.20', 'Yoghurt'],
  ['Tea £2.50', 'Tea'],
  ['Oats AUD 8', 'Oats'],
  ['Sauce percent-off', 'Sauce'],
  ['Chips special buys', 'Chips'],
  ['Chef specials pie', 'Chef specials pie'],
  ['Special K cereal', 'Special K cereal'],
  ['Special fried rice', 'Special fried rice'],
  ['Specialty cheese', 'Specialty cheese'],
  ['Coles specials', 'Coles specials'],
  ['Chicken 1.5kg', 'Chicken 1.5kg'],
];

const LEAKS = [
  '$12.50',
  'half price',
  'half-price',
  '2 for $5',
  '2 for 1',
  '3 for 2',
  '99c',
  '30c',
  'AUD 3.50',
  'AUD 8',
  '3. 50',
  'week 36',
  'week 35',
  'w36',
  'wk40',
  '2026-W36',
  '2026-W40',
  '25/08/2026',
  '01/09/2026',
  'Aug 25 2026',
  'buy one get one',
  'BOGO',
  'Down Down',
  'percent-off',
  '20 percent',
  'special buys',
  'special-buys',
  'catalogues-and-specials',
  '/specials',
  'au-public-specials',
  'wasPrice',
  'salePrice',
  'specialsUrl',
  'retailerLink',
  '€',
  '£',
  'https: //',
];

function plantedNames() {
  return CASES.map(([raw]) => raw).filter((name) => name !== 'Chicken 1.5kg');
}

function line(name, amount, unit) {
  return {
    sku: 'planted',
    name,
    aisle: 'Pantry',
    packs: 1,
    amount,
    unit,
    searchUrl: 'https://www.coles.com.au/catalogues-and-specials?q=milk',
    wasPrice: 9,
    salePrice: 4,
  };
}

function plantedShopper(storeId) {
  const names = plantedNames();
  return {
    week: {
      id: 'au-public-specials-2026-w36',
      name: names[0],
      days: [{
        day: 'Mon',
        meals: [{
          slot: 'Dinner',
          name: 'Chef specials pie',
          ingredients: [
            { sku: 'special-k', name: 'Special K cereal', amount: 0.15, unit: 'each' },
            { sku: 'pie', name: 'Chef specials pie', amount: 0.2, unit: 'g' },
          ],
        }],
      }],
    },
    priceNote: 'Woolies half-price week 35',
    lines: names.map((name, index) => ({
      ...line(name, index === 0 ? 0.6 : 0.15, 'each'),
      searchUrl: index % 2 === 0 ? POISON_BASES[storeId] : `${GOOD_BASES[storeId]}milk`,
    })),
    recommendation: {
      split: true,
      extraTrips: 2,
      bestSingleStore: storeId,
      bestSingleStoreName: 'Anywhere',
      stores: [storeId],
      storeNames: [storeId],
      reason: 'Shop at the store.',
    },
    checkout: {
      note: 'Bring au-public-specials-2026-w36 catalogue',
      baskets: [{
        store: storeId,
        searchHome: POISON_BASES[storeId],
        lines: [{ name: 'Pasta 99c', searchUrl: POISON_BASES[storeId] }],
        copyText: 'Pasta 99c https://www.aldi.com.au/special-buys',
      }],
    },
    specialsUrl: 'https://www.aldi.com.au/special-buys',
    retailerLink: 'https://www.coles.com.au/catalogues-and-specials',
    tips: 'Woolies half-price week 35',
  };
}

function plantedPlan() {
  const names = plantedNames();
  return {
    updatedAt: '2026-10-03T00:00:00.000Z',
    days: [{
      day: 'Mon',
      kcal: 500,
      meals: [{
        slot: 'Dinner',
        name: 'Chef specials pie',
        kcal: 500,
        protein: 20,
        carbs: 40,
        fat: 10,
        ingredients: names.map((name) => ({ name, amount: 0.2, unit: 'g' })),
      }],
    }],
    shopping: {
      storeName: 'Woolworths',
      storeId: 'woolworths',
      note: 'Checkout au-public-specials-2026-w36',
      lines: names.map((name) => ({
        store: 'Woolworths',
        name,
        aisle: 'Pantry',
        packs: 1,
        amount: 0.2,
        unit: 'g',
        priced: true,
        wasPrice: 9,
        salePrice: 4,
      })),
    },
    specialsUrl: 'https://www.aldi.com.au/special-buys',
    retailerLink: 'https://www.coles.com.au/catalogues-and-specials',
    tips: 'Woolies half-price week 35',
    coachNote: 'Save big: Aldi Special Buys',
    wasPrice: 9,
    salePrice: 4,
    priceAud: 3.5,
    priceCents: 350,
    honesty: { paysWoolworths: false, pricesFrom: 'public_specials_catalogue' },
  };
}

function absent(text) {
  for (const leak of LEAKS) expect(text).not.toContain(leak);
}

describe('planted price and deal text', () => {
  it('strips each deal phrase and keeps real product words', () => {
    for (const [raw, expected] of CASES) {
      expect(stripFragments(raw) || 'Item').toBe(expected);
    }
    expect(stripFragments('See https://www.aldi.com.au/special-buys today')).toBe('See today');
    expect(stripFragments('Cottage cheese AUD 3.50 save 30c')).not.toContain('3. 50');
  });

  it('cleans week, draft and approve payloads for every store', () => {
    for (const storeId of STORES) {
      const clean = shopper.sanitizeShopperPayload(plantedShopper(storeId));
      const blob = JSON.stringify(clean);
      absent(blob);
      expect(blob).toContain('Chef specials pie');
      expect(blob).toContain('Special K cereal');
      expect(blob).toContain('Coles specials');
      expect(clean.priceNote).toBe('Prices vary by store and week.');
      expect(clean.recommendation.split).toBeUndefined();
      expect(clean.recommendation.extraTrips).toBeUndefined();
      expect(clean.recommendation.bestSingleStore).toBeUndefined();
      expect(clean.recommendation.bestSingleStoreName).toBeUndefined();
      expect(clean.recommendation.stores).toEqual([storeId]);
      expect(clean.week.id).toBeUndefined();
      expect(clean.lines.every((row) => row.amount >= 1)).toBe(true);
      expect(clean.lines.some((row) => row.amount === 0)).toBe(false);
      expect(clean.week.days[0].meals[0].ingredients[0].amount).toBe(1);
      expect(clean.week.days[0].meals[0].ingredients[1].amount).toBe(1);
      const urls = JSON.stringify(clean).match(/https?:\/\/[^"\\]+/g) || [];
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.startsWith(GOOD_BASES[storeId]))).toBe(true);
    }
  });

  it('drops poisoned search bases from the live week, draft and approve handlers', () => {
    const saved = {};
    for (const storeId of STORES) {
      saved[storeId] = staples.STORES[storeId].searchBase;
      staples.STORES[storeId].searchBase = POISON_BASES[storeId];
    }
    try {
      for (const storeId of STORES) {
        const draft = shopper.buildDraft({ preferredStore: storeId });
        const approved = shopper.approveDraft({ preferredStore: storeId });
        const blob = JSON.stringify({ draft, approved, week: shopper.getWeekPayload() });
        expect(blob).not.toMatch(/catalogues-and-specials|special-buys|\/specials\b|au-public-specials/i);
        expect(draft.recommendation.split).toBeUndefined();
        expect(draft.recommendation.extraTrips).toBeUndefined();
        expect(draft.recommendation.bestSingleStore).toBeUndefined();
        expect(approved.recommendation.bestSingleStoreName).toBeUndefined();
        expect(draft.lines.every((row) => row.amount !== 0 && row.amount >= 1)).toBe(true);
        expect(draft.lines.find((row) => row.sku === 'bread-loaf').amount).toBe(1);
        expect(draft.lines.find((row) => row.sku === 'cucumber').amount).toBe(2);
        expect(draft.lines.find((row) => row.sku === 'garlic-bulb').amount).toBe(1);
        const urls = blob.match(/https?:\/\/[^"\\]+/g) || [];
        expect(urls.every((url) => !/specials|special-buys|catalogue/i.test(url))).toBe(true);
      }
    } finally {
      for (const storeId of STORES) staples.STORES[storeId].searchBase = saved[storeId];
    }
  });

  it('serves no split fields from the shopper API for any store', async () => {
    const week = await request(app).get('/api/shopper/week').expect(200);
    expect(JSON.stringify(week.body)).not.toMatch(/"split"|"extraTrips"|"bestSingleStore"/);
    for (const storeId of STORES) {
      const draft = await request(app).post('/api/shopper/draft').send({ preferredStore: storeId }).expect(200);
      const approved = await request(app).post('/api/shopper/approve').send({ preferredStore: storeId }).expect(200);
      for (const body of [draft.body, approved.body]) {
        const blob = JSON.stringify(body);
        expect(blob).not.toMatch(/"split"|"extraTrips"|"bestSingleStore"/);
        expect(blob).not.toMatch(/catalogues-and-specials|special-buys|\/specials\b/);
      }
      expect(draft.body.draft.lines.find((row) => row.sku === 'bread-loaf').amount).toBe(1);
      expect(draft.body.priceNote).toBe('Prices vary by store and week.');
    }
  });
});

describe('planted deals on a saved coach plan', () => {
  beforeEach(() => {
    store.resetMemory();
  });

  it('removes planted deals from /c/:token and the PDF and keeps real names', async () => {
    const clean = sanitizePlan(plantedPlan());
    expect(clean.specialsUrl).toBeUndefined();
    expect(clean.retailerLink).toBeUndefined();
    expect(clean.tips).toBeUndefined();
    expect(clean.coachNote).toBeUndefined();
    expect(clean.wasPrice).toBeUndefined();
    expect(clean.salePrice).toBeUndefined();
    expect(clean.priceAud).toBeUndefined();
    expect(clean.priceCents).toBeUndefined();
    expect(clean.shopping.lines.some((row) => row.name === 'Chef specials pie')).toBe(true);
    expect(clean.shopping.lines.some((row) => row.name === 'Special K cereal')).toBe(true);
    expect(clean.shopping.lines.every((row) => row.amount >= 1)).toBe(true);
    absent(JSON.stringify(clean));

    const row = await store.createPlan({
      ptId: store.PREVIEW_PT.id,
      clientId: store.PREVIEW_CLIENT.id,
      clientLabel: 'Planted client',
      plan: plantedPlan(),
      source: 'manual',
    });
    const sent = await store.markStatus(row, 'send');
    const share = await request(app).get(`/c/${sent.token}`).expect(200);
    const pdf = await request(app).get(`/c/${sent.token}/pdf`).expect(200);
    const pdfText = pdf.body.toString('latin1');
    for (const text of [share.text, pdfText]) {
      absent(text);
      expect(text).toContain('Chef specials pie');
      expect(text).toContain('Special K');
      expect(text).toContain('Prices vary by store and week.');
      expect(text).not.toContain('undefined');
    }
  });
});
