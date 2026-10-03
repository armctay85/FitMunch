'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./test/helpers/price-memory-db');
db.assertDatabaseUrl();

const request = require('supertest');
const app = require('./server');
const flags = require('./lib/price-memory-flags');
const store = require('./lib/price-memory-store');

async function save(token, date, price, label) {
  const res = await request(app)
    .post('/api/price-memory/receipts')
    .set(db.auth(token))
    .send({
      store: 'Coles',
      purchasedOn: date,
      source: 'web',
      items: [{ name: label, quantity: 1, packSize: '1kg', price, category: 'meat' }],
    });
  expect(res.status).toBe(200);
  return res;
}

describe('price memory isolation', () => {
  jest.setTimeout(30000);
  let a;
  let b;
  let pt;

  beforeAll(async () => {
    await db.resetDatabase();
    a = await db.createUser('user-a');
    b = await db.createUser('user-b');
    pt = await db.createUser('trainer', 'pt');
    await db.linkTrainer(pt.id, a.id);
    for (const user of [a, b]) {
      await request(app)
        .put('/api/price-memory/consent')
        .set(db.auth(user.token))
        .send({ optIn: true, policyVersion: '2026-10', surface: 'web_settings' })
        .expect(200);
    }
    await save(a.token, '2026-09-12', 11, 'WW Chicken Breast 1kg');
    await save(b.token, '2026-09-12', 8.5, 'WW Chicken Breast 1kg');
  });

  afterAll(async () => {
    await store.closeForTests();
    db.restoreEnv();
  });

  test('lookup returns only the caller figures', async () => {
    const lookA = await request(app).post('/api/price-memory/lookup').set(db.auth(a.token)).send({ keys: ['chicken-breast'] }).expect(200);
    const lookB = await request(app).post('/api/price-memory/lookup').set(db.auth(b.token)).send({ keys: ['chicken-breast'] }).expect(200);
    expect(lookA.body.results['chicken-breast'].lastPaid.cents).toBe(1100);
    expect(lookB.body.results['chicken-breast'].lastPaid.cents).toBe(850);
  });

  test('row level security hides the other user even if the filter is widened', async () => {
    expect(await store.visibleObservationCount(a.id)).toBe(1);
    expect(await store.visibleObservationCount(b.id)).toBe(1);
  });

  test('A cannot read, correct or delete B receipts', async () => {
    const listB = await request(app).get('/api/price-memory/receipts').set(db.auth(b.token)).expect(200);
    const id = listB.body.receipts[0].id;
    const detail = await request(app).get('/api/price-memory/receipts/' + id).set(db.auth(b.token)).expect(200);
    const observationId = detail.body.receipt.observations[0].id;
    await request(app).get('/api/price-memory/receipts/' + id).set(db.auth(a.token)).expect(404);
    await request(app).patch('/api/price-memory/observations/' + observationId).set(db.auth(a.token)).send({ itemKey: 'oats' }).expect(404);
    await request(app).delete('/api/price-memory/receipts/' + id).set(db.auth(a.token)).expect(404);
    const again = await request(app).get('/api/price-memory/receipts/' + id).set(db.auth(b.token)).expect(200);
    expect(again.body.receipt.observations[0].item_key).toBe('chicken-breast');
  });

  test('a userId in the body or query is ignored', async () => {
    const res = await request(app)
      .post('/api/price-memory/lookup?userId=' + b.id)
      .set(db.auth(a.token))
      .send({ userId: b.id, keys: ['chicken-breast'] })
      .expect(200);
    expect(res.body.results['chicken-breast'].lastPaid.cents).toBe(1100);
  });

  test('a linked trainer cannot read price memory', async () => {
    const listA = await request(app).get('/api/price-memory/receipts').set(db.auth(a.token)).expect(200);
    const id = listA.body.receipts[0].id;
    const asPt = await request(app).get('/api/price-memory/receipts').set(db.auth(pt.token)).expect(200);
    expect(asPt.body.receipts).toEqual([]);
    await request(app).get('/api/price-memory/receipts/' + id).set(db.auth(pt.token)).expect(404);
    const lookup = await request(app).post('/api/price-memory/lookup').set(db.auth(pt.token)).send({ keys: ['chicken-breast'] }).expect(200);
    expect(lookup.body.results['chicken-breast']).toBeNull();
  });

  test('pooled prices stay off and no crowd route exists', () => {
    expect(flags.POOLED_PRICES_ALLOWED).toBe(false);
    const routes = fs.readFileSync(path.join(__dirname, 'lib/price-memory-routes.js'), 'utf8');
    expect(routes).not.toMatch(/['"`]\/[^'"`]*(pool|community|average|crowd)/i);
    expect(fs.readFileSync(path.join(__dirname, 'lib/price-memory-flags.js'), 'utf8')).toMatch(/POOLED_PRICES_ALLOWED = false/);
  });

  test('price memory SQL stays inside the store module', () => {
    const verb = new RegExp(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].join('|'), 'i');
    const named = new RegExp(['price_observations', 'price_memory_consents', 'price_memory_aliases'].join('|'), 'i');
    const receiptSql = new RegExp('(?:FROM|JOIN|INTO)\\s+receipts\\b', 'i');
    const skip = new Set(['node_modules', 'coverage', '.git']);
    const hits = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|mjs|cjs|sql)$/.test(entry.name)) continue;
        if (full.endsWith(path.join('lib', 'price-memory-store.js'))) continue;
        if (full.endsWith(path.join('lib', 'db-migrate.js'))) continue;
        if (full.endsWith(path.join('shared', 'schema.js')) || full.endsWith(path.join('shared', 'schema.ts'))) continue;
        const text = fs.readFileSync(full, 'utf8');
        const sqlLine = text.split('\n').some((line) => verb.test(line) && (named.test(line) || receiptSql.test(line)));
        if (sqlLine) hits.push(path.relative(__dirname, full));
      }
    }
    walk(__dirname);
    expect(hits).toEqual([]);
  });
});
