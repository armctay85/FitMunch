'use strict';

const db = require('./test/helpers/price-memory-db');
db.assertDatabaseUrl();

const request = require('supertest');
const app = require('./server');
const receiptRouter = require('./receipt-scanner');
const store = require('./lib/price-memory-store');

const TINY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function chickenVision(extra) {
  return async () => ({
    ok: true,
    text: JSON.stringify(Object.assign({
      store: 'Coles',
      purchasedOn: '2026-09-12',
      items: [{
        name: 'WW Chicken Breast 1kg',
        quantity: 1,
        unit: 'kg',
        packSize: '1kg',
        price: 11,
        category: 'meat',
      }],
    }, extra || {})),
  });
}

async function scan(token, vision) {
  receiptRouter._setVisionForTests(vision);
  const res = await request(app)
    .post('/api/receipt/scan')
    .set(db.auth(token))
    .send({ image: TINY.toString('base64'), mimeType: 'image/png' });
  receiptRouter._setVisionForTests(null);
  return res;
}

describe('price memory consent and capture', () => {
  jest.setTimeout(30000);
  let user;

  beforeAll(async () => {
    await db.resetDatabase();
    user = await db.createUser('consent');
  });

  afterAll(async () => {
    receiptRouter._setVisionForTests(null);
    process.env.PRICE_MEMORY_ENABLED = 'true';
    await store.closeForTests();
    db.restoreEnv();
  });

  test('a new user is opted out and a scan saves nothing', async () => {
    const settings = await request(app).get('/api/price-memory/settings').set(db.auth(user.token)).expect(200);
    expect(settings.body.optedIn).toBe(false);
    const res = await scan(user.token, chickenVision());
    expect(res.body.success).toBe(true);
    expect(res.body.priceMemory.reason).toBe('not_opted_in');
    expect(res.body.priceMemory.saved).toBe(0);
    const counts = await store.testingCountAll();
    expect(Number(counts.observations)).toBe(0);
  });

  test('the flag off saves nothing and routes 404', async () => {
    process.env.PRICE_MEMORY_ENABLED = 'false';
    const res = await scan(user.token, chickenVision());
    expect(res.body.priceMemory.reason).toBe('disabled');
    const denied = await request(app).get('/api/price-memory/receipts').set(db.auth(user.token));
    expect(denied.status).toBe(404);
    const settings = await request(app).get('/api/price-memory/settings').set(db.auth(user.token)).expect(200);
    expect(settings.body.enabled).toBe(false);
    process.env.PRICE_MEMORY_ENABLED = 'true';
  });

  test('opt in records the policy version and surface, then a scan saves', async () => {
    const consent = await request(app)
      .put('/api/price-memory/consent')
      .set(db.auth(user.token))
      .send({ optIn: true, policyVersion: '2026-10', surface: 'web_scan' })
      .expect(200);
    expect(consent.body.optedIn).toBe(true);
    const state = await store.getConsent(user.id);
    expect(state.optedIn).toBe(true);
    expect(state.policyVersion).toBe('2026-10');
    expect(state.surface).toBe('web_scan');
    const res = await scan(user.token, chickenVision());
    expect(res.body.priceMemory.saved).toBe(1);
    expect(res.body.priceMemory.receiptId).toBeTruthy();
  });

  test('opt out stops capture and lookup returns null while kept rows stay hidden', async () => {
    await request(app)
      .put('/api/price-memory/consent')
      .set(db.auth(user.token))
      .send({ optIn: false, policyVersion: '2026-10', surface: 'web_settings', deleteHistory: false })
      .expect(200);
    const res = await scan(user.token, chickenVision({ purchasedOn: '2026-09-13' }));
    expect(res.body.priceMemory.reason).toBe('not_opted_in');
    const lookup = await request(app)
      .post('/api/price-memory/lookup')
      .set(db.auth(user.token))
      .send({ keys: ['chicken-breast'] })
      .expect(200);
    expect(lookup.body.results['chicken-breast']).toBeNull();
    const counts = await store.testingCountAll();
    expect(Number(counts.receipts)).toBe(1);
  });

  test('a fallback scan never saves sample prices', async () => {
    await request(app)
      .put('/api/price-memory/consent')
      .set(db.auth(user.token))
      .send({ optIn: true, policyVersion: '2026-10', surface: 'web_settings', deleteHistory: false })
      .expect(200);
    const before = await store.testingCountAll();
    const res = await scan(user.token, async () => ({ ok: false, error: 'vision_failed' }));
    expect(res.body.scannerProvider).toBe('fallback');
    expect(res.body.priceMemory.reason).toBe('fallback');
    expect(res.body.priceMemory.saved).toBe(0);
    const after = await store.testingCountAll();
    expect(Number(after.observations)).toBe(Number(before.observations));
  });

  test('first-scan never writes, even with a token', async () => {
    const before = await store.testingCountAll();
    receiptRouter._setVisionForTests(chickenVision());
    await request(app)
      .post('/api/receipt/first-scan')
      .set(db.auth(user.token))
      .send({ image: TINY.toString('base64'), mimeType: 'image/png' })
      .expect(200);
    receiptRouter._setVisionForTests(null);
    const after = await store.testingCountAll();
    expect(Number(after.receipts)).toBe(Number(before.receipts));
    expect(Number(after.observations)).toBe(Number(before.observations));
  });

  test('pharmacy, gift cards, card digits and addresses are not stored', async () => {
    const before = Number((await store.testingCountAll()).observations);
    const res = await scan(user.token, async () => ({
      ok: true,
      text: JSON.stringify({
        store: '12 King Street Coles',
        purchasedOn: '2026-09-20',
        items: [
          { name: 'Panadol 20pk', quantity: 1, price: 6, category: 'other' },
          { name: 'Gift card 50', quantity: 1, price: 50, category: 'other' },
          { name: 'Visa 4242424242424242', quantity: 1, price: 12, category: 'other' },
          { name: 'Everyday Rewards 123456789012', quantity: 1, price: 1, category: 'other' },
          { name: 'WW Chicken Breast 1kg', quantity: 1, packSize: '1kg', price: 11, category: 'meat' },
        ],
      }),
    }));
    expect(res.body.priceMemory.saved).toBe(1);
    const exported = await request(app).get('/api/price-memory/export').set(db.auth(user.token)).expect(200);
    const blob = JSON.stringify(exported.body);
    expect(blob).not.toMatch(/4242424242424242|Panadol|Gift card|King Street|Everyday Rewards/i);
    expect(blob).toMatch(/Chicken Breast/i);
    const after = Number((await store.testingCountAll()).observations);
    expect(after - before).toBe(1);
  });
});
