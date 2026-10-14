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

const PT = 'pt-legacy-0001';
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

const legacyPayload = () => ({
  id: PLAN_ID,
  ptId: PT,
  clientId: null,
  clientLabel: 'Legacy client',
  status: 'sent',
  token: TOKEN,
  storeId: 'store-legacy-7',
  storeName: 'Corner Grocer',
  totalAud: 142.5,
  targets: { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
  flags: [],
  householdSize: 1,
  plan: {
    title: 'Legacy week',
    store: 'Corner Grocer',
    storeId: 'store-legacy-7',
    storeName: 'Corner Grocer',
    totalAud: 142.5,
    totalCents: 14250,
    unpricedCount: 2,
    pricesFrom: 'Corner Grocer catalogue',
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
    // Row-level extras (e.g. a stray totalAud) never leave publicPlan's
    // allow-list; the plan JSON itself must be clean straight off the read.
    expect(bannedPaths((await store.getPlan(PLAN_ID, PT)).plan)).toEqual([]);
    expect(bannedPaths((await store.listPlans(PT)).map((r) => r.plan))).toEqual([]);
    expect(bannedPaths((await store.getByToken(TOKEN)).plan)).toEqual([]);
  });

  it('the shared page /c/:token prints no price, store or catalogue text', async () => {
    const res = await request(app).get(`/c/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy client');
    expect(res.text).not.toMatch(/Corner Grocer|store-legacy-7|142\.5|12\.99|21\.65|example\.invalid\/catalogue|W35/);
  });
});
