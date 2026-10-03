'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const shopper = require('./lib/fitness-butler-shopper');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

describe('Fitness Butler shopper engine', () => {
  it('writes ingredients from the committed week and assigns one store', () => {
    const week = shopper.getWeek();
    const ingredients = shopper.writeIngredients(week);
    expect(ingredients.length).toBeGreaterThan(10);
    expect(ingredients.every((line) => line.packs >= 1)).toBe(true);
    expect(ingredients.some((line) => line.sku === 'chicken-breast-1kg')).toBe(true);
    expect(ingredients.some((line) => line.sku === 'salmon-400g')).toBe(true);

    const draft = shopper.buildDraft();
    expect(draft.recommendation.split).toBeUndefined();
    expect(draft.recommendation.extraTrips).toBeUndefined();
    expect(draft.recommendation.bestSingleStore).toBeUndefined();
    expect(draft.recommendation.bestSingleStoreName).toBeUndefined();
    expect(draft.recommendation.stores).toEqual(['woolworths']);
    expect(draft.recommendation.reason).toBe('Shop at Woolworths.');
    expect(draft.lines.every((line) => line.assignedStore === 'woolworths')).toBe(true);
    expect(draft.lines.every((line) => line.searchUrl.includes('woolworths.com.au/shop/search'))).toBe(true);
    expect(JSON.stringify(draft)).not.toMatch(/assignedAud|goodsAud|totalAud|validFrom|validTo|\$\d|\bspecials\b|worth the extra trip/);
    expect(draft.honesty.paysWoolworths).toBe(false);
    expect(draft.honesty.trolleyApi).toBe(false);
    expect(draft.honesty.stripeLinkGrocery).toBe(false);
    expect(draft.honesty.pricesFrom).toBeUndefined();
    expect(draft.catalogue).toBeUndefined();
    expect(draft.priceNote).toBe('Prices vary by store and week.');
    expect(draft.draftId).toBe(`draft_${shopper.WEEK_ID}`);
    expect(draft.lines.some((line) => line.name === 'Cucumber each')).toBe(false);
    expect(draft.lines.find((line) => line.sku === 'cucumber').name).toBe('Cucumber');
    expect(draft.lines.find((line) => line.sku === 'bananas-1kg').proteinLabel).toBe('1g protein / 1 banana');
    const walk = ['Produce', 'Bakery', 'Meat', 'Dairy', 'Pantry', 'Frozen', 'Grocery'];
    let last = -1;
    for (const line of draft.lines) {
      const index = walk.indexOf(line.aisle);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
  });

  it('uses the preferred store when one is set', () => {
    const coles = shopper.buildDraft({ preferredStore: 'coles' });
    expect(coles.recommendation.split).toBeUndefined();
    expect(coles.recommendation.extraTrips).toBeUndefined();
    expect(coles.recommendation.bestSingleStore).toBeUndefined();
    expect(coles.recommendation.stores).toEqual(['coles']);
    expect(coles.lines.every((line) => line.assignedStore === 'coles')).toBe(true);
    expect(coles.recommendation.reason).toBe('Shop at Coles.');
    const unknown = shopper.buildDraft({ storeId: 'not-a-store' });
    expect(unknown.recommendation.stores).toEqual(['woolworths']);
  });

  it('picks the preferred store or Woolworths, never a price ranking', () => {
    expect(shopper.chosenStore({})).toBe('woolworths');
    expect(shopper.chosenStore({ preferredStore: 'aldi', cheapest: 'coles' })).toBe('aldi');
    expect(shopper.chosenStore({ storeId: 'coles' })).toBe('coles');
    const proto = shopper.buildDraft({ preferredStore: '__proto__' });
    expect(proto.recommendation.stores).toEqual(['woolworths']);
    expect(proto.recommendation.reason).toBe('Shop at Woolworths.');
    expect(proto.recommendation.reason).not.toMatch(/Object/);
    expect(shopper.chosenStore({ storeId: '__proto__' })).toBe('woolworths');
    const src = read('lib/fitness-butler-shopper.js');
    const start = src.indexOf('function chosenStore');
    const body = src.slice(start, src.indexOf('function buildDraft'));
    expect(body).not.toMatch(/price|cheapest|aud|cents|special/i);
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

function priceKeys(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  const nodes = Array.isArray(value) ? value : Object.entries(value);
  if (Array.isArray(value)) {
    for (const item of value) priceKeys(item, found);
    return found;
  }
  for (const [key, child] of nodes) {
    if (
      key === 'secondTripCostAud'
      || key === 'pricedAt'
      || key === 'validFrom'
      || key === 'validTo'
      || (key !== 'priceNote' && /price|cents|total|saving|\bsave/i.test(key))
    ) found.push(key);
    priceKeys(child, found);
  }
  return found;
}

const CATALOGUE_KEYS = new Set([
  'catalogue',
  'sources',
  'catalogueUrl',
  'onSpecial',
  'assignedOnSpecial',
  'pricesFrom',
  'sourceKind',
  'approvedAt',
]);
const CATALOGUE_ID = 'au-public-specials-2026-w35';

function catalogueLeaks(value, path, hits = []) {
  if (typeof value === 'string') {
    if (value.includes(CATALOGUE_ID)) hits.push(`${path || 'value'}=${CATALOGUE_ID}`);
    return hits;
  }
  if (!value || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => catalogueLeaks(item, `${path}[${index}]`, hits));
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (CATALOGUE_KEYS.has(key)) hits.push(here);
    catalogueLeaks(child, here, hits);
  }
  return hits;
}

describe('Fitness Butler shopper HTTP', () => {
  it('GET /shopper is its own surface and does not fight the homepage job', async () => {
    const page = await request(app).get('/shopper').expect(200);
    expect(page.text).toContain('Commit the week. Take the trolley.');
    expect(page.text).toContain('class="skip"');
    expect(read('public/css/fm-shopper.css')).toMatch(/\.skip\{[\s\S]*transform:translateY\(-160%\)/);
    expect(page.text).toContain('data-sp-commit');
    expect(page.text).toContain('Approve this trolley');
    expect(page.text).toContain('Prices vary by store and week.');
    expect(page.text).not.toContain('priced from public catalogue specials');
    expect(page.text).toContain('14-day trial, then <strong>A$19.99 a month.</strong> <span>Card on file.</span>');
    expect(page.text).toContain('Start the 14-day trial');
    expect(page.text).toContain('href="/login.html?plan=premium#register"');
    expect(page.text).toContain('web app');
    expect(page.text).toContain('Add to Home Screen');
    expect(page.text).not.toContain('Photograph your receipt');
    expect(page.text).not.toMatch(/syncs with (Apple Watch|HealthKit)/i);
    expect(page.text).not.toMatch(/HealthKit connected/i);
    expect(page.text).not.toContain('we already pay Woolies');
    expect(page.text).not.toContain('we pay Woolworths');
    expect(page.text).toContain('We do not pay Woolies');
    expect(page.text).toContain('You pay at the supermarket.');
    expect(page.text).not.toContain('Stripe Link');
    expect(page.text.replace(/<[^>]+>/g, '')).toContain('Draft trolley. You check out at the store. We do not pay Woolies. Prices vary by store and week.');
    expect(page.text).not.toContain('No Apple Watch. No HealthKit.');

    const home = await request(app).get('/').expect(200);
    expect(home.text).not.toContain('id="commit"');
    expect(home.text).not.toContain('data-sp-commit');
  });

  it('first fold is a solid fridge studio, not a grocery photo', () => {
    const css = read('public/css/fm-shopper.css');
    const html = read('public/shopper.html');
    expect(css).not.toMatch(/fm-groceries/);
    expect(html).not.toMatch(/fm-groceries/);
    expect(css).toMatch(/\.sp-hero\{[\s\S]*?background:#07130d/);
    expect(css).toMatch(/\.sp-hero \.lead\{[\s\S]*?color:#dce6de/);
    expect(css).toMatch(/\.sp-pricebar\{[\s\S]*?color:#e8efe6/);
    expect(css).not.toMatch(/\.sp-pricebar\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.sp-day\{[\s\S]*?background:#04100a/);
    expect(css).toMatch(/\.sp-day b\{[\s\S]*?color:#7dffa3/);
    expect(css).toMatch(/\.sp-day span\{[\s\S]*?color:#f4f7f4/);
    expect(read('public/index.html')).toContain('Your body wrote the trolley.');
  });

  it('first fold wraps seven day chips and keeps CTAs inside a 390 viewport', () => {
    const css = read('public/css/fm-shopper.css');
    const html = read('public/shopper.html');
    expect(css).toMatch(/@media\(max-width:520px\)\{[\s\S]*?\.sp-week-strip\{[\s\S]*?flex-wrap:wrap/);
    expect(css).toMatch(/@media\(max-width:520px\)\{[\s\S]*?\.sp-ctas\{display:grid;grid-template-columns:1fr\}/);
    expect(css).toMatch(/\.sp-hero \.fm-btn\{box-sizing:border-box/);
    expect(css).toMatch(/\.sp-ctas \.fm-btn\{width:100%;max-width:100%;box-sizing:border-box/);
    expect(html).toContain('Commit the week. Take the trolley.');
    expect(html).toContain('Commit this week');
    expect(html).toContain('How the list works');
    expect(html).toContain('14-day trial, then');
    expect(html).toContain('$19.99 a month');
    expect(html).toContain('href="/login.html?plan=premium#register"');
    expect(html).toContain('We do not pay Woolies');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Draft trolley. You check out at the store. We do not pay Woolies. Prices vary by store and week.');
    expect(html).toContain('>FitMunch</a>');
    expect(html).not.toContain('Fit<span>Munch</span>');
    expect(html).toContain('Sample list');
    expect(html).toContain('1g protein / 1 banana');
    expect(html).toContain('33g protein / 150g');
    expect(html).toContain('12g protein / 2 eggs');
    expect(html).not.toContain('7g protein / 2 slices');
    expect(html).not.toContain('Cucumber each');
    expect(html).not.toContain('No Apple Watch. No HealthKit.');
    expect(html).not.toMatch(/fm-groceries/);
    expect(read('public/index.html')).toContain('Your body wrote the trolley.');
  });

  it('aliases land on the shopper surface', async () => {
    await request(app).get('/fitness-butler').expect(301).expect('Location', '/shopper');
    await request(app).get('/butler').expect(301).expect('Location', '/shopper');
  });

  it('draft and approve APIs do not call trolley or Stripe', async () => {
    const draft = await request(app).post('/api/shopper/draft').send({}).expect(200);
    expect(draft.body.success).toBe(true);
    expect(draft.body.draft.status).toBe('draft');
    expect(draft.body.draft.catalogue).toBeUndefined();
    expect(JSON.stringify(draft.body)).not.toMatch(/validFrom|validTo|sourceKind|\$\d|\bspecials\b/);
    expect(draft.body.draft.honesty.trolleyApi).toBe(false);
    expect(draft.body.draft.honesty.stripeLinkGrocery).toBe(false);

    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    expect(approved.body.trolley.status).toBe('approved');
    expect(approved.body.trolley.checkout.kind).toBe('takeaway');
    expect(approved.body.trolley.checkout.stripeLink).toBe(false);
    expect(JSON.stringify(approved.body)).not.toMatch(/payment_intent|checkout\.sessions/i);
  });

  it('week, draft, and approve responses have no price, cents, total, or saving keys', async () => {
    const week = await request(app).get('/api/shopper/week').expect(200);
    const draft = await request(app).post('/api/shopper/draft').send({}).expect(200);
    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    expect(priceKeys(week.body)).toEqual([]);
    expect(priceKeys(draft.body)).toEqual([]);
    expect(priceKeys(approved.body)).toEqual([]);
    expect(week.body.priceNote).toBe(shopper.CHECKOUT_LINE);
    expect(week.body.catalogue).toBeUndefined();
    expect(draft.body.priceNote).toBe(shopper.CHECKOUT_LINE);
    expect(draft.body.draft.priceNote).toBe(shopper.CHECKOUT_LINE);
    expect(draft.body.draft.catalogue).toBeUndefined();
    expect(approved.body.priceNote).toBe(shopper.CHECKOUT_LINE);
    expect(approved.body.trolley.priceNote).toBe(shopper.CHECKOUT_LINE);
    expect(approved.body.trolley.catalogue).toBeUndefined();
  });

  it('returns fixed shopper errors and logs the detail', async () => {
    const missing = await request(app).post('/api/shopper/draft').send({ weekId: 'missing-week' }).expect(404);
    expect(missing.body).toEqual({
      success: false,
      error: 'That week is not available.',
      code: 'unknown_week',
    });
    expect(JSON.stringify(missing.body)).not.toContain('Unknown week');

    const original = shopper.buildDraft;
    shopper.buildDraft = () => {
      const err = new Error('secret driver detail');
      err.code = 'driver_down';
      throw err;
    };
    try {
      const failed = await request(app).post('/api/shopper/draft').send({}).expect(500);
      expect(failed.body).toEqual({
        success: false,
        error: 'Could not build the list.',
        code: 'shopper_error',
      });
      expect(JSON.stringify(failed.body)).not.toContain('secret driver detail');
    } finally {
      shopper.buildDraft = original;
    }
  });

  it('week response has no catalogue identifiers, dates, or retailer specials links', async () => {
    const week = await request(app).get('/api/shopper/week').expect(200);
    const text = JSON.stringify(week.body);
    expect(week.body.week.id).toBe(shopper.WEEK_ID);
    expect(week.body.week.id).not.toBe(CATALOGUE_ID);
    expect(text).not.toContain(CATALOGUE_ID);
    expect(text).not.toContain('public_specials_catalogue');
    expect(text).not.toMatch(/\/specials\b|catalogueUrl|sourceKind|validFrom|validTo|weekLabel|2026-08-25|2026-08-31/i);
    expect(week.body.priceNote).toBe('Prices vary by store and week.');
    expect(week.body.catalogue).toBeUndefined();
    const draft = await request(app).post('/api/shopper/draft').send({}).expect(200);
    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    for (const body of [draft.body, approved.body]) {
      const blob = JSON.stringify(body);
      expect(blob).not.toContain(CATALOGUE_ID);
      expect(blob).not.toContain('public_specials_catalogue');
      expect(blob).not.toMatch(/\/specials\b/);
      expect(blob).toContain('Prices vary by store and week.');
    }
    expect(draft.body.draft.lines.every((line) => line.aisle && (line.proteinLabel || line.swap !== undefined))).toBe(true);
    expect(draft.body.draft.recommendation.stores.length).toBe(1);
  });

  it('does not serve supermarket_api.js', async () => {
    const res = await request(app).get('/supermarket_api.js').expect(404);
    expect(res.text).not.toMatch(/getWeeklySpecials/);
    expect(fs.existsSync(path.join(__dirname, 'public', 'supermarket_api.js'))).toBe(false);
  });

  it('shopper and checkout handlers omit catalogue fields and specials links', async () => {
    const index = await request(app).get('/api/shopper').expect(200);
    const week = await request(app).get('/api/shopper/week').expect(200);
    const draft = await request(app).post('/api/shopper/draft').send({}).expect(200);
    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    for (const res of [index, week, draft, approved]) {
      expect(catalogueLeaks(res.body)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(CATALOGUE_ID);
    }
    expect(index.body.endpoints['GET /api/shopper/week']).toBe('Worked week');
    expect(index.body.endpoints['GET /api/shopper/week']).not.toMatch(/catalogue/i);
    expect(draft.body.draft.draftId).toBe(`draft_${shopper.WEEK_ID}`);
    expect(draft.body.draft.draftId).not.toContain(CATALOGUE_ID);
    const baskets = approved.body.trolley.checkout.baskets;
    const basketText = JSON.stringify(baskets);
    expect(basketText).not.toMatch(/specials/i);
    expect(basketText).not.toMatch(/catalogueUrl|onSpecial|assignedOnSpecial|sourceKind/);
  });
});

describe('Fitness Butler shopper honesty lock', () => {
  it('engine and page never scrape trolley APIs or raise Stripe Link grocery spend', () => {
    const files = [
      'lib/fitness-butler-shopper.js',
      'lib/staple-items.js',
      'shopper.js',
      'public/js/fm-shopper.js',
      'public/shopper.html',
    ].map(read).join('\n');

    expect(files).not.toMatch(/wowapi|\/shop\/apis|cart\/api/i);
    expect(files).not.toMatch(/payment_method_types|stripe\.checkout/i);
    expect(files).not.toMatch(/syncs with HealthKit|watchOS|HealthKit connected/i);
    expect(files).not.toContain('public_specials_catalogue');
    expect(files).not.toMatch(/worth the extra trip/);
    expect(files).toContain('takeaway');
  });

  it('drops the budget price endpoint, cheapest ranking, and cheaper claim', () => {
    expect(read('api_server.js')).not.toMatch(/shopping-list\/budget/);
    expect(read('app_fixes.js')).not.toMatch(/\bcheapest\b/);
    expect(read('post-outreach.js')).not.toMatch(/we're cheaper/);
    const hits = [];
    function walk(rel) {
      const abs = path.join(__dirname, rel);
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          walk(child);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        const needle = ['save beats a ', 'second trip'].join('');
        if (read(child).includes(needle)) hits.push(child);
      }
    }
    walk('.');
    expect(hits).toEqual([]);
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
