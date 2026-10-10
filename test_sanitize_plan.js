'use strict';

const request = require('supertest');
const app = require('./server.js');
const store = require('./lib/coach-store');
const fs = require('fs');
const path = require('path');
const { sanitizePlan, stripFragments, roundAmount, lineText, qtyText, needText, groupShopping, ingredientText } = require('./lib/sanitize-plan');
const { buildCoachPdf } = require('./lib/coach-pdf');
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
    'cheap',
    'estimated',
    'Pty Ltd',
    'GST',
    'Grok',
    'OpenClaw',
    'MRR',
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
      'Yoghurt 3 dollars': 'Yoghurt',
      'Yoghurt BOGO': 'Yoghurt',
      'Bread buy one get one': 'Bread',
      'Bread buy one get one free': 'Bread',
      'Week w36': 'Week',
      'Week w40': 'Week',
      'Milk ＄4.50': 'Milk',
      'Milk ﹩3': 'Milk',
      'Week of Aug 25': 'Week of',
      'Week of August 25': 'Week of',
      'Bread half-price': 'Bread',
      'Milk was 9.50': 'Milk',
      'Milk AUD 4.50': 'Milk',
      'Milk $3.00ea': 'Milk',
      '$12 off': 'Item',
      'was $9.50': 'Item',
      '2 for $5': 'Item',
      'half price': 'Item',
      'save 30%': 'Item',
      '25 Aug': 'Item',
      '3 dollars': 'Item',
      'BOGO': 'Item',
      'buy one get one': 'Item',
      'w36': 'Item',
      'w40': 'Item',
      '＄4.50': 'Item',
      '﹩3': 'Item',
      'Aug 25': 'Item',
      'August 25': 'Item',
      'half-price': 'Item',
      'was 9.50': 'Item',
      'AUD 4.50': 'Item',
      '$3.00ea': 'Item',
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

  it('keeps a decimal in a name and does not space a full stop before a digit', () => {
    expect(stripFragments('Light milk 1.5L')).toBe('Light milk 1.5L');
    expect(stripFragments('Light milk 1.5L was 9.50')).toBe('Light milk 1.5L');
    const clean = sanitizePlan({
      shopping: {
        lines: [{ name: 'Light milk 1.5L', aisle: 'Dairy', packs: 1, amount: 1, unit: 'L' }],
      },
    });
    expect(clean.shopping.lines[0].name).toBe('Light milk 1.5L');
  });

  it('drops price, promo and catalogue-week keys', () => {
    const clean = sanitizePlan({
      shopping: {
        wasAud: 9.5,
        priceCents: 950,
        savingAud: 2,
        discount: 1,
        promo: 'BOGO',
        dealEnds: 'Aug 25',
        catalogueWeek: 'w40',
        lines: [{
          name: 'Oats',
          aisle: 'Pantry',
          packs: 1,
          amount: 1,
          unit: 'g',
          wasAud: 1,
          priceCents: 2,
          savingAud: 3,
          discount: 4,
          promo: 'BOGO',
          dealEnds: 'Aug 25',
          catalogueWeek: 'w36',
        }],
      },
    });
    for (const key of ['wasAud', 'priceCents', 'savingAud', 'discount', 'promo', 'dealEnds', 'catalogueWeek']) {
      expect(clean.shopping[key]).toBeUndefined();
      expect(clean.shopping.lines[0][key]).toBeUndefined();
    }
    expect(JSON.stringify(clean)).not.toMatch(/wasAud|priceCents|savingAud|catalogueWeek|BOGO|w40|w36/);
  });

  it('does not round kilograms or litres down to zero', () => {
    expect(roundAmount(1.26, 'kg')).toBe(1.3);
    expect(roundAmount(1.5, 'L')).toBe(1.5);
    expect(roundAmount(0.4, 'kg')).toBe(400);
    expect(roundAmount(0.45, 'L')).toBe(450);
    expect(roundAmount(0.04, 'kg')).toBe(40);
    expect(roundAmount(0.4, 'kg')).not.toBe(0);
    expect(roundAmount(0.45, 'L')).not.toBe(0);
    const clean = sanitizePlan({
      shopping: {
        lines: [
          { name: 'Oats', aisle: 'Pantry', packs: 1, amount: 0.4, unit: 'kg' },
          { name: 'Rice', aisle: 'Pantry', packs: 1, amount: 1.26, unit: 'kg' },
          { name: 'Oil', aisle: 'Pantry', packs: 1, amount: 0.45, unit: 'L' },
          { name: 'Milk', aisle: 'Dairy', packs: 1, amount: 1.5, unit: 'L' },
        ],
      },
    });
    expect(clean.shopping.lines[0]).toMatchObject({ amount: 400, unit: 'g' });
    expect(clean.shopping.lines[1]).toMatchObject({ amount: 1.3, unit: 'kg' });
    expect(clean.shopping.lines[2]).toMatchObject({ amount: 450, unit: 'ml' });
    expect(clean.shopping.lines[3]).toMatchObject({ amount: 1.5, unit: 'L' });
  });

  it('splits a shopping line into a name, a quantity, and an aisle group', () => {
    const line = { packs: 6, name: 'Cottage cheese 250g', aisle: 'Dairy', amount: 1260, unit: 'g' };
    expect(lineText(line)).toBe('6 x Cottage cheese');
    expect(qtyText(line)).toBe('1.26 kg');
    expect(lineText(line)).not.toContain('Dairy');
    expect(groupShopping([
      line,
      { name: 'Bananas 1kg', aisle: 'Produce', packs: 1, amount: 1000, unit: 'g' },
      { name: 'Mystery', aisle: 'Deli', packs: 1, amount: 1, unit: 'each' },
    ]).map((group) => group.label)).toEqual(['Produce', 'Dairy', 'Other']);
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

    expect(share.text).toContain('2 x Chicken breast');
    expect(share.text).not.toContain('Chicken breast 1kg');
    expect(share.text).toContain('need 1 kg');
    expect(share.text).toContain('1 kg');
    expect(share.text).toContain('Meat <span class="count">');
    expect(share.text).not.toContain('Chicken breast 1kg Meat');
    expect(share.text).not.toContain('1000');
    expect(share.text).toContain('grid-template-columns: 1fr 1fr');
    expect(share.text).toContain('overflow-x: hidden');
    expect(share.text).toContain('/css/fm-coach-fonts.css');
    expect(share.text).toContain('/css/fm-tokens.css');
    expect(share.text).toContain('href="/favicon.ico"');
    expect(share.text).toContain('href="/assets/logo.svg"');
    expect(share.text).toContain('<meta name="robots" content="noindex"/>');
    expect(share.text).toContain('Old client');
    expect(share.text).toContain('id="share-summary"');
    expect(share.text).toContain('role="tablist"');
    expect(share.text).toContain('minmax(0, 3fr) minmax(0, 2fr)');
    expect(share.text).toContain('position: sticky');
    expect(share.text).toContain('@media (min-width: 1024px)');
    expect(share.text).toContain('@media print');
    expect(share.text).toContain('localStorage');
    expect(share.text).toContain('type="checkbox"');
    expect(share.text).toContain('white-space: nowrap');
    expect(share.text).toContain('var(--accent)');
    expect(share.text).toContain('2000 kcal');
    forbidden(share.text);

    expect(pdfText.slice(0, 5)).toBe('%PDF-');
    expect(pdfText).toContain('2 x Chicken breast');
    expect(pdfText).not.toContain('Chicken breast 1kg');
    expect(pdfText).toContain('1 kg');
    expect(pdfText).toContain('Page 1 of');
    expect(pdfText).toContain('Meat');
    expect(pdfText).not.toContain('1000');
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

    expect(share.text).toContain('>120 g</span>');
    expect(share.text).toContain('ing-name">Brown rice');
    expect(share.text).not.toContain('Brown rice 1kg');
    expect(share.text).toContain('1 x Brown rice');
    expect(share.text).toContain('Pantry <span class="count">');
    expect(share.text).not.toContain('Pantry 1.5 kg');
    for (const text of [share.text, pdfText]) {
      expect(text).toContain('Brown rice');
      expect(text).toContain('Pantry');
      expect(text).toContain('1.5 kg');
      expect(text).not.toContain('1500');
      expect(text).not.toContain('Brown rice 1kg');
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
    expect(share.text).toContain('1.75 kg');
    expect(share.text).not.toContain('1750 g');
    expect(pdfText).toContain('1.75 kg');
    expect(pdfText).not.toContain('1750 g');
    expect(share.text).toContain('ing-name">Lemon');
    expect(share.text).not.toContain('1 each');
    expect(pdfText).toContain('1 Lemon');
    expect(pdfText).not.toContain('1 each');
    for (const text of [share.text, pdfText]) {
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
    expect(src).toContain('FmPlanList');
    expect(src).toContain('groupShopping');
    expect(src).toContain('needText');
    expect(src).not.toMatch(/function roundAmount/);
    const html = fs.readFileSync(path.join(__dirname, 'public/coach.html'), 'utf8');
    expect(html).toContain('/js/fm-plan-list.js');
    expect(html).toContain('/css/fm-coach-fonts.css');
  });
});

