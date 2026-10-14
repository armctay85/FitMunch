'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { neutralise } = require('./lib/store-neutral');

const STORE = /woolworths|woolies|\bcoles\b|\baldi\b|\bIGA\b|costco|harris farm|foodworks/i;
const STORE_KEY = /woolworths|woolies|coles|aldi/i;
const ROOT = __dirname;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}
function firstHit(file) {
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`.{0,40}(${STORE.source}).{0,40}`, 'i'));
  return m ? `${path.relative(ROOT, file)}: ${m[0]}` : null;
}

describe('store-name sweep: served HTML/JS and email templates', () => {
  test('every served HTML and JS file under public/ names no chain', () => {
    const files = walk(path.join(ROOT, 'public')).filter((f) => /\.(html?|m?js|css|json|xml|txt|svg|webmanifest)$/i.test(f));
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(firstHit).filter(Boolean)).toEqual([]);
  });

  test('email templates name no chain', () => {
    const files = [
      ...walk(path.join(ROOT, 'server')).filter((f) => /email|mail/i.test(f) && /\.(js|html)$/.test(f)),
      ...['emails', 'templates', 'email-templates'].map((d) => path.join(ROOT, d)).filter(fs.existsSync).flatMap(walk),
    ];
    expect(files.map((f) => path.relative(ROOT, f))).toContain(path.join('server', 'email.js'));
    expect(files.map(firstHit).filter(Boolean)).toEqual([]);
  });

  test('meal planner empty states and the staples page name no chain', () => {
    const app = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
    expect(app).not.toMatch(/Woolies\s*\/\s*Coles|Woolies or Coles|Shop Woolies|Shop Coles/i);
    expect(app).toContain('No meal plan yet');
    for (const f of ['high-protein-staples-meal-plan.html', 'coach.html']) {
      expect(firstHit(path.join(ROOT, 'public', f))).toBeNull();
    }
    expect(fs.readFileSync(path.join(ROOT, 'public/coach.html'), 'utf8')).not.toContain('id="coach-store"');
  });
});

describe('neutralise()', () => {
  test('drops chain keys and retailer links, renames chain strings', () => {
    const out = neutralise({
      storeName: 'Woolworths',
      storeId: 'coles',
      paysWoolworths: false,
      searchUrl: 'https://www.woolworths.com.au/shop/search/products?searchTerm=oats',
      note: 'Pay at Woolies, Coles or Aldi.',
      side: 'Coleslaw',
      list: ['Aldi', 'https://www.aldi.com.au/en/specials/', 'Oats'],
    });
    expect(JSON.stringify(out)).not.toMatch(STORE);
    expect(out.paysWoolworths).toBeUndefined();
    expect(out.searchUrl).toBeUndefined();
    expect(out.storeName).toBe('Supermarket');
    expect(out.side).toBe('Coleslaw');
    expect(out.list).toEqual(['Supermarket', 'Oats']);
    expect(neutralise({ url: null, n: 0, ok: false })).toEqual({ url: null, n: 0, ok: false });
  });
});

describe('shopper retired', () => {
  const app = require('./server.js');
  test.each(['/shopper', '/shopper.html', '/fitness-butler', '/butler'])('%s 301s to /app.html#shopping', async (url) => {
    await request(app).get(url).expect(301).expect('Location', '/app.html#shopping');
  });
  test.each([['get', '/api/shopper'], ['get', '/api/shopper/'], ['get', '/api/shopper/week'], ['post', '/api/shopper/draft'], ['post', '/api/shopper/approve'], ['get', '/api/shopper/anything']])(
    '%s %s is 410 Gone', async (method, url) => {
      const res = await request(app)[method](url).send({});
      expect(res.status).toBe(410);
      expect(res.text).not.toMatch(STORE);
    });
  test('vercel.json carries the same 301s', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    for (const src of ['/shopper', '/shopper.html', '/fitness-butler', '/butler']) {
      expect(v.redirects).toContainEqual({ source: src, destination: '/app.html#shopping', statusCode: 301 });
    }
  });
  test('retired and unserved store-name files are deleted, and nothing links to /shopper', () => {
    for (const f of ['public/shopper.html', 'public/js/fm-shopper.js', 'public/css/fm-shopper.css', 'professional-landing.html', 'simple-landing.html', 'app_fixes.js']) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(false);
    }
    const hits = walk(path.join(ROOT, 'public')).filter((f) => /\.(html|js|xml)$/.test(f))
      .filter((f) => /href="\/shopper|\/api\/shopper|fitmunch\.com\.au\/shopper/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  test('app.html opens the shopping list for #shopping', () => {
    expect(fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8')).toContain("location.hash === '#shopping'");
  });
});

