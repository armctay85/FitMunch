'use strict';

const db = require('./test/helpers/price-memory-db');
db.assertDatabaseUrl();

const request = require('supertest');
const app = require('./server');
const store = require('./lib/price-memory-store');

async function optIn(token) {
  await request(app)
    .put('/api/price-memory/consent')
    .set(db.auth(token))
    .send({ optIn: true, policyVersion: '2026-10', surface: 'ios_settings' })
    .expect(200);
}

async function save(token, date, price) {
  const res = await request(app)
    .post('/api/price-memory/receipts')
    .set(db.auth(token))
    .send({
      store: 'Aldi',
      purchasedOn: date,
      source: 'ios',
      items: [{ name: 'Rolled Oats 750g', quantity: 1, packSize: '750g', price, category: 'grains' }],
    })
    .expect(200);
  return res.body.priceMemory;
}

describe('price memory deletion and retention', () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    await db.resetDatabase();
  });

  afterAll(async () => {
    delete process.env.CRON_SECRET;
    await store.closeForTests();
    db.restoreEnv();
  });

  test('deleting one receipt removes only its observations', async () => {
    const user = await db.createUser('delete-one');
    await optIn(user.token);
    const first = await save(user.token, '2026-09-01', 4);
    const second = await save(user.token, '2026-09-02', 5);
    await request(app).delete('/api/price-memory/receipts/' + first.receiptId).set(db.auth(user.token)).expect(200);
    const list = await request(app).get('/api/price-memory/receipts').set(db.auth(user.token)).expect(200);
    expect(list.body.receipts.map((row) => row.id)).toEqual([second.receiptId]);
  });

  test('delete all keeps the consent audit', async () => {
    const user = await db.createUser('delete-all');
    await optIn(user.token);
    await save(user.token, '2026-09-03', 4);
    await request(app).delete('/api/price-memory').set(db.auth(user.token)).expect(200);
    const counts = await store.testingCountAll();
    const settings = await request(app).get('/api/price-memory/settings').set(db.auth(user.token)).expect(200);
    expect(settings.body.optedIn).toBe(true);
    expect(settings.body.receiptCount).toBe(0);
    expect(Number(counts.consents)).toBeGreaterThan(0);
  });

  test('omitting deleteHistory on opt-out deletes saved prices', async () => {
    const user = await db.createUser('toggle-default');
    await optIn(user.token);
    await save(user.token, '2026-09-04', 4);
    await request(app)
      .put('/api/price-memory/consent')
      .set(db.auth(user.token))
      .send({ optIn: false, policyVersion: '2026-10', surface: 'web_settings' })
      .expect(200);
    const settings = await request(app).get('/api/price-memory/settings').set(db.auth(user.token)).expect(200);
    expect(settings.body.receiptCount).toBe(0);
    expect(settings.body.optedIn).toBe(false);
  });

  test('account deletion leaves no price memory rows and a stale token is rejected', async () => {
    await db.resetDatabase();
    const user = await db.createUser('account-delete');
    await optIn(user.token);
    await save(user.token, '2026-09-05', 4);
    await request(app).delete('/api/auth/account').set(db.auth(user.token)).expect(200);
    const counts = await store.testingCountAll();
    expect(Number(counts.receipts)).toBe(0);
    expect(Number(counts.observations)).toBe(0);
    expect(Number(counts.consents)).toBe(0);
    expect(Number(counts.aliases)).toBe(0);
    const stale = await request(app)
      .post('/api/price-memory/receipts')
      .set(db.auth(user.token))
      .send({
        store: 'Aldi',
        purchasedOn: '2026-09-06',
        items: [{ name: 'Rolled Oats 750g', quantity: 1, price: 4, category: 'grains' }],
      });
    expect(stale.status).toBe(401);
  });

  test('purge removes receipts older than 18 months and can run twice', async () => {
    const user = await db.createUser('purge');
    await optIn(user.token);
    const old = await save(user.token, '2026-09-01', 4);
    const fresh = await save(user.token, '2026-09-02', 5);
    await store.testingAgeReceipt(user.id, old.receiptId, 19);
    const removed = await store.purgeExpired(user.id);
    expect(removed).toBeGreaterThan(0);
    const again = await store.purgeExpired(user.id);
    expect(again).toBe(0);
    const list = await request(app).get('/api/price-memory/receipts').set(db.auth(user.token)).expect(200);
    expect(list.body.receipts.map((row) => row.id)).toEqual([fresh.receiptId]);
  });

  test('the same receipt fingerprint is rejected', async () => {
    const user = await db.createUser('dup');
    await optIn(user.token);
    const first = await save(user.token, '2026-08-01', 4.2);
    expect(first.saved).toBe(1);
    const second = await save(user.token, '2026-08-01', 4.2);
    expect(second.saved).toBe(0);
    expect(second.reason).toBe('duplicate');
  });

  test('the purge route stays closed unless the cron secret is set', async () => {
    delete process.env.CRON_SECRET;
    const closed = await request(app).get('/api/price-memory/purge');
    expect(closed.status).toBe(503);
    process.env.CRON_SECRET = 'cron-test-secret';
    const denied = await request(app).get('/api/price-memory/purge');
    expect(denied.status).toBe(401);
    const ok = await request(app).get('/api/price-memory/purge').set('Authorization', 'Bearer cron-test-secret');
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    delete process.env.CRON_SECRET;
  });
});