describe('sanitizer evasions from the QA sheet', () => {
  const leaks = [
    ['Milk $3', 'Milk'],
    ['Milk 3$', 'Milk'],
    ['Milk A$3', 'Milk'],
    ['Bananas 3.50ea', 'Bananas'],
    ['Yoghurt 2 for $5', 'Yoghurt'],
    ['Yoghurt 2 for 5', 'Yoghurt'],
    ['Chicken 50% off', 'Chicken'],
    ['Chicken 1/2 price', 'Chicken'],
    ['Rice Save 3', 'Rice'],
    ['Oats from 4.00', 'Oats'],
    ['Oats now 3.00', 'Oats'],
    ['Beef mince $12/kg', 'Beef mince'],
    ['Beef mince 1200c/kg', 'Beef mince'],
    ['Cheese $1.20/100g', 'Cheese'],
    ['Cheese 1.20/100g', 'Cheese'],
    ['Tuna Woolworths special', 'Tuna Woolworths'],
    ['Tuna Coles catalogue wk40', 'Tuna Coles'],
    ['Eggs valid until 08/10', 'Eggs'],
    ['Eggs ends 8 Oct', 'Eggs'],
    ['Eggs until Wed 8th', 'Eggs'],
    ['Pasta Rollback', 'Pasta'],
    ['Pasta Prices Dropped', 'Pasta'],
    ['Pasta Down Down', 'Pasta'],
    ['Pasta Everyday low price', 'Pasta'],
    ['Pasta member price', 'Pasta'],
    ['Pasta Rewards bonus points', 'Pasta'],
    ['Salmon 💲9', 'Salmon'],
    ['Salmon spec\u200bial', 'Salmon'],
    ['Salmon &#36;9', 'Salmon'],
    ['Salmon 350c', 'Salmon'],
    ['Salmon 50 cents', 'Salmon'],
    ['Bread $ 3.50', 'Bread'],
    ['Bread 3.5 bucks', 'Bread'],
    ['Bread AU$4', 'Bread'],
    ['Bread USD 4.50', 'Bread'],
    ['Bread 4,50 €', 'Bread'],
    ['Bread RRP 5.00', 'Bread'],
    ['Bread clearance', 'Bread'],
    ['Bread price drop', 'Bread'],
    ['Bread Wk 40', 'Bread'],
    ['Bread week 40', 'Bread'],
    ['Bread 08/10/2026', 'Bread'],
    ['Bread 8.10.26', 'Bread'],
    ['Bread Oct 8-14', 'Bread'],
    ['Bread SPECIALS', 'Bread'],
    ['Bread Speci4l', 'Bread'],
    ['Bread $3\uFF0E50', 'Bread'],
    ['Bread \uFF04\uFF13', 'Bread'],
    ['Bread was \uFF19.50', 'Bread'],
    ['Bread Was: $9.50', 'Bread'],
    ['Bread two for five dollars', 'Bread'],
    ['Bread 3 dollar', 'Bread'],
    ['Bread 30% cheaper', 'Bread'],
    ['Bread cheapest', 'Bread'],
    ['Bread 1/2 Price', 'Bread'],
    ['Bread Half Price!', 'Bread'],
  ];

  const keeps = [
    'Special K',
    'Half and half cream',
    'Dollar sweets',
    '1.5L milk',
    '500g mince',
    '2 x 250g cottage cheese',
    'V8 juice',
    '7 Up',
    'Mayonnaise',
    'Mars bars 4 pack',
    'Weet-Bix',
    'Wasabi peas',
    'Sweet chilli sauce',
    'Coles brand oats',
    '100% juice',
    'Free range eggs',
    'Save-a-lot',
    'Chicken thigh 1kg',
    'June plums',
    '3 May potatoes',
    'W1 flour',
    'Kellogg\u2019s Special K',
    'Dates (Medjool) 250g',
    'Bacon 2 for 1 pack',
  ];

  function placed(raw) {
    return sanitizePlan({
      days: [{
        meals: [{ name: raw, ingredients: [{ name: raw, amount: 1, unit: 'g' }] }],
      }],
      shopping: { lines: [{ name: raw, aisle: 'Pantry', packs: 1, amount: 1, unit: 'g' }] },
    });
  }

  it.each(leaks)('strips %s from the line, the meal and the ingredient', (raw, expected) => {
    const clean = placed(raw);
    expect(clean.shopping.lines[0].name).toBe(expected);
    expect(clean.days[0].meals[0].name).toBe(expected);
    expect(clean.days[0].meals[0].ingredients[0].name).toBe(expected);
    expect(stripFragments(raw) || 'Item').toBe(expected);
  });

  it.each(keeps)('keeps %s', (raw) => {
    const clean = placed(raw);
    expect(clean.shopping.lines[0].name).toBe(raw);
    expect(clean.days[0].meals[0].name).toBe(raw);
    expect(clean.days[0].meals[0].ingredients[0].name).toBe(raw);
    expect(stripFragments(raw)).toBe(raw);
  });

  it('keeps a rewards bar and tidies the dash', () => {
    const raw = 'Rewards bars? no \u2014 Cadbury Dream';
    const expected = 'Rewards bars? no Cadbury Dream';
    const clean = placed(raw);
    expect(clean.shopping.lines[0].name).toBe(expected);
    expect(clean.days[0].meals[0].name).toBe(expected);
    expect(clean.days[0].meals[0].ingredients[0].name).toBe(expected);
  });
});

