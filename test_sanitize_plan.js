'use strict';

const request = require('supertest');
const app = require('./server.js');
const store = require('./lib/coach-store');
const fs = require('fs');
const path = require('path');
const { sanitizePlan, stripFragments, roundAmount } = require('./lib/sanitize-plan');
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

  it('strips price fragments and keeps real names', () => {
    const names = {
      'Chicken $12 off': 'Chicken',
      'Milk was $9.50': 'Milk',
      'Yoghurt 2 for $5': 'Yoghurt',
      'Bread half price': 'Bread',
      'Oats save 30%': 'Oats',
      'Beef on special': 'Beef',
      'Coles specials': 'Coles',
      'Week catalogue w35': 'Week',
      'Tag au-public-specials': 'Tag',
      'Dated 2026-08-25': 'Dated',
      'Week of 25 Aug': 'Week of',
      'Week of 25 August': 'Week of',
      'Specialty cheese': 'Specialty cheese',
      'Special K': 'Special K',
      'Special fried rice': 'Special fried rice',
      '$12 off': 'Item',
      'was $9.50': 'Item',
      '2 for $5': 'Item',
      'half price': 'Item',
      'save 30%': 'Item',
      '25 Aug': 'Item',
    };
    for (const [raw, expected] of Object.entries(names)) {
      const clean = sanitizePlan({
        days: [{
          day: 'Mon',
          meals: [{ slot: 'Dinner', name: raw, ingredients: [{ name: raw, amount: 1, unit: 'g' }] }],
        }],
        shopping: {
          lines: [{ name: raw, aisle: 'Pantry', packs: 1, amount: 1, unit: 'g', priced: true }],
        },
      });
      expect(clean.shopping.lines[0].name).toBe(expected);
      expect(clean.days[0].meals[0].name).toBe(expected);
      expect(clean.days[0].meals[0].ingredients[0].name).toBe(expected);
      expect(stripFragments(raw) || 'Item').toBe(expected);
    }
  });

  it('drops subtotal, cost and estTotal and keeps a plan-level updatedAt', () => {
    const clean = sanitizePlan({
      updatedAt: '2026-10-03T00:00:00.000Z',
      shopping: {
        updatedAt: '2026-08-25T00:00:00.000Z',
        subtotal: 12,
        cost: 4,
        estTotal: 9,
        was: 8,
        approvedAt: '2026-08-25',
        pricedAt: '2026-08-25',
        validFrom: '2026-08-25',
        validTo: '2026-08-31',
        weekLabel: 'Catalogue week',
        lines: [{
          name: 'Oats',
          aisle: 'Pantry',
          packs: 1,
          amount: 80,
          unit: 'g',
          subtotal: 3,
          cost: 3,
          estTotal: 3,
        }],
      },
    });
    expect(clean.updatedAt).toBe('2026-10-03T00:00:00.000Z');
    expect(clean.shopping.updatedAt).toBeUndefined();
    expect(clean.shopping.subtotal).toBeUndefined();
    expect(clean.shopping.cost).toBeUndefined();
    expect(clean.shopping.estTotal).toBeUndefined();
    expect(clean.shopping.was).toBeUndefined();
    expect(clean.shopping.approvedAt).toBeUndefined();
    expect(clean.shopping.pricedAt).toBeUndefined();
    expect(clean.shopping.validFrom).toBeUndefined();
    expect(clean.shopping.validTo).toBeUndefined();
    expect(clean.shopping.weekLabel).toBeUndefined();
    expect(clean.shopping.lines[0].subtotal).toBeUndefined();
    expect(clean.shopping.lines[0].cost).toBeUndefined();
    expect(clean.shopping.lines[0].estTotal).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('2026-08-25');
  });

  it('rounds grams, millilitres and each', () => {
    expect(roundAmount(1747.495, 'g')).toBe(1750);
    expect(roundAmount(1747.495, 'ml')).toBe(1750);
    expect(roundAmount(80.4, 'g')).toBe(80);
    expect(roundAmount(0.484, 'each')).toBe(1);
    expect(roundAmount(1.2, 'each')).toBe(2);
    const clean = sanitizePlan({
      days: [{
        meals: [{
          ingredients: [
            { name: 'Mince', amount: 1747.495, unit: 'g' },
            { name: 'Lemon', amount: 0.484, unit: 'each' },
          ],
        }],
      }],
      shopping: {
        lines: [
          { name: 'Mince', aisle: 'Meat', packs: 2, amount: 1747.495, unit: 'g' },
          { name: 'Lemon', aisle: 'Produce', packs: 1, amount: 0.484, unit: 'each' },
        ],
      },
    });
    expect(clean.shopping.lines[0].amount).toBe(1750);
    expect(clean.shopping.lines[1].amount).toBe(1);
    expect(clean.days[0].meals[0].ingredients[0].amount).toBe(1750);
    expect(clean.days[0].meals[0].ingredients[1].amount).toBe(1);
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

  it('rounds amounts and never prints undefined', async () => {
    const plan = oldPlan();
    plan.days[0].meals[0].name = 'Special fried rice';
    plan.days[0].meals[0].ingredients = [
      { name: 'Mince', amount: 1747.495, unit: 'g' },
      { name: 'Lemon', amount: 0.484, unit: 'each' },
      { name: 'Special fried rice', amount: 200, unit: 'g' },
      { amount: 40, unit: 'g' },
    ];
    plan.shopping.lines.push(
      { name: 'Mince', aisle: 'Meat', packs: 2, amount: 1747.495, unit: 'g', priced: true, lineAud: 12 },
      { name: 'Lemon', aisle: 'Produce', packs: 1, amount: 0.484, unit: 'each', onSpecial: true },
      { aisle: 'Pantry', packs: 3, amount: null, unit: 'g' },
      { name: 'Specialty cheese', aisle: 'Dairy', packs: 1, amount: 250, unit: 'g' },
      { name: 'Special K', aisle: 'Pantry', packs: 1, amount: 500, unit: 'g' }
    );
    const sent = await publish(plan, 'Old client');
    const share = await request(app).get(`/c/${sent.token}`).expect(200);
    const pdf = await request(app).get(`/c/${sent.token}/pdf`).expect(200);
    const pdfText = pdf.body.toString('latin1');
    for (const text of [share.text, pdfText]) {
      expect(text).toContain('1750 g');
      expect(text).toContain('1 each');
      expect(text).toContain('Special fried rice');
      expect(text).toContain('Specialty cheese');
      expect(text).toContain('Special K');
      expect(text).toContain('3 x Item');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('1747.495');
      expect(text).not.toContain('0.484');
      expect(text).not.toContain('$');
    }
  });

  it('adds noindex on the missing plan page', async () => {
    const missing = await request(app).get('/c/not-a-real-token').expect(404);
    expect(missing.text).toContain('<meta name="robots" content="noindex"/>');
  });

  it('returns no prices, catalogue or old note from the coach API', async () => {
    const session = await request(app).post('/api/coach/preview-session').expect(200);
    const auth = { Authorization: `Bearer ${session.body.token}` };
    const row = await store.createPlan({
      ptId: store.PREVIEW_PT.id,
      clientId: store.PREVIEW_CLIENT.id,
      clientLabel: 'Old client',
      plan: oldPlan(),
      source: 'manual',
    });
    const got = await request(app).get(`/api/coach/plans/${row.id}`).set(auth).expect(200);
    const sent = await request(app).post(`/api/coach/plans/${row.id}/send`).set(auth).expect(200);
    for (const body of [got.body.plan, sent.body.plan]) {
      const json = JSON.stringify(body);
      expect(body.plan.priceNote).toBe(CURRENT_NOTE);
      expect(body.updatedAt).toBeTruthy();
      expect(json).not.toContain('2026-08-25');
      expect(json).not.toContain('w35');
      expect(json).not.toContain('au-public-specials');
      expect(json).not.toContain('onSpecial');
      expect(json).not.toContain('totalAud');
      expect(json).not.toContain('catalogue');
      expect(json).not.toContain('$');
      expect(json).not.toContain(OLD_NOTE);
      expect(json).not.toContain('Estimated from public');
    }
    const stored = await store.getPlan(row.id, row.ptId);
    expect(stored.plan.priceNote).toBe(OLD_NOTE);
    expect(stored.plan.shopping.totalAud).toBe(36.8);
  });
});

describe('coach builder copy', () => {
  it('shows aisle and amount, not a price or a total', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/fm-coach.js'), 'utf8');
    expect(src).not.toContain('No public special');
    expect(src).not.toContain('coach-total');
    expect(src).toContain('Prices vary by store and week.');
    expect(count(src, 'Prices vary by store and week.')).toBe(1);
    expect(src).toContain('line.aisle');
    expect(src).toContain('amountLabel');
  });
});
