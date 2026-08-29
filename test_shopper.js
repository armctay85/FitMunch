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

describe('Fitness Butler shopper HTTP', () => {
  it('GET /shopper is its own surface and does not fight the homepage job', async () => {
    const page = await request(app).get('/shopper').expect(200);
    expect(page.text).toContain('Commit the week. Take the trolley.');
    expect(page.text).toContain('class="skip"');
    expect(read('public/css/fm-shopper.css')).toMatch(/\.skip\{[\s\S]*transform:translateY\(-160%\)/);
    expect(page.text).toContain('data-sp-commit');
    expect(page.text).toContain('Approve this trolley');
    expect(page.text).toContain('public specials');
    expect(page.text).toContain('Premium <strong>$19.99 AUD/mo</strong>');
    expect(page.text).toContain('Start Premium trial, $19.99/mo');
    expect(page.text).toContain('web app');
    expect(page.text).toContain('Add to Home Screen');
    expect(page.text).not.toContain('Photograph your receipt');
    expect(page.text).not.toMatch(/syncs with (Apple Watch|HealthKit)/i);
    expect(page.text).not.toMatch(/HealthKit connected/i);
    expect(page.text).not.toContain('we already pay Woolies');
    expect(page.text).not.toContain('we pay Woolworths');
    expect(page.text).toContain('We do not pay Woolies');
    expect(page.text).toContain('Stripe Link is not used for this shop');
    expect(page.text).toContain('No Apple Watch. No HealthKit.');

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
    expect(css).toMatch(/\.sp-day\{[\s\S]*?background:#04100a/);
    expect(css).toMatch(/\.sp-day b\{[\s\S]*?color:#7dffa3/);
    expect(css).toMatch(/\.sp-day span\{[\s\S]*?color:#f4f7f4/);
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
    expect(draft.body.draft.catalogue.sourceKind).toBe('public_specials_catalogue');
    expect(draft.body.draft.honesty.trolleyApi).toBe(false);
    expect(draft.body.draft.honesty.stripeLinkGrocery).toBe(false);

    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    expect(approved.body.trolley.status).toBe('approved');
    expect(approved.body.trolley.checkout.kind).toBe('takeaway');
    expect(approved.body.trolley.checkout.stripeLink).toBe(false);
    expect(JSON.stringify(approved.body)).not.toMatch(/payment_intent|checkout\.sessions/i);
  });
});

describe('Fitness Butler shopper honesty lock', () => {
  it('engine and page never scrape trolley APIs or raise Stripe Link grocery spend', () => {
    const files = [
      'lib/fitness-butler-shopper.js',
      'lib/public-specials-catalogue.js',
      'shopper.js',
      'public/js/fm-shopper.js',
      'public/shopper.html',
    ].map(read).join('\n');

    expect(files).not.toMatch(/wowapi|\/shop\/apis|cart\/api/i);
    expect(files).not.toMatch(/payment_method_types|stripe\.checkout/i);
    expect(files).not.toMatch(/syncs with HealthKit|watchOS|HealthKit connected/i);
    expect(files).toContain('public_specials_catalogue');
    expect(files).toContain('takeaway');
  });

  it('leaves the $19.99 Premium trial path untouched', () => {
    const checkout = read('lib/fitmunch-checkout.js');
    expect(checkout).toContain("'premium':    'price_1ToYrXGMuYRuJYDrwHtvWD1c'");
    expect(checkout).toContain('const TRIAL_PERIOD_DAYS = 14');
    expect(checkout).toContain("payment_method_collection: 'always'");
    expect(checkout).not.toMatch(/shopper grocery|woolworths spend/i);
  });
});
