'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const coach = require('./lib/coach-plan');
const { CATALOGUE } = require('./lib/public-specials-catalogue');
const store = require('./lib/coach-store');

const PRICE_OR_DATE = /\$\s?\d|A\$\s?\d|totalAud|lineAud|on special|catalogue specials|validFrom|validTo|pricedAt|2026-08-\d{2}|\d{1,2}\s*[–-]\s*\d{1,2}\s+Aug|Aug\s+2026|public specials|Woolworths estimate|save \$|savings/i;

function pdfDrawnText(buf) {
  const raw = buf.toString('latin1');
  const parts = [];
  const re = /\((?:\\[()\\]|[^\\)])*\)\s*Tj/g;
  let match;
  while ((match = re.exec(raw))) {
    const inner = match[0].replace(/\)\s*Tj$/, '').slice(1);
    parts.push(inner.replace(/\\([()\\])/g, '$1'));
  }
  return parts.join('\n');
}
const { encodeRgbPng } = require('./lib/coach-png');
const { decodePng } = require('./lib/coach-png');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

function skuSet(plan) {
  const skus = new Set();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) skus.add(ing.sku);
    }
  }
  return skus;
}

describe('Coach plan builder', () => {
  const base = { kcal: 2000, protein: 140, carbs: 180, fat: 60, householdSize: 1, storeId: 'woolworths', flags: [] };

  it('builds a 7-day plan with a store split and no supermarket prices', () => {
    const plan = coach.buildCoachPlan(base);
    expect(plan.dayCount).toBe(7);
    expect(plan.days.map((day) => day.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(skuSet(plan).has('chicken-breast-1kg')).toBe(true);
    for (const day of plan.days) {
      expect(day.kcal).toBeGreaterThan(1400);
      expect(day.kcal).toBeLessThan(2600);
      expect(day.meals.length).toBeGreaterThan(2);
    }
    expect(plan.shopping.storeName).toBe('Woolworths');
    expect(plan.shopping.lines.length).toBeGreaterThan(5);
    expect(plan.shopping.lines.every((line) => line.aisle && line.packLabel && line.storeName)).toBe(true);
    expect(plan.shopping.lines.some((line) => /^\d+g protein$/.test(line.proteinLabel))).toBe(true);
    expect(plan.shopping.lines.some((line) => /\+\d+g protein$/.test(line.swapLabel))).toBe(true);
    expect(plan.shopping.note).toBe('Check prices at checkout.');
    expect(plan.priceNote).toBe('Check prices at checkout.');
    expect(plan.shopping.splitLabel).toMatch(/All at|Split across/);
    expect(JSON.stringify(plan.shopping)).not.toMatch(PRICE_OR_DATE);
    expect(coach.nutritionFacts('chicken-thigh-1kg').proteinLabel).toBe('47g protein');
    expect(coach.nutritionFacts('chicken-thigh-1kg').swapLabel).toBe('Breast +9g protein');
    expect(coach.nutritionFacts('chicken-breast-1kg').swapLabel).toBe('');
    expect(coach.nutritionFacts('chicken-thigh-1kg', ['vegetarian']).swapLabel).toBe('');
    const dinners = plan.days.map((day) => day.meals.find((meal) => meal.slot === 'Dinner').name);
    expect(new Set(dinners).size).toBeGreaterThanOrEqual(5);
    for (const slot of ['Breakfast', 'Lunch', 'Dinner']) {
      const counts = {};
      for (const day of plan.days) {
        const name = day.meals.find((meal) => meal.slot === slot).name;
        counts[name] = (counts[name] || 0) + 1;
      }
      expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
    }
    for (const day of plan.days) {
      expect(Math.abs(day.kcal - plan.targets.kcal) / plan.targets.kcal).toBeLessThanOrEqual(0.05);
      expect(Math.abs(day.protein - plan.targets.protein) / plan.targets.protein).toBeLessThanOrEqual(0.05);
      expect(Math.abs(day.carbs - plan.targets.carbs) / plan.targets.carbs).toBeLessThanOrEqual(0.05);
      expect(Math.abs(day.fat - plan.targets.fat) / plan.targets.fat).toBeLessThanOrEqual(0.05);
      for (const meal of day.meals) {
        for (const ing of meal.ingredients) {
          expect(ing.qty).not.toMatch(/\d+\.\d+/);
        }
      }
    }
    expect(coach.formatQty({ sku: 'eggs-12', amount: 2.627, unit: 'each', name: 'Free range eggs 12 pack' })).toBe('3 eggs');
    expect(coach.formatQty({ sku: 'bread-loaf', amount: 0.197, unit: 'each', name: 'Wholegrain loaf' })).toBe('3 slices');
    expect(coach.formatQty({ sku: 'greek-yoghurt-1kg', amount: 201.142, unit: 'g', name: 'Greek yoghurt 1kg' })).toBe('200 g Greek yoghurt');
    expect(plan.shopping.lines.every((line) => line.packLabel && !/\d+\.\d+/.test(line.packLabel.split(':')[1] || line.packLabel))).toBe(true);
    expect(plan.dietitianLine).toBe('See a dietitian for medical nutrition.');
    expect(plan.honesty.trolleyApi).toBe(false);
    expect(plan.honesty.ordersPlaced).toBe(false);
    expect(plan.honesty.pricesFrom).toBe('none');
  });

  it('keeps 1600, 2000 and 2600 days inside trainer bands', () => {
    const cases = [
      { kcal: 1600, protein: 112, carbs: 144, fat: 48 },
      { kcal: 2000, protein: 140, carbs: 180, fat: 60 },
      { kcal: 2600, protein: 182, carbs: 234, fat: 78 },
    ];
    for (const targets of cases) {
      const plan = coach.buildCoachPlan({ ...base, ...targets });
      for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
        expect(Math.abs(plan.days[0][key] - targets[key]) / targets[key]).toBeLessThanOrEqual(0.05);
      }
      for (const day of plan.days) {
        expect(Math.abs(day.kcal - targets.kcal) / targets.kcal).toBeLessThanOrEqual(0.05);
        expect(Math.abs(day.protein - targets.protein) / targets.protein).toBeLessThanOrEqual(0.05);
        expect(Math.abs(day.carbs - targets.carbs) / targets.carbs).toBeLessThanOrEqual(0.05);
        expect(Math.abs(day.fat - targets.fat) / targets.fat).toBeLessThanOrEqual(0.05);
        for (const meal of day.meals) {
          const [lo, hi] = coach.mealBand(meal.slot, targets.kcal);
          const raw = coach.sumIngredientMacros(meal.ingredients);
          expect(meal.kcal).toBe(Math.round(raw.kcal));
          expect(meal.protein).toBe(Math.round(raw.protein));
          expect(meal.carbs).toBe(Math.round(raw.carbs));
          expect(meal.fat).toBe(Math.round(raw.fat));
          expect(meal.kcal).toBeGreaterThan(0);
          expect(meal.kcal).toBeLessThanOrEqual(900);
          expect(meal.kcal).toBeGreaterThanOrEqual(lo);
          expect(meal.kcal).toBeLessThanOrEqual(hi);
          if (meal.slot !== 'Snack') expect(meal.protein).toBeGreaterThanOrEqual(25);
          for (const ing of meal.ingredients) {
            expect(ing.amount).toBeGreaterThan(0);
            if (ing.sku === 'brown-rice-1kg' || ing.sku === 'pasta-500g') {
              expect(ing.amount).toBeGreaterThanOrEqual(30);
              expect(ing.amount).toBeLessThanOrEqual(130);
            }
            if (ing.sku === 'chicken-breast-1kg' || ing.sku === 'beef-mince-500g') {
              expect(ing.amount).toBeGreaterThanOrEqual(70);
              expect(ing.amount).toBeLessThanOrEqual(220);
            }
            if (ing.sku === 'olive-oil-500ml') expect(ing.amount).toBeLessThanOrEqual(20);
            if (ing.sku === 'bananas-1kg') expect(ing.amount).toBeLessThanOrEqual(180);
          }
        }
      }
    }
  });

  it('drops animal foods for a vegan plan and scales the household list', () => {
    const vegan = coach.buildCoachPlan({ ...base, flags: ['vegan', 'nut-free'] });
    const skus = skuSet(vegan);
    for (const blocked of ['chicken-breast-1kg', 'eggs-12', 'greek-yoghurt-1kg', 'tuna-4pk', 'salmon-400g', 'beef-mince-500g', 'peanut-butter-375g', 'cheese-250g', 'milk-2l']) {
      expect(skus.has(blocked)).toBe(false);
    }
    const one = coach.buildCoachPlan(base);
    const two = coach.buildCoachPlan({ ...base, householdSize: 2 });
    const packs = (row) => row.shopping.lines.reduce((sum, line) => sum + line.packs, 0);
    expect(packs(two)).toBeGreaterThan(packs(one));
  });

  it('splits items the chosen store does not stock, without prices', () => {
    const aldi = coach.buildCoachPlan({ ...base, storeId: 'aldi' });
    expect(aldi.shopping.storeId).toBe('aldi');
    expect(aldi.shopping.split).toBe(true);
    expect(aldi.shopping.stores.length).toBeGreaterThan(1);
    expect(aldi.shopping.lines.some((line) => line.storeId !== 'aldi')).toBe(true);
    expect(aldi.shopping.splitLabel).toMatch(/^Split across /);
    expect(aldi.shopping.note).toBe('Check prices at checkout.');
    expect(JSON.stringify(aldi.shopping)).not.toMatch(PRICE_OR_DATE);
  });

  it('reads adherence and targets from meal logs', () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    const logs = [];
    for (const ago of [0, 1, 2, 4]) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - ago);
      logs.push(
        { date: date.toISOString(), calories: 500, protein: 30, carbs: 50, fat: 15 },
        { date: date.toISOString(), calories: 700, protein: 40, carbs: 70, fat: 20 },
        { date: date.toISOString(), calories: 600, protein: 35, carbs: 55, fat: 18 }
      );
    }
    const targets = coach.targetsFromLogs(logs, now);
    expect(targets.available).toBe(true);
    expect(targets).toMatchObject({ kcal: 1800, protein: 105, carbs: 175, fat: 53 });
    const adherence = coach.adherenceFromLogs(logs, { kcal: 1800, protein: 105, carbs: 175, fat: 53 }, now);
    expect(adherence.daysLogged).toBe(4);
    expect(adherence.windowDays).toBe(7);
    expect(adherence.avgKcal).toBe(1800);
    expect(coach.targetsFromLogs([], now).available).toBe(false);
  });

  it('moves a plan draft to sent, then viewed, and does not move backwards', () => {
    expect(coach.transitionPlanStatus('draft', 'send')).toBe('sent');
    expect(coach.transitionPlanStatus('sent', 'view')).toBe('viewed');
    expect(coach.transitionPlanStatus('viewed', 'send')).toBe('viewed');
    expect(coach.transitionPlanStatus('viewed', 'view')).toBe('viewed');
    expect(() => coach.transitionPlanStatus('draft', 'view')).toThrow(/not shared/i);
  });

  it('keeps the client-count gate open until part B sets a limit', () => {
    expect(coach.resolveCoachClientLimit({})).toBeNull();
    expect(coach.resolveCoachClientLimit({ coachClientLimit: null })).toBeNull();
    expect(coach.resolveCoachClientLimit({ coachClientLimit: 2 })).toBe(2);
    const open = coach.evaluateCoachClientGate({
      limit: null,
      clientId: 'new-client',
      rosterIds: ['a'],
    });
    expect(open.hook).toBe('coach.clientCountGate');
    expect(open.installed).toBe(false);
    expect(open.allowed).toBe(true);
    const blocked = coach.evaluateCoachClientGate({
      limit: 1,
      clientId: 'new-client',
      rosterIds: ['a'],
    });
    expect(blocked.installed).toBe(true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('client_count_gate');
    const existing = coach.evaluateCoachClientGate({
      limit: 1,
      clientId: 'a',
      rosterIds: ['a'],
    });
    expect(existing.allowed).toBe(true);
  });

  it('round-trips a PNG logo into RGB pixels', () => {
    const rgb = Buffer.alloc(12);
    rgb[0] = 200;
    rgb[1] = 20;
    rgb[2] = 40;
    const png = encodeRgbPng(2, 2, rgb);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.rgb[0]).toBe(200);
    expect(decoded.rgb[1]).toBe(20);
    expect(decoded.rgb[2]).toBe(40);
  });
});

