'use strict';

/**
 * Legacy coach-plan rows read back clean, against real Postgres (Elite QA
 * #103 r4 S). A row saved before the strip still carries prices, store ids,
 * catalogue blocks and pays* flags in its JSONB payload. It is planted with
 * raw SQL, so the save-side strip never sees it, then read back through the
 * real routes (and the coach-store reads behind them): GET /api/coach/plans, GET /api/coach/plans/:id and the
 * shared page /c/:token. Every one of those fields must be gone.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Drops and recreates its tables,
 * so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_coach_plan_legacy_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}

const request = require('supertest');
const jwt = require('jsonwebtoken');

const PT = '00000000-0000-4000-8000-00000000c0a1';
const PLAN_ID = 'legacy-plan-0001';
const TOKEN = 'legacyShareToken0001';

// Keys a legacy row may carry that must never come back out.
const BANNED = [
  'price', 'unitPrice', 'linePrice', 'lineAud', 'unitAud', 'totalAud', 'totalCents',
  'total', 'totals', 'subtotal', 'cost', 'estTotal', 'saving', 'savings', 'was',
  'store', 'storeId', 'storeName',
  'catalogue', 'catalogueUrl', 'pricesFrom', 'sourceKind', 'onSpecial', 'assignedOnSpecial',
  'priced', 'unpriced', 'unpricedCount', 'validFrom', 'validTo', 'weekLabel', 'pricedAt',
];
const isBanned = (k) => BANNED.includes(k) || /^pays/i.test(k);

// Real chain names, built here in the test only. No served file names one;
// the share page and PDF must not either, even when a legacy row does.
const CHAINS = ['Wool' + 'worths', 'Co' + 'les', 'Al' + 'di', 'I' + 'GA', 'Harris ' + 'Farm', 'Food' + 'works', 'Drakes'];
const CHAIN_RE = new RegExp(`\\b(?:${CHAINS.join('|')})\\b`, 'i');
const PRICE_RE = /(?:A?\$|AUD\s?)\s?\d+(?:\.\d{1,2})?/;

const legacyPayload = (status = 'sent') => ({
  id: PLAN_ID,
  ptId: PT,
  clientId: null,
  clientLabel: 'Legacy client',
  status,
  token: status === 'draft' ? null : TOKEN,
  storeId: 'store-legacy-7',
  storeName: CHAINS[0],
  totalAud: 142.5,
  paysSupermarket: true,
  paysStore: true,
  targets: { kcal: 2000, protein: 150, carbs: 200, fat: 60, paysStore: true },
  flags: [],
  householdSize: 1,
  plan: {
    title: 'Legacy week',
    store: CHAINS[1],
    storeId: 'store-legacy-7',
    storeName: 'Corner Grocer',
    totalAud: 142.5,
    totalCents: 14250,
    unpricedCount: 2,
    pricesFrom: `${CHAINS[2]} catalogue`,
    shoppingNote: `Cheapest at ${CHAINS[3]}, about $142.50 a week`,
    sourceKind: 'catalogue',
    catalogue: { url: 'https://example.invalid/catalogue', validFrom: '2025-08-20', validTo: '2025-08-26', weekLabel: 'W35' },
    catalogueUrl: 'https://example.invalid/catalogue',
    paysStore: true,
    paysSupermarket: true,
    paysGrocer: false,
    honesty: { paysSupermarket: true, paysStore: true, trolleyApi: false },
    targets: { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
    days: [{
      day: 'Monday',
      meals: [{
        name: 'Chicken rice bowl',
        price: 6.4,
        cost: 6.4,
        store: 'Corner Grocer',
        notes: `Grab it at ${CHAINS[0]} for $6.40`,
        ingredients: [{ name: 'Chicken breast', amount: 150, unit: 'g', price: 3.2, unitPrice: 12.99, onSpecial: true, store: 'Corner Grocer', paysStore: true }],
      }],
    }],
    shopping: {
      total: 142.5,
      subtotal: 140,
      estTotal: 142.5,
      savings: 9.1,
      items: [
        { name: 'Chicken breast', aisle: 'Meat', packs: 1, amount: 600, unit: 'g', linePrice: 12.99, unitPrice: 21.65, lineAud: 12.99, unitAud: 21.65, priced: true, onSpecial: true, assignedOnSpecial: true, was: 15.99, saving: 3, storeId: 'store-legacy-7', paysStore: true },
        { name: 'Brown rice', aisle: 'Pantry', packs: 1, amount: 1, unit: 'kg', price: 3.5, priced: true, store: 'Corner Grocer' },
      ],
    },
  },
  createdAt: '2025-08-20T00:00:00.000Z',
  updatedAt: '2025-08-20T00:00:00.000Z',
});

function bannedPaths(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => bannedPaths(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (isBanned(k)) out.push(`${path}.${k}`);
      bannedPaths(v, `${path}.${k}`, out);
    }
  }
  return out;
}

let pool;
let app;
let auth;

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  const store = require('./lib/coach-store');
  await pool.query('drop table if exists coach_plans, coach_branding cascade');
  await pool.query(store.DDL);
  store.resetMemory();
  await pool.query(`
    create table if not exists users (
      id uuid primary key,
      email text unique,
      name text,
      password_hash text,
      role text
    )
  `);
  await pool.query(
    `insert into users (id, email, name, password_hash, role)
     values ($1, 'legacy-pt@example.test', 'Legacy PT', 'x', 'pt')
     on conflict (id) do update set role = 'pt'`,
    [PT]
  );
  app = require('./server.js');
  const { jwtSecret } = require('./lib/fitmunch-checkout');
  auth = `Bearer ${jwt.sign({ userId: PT, role: 'pt' }, jwtSecret())}`;
});

beforeEach(async () => {
  if (!URL) return;
  require('./lib/coach-store').resetMemory();
  await pool.query('truncate coach_plans');
  await pool.query(
    `insert into coach_plans (id, pt_id, client_id, client_label, status, token, payload, sent_at, created_at, updated_at)
     values ($1, $2, null, 'Legacy client', 'sent', $3, $4, now(), now(), now())`,
    [PLAN_ID, PT, TOKEN, JSON.stringify(legacyPayload())]
  );
});

afterAll(async () => { if (pool) await pool.end(); });

maybe('legacy coach-plan row read back through the real routes (real SQL)', () => {
  it('the planted row really does carry every banned field', async () => {
    const { rows } = await pool.query('select payload from coach_plans where id = $1', [PLAN_ID]);
    const found = bannedPaths(rows[0].payload);
    for (const k of ['price', 'unitPrice', 'store', 'storeId', 'storeName', 'catalogue', 'paysStore', 'paysSupermarket', 'totalAud']) {
      expect(found.some((p) => p.endsWith(`.${k}`))).toBe(true);
    }
    expect(found.length).toBeGreaterThan(30);
  });

  it('GET /api/coach/plans/:id strips price, store, catalogue and pays* fields', async () => {
    const res = await request(app).get(`/api/coach/plans/${PLAN_ID}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.plan.id).toBe(PLAN_ID);
    expect(bannedPaths(res.body.plan)).toEqual([]);
    expect(res.body.plan.plan.days[0].meals[0].name).toBe('Chicken rice bowl');
    expect(res.body.plan.plan.shopping.items.map((i) => i.name)).toEqual(['Chicken breast', 'Brown rice']);
  });

  it('GET /api/coach/plans strips them from the list too', async () => {
    const res = await request(app).get('/api/coach/plans').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p) => p.id)).toEqual([PLAN_ID]);
    expect(bannedPaths(res.body.plans)).toEqual([]);
  });

  it('the store read functions return a clean row', async () => {
    const store = require('./lib/coach-store');
    // The whole row is clean straight off the read, not just .plan: a
    // top-level totalAud or pays* flag must not survive either.
    const byId = await store.getPlan(PLAN_ID, PT);
    const byToken = await store.getByToken(TOKEN);
    for (const row of [byId, byToken, ...(await store.listPlans(PT))]) {
      expect(bannedPaths(row)).toEqual([]);
      expect(row.totalAud).toBeUndefined();
      expect(row.paysSupermarket).toBeUndefined();
      expect(row.updatedAt).toBeTruthy();
      expect(row.targets.kcal).toBe(2000);
    }
  });

  it('the planted row really names real chains and $ prices', async () => {
    const { rows } = await pool.query('select payload::text as t from coach_plans where id = $1', [PLAN_ID]);
    expect(rows[0].t).toMatch(CHAIN_RE);
    expect(rows[0].t).toMatch(PRICE_RE);
  });

  it('the shared page /c/:token prints no chain name, $ price, store or catalogue text', async () => {
    const res = await request(app).get(`/c/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy client');
    expect(res.text).not.toMatch(CHAIN_RE);
    expect(res.text).not.toMatch(PRICE_RE);
    expect(res.text).not.toMatch(/store-legacy-7|142\.5|12\.99|21\.65|example\.invalid\/catalogue|W35/);
  });

  it('the shared PDF /c/:token/pdf prints no chain name, $ price, store or catalogue text', async () => {
    const res = await request(app)
      .get(`/c/${TOKEN}/pdf`)
      .buffer(true)
      .parse((r, cb) => { const bufs = []; r.on('data', (d) => bufs.push(d)); r.on('end', () => cb(null, Buffer.concat(bufs))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    const text = res.body.toString('latin1');
    expect(text.slice(0, 5)).toBe('%PDF-');
    expect(text).toContain('Legacy client');
    expect(text).toContain('Chicken rice bowl');
    expect(text).not.toMatch(CHAIN_RE);
    expect(text).not.toMatch(PRICE_RE);
    expect(text).not.toMatch(/store-legacy-7|142\.5|12\.99|21\.65|example\.invalid|W35/);
  });

  it('POST /api/coach/plans/:id/send on a legacy draft returns a clean plan and rewrites the row clean', async () => {
    await pool.query('truncate coach_plans');
    await pool.query(
      `insert into coach_plans (id, pt_id, client_id, client_label, status, token, payload, created_at, updated_at)
       values ($1, $2, null, 'Legacy client', 'draft', null, $3, now(), now())`,
      [PLAN_ID, PT, JSON.stringify(legacyPayload('draft'))]
    );
    const res = await request(app).post(`/api/coach/plans/${PLAN_ID}/send`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.plan.status).toBe('sent');
    expect(res.body.plan.sharePath).toMatch(/^\/c\//);
    expect(bannedPaths(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(CHAIN_RE);
    const { rows } = await pool.query('select payload from coach_plans where id = $1', [PLAN_ID]);
    expect(rows[0].payload.status).toBe('sent');
    expect(bannedPaths(rows[0].payload)).toEqual([]);
    const page = await request(app).get(res.body.plan.sharePath);
    expect(page.status).toBe(200);
    expect(page.text).not.toMatch(CHAIN_RE);
    expect(page.text).not.toMatch(PRICE_RE);
  });
});
