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
const PRODUCT_PAGES = new Set(['app.html', 'coach.html']);
const STORE = /woolworths|woolies|\bcoles\b|\baldi\b|\bIGA\b|1 Shop 5 Meals/i;

const REDIRECTS = [
  ['/woolworths-meal-planner', '/supermarket-meal-planner'],
  ['/coles-meal-planner', '/grocery-meal-planner'],
  ['/pt-client-meal-plans-woolworths', '/pt-client-meal-plans'],
];

describe('no store names on marketing pages', () => {
  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && !PRODUCT_PAGES.has(f));

  it.each(pages)('%s has no store name in its copy, title or links', (file) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const hit = html.match(new RegExp(`.{0,40}(${STORE.source}).{0,40}`, 'i'));
    expect(hit && hit[0]).toBeFalsy();
  });

  it('app_fixes.js carries no dead store price data or store names', () => {
    const src = fs.readFileSync(path.join(__dirname, 'app_fixes.js'), 'utf8');
    expect(src).not.toMatch(STORE);
    expect(src).not.toMatch(/SupermarketAPI|mockPrices/);
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

  it('coach.html intro copy is generic; its store picker is unchanged (Wilson)', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'coach.html'), 'utf8');
    expect(html).toContain('<p>Pick a client, set targets, and draft a 7-day plan with a supermarket list.</p>');
    expect(html).toContain('<option value="woolworths">Woolworths</option>');
    expect(html).toContain('<option value="coles">Coles</option>');
    expect(html).toContain('<option value="aldi">Aldi</option>');
  });

  it('app.html keeps its store buttons and badges', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
    expect(html).toMatch(/Woolworths/);
    expect(html).toMatch(/Coles/);
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
      .filter((f) => f.endsWith('.html') && !PRODUCT_PAGES.has(f))
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
    expect(read('shopper.html')).toContain('Nothing is sent to a supermarket as an order.');
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
