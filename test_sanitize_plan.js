'use strict';

const request = require('supertest');
const app = require('./server.js');
const store = require('./lib/coach-store');
const { sanitizePlan } = require('./lib/sanitize-plan');
const { CATALOGUE, priceEstimateNote } = require('./lib/public-specials-catalogue');

const CURRENT_NOTE = 'Prices vary by store and week.';
const OLD_NOTE = priceEstimateNote(CATALOGUE);

function count(text, needle) {
  return text.split(needle).length - 1;
}

function oldPlan() {
  return {
    days: [
      {
        day: 'Mon',
        kcal: 1800,
        meals: [
          {
            slot: 'Breakfast',
            name: 'Oats',
            kcal: 450,
            protein: 20,
            carbs: 60,
            fat: 10,
            ingredients: [{ name: 'Rolled oats', amount: 80, unit: 'g' }],
          },
        ],
      },
    ],
    targets: { kcal: 2000, protein: 140, carbs: 180, fat: 60 },
    householdSize: 1,
    storeId: 'coles',
    shopping: {
      storeId: 'coles',
      storeName: 'Coles',
      lines: [
        {
          store: 'Coles',
          sku: 'chicken-breast-1kg',
          name: 'Chicken breast 1kg',
          aisle: 'Meat',
          packs: 2,
          amount: 1000,
          unit: 'g',
          priced: true,
          onSpecial: true,
          assignedOnSpecial: true,
          price: 18.4,
          unitPrice: 18.4,
          linePrice: 36.8,
          lineAud: 36.8,
          unitAud: 18.4,
          saving: 4,
          savings: 4,
        },
      ],
      total: 36.8,
      totals: { aud: 36.8 },
      totalAud: 36.8,
      totalCents: 3680,
      unpricedCount: 3,
      unpriced: 3,
      note: OLD_NOTE,
    },
    catalogue: {
      id: CATALOGUE.id,
      weekLabel: CATALOGUE.weekLabel,
      sourceKind: 'public_specials_catalogue',
      catalogueUrl: 'https://www.coles.com.au/on-special',
      pricesFrom: 'public_specials_catalogue',
    },
    sources: [CATALOGUE.id],
    priceNote: OLD_NOTE,
    honesty: {
      paysColes: false,
      pricesFrom: 'public_specials_catalogue',
      sourceKind: 'public_specials_catalogue',
    },
  };
}

function freshPlan() {
  return {
    days: [
      {
        day: 'Tue',
        kcal: 1900,
        meals: [
          {
            slot: 'Lunch',
            name: 'Rice bowl',
            kcal: 600,
            protein: 40,
            carbs: 70,
            fat: 15,
            ingredients: [{ name: 'Brown rice 1kg', amount: 120, unit: 'g' }],
          },
        ],
      },
    ],
    targets: { kcal: 1900, protein: 150, carbs: 190, fat: 55 },
    householdSize: 2,
    storeId: 'woolworths',
    shopping: {
      storeId: 'woolworths',
      storeName: 'Woolworths',
      lines: [
        {
          store: 'Woolworths',
          name: 'Brown rice 1kg',
          aisle: 'Pantry',
          packs: 1,
          amount: 1500,
          unit: 'g',
        },
      ],
    },
    priceNote: CURRENT_NOTE,
  };
}

function forbidden(text) {
  for (const needle of [
    '2026-08-25',
    '2026-08-31',
    'w35',
    'au-public-specials',
    'onSpecial',
    'Estimated from public catalogue',
    'catalogue',
    'special',
    'unpriced',
    '$',
    '36.80',
    '18.40',
  ]) {
    expect(text).not.toContain(needle);
  }
  expect(count(text, CURRENT_NOTE)).toBe(1);
}

async function publish(plan, clientLabel) {
  const row = await store.createPlan({
    ptId: store.PREVIEW_PT.id,
    clientId: store.PREVIEW_CLIENT.id,
    clientLabel,
    plan,
    source: 'manual',
  });
  return store.markStatus(row, 'send');
}

