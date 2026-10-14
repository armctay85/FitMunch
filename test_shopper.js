'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const shopper = require('./lib/fitness-butler-shopper');
const { CATALOGUE } = require('./lib/public-specials-catalogue');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

describe('Fitness Butler shopper engine', () => {
  it('writes ingredients from the committed week and prices only public specials', () => {
    const week = shopper.getWeek();
    const ingredients = shopper.writeIngredients(week);
    expect(ingredients.length).toBeGreaterThan(10);
    expect(ingredients.every((line) => line.packs >= 1)).toBe(true);
    expect(ingredients.some((line) => line.sku === 'chicken-breast-1kg')).toBe(true);
    expect(ingredients.some((line) => line.sku === 'salmon-400g')).toBe(true);

    const priced = shopper.priceIngredients(ingredients, CATALOGUE);
    for (const line of priced) {
      expect(line.quotes.woolworths || line.quotes.coles || line.quotes.aldi).toBeTruthy();
      if (line.quotes.woolworths) {
        expect(line.quotes.woolworths.searchUrl).toContain('woolworths.com.au/shop/search');
      }
    }
  });

  it('stays at one store when the catalogue save does not beat a second trip', () => {
    const draft = shopper.buildDraft({ secondTripCostAud: 22 });
    expect(draft.status).toBe('draft');
    expect(draft.recommendation.split).toBe(false);
    expect(draft.recommendation.stores).toEqual(['woolworths']);
    expect(draft.recommendation.saveVsSingleAud).toBeGreaterThan(0);
    expect(draft.recommendation.saveVsSingleAud).toBeLessThan(draft.recommendation.secondTripCostAud);
    expect(draft.recommendation.reason).toMatch(/does not beat/i);
    expect(draft.honesty.paysWoolworths).toBe(false);
    expect(draft.honesty.trolleyApi).toBe(false);
    expect(draft.honesty.stripeLinkGrocery).toBe(false);
  });

  it('splits only when the catalogue save beats the second trip', () => {
    const splitDraft = shopper.buildDraft({ secondTripCostAud: 8 });
    expect(splitDraft.recommendation.split).toBe(true);
    expect(splitDraft.recommendation.stores.length).toBeGreaterThan(1);
    expect(splitDraft.recommendation.saveVsSingleAud).toBeGreaterThan(8);
    expect(splitDraft.recommendation.reason).toMatch(/beats/i);
  });

  it('approve returns a takeaway checkout, not a Woolies payment', () => {
    const trolley = shopper.approveDraft();
    expect(trolley.status).toBe('approved');
    expect(trolley.checkout.kind).toBe('takeaway');
    expect(trolley.checkout.paidByFitMunch).toBe(false);
    expect(trolley.checkout.stripeLink).toBe(false);
    expect(trolley.checkout.trolleyApi).toBe(false);
    expect(trolley.checkout.note).toMatch(/does not charge this shop/i);
    expect(trolley.checkout.copyAll).toMatch(/Pay at the store/);
    expect(trolley.checkout.baskets.length).toBeGreaterThan(0);
    expect(trolley.honesty.appleWatch).toBe(false);
    expect(trolley.honesty.healthKit).toBe(false);
  });
});

describe('Shopper surface retired', () => {
  it('page and aliases 301 to /app.html#shopping and the API is 410 Gone', async () => {
    for (const url of ['/shopper', '/shopper.html', '/fitness-butler', '/butler']) {
      await request(app).get(url).expect(301).expect('Location', '/app.html#shopping');
    }
    await request(app).get('/api/shopper/week').expect(410);
    await request(app).post('/api/shopper/draft').send({}).expect(410);
    await request(app).post('/api/shopper/approve').send({}).expect(410);
    expect(fs.existsSync(path.join(__dirname, 'public/shopper.html'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, 'public/js/fm-shopper.js'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, 'public/css/fm-shopper.css'))).toBe(false);
  });
});

describe('Fitness Butler shopper honesty lock', () => {
  it('engine and page never scrape trolley APIs or raise Stripe Link grocery spend', () => {
    const files = [
      'lib/fitness-butler-shopper.js',
      'lib/public-specials-catalogue.js',
    ].map(read).join('\n');

    expect(files).not.toMatch(/wowapi|\/shop\/apis|cart\/api/i);
    expect(files).not.toMatch(/payment_method_types|stripe\.checkout/i);
    expect(files).not.toMatch(/syncs with HealthKit|watchOS|HealthKit connected/i);
    expect(files).toContain('public_specials_catalogue');
    expect(files).toContain('takeaway');
  });

  it("rg pattern this week's public specials|live prices|today's prices is absent from public and lib", () => {
    const pattern = /this week's public specials|live prices|today's prices/;
    const roots = ['public', 'lib'];
    const hits = [];
    function walk(rel) {
      const abs = path.join(__dirname, rel);
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(child);
          continue;
        }
        if (!/\.(html|js|mjs|cjs|md|json)$/.test(entry.name)) continue;
        const text = read(child);
        if (pattern.test(text)) hits.push(child);
      }
    }
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });

  it('bans false and internal copy in public', () => {
    const pattern = /We buy the food|Link agents|Stripe Link|Most popular|Secondary lane|check the butler|Native is the next surface|\$59 to \$99|this week's public specials/;
    const hits = [];
    function walk(rel) {
      const abs = path.join(__dirname, rel);
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(child);
          continue;
        }
        if (!/\.(html|js|mjs|cjs|md|json)$/.test(entry.name)) continue;
        const text = read(child);
        if (pattern.test(text)) hits.push(child);
      }
    }
    walk('public');
    expect(hits).toEqual([]);
  });

  it('leaves the $19.99 Premium trial path untouched', () => {
    const checkout = read('lib/fitmunch-checkout.js');
    expect(checkout).toContain("'premium':    'price_1ToYrXGMuYRuJYDrwHtvWD1c'");
    expect(checkout).toContain('const TRIAL_PERIOD_DAYS = 14');
    expect(checkout).toContain("payment_method_collection: 'always'");
    expect(checkout).not.toMatch(/shopper grocery|woolworths spend/i);
  });
});
