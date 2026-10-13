'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
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

  test('meal planner empty states and budget pages name no chain', () => {
    const app = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
    expect(app).not.toMatch(/Woolies\s*\/\s*Coles|Woolies or Coles|Shop Woolies|Shop Coles/i);
    expect(app).toContain('No meal plan yet');
    for (const f of ['budget-meal-planner.html', 'budget-meal-plan.html', 'coach.html']) {
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

describe('public /api/shopper responses name no chain', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/shopper', require('./shopper'));
  test.each([['get', '/api/shopper/'], ['get', '/api/shopper/week'], ['post', '/api/shopper/draft'], ['post', '/api/shopper/approve']])(
    '%s %s', async (method, url) => {
      const res = await request(app)[method](url).send({});
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(STORE);
      expect(res.text).not.toMatch(/woolworths\.com|coles\.com|aldi\.com/i);
      const keys = [];
      JSON.stringify(res.body, (k, v) => { keys.push(k); return v; });
      expect(keys.filter((k) => STORE_KEY.test(k))).toEqual([]);
    });
});

describe('coach plan output names no chain', () => {
  test('buildCoachPlan shopping and honesty are neutral', () => {
    const { buildCoachPlan } = require('./lib/coach-plan');
    const plan = buildCoachPlan({ kcal: 2200, protein: 160, carbs: 220, fat: 70 });
    expect(plan.shopping.storeName).toBe('Supermarket');
    expect(Object.keys(plan.honesty).filter((k) => STORE_KEY.test(k))).toEqual([]);
    expect(JSON.stringify(neutralise(plan))).not.toMatch(STORE);
  });
});

describe('saved coach plans from before the sweep', () => {
  test('share page and PDF title neutralise an old stored chain name', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/coach-share.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'lib/coach-pdf.js'), 'utf8');
    expect((src.match(/neutralString\(String\(shopping\.storeName/g) || []).length).toBe(2);
    expect(require('./lib/store-neutral').neutralString('Woolworths')).toBe('Supermarket');
  });
});