describe('sanitizePlan', () => {
  it('clones an old saved plan and strips catalogue prices and notes', () => {
    const stored = oldPlan();
    const clean = sanitizePlan(stored);

    expect(stored.priceNote).toBe(OLD_NOTE);
    expect(stored.shopping.lines[0].onSpecial).toBe(true);
    expect(stored.shopping.lines[0].lineAud).toBe(36.8);
    expect(stored.shopping.totalAud).toBe(36.8);
    expect(stored.catalogue.id).toContain('w35');

    expect(clean).not.toBe(stored);
    expect(clean.priceNote).toBe(CURRENT_NOTE);
    expect(clean.shopping.lines).toEqual([
      {
        store: 'Coles',
        name: 'Chicken breast 1kg',
        aisle: 'Meat',
        packs: 2,
        amount: 1000,
        unit: 'g',
      },
    ]);
    expect(clean.catalogue).toBeUndefined();
    expect(clean.sources).toBeUndefined();
    expect(clean.shopping.note).toBeUndefined();
    expect(clean.shopping.total).toBeUndefined();
    expect(clean.shopping.totals).toBeUndefined();
    expect(clean.shopping.totalAud).toBeUndefined();
    expect(clean.shopping.unpricedCount).toBeUndefined();
    expect(clean.honesty.pricesFrom).toBeUndefined();
    expect(clean.honesty.sourceKind).toBeUndefined();
    expect(clean.honesty.paysColes).toBe(false);
    expect(JSON.stringify(clean)).not.toMatch(/w35|au-public-specials|catalogue|special|onSpecial|\$/i);
  });

  it('leaves a new-style list item unchanged', () => {
    const stored = freshPlan();
    const clean = sanitizePlan(stored);
    expect(clean.shopping.lines).toEqual(stored.shopping.lines);
    expect(clean.days[0].meals[0].ingredients).toEqual(stored.days[0].meals[0].ingredients);
    expect(clean.priceNote).toBe(CURRENT_NOTE);
  });
});

describe('saved coach plans on the share page and PDF', () => {
  beforeEach(() => {
    store.resetMemory();
  });

  it('renders an old saved plan without catalogue prices and with the current price note once', async () => {
    const sent = await publish(oldPlan(), 'Old client');
    const share = await request(app).get(`/c/${sent.token}`).expect(200);
    const pdf = await request(app).get(`/c/${sent.token}/pdf`).expect(200);
    const pdfText = pdf.body.toString('latin1');

    expect(share.text).toContain('Chicken breast 1kg');
    expect(share.text).toContain('Meat');
    expect(share.text).toContain('1000');
    expect(share.text).toContain('Old client');
    forbidden(share.text);

    expect(pdfText.slice(0, 5)).toBe('%PDF-');
    expect(pdfText).toContain('Chicken breast 1kg');
    expect(pdfText).toContain('Meat');
    expect(pdfText).toContain('1000');
    forbidden(pdfText);

    const stored = await store.getPlan(sent.id, sent.ptId);
    expect(stored.plan.priceNote).toBe(OLD_NOTE);
    expect(stored.plan.shopping.totalAud).toBe(36.8);
    expect(stored.plan.catalogue.id).toBe(CATALOGUE.id);
  });

  it('renders a new-style plan with the same items, aisles and amounts', async () => {
    const sent = await publish(freshPlan(), 'New client');
    const share = await request(app).get(`/c/${sent.token}`).expect(200);
    const pdf = await request(app).get(`/c/${sent.token}/pdf`).expect(200);
    const pdfText = pdf.body.toString('latin1');

    expect(share.text).toContain('120 g Brown rice 1kg');
    for (const text of [share.text, pdfText]) {
      expect(text).toContain('Brown rice 1kg');
      expect(text).toContain('Pantry');
      expect(text).toContain('1500');
      expect(count(text, CURRENT_NOTE)).toBe(1);
      expect(text).not.toContain('$');
    }
  });
});
