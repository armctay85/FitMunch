'use strict';

const db = require('./test/helpers/price-memory-db');
db.assertDatabaseUrl();

const request = require('supertest');
const app = require('./server');
const estimate = require('./lib/price-memory-estimate');
const store = require('./lib/price-memory-store');
const copy = require('./lib/price-memory-copy');

function row(overrides) {
  return Object.assign({
    id: 1,
    receipt_id: 'r1',
    store_id: 'coles',
    store_label: null,
    purchased_on: '2026-09-12',
    pack_size_value: 1000,
    pack_size_unit: 'g',
    unit_price_cents: 1100,
    unit_rate_cents: 1100,
    unit_rate_basis: 'per_kg',
    promo_flag: false,
  }, overrides);
}

describe('price memory estimates', () => {
  jest.setTimeout(30000);

  afterAll(async () => {
    await store.closeForTests();
    db.restoreEnv();
  });

  test('no rows is null, one row has no range, three dates do', () => {
    expect(estimate.buildMemo([], null, '2026-10-03')).toBeNull();
    const one = estimate.buildMemo([row({})], null, '2026-10-03');
    expect(one.lastPaid.cents).toBe(1100);
    expect(one.range).toBeNull();
    expect(one.ageBand).toBe('recent');
    const many = estimate.buildMemo([
      row({ id: 1, purchased_on: '2026-09-01', unit_price_cents: 1000, receipt_id: 'a' }),
      row({ id: 2, purchased_on: '2026-09-10', unit_price_cents: 1250, receipt_id: 'b' }),
      row({ id: 3, purchased_on: '2026-09-12', unit_price_cents: 1100, receipt_id: 'c' }),
    ], null, '2026-10-03');
    expect(many.lastPaid.cents).toBe(1100);
    expect(many.range.minCents).toBe(1000);
    expect(many.range.maxCents).toBe(1250);
    expect(many.range.receipts).toBe(3);
    expect(copy.rangeLine(many, new Date('2026-10-03T00:00:00Z'))).toMatch(/You paid A\$10\.00 to A\$12\.50/);
  });

  test('older than 90 days is marked older and a known pack difference shows the unit rate', () => {
    const older = estimate.buildMemo([
      row({ purchased_on: '2026-06-01' }),
    ], null, '2026-10-03');
    expect(older.ageBand).toBe('older');
    const rate = estimate.buildMemo([
      row({ pack_size_value: 1000, unit_rate_cents: 1100, unit_rate_basis: 'per_kg', unit_price_cents: 1100 }),
    ], { value: 500, unit: 'g' }, '2026-10-03');
    expect(rate.lastPaid.showUnitRate).toBe(true);
    expect(rate.lastPaid.cents).toBe(1100);
    expect(copy.lastPaidLine(rate, new Date('2026-10-03T00:00:00Z'))).toMatch(/A\$11\.00\/kg/);
  });

  test('an unknown list pack keeps the observed pack price and does not scale quantity', () => {
    const memo = estimate.buildMemo([
      row({ pack_size_value: 500, pack_size_unit: 'g', unit_price_cents: 550, unit_rate_cents: 1100 }),
    ], null, '2026-10-03');
    expect(memo.lastPaid.showUnitRate).toBe(false);
    expect(memo.lastPaid.packQualifier).toBe(true);
    expect(memo.lastPaid.cents).toBe(550);
    expect(copy.lastPaidLine(memo, new Date('2026-10-03T00:00:00Z'))).toMatch(/A\$5\.50 for 500 g/);
  });

  test('lookup ignores rows older than 180 days and low confidence until a correction', async () => {
    await db.resetDatabase();
    const user = await db.createUser('estimate');
    await request(app).put('/api/price-memory/consent').set(db.auth(user.token)).send({
      optIn: true, policyVersion: '2026-10', surface: 'web_scan',
    }).expect(200);
    const fresh = await request(app).post('/api/price-memory/receipts').set(db.auth(user.token)).send({
      store: 'Coles',
      purchasedOn: '2026-09-12',
      items: [
        { name: 'WW Chicken Breast 1kg', quantity: 1, packSize: '1kg', price: 11, category: 'meat' },
        { name: 'Mystery snack bar', quantity: 1, price: 3, category: 'other' },
      ],
    }).expect(200);
    expect(fresh.body.priceMemory.saved).toBe(2);
    await store.testingAgeReceipt(user.id, fresh.body.priceMemory.receiptId, 7);
    const stale = await request(app).post('/api/price-memory/lookup').set(db.auth(user.token)).send({
      keys: ['chicken-breast'],
    }).expect(200);
    expect(stale.body.results['chicken-breast']).toBeNull();

    const recent = await request(app).post('/api/price-memory/receipts').set(db.auth(user.token)).send({
      store: 'Woolworths',
      purchasedOn: '2026-09-20',
      items: [{ name: 'Mystery snack bar', quantity: 1, price: 3.5, category: 'other' }],
    }).expect(200);
    const hidden = await request(app).post('/api/price-memory/lookup').set(db.auth(user.token)).send({
      labels: ['Mystery snack bar'],
    }).expect(200);
    const hiddenKey = hidden.body.keysByLabel['Mystery snack bar'];
    expect(hidden.body.results[hiddenKey]).toBeNull();

    const detail = await request(app).get('/api/price-memory/receipts/' + recent.body.priceMemory.receiptId).set(db.auth(user.token)).expect(200);
    const observationId = detail.body.receipt.observations[0].id;
    await request(app).patch('/api/price-memory/observations/' + observationId).set(db.auth(user.token)).send({
      itemKey: 'oats',
    }).expect(200);
    const shown = await request(app).post('/api/price-memory/lookup').set(db.auth(user.token)).send({
      keys: ['oats'],
    }).expect(200);
    expect(shown.body.results.oats.lastPaid.cents).toBe(350);

    const next = await request(app).post('/api/price-memory/receipts').set(db.auth(user.token)).send({
      store: 'Aldi',
      purchasedOn: '2026-09-28',
      items: [{ name: 'Mystery snack bar', quantity: 1, price: 4, category: 'other' }],
    }).expect(200);
    const aliased = await request(app).get('/api/price-memory/receipts/' + next.body.priceMemory.receiptId).set(db.auth(user.token)).expect(200);
    expect(aliased.body.receipt.observations[0].item_key).toBe('oats');
    expect(aliased.body.receipt.observations[0].item_key_source).toBe('user');
  });

  test('a shopper sku pack that matches the receipt shows the pack price, not a qualifier', async () => {
    await db.resetDatabase();
    const user = await db.createUser('estimate-pack');
    await request(app).put('/api/price-memory/consent').set(db.auth(user.token)).send({
      optIn: true, policyVersion: '2026-10', surface: 'web_scan',
    }).expect(200);
    await request(app).post('/api/price-memory/receipts').set(db.auth(user.token)).send({
      store: 'Coles',
      purchasedOn: '2026-09-12',
      items: [{ name: 'WW Chicken Breast 1kg', quantity: 1, price: 11, category: 'meat' }],
    }).expect(200);
    const found = await request(app).post('/api/price-memory/lookup').set(db.auth(user.token)).send({
      labels: ['chicken-breast-1kg'],
    }).expect(200);
    const memo = found.body.results['chicken-breast'];
    expect(memo.lastPaid.cents).toBe(1100);
    expect(memo.lastPaid.packQualifier).toBe(false);
    expect(memo.lastPaid.showUnitRate).toBe(false);
    expect(copy.lastPaidLine(memo, new Date('2026-10-03T00:00:00Z'))).toBe('Your last paid: A$11.00 at Coles (12 Sep)');
  });
});