describe('price keys, amounts, and list formatting', () => {
  it('drops price keys by pattern, including on meals', () => {
    const token = 'keep-this-token-xyz';
    const clean = sanitizePlan({
      price_cents: 1,
      wasPrice: 2,
      Price: 3,
      PRICE: 4,
      priceAud: 5,
      price_aud: 6,
      specialPrice: 7,
      memberPrice: 8,
      dealPrice: 9,
      rrp: 10,
      discountPct: 11,
      savingsPct: 12,
      totalPrice: 13,
      grandTotal: 14,
      catalogueId: 'cat',
      cataloguePage: 2,
      salePrice: 15,
      promo: token,
      days: [{
        meals: [{
          name: 'Oats',
          price_cents: 50,
          promo: token,
          ingredients: [{ name: 'Oats', amount: 1, unit: 'g', price_cents: 9, salePrice: 1 }],
        }],
      }],
    });
    const json = JSON.stringify(clean);
    for (const key of [
      'price_cents', 'wasPrice', 'salePrice', 'rrp', 'totalPrice', 'grandTotal',
      'catalogueId', 'cataloguePage', 'discountPct', 'savingsPct', 'promo',
    ]) {
      expect(json).not.toContain(key);
    }
    expect(json).not.toContain(token);
    expect(clean.priceNote).toBe(CURRENT_NOTE);
    expect(clean.days[0].meals[0].name).toBe('Oats');
  });

  it('returns at least 1 of the display unit and drops negatives', () => {
    expect(roundAmount(0.4, 'g')).toBe(1);
    expect(roundAmount(0.4, 'ml')).toBe(1);
    expect(roundAmount(0.2, 'tbsp')).toBe(1);
    expect(roundAmount(0.01, 'tsp')).toBe(1);
    expect(roundAmount(0.3, '')).toBe(1);
    expect(roundAmount(0.3)).toBe(1);
    expect(roundAmount(-1, 'g')).toBeNull();
    expect(roundAmount(0, 'g')).toBeNull();
    expect(roundAmount(0.0004, 'kg')).toBe(1);
    expect(roundAmount(0.0004, 'L')).toBe(1);
    expect(roundAmount(0.0004, 'kg')).not.toBe(0);
    const clean = sanitizePlan({
      shopping: {
        lines: [
          { name: 'Oats', aisle: 'Pantry', packs: 1, amount: 0.4, unit: 'g' },
          { name: 'Oil', aisle: 'Pantry', packs: 1, amount: -1, unit: 'ml' },
          { name: 'Salt', aisle: 'Pantry', packs: 1, amount: 0.0004, unit: 'kg' },
        ],
      },
    });
    expect(clean.shopping.lines[0]).toMatchObject({ amount: 1, unit: 'g' });
    expect(clean.shopping.lines[1].amount).toBeUndefined();
    expect(clean.shopping.lines[2]).toMatchObject({ amount: 1, unit: 'g' });
    expect(qtyText(clean.shopping.lines[0])).toBe('1 g');
    expect(qtyText({ amount: -1, unit: 'g' })).toBe('');
  });

  it('does not copy the food name into an empty unit', () => {
    const clean = sanitizePlan({
      days: [{
        meals: [{
          name: 'Rice',
          ingredients: [{ name: 'Rice', amount: 0.3, unit: '' }],
        }],
      }],
      shopping: {
        lines: [{ name: 'Rice', aisle: 'Pantry', packs: 1, amount: 0.3, unit: '' }],
      },
    });
    expect(clean.shopping.lines[0].unit).toBe('');
    expect(clean.shopping.lines[0].amount).toBe(1);
    expect(clean.days[0].meals[0].ingredients[0]).toMatchObject({ amount: 1, unit: '' });
    expect(ingredientText({ name: 'Rice', amount: 0.3, unit: '' })).toBe('1 Rice');
    expect(ingredientText({ name: 'Rice', amount: 0.3, unit: '' })).not.toContain('Rice Rice');
    expect(lineText(clean.shopping.lines[0])).toBe('1 x Rice');
  });

  it('keeps aisle groups in shop order', () => {
    expect(groupShopping([
      { name: 'Peas', aisle: 'Frozen' },
      { name: 'Bread', aisle: 'Bakery' },
      { name: 'Milk', aisle: 'Dairy' },
      { name: 'Beef', aisle: 'Meat' },
      { name: 'Rice', aisle: 'Pantry' },
      { name: 'Apple', aisle: 'Produce' },
      { name: 'Soap', aisle: 'Deli' },
    ]).map((group) => group.label)).toEqual([
      'Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other',
    ]);
  });

  it('strips pack size and each from displayed names and labels the need', () => {
    expect(ingredientText({ name: 'Greek yoghurt 1kg', amount: 223, unit: 'g' })).toBe('223 g Greek yoghurt');
    expect(ingredientText({ name: 'Tomatoes punnet', amount: 99, unit: 'g' })).toBe('99 g Tomatoes');
    expect(ingredientText({ name: 'Broccoli 2 pack', amount: 124, unit: 'g' })).toBe('124 g Broccoli');
    expect(ingredientText({ name: 'Cottage cheese 250g', amount: 155, unit: 'g' })).toBe('155 g Cottage cheese');
    expect(ingredientText({ name: 'Cucumber each', amount: 1, unit: 'each' })).toBe('1 Cucumber');
    expect(lineText({ packs: 5, name: 'Cucumber each' })).toBe('5 x Cucumber');
    expect(needText({ amount: 489, unit: 'ml' })).toBe('need 489 ml');
    expect(needText({ amount: 1.5, unit: 'L' })).toBe('need 1.5 L');
    expect(needText({ amount: 1160, unit: 'g' })).toBe('need 1.16 kg');
    expect(qtyText({ amount: 1.5, unit: 'L' })).toBe('1.5 L');
  });

  it('keeps the draft-list title and aisle heading with the first items', () => {
    const days = [];
    for (let d = 0; d < 7; d += 1) {
      days.push({
        day: `Day ${d + 1}`,
        kcal: 2000,
        meals: [0, 1, 2, 3].map((i) => ({
          slot: 'Meal',
          name: `Bowl ${i}`,
          kcal: 500,
          protein: 30,
          carbs: 40,
          fat: 18,
          ingredients: [
            { name: 'Rolled oats', amount: 40, unit: 'g' },
            { name: 'Milk', amount: 100, unit: 'ml' },
          ],
        })),
      });
    }
    const lines = [];
    for (const aisle of ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen']) {
      for (let i = 0; i < 6; i += 1) {
        lines.push({ name: `${aisle} item ${i}`, aisle, packs: 1, amount: 120 + i, unit: 'g' });
      }
    }
    const pdf = buildCoachPdf({
      branding: { practiceName: 'Northside training', accent: '#14532d' },
      clientLabel: 'Sample',
      plan: {
        days,
        targets: { kcal: 2000, protein: 140, carbs: 180, fat: 60 },
        householdSize: 1,
        shopping: { storeName: 'Woolworths', lines },
      },
    }).toString('latin1');
    const titleAt = pdf.indexOf('Woolworths draft list');
    const produceAt = pdf.indexOf('(Produce) Tj');
    expect(titleAt).toBeGreaterThan(0);
    expect(produceAt).toBeGreaterThan(titleAt);
    expect(pdf.slice(titleAt, produceAt)).not.toMatch(/Page \d+ of/);
    expect(pdf).toContain('30 g protein');
    expect(pdf).toContain('40 g Rolled oats');
    expect(pdf).toContain('Page 1 of');
    const meatAt = pdf.indexOf('(Meat) Tj');
    const dairyAt = pdf.indexOf('(Dairy) Tj');
    expect(meatAt).toBeGreaterThan(produceAt);
    expect(dairyAt).toBeGreaterThan(meatAt);
  });
});
