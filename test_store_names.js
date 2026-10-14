'use strict';

/**
 * Wilson's ruling (PR 76): no store names in marketing pages, titles, slugs or
 * SEO copy. app.html and coach.html are the product (store buttons, badges and
 * the store picker stay), and the lib store data is untouched.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

const PUBLIC = path.join(__dirname, 'public');
const STORE = /woolworths|woolies|\bcoles\b|\baldi\b|\bIGA\b|costco|1 Shop 5 Meals/i;

const REDIRECTS = [
  ['/woolworths-meal-planner', '/supermarket-meal-planner'],
  ['/coles-meal-planner', '/grocery-meal-planner'],
  ['/pt-client-meal-plans-woolworths', '/pt-client-meal-plans'],
];

describe('no store names on any public page (app.html and coach.html included, no skips)', () => {
  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

  it('covers the product pages', () => {
    expect(pages).toEqual(expect.arrayContaining(['app.html', 'coach.html', 'index.html']));
  });

  it.each(pages)('%s has no store name in its copy, title or links', (file) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const hit = html.match(new RegExp(`.{0,40}(${STORE.source}).{0,40}`, 'i'));
    expect(hit && hit[0]).toBeFalsy();
  });

  it('app_fixes.js (dead, unserved, store price data) is deleted', () => {
    expect(fs.existsSync(path.join(__dirname, 'app_fixes.js'))).toBe(false);
  });


  it('the dead supermarket_api.js mock is gone', () => {
    expect(fs.existsSync(path.join(__dirname, 'supermarket_api.js'))).toBe(false);
  });

  it('food-db keeps its national brands', () => {
    const { FOODS } = require('./food-db');
    const names = FOODS.map((f) => f.name).join('\n');
    expect(names).not.toMatch(STORE);
    expect(names).toMatch(/Chobani/);
  });

  it('sitemap, slugs and the lander tracker carry no store names', () => {
    expect(fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8')).not.toMatch(STORE);
    expect(fs.readFileSync(path.join(PUBLIC, 'js', 'fm-track.js'), 'utf8')).not.toMatch(STORE);
    expect(fs.readdirSync(PUBLIC).filter((f) => STORE.test(f))).toEqual([]);
  });

  it('every served text file under public/ (any folder: html, js, css, json, xml, txt, webmanifest) has no store name', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const full = path.join(dir, d.name);
      return d.isDirectory() ? walk(full) : [full];
    });
    const served = walk(PUBLIC).filter((f) => /\.(html?|js|mjs|css|json|xml|txt|webmanifest|svg)$/i.test(f));
    expect(served.length).toBeGreaterThan(20);
    const hits = served
      .map((f) => {
        const m = fs.readFileSync(f, 'utf8').match(new RegExp(`.{0,40}(${STORE.source}).{0,40}`, 'i'));
        return m ? `${path.relative(PUBLIC, f)}: ${m[0]}` : null;
      })
      .filter(Boolean);
    expect(hits).toEqual([]);
  });

  it('app.html names no supermarket', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
    expect(html).not.toMatch(/Woolworths|Woolies|\bColes\b/i);
  });

  it('the meal planner and shopping-list copy names no chain (no Woolies/Coles empty state)', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
    expect(html).not.toMatch(/Woolies\s*\/\s*Coles|Woolies or Coles|sl-woolies-link|sl-coles-link/i);
  });

  it('coach.html intro copy is generic and it has no store picker', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'coach.html'), 'utf8');
    expect(html).toContain('<p>Pick a client, set targets, and draft a 7-day plan with a supermarket list.</p>');
    expect(html).not.toContain('id="coach-store"');
    expect(fs.readFileSync(path.join(PUBLIC, 'js', 'fm-coach.js'), 'utf8')).not.toMatch(/coach-store'\)\.value|storeName/);
  });

  it('app.html has no store name anywhere, including links, titles and placeholders', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
    expect(html).not.toMatch(STORE);
    expect(html).not.toMatch(/woolworths\.com\.au|coles\.com\.au/i);
  });

  it('the nutrition Coach prompt says "shop at your supermarket" and names no chain', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const prompts = src.slice(src.indexOf('const CHAT_INTENTS'), src.indexOf('function chatIntentPrompt'));
    expect(prompts).toMatch(/shop at your supermarket/);
    expect(prompts).not.toMatch(STORE);
    expect(src).not.toMatch(/approx Woolies\/Coles/);
  });

  it('the legacy priced /api/shopping-list/budget route is gone', async () => {
    expect(fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8')).not.toContain("'/shopping-list/budget'");
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ userId: '00000000-0000-4000-8000-000000000001' }, process.env.JWT_SECRET || 'fitmunch-dev-secret');
    const res = await request(app).post('/api/shopping-list/budget').set('Authorization', `Bearer ${tok}`).send({ protein: 150 });
    expect(res.status).toBe(404);
  });
});

describe('301s for renamed store slugs', () => {
  it.each(REDIRECTS)('%s -> %s in vercel.json, permanent', (from, to) => {
    const { redirects } = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    for (const src of [from, `${from}.html`]) {
      expect(redirects).toContainEqual({ source: src, destination: to, statusCode: 301 });
    }
  });

  it.each(REDIRECTS)('%s -> %s on the app server, and the new slug serves 200', async (from, to) => {
    for (const src of [from, `${from}.html`]) {
      const res = await request(app).get(src).expect(301);
      expect(res.headers.location).toBe(to);
    }
    const page = await request(app).get(to).expect(200);
    expect(page.text).toContain(`<link rel="canonical" href="https://www.fitmunch.com.au${to}"`);
  });

  it('sitemap lists each new slug once and no old slug', () => {
    const xml = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
    for (const [from, to] of REDIRECTS) {
      expect(xml.split(`<loc>https://www.fitmunch.com.au${to}</loc>`).length - 1).toBe(1);
      expect(xml).not.toContain(`${from}<`);
    }
  });
});

describe('PR 76 r2 copy fixes', () => {
  const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

  it('fallback 301 keeps the query string (QA r2 L2)', async () => {
    const res = await request(app).get('/coles-meal-planner?utm_source=x&b=2').expect(301);
    expect(res.headers.location).toBe('/grocery-meal-planner?utm_source=x&b=2');
  });

  it('marketing page titles are 60 characters or fewer', () => {
    const long = fs.readdirSync(PUBLIC)
      .filter((f) => f.endsWith('.html') && !['app.html', 'coach.html'].includes(f)) // signed-in tools, not marketing titles
      .map((f) => [f, (read(f).match(/<title>([^<]*)<\/title>/) || [])[1] || ''])
      .filter(([, t]) => t.length > 60);
    expect(long).toEqual([]);
  });

  it('carries the QA r2 copy verbatim and none of the garbled lines', () => {
    const scanner = read('receipt-nutrition-scanner.html');
    expect(scanner).toContain('<h2>Works with Australian supermarket receipts</h2>');
    expect(scanner).toContain('<p>Paper receipts and digital e-receipts are supported. OCR plus AI handles crumpled paper, faded ink and long scrolls.</p>');
    expect(scanner).not.toContain('store-badge');
    expect(scanner).toContain('faded thermal paper.');
    const ai = read('ai-meal-planner-australia.html');
    expect(ai).toContain('<li>Busy Australians who do a weekly supermarket shop</li>');
    expect(ai).toContain('<dt>Does it work with any Australian supermarket?</dt>');
    expect(ai).toContain('<h2>Your supermarket, without a trolley scrape</h2>');
    expect(read('index.html')).not.toContain('<b>List</b>');
    const pt = read('pt-client-meal-plans.html');
    expect(pt).toMatch(/<dt>Can the same plan work at a different supermarket\?<\/dt>\s*<dd>Yes\. The draft is an ingredient list, so the client can shop it at any supermarket\. FitMunch does not place the order\.<\/dd>/);
    expect(pt).toContain('<h2>The list stays a draft</h2>');
    expect(pt).not.toContain('Other stores work too');
    expect(read('meal-plan-software-personal-trainers.html')).toContain('FitMunch is not affiliated with any supermarket, and it does not place the order or pay the store.');
    const garbled = /supermarket, supermarket|a any |on its own site|Does it use supermarket|pay supermarket directly|faded thermal receipt/;
    for (const f of fs.readdirSync(PUBLIC).filter((x) => x.endsWith('.html'))) {
      expect([f, garbled.test(read(f))]).toEqual([f, false]);
    }
  });
});

describe('homepage phone list layout (QA r3)', () => {
  it('two-column rows and no leftover store-label rules', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    expect(html).toContain('.phone-list li{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid #ece6db}');
    expect(html).not.toMatch(/\.phone-list b\b/);
  });
});

// Ported from #103's test_store_name_sweep.js (Elite QA #107 r? S1).
describe('store-name sweep: email, AI prompts and coach-api', () => {
  const CHAIN = /woolworths|woolies|\bcoles\b|\baldi\b|\bIGA\b|costco|harris farm|foodworks/i;
  const COMMERCE_KEY = /^(totalAud|totalCents|lineAud|unitAud|onSpecial|priced|unpricedCount|catalogue|pricesFrom|sourceKind|storeId|storeName|store|paysWoolworths|paysColes|paysAldi)$/;
  const COMMERCE_VALUE = /au-public-specials|\bw35\b|public_specials_catalogue/i;
  const keysIn = (v, out = []) => {
    if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (COMMERCE_KEY.test(k)) out.push(k); keysIn(x, out); }
    return out;
  };

  it('server/email.js (including line 80) names no chain', () => {
    const src = fs.readFileSync(path.join(__dirname, 'server/email.js'), 'utf8');
    expect(src.split('\n')[79]).not.toMatch(CHAIN);
    expect(src.match(CHAIN)).toBeNull();
  });

  it('every AI prompt constant loads and names no chain', () => {
    const chat = require('./api_server').AI_PROMPTS;
    const prompts = {
      CHAT_GLOBAL_RULES: chat.CHAT_GLOBAL_RULES,
      ...Object.fromEntries(Object.entries(chat.CHAT_INTENTS).map(([k, v]) => [`CHAT_INTENTS.${k}`, v])),
      VISION_PROMPT: require('./receipt-scanner').AI_PROMPTS.VISION_PROMPT,
      planPrompt: require('./meal-planner').AI_PROMPTS.planPrompt({ goal: 'maintain', calories: 2000, protein: 150, days: 7, dietary: [] }),
    };
    for (const [name, text] of Object.entries(prompts)) {
      expect(typeof text).toBe('string');
      expect([name, text.match(CHAIN)]).toEqual([name, null]);
    }
  });

  it('coach plans, the saved row and the coach-api response carry no chain, price, special or catalogue', async () => {
    const { buildCoachPlan } = require('./lib/coach-plan');
    const coachStore = require('./lib/coach-store');
    for (const storeId of [undefined, 'woolworths', 'coles', 'aldi']) {
      const plan = buildCoachPlan({ kcal: 2200, protein: 160, carbs: 220, fat: 70, storeId });
      expect(keysIn(plan)).toEqual([]);
      expect(JSON.stringify(plan)).not.toMatch(CHAIN);
      expect(JSON.stringify(plan)).not.toMatch(COMMERCE_VALUE);
    }
    const row = await coachStore.createPlan({ ptId: 'sn-pt', clientId: 'sn-c', clientLabel: 'S', plan: buildCoachPlan({ kcal: 2000, protein: 150, carbs: 200, fat: 60 }) });
    const saved = await coachStore.getPlan(row.id, 'sn-pt');
    const body = await coachStore.withAdherence(saved);
    for (const v of [saved, body]) {
      expect(keysIn(v)).toEqual([]);
      expect(JSON.stringify(v)).not.toMatch(CHAIN);
      expect(JSON.stringify(v)).not.toMatch(COMMERCE_VALUE);
    }
    const { api } = require('./coach-api');
    const res = { json: (b) => b };
    api.stack[0].handle({}, res, () => {});
    expect(JSON.stringify(res.json({ storeName: 'Woolworths', paysColes: false }))).not.toMatch(CHAIN);
  });
});