const COMMERCE_KEY = /^(totalAud|totalCents|lineAud|unitAud|onSpecial|priced|unpricedCount|catalogue|pricesFrom|sourceKind|storeId|storeName|store)$/;
const COMMERCE_VALUE = /au-public-specials|\bw35\b|public_specials_catalogue/i;
function commerceKeys(value, at = '$', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => commerceKeys(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (COMMERCE_KEY.test(k)) out.push(`${at}.${k}`);
      commerceKeys(v, `${at}.${k}`, out);
    }
  }
  return out;
}

describe('AI prompts name no chain', () => {
  test('every AI prompt constant loads and is clean', () => {
    const chat = require('./api_server').AI_PROMPTS;
    const vision = require('./receipt-scanner').AI_PROMPTS;
    const planner = require('./meal-planner').AI_PROMPTS;
    const prompts = {
      CHAT_GLOBAL_RULES: chat.CHAT_GLOBAL_RULES,
      ...Object.fromEntries(Object.entries(chat.CHAT_INTENTS).map(([k, v]) => [`CHAT_INTENTS.${k}`, v])),
      VISION_PROMPT: vision.VISION_PROMPT,
      planPrompt: planner.planPrompt({ goal: 'maintain', calories: 2000, protein: 150, days: 7, dietary: ['vegan'] }),
    };
    for (const [name, text] of Object.entries(prompts)) {
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(20);
      expect([name, text.match(STORE)]).toEqual([name, null]);
    }
  });
});

describe('coach API plan responses carry no chain, price, total, special or catalogue', () => {
  const coachStore = require('./lib/coach-store');
  let app; let token;
  beforeAll(() => {
    process.env.COACH_PREVIEW = process.env.COACH_PREVIEW || '1';
    app = require('./server.js');
  });

  test('buildCoachPlan output has none of them', () => {
    const { buildCoachPlan } = require('./lib/coach-plan');
    for (const storeId of ['woolworths', 'coles', 'aldi']) {
      const plan = buildCoachPlan({ kcal: 2200, protein: 160, carbs: 220, fat: 70, storeId });
      expect(commerceKeys(plan)).toEqual([]);
      const json = JSON.stringify(plan);
      expect(json).not.toMatch(STORE);
      expect(json).not.toMatch(COMMERCE_VALUE);
    }
  });

  test('coach-api router runs every response through neutralise()', () => {
    const src = fs.readFileSync(path.join(ROOT, 'coach-api.js'), 'utf8');
    expect(src).toMatch(/res\.json = \(body\) => json\(neutralise\(body\)\)/);
    // And it is the first middleware on the api router.
    const { api } = require('./coach-api');
    const first = api.stack[0].handle;
    const res = { json: (b) => b };
    first({}, res, () => {});
    expect(res.json({ storeName: 'Woolworths', note: 'Pay at Coles' })).toEqual({ storeName: 'Supermarket', note: 'Pay at supermarket' });
  });

  test('a real POST /api/coach/plans response and the saved row have none of them', async () => {
    const { buildCoachPlan } = require('./lib/coach-plan');
    const row = await coachStore.createPlan({
      ptId: 'sweep-pt', clientId: 'sweep-client', clientLabel: 'Sweep',
      plan: buildCoachPlan({ kcal: 2000, protein: 150, carbs: 200, fat: 60, storeId: 'coles' }),
    });
    const saved = await coachStore.getPlan(row.id, 'sweep-pt');
    expect(commerceKeys(saved)).toEqual([]);
    expect(JSON.stringify(saved)).not.toMatch(STORE);
    expect(JSON.stringify(saved)).not.toMatch(COMMERCE_VALUE);
    const body = await coachStore.withAdherence(saved);
    expect(commerceKeys(body)).toEqual([]);
  });

  test('an old saved row is cleaned when read back', async () => {
    const { buildCoachPlan } = require('./lib/coach-plan');
    const row = await coachStore.createPlan({
      ptId: 'sweep-pt', clientId: 'sweep-client', clientLabel: 'Old',
      plan: buildCoachPlan({ kcal: 2000, protein: 150, carbs: 200, fat: 60 }),
    });
    // Simulate a row saved before the strip.
    row.storeId = 'woolworths';
    row.plan.catalogue = { id: 'au-public-specials-2026-w35' };
    row.plan.shopping.totalAud = 178.5;
    row.plan.shopping.lines[0].lineAud = 9.5;
    row.plan.shopping.lines[0].onSpecial = true;
    const listed = (await coachStore.listPlans('sweep-pt')).map((r) => coachStore.withAdherence ? r : r);
    const pub = await coachStore.withAdherence(listed.find((r) => r.id === row.id));
    expect(commerceKeys(pub)).toEqual([]);
    expect(JSON.stringify(pub)).not.toMatch(COMMERCE_VALUE);
  });
});

describe('saved coach plans from before the sweep', () => {
  test('share page and PDF title neutralise an old stored chain name', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/coach-share.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'lib/coach-pdf.js'), 'utf8');
    expect((src.match(/neutralString\(String\(shopping\.storeName/g) || []).length).toBe(2);
    expect(require('./lib/store-neutral').neutralString('Woolworths')).toBe('Supermarket');
  });
});
