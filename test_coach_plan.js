'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const coach = require('./lib/coach-plan');
const { CATALOGUE, priceEstimateNote } = require('./lib/public-specials-catalogue');
const store = require('./lib/coach-store');
const { encodeRgbPng } = require('./lib/coach-png');
const { decodePng } = require('./lib/coach-png');
const { renderSharePage } = require('./lib/coach-share');
const { buildCoachPdf } = require('./lib/coach-pdf');
const { tones, contrastRatio } = require('./public/js/fm-accent');

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

  it('builds a 7-day plan and prices the chosen store from public specials', () => {
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
    expect(plan.shopping.lines.every((line) => line.priced && line.lineAud > 0)).toBe(true);
    const cents = plan.shopping.lines.reduce((sum, line) => sum + Math.round(line.lineAud * 100), 0);
    expect(plan.shopping.totalCents).toBe(cents);
    expect(plan.shopping.note).toBe('Prices vary by store and week.');
    expect(plan.priceNote).toBe(coach.PRICE_NOTE);
    expect(plan.dietitianLine).toBe('See a dietitian for medical nutrition.');
    expect(plan.honesty.trolleyApi).toBe(false);
    expect(plan.honesty.ordersPlaced).toBe(false);
    expect(plan.honesty.pricesFrom).toBe('public_specials_catalogue');
  });

  it('drops animal foods for a vegan plan and scales the household list', () => {
    const vegan = coach.buildCoachPlan({ ...base, flags: ['vegan', 'nut-free'] });
    const skus = skuSet(vegan);
    for (const blocked of ['chicken-breast-1kg', 'eggs-12', 'greek-yoghurt-1kg', 'tuna-4pk', 'salmon-400g', 'beef-mince-500g', 'peanut-butter-375g', 'cheese-250g', 'milk-2l']) {
      expect(skus.has(blocked)).toBe(false);
    }
    const one = coach.buildCoachPlan(base);
    const two = coach.buildCoachPlan({ ...base, householdSize: 2 });
    expect(two.shopping.totalCents).toBeGreaterThan(one.shopping.totalCents);
  });

  it('prices only the chosen store and leaves Aldi gaps unpriced', () => {
    const aldi = coach.buildCoachPlan({ ...base, storeId: 'aldi' });
    expect(aldi.shopping.storeId).toBe('aldi');
    expect(aldi.shopping.unpricedCount).toBeGreaterThan(0);
    expect(aldi.shopping.lines.some((line) => line.priced === false && line.lineAud == null)).toBe(true);
    const priced = aldi.shopping.lines.filter((line) => line.priced);
    const cents = priced.reduce((sum, line) => sum + Math.round(line.lineAud * 100), 0);
    expect(aldi.shopping.totalCents).toBe(cents);
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
    expect(created.body.plan.plan.priceNote).toBe('Prices vary by store and week.');
    expect(created.body.plan.plan.catalogue).toBeUndefined();
    expect(JSON.stringify(created.body.plan.plan)).not.toContain('2026-08-25');
    expect(JSON.stringify(created.body.plan.plan)).not.toContain('w35');
    expect(created.body.plan.updatedAt).toBeTruthy();

    const sent = await request(app)
      .post(`/api/coach/plans/${created.body.plan.id}/send`)
      .set(auth(token))
      .expect(200);
    expect(sent.body.plan.status).toBe('sent');
    expect(sent.body.plan.sharePath).toMatch(/^\/c\//);

    const share = await request(app).get(sent.body.plan.sharePath).expect(200);
    expect(share.text).toContain('Northside training');
    expect(share.text).toContain('#14532d');
    expect(share.text).toContain('background: var(--accent)');
    expect(share.text).toContain('id="share-logo"');
    expect(share.text).toContain('Prices vary by store and week.');
    expect(share.text).not.toContain(priceEstimateNote(CATALOGUE));
    expect(share.text).not.toContain('2026-08-25');
    expect(share.text).toContain('See a dietitian for medical nutrition.');
    expect(share.text).toContain('Coles draft list');
    expect(share.text).not.toContain('Coles total');
    expect(share.headers['x-robots-tag']).toBe('noindex');

    const pdf = await request(app).get(`${sent.body.plan.sharePath}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    const pdfText = pdf.body.toString('latin1');
    expect(pdfText.slice(0, 5)).toBe('%PDF-');
    expect(pdfText).toContain('Northside training');
    expect(pdfText).toContain('See a dietitian for medical nutrition.');
    expect(pdfText).toContain('Prices vary by store and week.');
    expect(pdfText).not.toContain(`dated ${CATALOGUE.validFrom} to ${CATALOGUE.validTo}`);
    expect(pdfText).not.toContain('Check prices at');
    expect(pdfText).not.toContain('checkout.');
    expect(pdfText).toContain('/Subtype /Image');

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
    expect(stranger.body.gate).toBeUndefined();
    expect(JSON.stringify(stranger.body)).not.toContain('coach.clientCountGate');
  });

  it('returns a generic message when the client is not on the trainer roster', async () => {
    const token = await session();
    store.setClientLimit(store.PREVIEW_PT.id, 8);
    const stranger = await request(app)
      .post('/api/coach/plans')
      .set(auth(token))
      .send({ clientId: 'someone-new', kcal: 2000, protein: 140, carbs: 180, fat: 60 })
      .expect(403);
    expect(stranger.body.success).toBe(false);
    expect(stranger.body.error).toBe('not_your_client');
    expect(stranger.body.message).toBe('You cannot open a plan for that client.');
    expect(stranger.body.gate).toBeUndefined();
    expect(JSON.stringify(stranger.body)).not.toContain('coach.clientCountGate');
  });

  it('serves the builder from the trainer dashboard without touching shopper or the homepage', async () => {
    const page = await request(app).get('/coach').expect(200);
    expect(page.text).toContain('Coach plan builder');
    expect(page.text).not.toContain('Prices vary by store and week.');
    expect(page.text).not.toContain('Estimated from public catalogue specials');
    expect(read('public/js/fm-coach.js').split('Prices vary by store and week.').length - 1).toBe(1);
    expect(page.text).not.toContain('Client count gate: open.');
    expect(page.text).toContain('href="/favicon.ico"');
    expect(page.text).toContain('href="/assets/logo.svg"');
    const icon = await request(app).get('/favicon.ico').expect(200);
    expect(icon.headers['content-type']).toMatch(/icon|image/);
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

function printCss(html) {
  const start = html.indexOf('@media print');
  if (start < 0) return '';
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return '';
}

describe('share page contrast, print, and PDF layout', () => {
  const accents = ['#1f9d4a', '#00b3ff', '#ff6b6b', '#fff3a0'];

  it('picks ink and darkened text that clear 4.5:1', () => {
    expect(contrastRatio('#1f9d4a', '#ffffff')).toBeCloseTo(3.51, 2);
    expect(contrastRatio('#ffffff', '#00b3ff')).toBeCloseTo(2.36, 2);
    expect(contrastRatio('#ffffff', '#ff6b6b')).toBeCloseTo(2.78, 2);
    for (const hex of accents) {
      const tone = tones(hex);
      expect(['#ffffff', '#07130d', '#000000']).toContain(tone.ink);
      expect(contrastRatio(tone.ink, hex)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tone.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(tones('#1f9d4a').ink).toBe('#07130d');
    expect(tones('#00b3ff').ink).toBe('#07130d');
    expect(tones('#ff6b6b').ink).toBe('#07130d');
    expect(tones('#fff3a0').ink).toBe('#07130d');
    expect(tones('#14532d').ink).toBe('#ffffff');
    expect(tones('#14532d').text).toBe('#14532d');
  });

  function samplePlan() {
    return {
      days: [{
        day: 'Mon',
        kcal: 1800,
        meals: [{
          slot: 'Breakfast',
          name: 'Yoghurt oats bowl',
          kcal: 420,
          protein: 30,
          carbs: 48,
          fat: 18,
          ingredients: [
            { name: 'Rolled oats', amount: 40, unit: 'g' },
            { name: 'Milk', amount: 100, unit: 'ml' },
          ],
        }],
      }],
      targets: { kcal: 2000, protein: 140, carbs: 180, fat: 60 },
      householdSize: 1,
      shopping: {
        storeName: 'Woolworths',
        lines: [{ name: 'Rolled oats', aisle: 'Pantry', packs: 1, amount: 500, unit: 'g' }],
      },
    };
  }

  it('prints with dark header text, hides tabs and buttons, and shows every day', () => {
    const html = renderSharePage({
      planRow: { token: 'tok', clientLabel: 'Sam', plan: samplePlan() },
      branding: { accent: '#1f9d4a', practiceName: 'Northside' },
    });
    const block = printCss(html);
    expect(block).toContain('@media print');
    expect(block).toMatch(/\.day-switch[^}]*display:\s*none/);
    expect(block).toMatch(/\.btn[^}]*display:\s*none/);
    expect(block).toMatch(/\.day-panel\.is-hidden[^}]*display:\s*block/);
    expect(block).toMatch(/\.shop-grid[^}]*grid-template-columns:\s*1fr\s+1fr/);
    expect(block).toMatch(/\.identity[^}]*color:\s*#0c1210/);
    expect(html.indexOf('id="share-price-note"')).toBeLessThan(html.indexOf('id="share-list"'));
    expect(html).toContain('position: sticky');
    expect(html).not.toContain('overflow: auto');
    expect(html).not.toContain('max-height: calc(100vh');
    const tone = tones('#1f9d4a');
    expect(html).toContain(`--accent-ink: ${tone.ink}`);
    expect(html).toContain(`--accent-text: ${tone.text}`);
    expect(html.split('Prices vary by store and week.').length - 1).toBe(1);
  });

  it('draws full-width meals, bullets, tick boxes, and a stat row in the PDF', () => {
    const pdf = buildCoachPdf({
      branding: { practiceName: 'North', accent: '#00b3ff' },
      clientLabel: 'Sam',
      plan: samplePlan(),
    }).toString('latin1');
    expect(pdf.slice(0, 5)).toBe('%PDF-');
    expect(pdf).toMatch(/\n[0-9. -]+ c\n/);
    expect(pdf).not.toContain('arc');
    expect(pdf).toContain(' re S');
    expect(pdf).not.toContain('(- ');
    expect(pdf).toContain('(kcal) Tj');
    expect(pdf).toContain('(protein) Tj');
    expect(pdf).toContain('(carbs) Tj');
    expect(pdf).toContain('(fat) Tj');
    expect(pdf).toContain('(days) Tj');
    expect(pdf).toContain('40 g Rolled oats');
    const fatAt = pdf.indexOf('(18 g fat) Tj');
    expect(fatAt).toBeGreaterThan(0);
    const tm = pdf.lastIndexOf('Tm', fatAt);
    const x = Number(pdf.slice(tm - 24, tm).match(/1 ([0-9.]+) [0-9.]+ $/)[1]);
    expect(x).toBeGreaterThan(350);
    const practiceAt = pdf.indexOf('(North) Tj');
    expect(pdf.slice(practiceAt - 180, practiceAt)).toContain('0.027 0.075 0.051 rg');
    expect(pdf.slice(practiceAt - 80, practiceAt)).not.toContain('1 1 1 rg');
    expect(pdf.split('Prices vary by store and week.').length - 1).toBe(1);
  });
});