describe('Coach plan HTTP', () => {
  beforeEach(() => {
    store.resetMemory();
  });

  async function session() {
    const res = await request(app).post('/api/coach/preview-session').expect(200);
    return res.body.token;
  }

  function auth(token) {
    return { Authorization: `Bearer ${token}` };
  }

  it('lets a PT test account create, brand, send, and open a plan logged out', async () => {
    const token = await session();
    const clients = await request(app).get('/api/coach/clients').set(auth(token)).expect(200);
    expect(clients.body.clients[0].label).toBe('Sample client');
    const targets = await request(app)
      .get(`/api/coach/clients/${clients.body.clients[0].id}/targets`)
      .set(auth(token))
      .expect(200);
    expect(targets.body.targets.available).toBe(true);
    expect(targets.body.targets.kcal).toBe(1800);

    const rgb = Buffer.alloc(8 * 8 * 3, 0);
    for (let i = 0; i < rgb.length; i += 3) {
      rgb[i] = 20;
      rgb[i + 1] = 140;
      rgb[i + 2] = 60;
    }
    const logo = `data:image/png;base64,${encodeRgbPng(8, 8, rgb).toString('base64')}`;
    await request(app)
      .put('/api/coach/branding')
      .set(auth(token))
      .send({ practiceName: 'Northside training', accent: '#14532d', logoDataUrl: logo })
      .expect(200);

    const created = await request(app)
      .post('/api/coach/plans')
      .set(auth(token))
      .send({
        clientId: clients.body.clients[0].id,
        kcal: targets.body.targets.kcal,
        protein: targets.body.targets.protein,
        carbs: targets.body.targets.carbs,
        fat: targets.body.targets.fat,
        flags: ['gluten-free'],
        householdSize: 2,
        storeId: 'coles',
        source: 'logs',
      })
      .expect(201);
    expect(created.body.plan.status).toBe('draft');
    expect(created.body.plan.adherence.daysLogged).toBe(4);
    expect(created.body.gate.hook).toBe('coach.clientCountGate');
    expect(created.body.gate.installed).toBe(false);
    expect(created.body.plan.plan.shopping.storeName).toBe('Coles');
    expect(created.body.plan.plan.priceNote).toBe('Check prices at checkout.');
    expect(created.body.plan.plan.shopping.splitLabel).toBeTruthy();

    const sent = await request(app)
      .post(`/api/coach/plans/${created.body.plan.id}/send`)
      .set(auth(token))
      .expect(200);
    expect(sent.body.plan.status).toBe('sent');
    expect(sent.body.plan.sharePath).toMatch(/^\/c\//);

    const share = await request(app).get(sent.body.plan.sharePath).expect(200);
    expect(share.text).toContain('Northside training');
    expect(share.text).toContain('id="share-logo"');
    expect(share.text).toContain('Check prices at checkout.');
    expect(share.text).toContain('id="share-split"');
    expect(share.text).toMatch(/\d+g protein/);
    expect(share.text).toMatch(/\d+ kcal · P\d+ C\d+ F\d+/);
    expect(share.text).toContain('class="day-macros"');
    expect(share.text).not.toContain('class="mono day-macros"');
    expect(share.text).toContain('width:96px');
    expect(share.text).toContain('General guidance, not medical advice');
    expect(share.text).toContain('Prepared by Northside training with FitMunch');
    expect(share.text).toContain('Week of');
    expect(share.text).toContain('Shopping list');
    expect(share.text).not.toMatch(PRICE_OR_DATE);
    expect(share.text).not.toContain(CATALOGUE.weekLabel);
    expect(share.text).not.toContain(CATALOGUE.validFrom);
    expect(share.text).toContain('class="aisle"');
    expect(share.text).toContain('/img/meals/');
    expect(share.text).not.toMatch(/\d+\.\d+\s*(g|ml|eggs|slices)/);
    expect(share.text).not.toMatch(/HealthKit|Apple Watch|Stripe Link/i);
    expect(share.headers['x-robots-tag']).toBe('noindex');

    const pdf = await request(app).get(`${sent.body.plan.sharePath}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    const pdfText = pdf.body.toString('latin1');
    const drawn = pdfDrawnText(pdf.body);
    expect(pdfText.slice(0, 5)).toBe('%PDF-');
    expect(pdfText).toContain('Northside training');
    expect(pdfText).toContain('General guidance, not medical advice');
    expect(pdfText).toContain('Prepared by Northside training with FitMunch');
    expect(drawn).toContain('Check prices at checkout.');
    expect(drawn).toMatch(/All at|Split across/);
    expect(drawn).toMatch(/\d+g protein/);
    expect(pdfText).toContain('/Subtype /Image');
    expect(drawn).not.toMatch(PRICE_OR_DATE);
    expect(drawn).not.toContain(CATALOGUE.weekLabel);
    expect(drawn).not.toContain(CATALOGUE.validFrom);
    expect((pdfText.match(/\/Type \/Page(?!s)/g) || []).length).toBeLessThanOrEqual(3);
    expect(pdfText).not.toMatch(/\d+\.\d+ (g|ml)/);

    const viewed = await request(app)
      .get(`/api/coach/plans/${created.body.plan.id}`)
      .set(auth(token))
      .expect(200);
    expect(viewed.body.plan.status).toBe('viewed');

    const again = await request(app)
      .post(`/api/coach/plans/${created.body.plan.id}/send`)
      .set(auth(token))
      .expect(200);
    expect(again.body.plan.status).toBe('viewed');
  });

  it('blocks a new client when the gate limit is installed and leaves billing alone', async () => {
    const token = await session();
    store.setClientLimit(store.PREVIEW_PT.id, 0);
    const blocked = await request(app)
      .post('/api/coach/plans')
      .set(auth(token))
      .send({ clientId: 'someone-new', kcal: 2000, protein: 140, carbs: 180, fat: 60 })
      .expect(403);
    expect(blocked.body.error).toBe('client_count_gate');
    expect(blocked.body.gate.installed).toBe(true);

    const existing = await request(app)
      .post('/api/coach/plans')
      .set(auth(token))
      .send({
        clientId: store.PREVIEW_CLIENT.id,
        kcal: 2000,
        protein: 140,
        carbs: 180,
        fat: 60,
        storeId: 'woolworths',
        householdSize: 1,
      })
      .expect(201);
    expect(existing.body.gate.allowed).toBe(true);

    store.setClientLimit(store.PREVIEW_PT.id, 8);
    const stranger = await request(app)
      .post('/api/coach/plans')
      .set(auth(token))
      .send({ clientId: 'someone-new', kcal: 2000, protein: 140, carbs: 180, fat: 60 })
      .expect(403);
    expect(stranger.body.error).toBe('not_your_client');
  });

  it('serves the builder from the trainer dashboard without touching shopper or the homepage', async () => {
    const page = await request(app).get('/coach').expect(200);
    expect(page.text).toContain('Coach plan builder');
    expect(page.text).toContain('Check prices at checkout.');
    expect(page.text).not.toMatch(/25 Aug 2026|2026-08-25/);
    const coachPage = read('public/meal-plan-software-personal-trainers.html');
    expect(coachPage).toContain('A$39');
    expect(coachPage).toContain('A$79');
    expect(page.text).toContain('See a dietitian for medical nutrition.');
    expect(read('public/app.html')).toContain("location.href='/coach'");
    expect(read('public/app.html')).toContain('Coach plans');
    expect(read('lib/db-migrate.js')).toContain('CREATE TABLE IF NOT EXISTS coach_plans');
    expect(read('lib/coach-plan.js')).not.toMatch(/require\(['"]stripe['"]\)/);
    expect(read('coach-api.js')).not.toMatch(/require\(['"]stripe['"]\)/);
    const home = await request(app).get('/').expect(200);
    expect(home.text).toContain('<h1>Your body wrote the trolley.</h1>');
    const shopper = await request(app).get('/shopper').expect(200);
    expect(shopper.text).toContain('$19.99 a month');
  });
});
