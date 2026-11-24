'use strict';
/**
 * EQA locked acceptance, FitMunch CI-5 (class D: fake green). Owned by Elite QA.
 * LOCKED 24 Nov 2026 AEDT. REAL Postgres only (jest.yml postgres:16 service), never pg-mem or mocks.
 * Rule: DELETE /api/auth/account returns 200 and COMMITS (users row gone) whether every optional table exists or
 * any one of them (or all of them) is missing. A swallowed error inside an open transaction (25P02) must fail this.
 * Needs TEST_DATABASE_URL. Skipped locally without it; THROWS in CI if it is missing (no silent skip).
 * Own schema eqa_ci5_delete. No Stripe: STRIPE_SECRET_KEY is removed for this file.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const BASE = process.env.TEST_DATABASE_URL;
if (!BASE && process.env.CI) throw new Error('test_eqa_ci5_delete_pg: TEST_DATABASE_URL is required in CI');
if (BASE && /neon|supabase|amazonaws|vercel|railway|fitmunch\.com/i.test(BASE)) {
  throw new Error('TEST_DATABASE_URL looks like a real database');
}
const SCHEMA = 'eqa_ci5_delete';
const URL = BASE && `${BASE}${BASE.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const maybe = BASE ? describe : describe.skip;
const PREV = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL, stripe: process.env.STRIPE_SECRET_KEY };
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
delete process.env.STRIPE_SECRET_KEY;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_eqa_ci5';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server.js');
const { ensureSchema, getPool, DDL } = require('./lib/db-migrate');
const { endAppPools } = require('./test/end-app-pools');

// The four tables named in the CI-5 ticket, plus support_messages (the r5/r7 M4 delete table).
const OPTIONAL = ['pt_leads', 'client_invitations', 'stripe_claim_tokens', 'ai_usage_monthly', 'support_messages'];
const PT_LEADS_DDL = 'CREATE TABLE IF NOT EXISTS pt_leads (id SERIAL PRIMARY KEY, email TEXT UNIQUE, source TEXT, created_at TIMESTAMPTZ DEFAULT NOW())';
const USER = '00000000-0000-4000-8000-00000000c5a1';
const EMAIL = 'eqa-ci5-delete@example.com';
const bearer = () => `Bearer ${jwt.sign({ userId: USER, name: 'EQA', email: EMAIL }, process.env.JWT_SECRET)}`;

async function restoreAll(pool) {
  await pool.query(DDL);
  await pool.query(PT_LEADS_DDL);
  for (const t of OPTIONAL) {
    const r = await pool.query('SELECT to_regclass($1) AS t', [`${SCHEMA}.${t}`]);
    if (!r.rows[0].t) throw new Error(`setup: ${t} was not restored`);
  }
}
async function seedUser(pool) {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query(
    "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, 'EQA CI5', 'x')",
    [USER, EMAIL]
  );
}
async function deleteAndProve(pool, missing) {
  for (const t of missing) await pool.query(`DROP TABLE IF EXISTS ${SCHEMA}.${t} CASCADE`);
  for (const t of missing) {
    const r = await pool.query('SELECT to_regclass($1) AS t', [`${SCHEMA}.${t}`]);
    expect(r.rows[0].t).toBe(null);
  }
  const res = await request(app).delete('/api/auth/account').set('Authorization', bearer());
  const left = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE id=$1', [USER]);
  return { status: res.status, success: res.body && res.body.success, usersLeft: left.rows[0].n };
}

maybe('EQA CI-5: account delete commits on real Postgres with any optional table missing', () => {
  jest.setTimeout(30000);
  let pool;

  beforeAll(async () => {
    const { Pool } = require('pg');
    const admin = new Pool({ connectionString: BASE });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    const ready = await ensureSchema();
    if (!ready) throw new Error('schema was not ensured');
    pool = getPool();
  });

  beforeEach(async () => {
    await restoreAll(pool);
    await seedUser(pool);
  });

  afterAll(async () => {
    await endAppPools();
    for (const [k, v] of [['DATABASE_URL', PREV.url], ['DATABASE_SSL', PREV.ssl], ['STRIPE_SECRET_KEY', PREV.stripe]]) {
      if (v == null) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('D0 control: every optional table present, delete is 200 and the users row is gone', async () => {
    expect(await deleteAndProve(pool, [])).toEqual({ status: 200, success: true, usersLeft: 0 });
  });

  for (const t of OPTIONAL) {
    test(`D1 ${t} missing: delete is 200 and commits (no 25P02 abort)`, async () => {
      expect(await deleteAndProve(pool, [t])).toEqual({ status: 200, success: true, usersLeft: 0 });
    });
  }

  test('D2 all optional tables missing at once: delete is 200 and commits', async () => {
    expect(await deleteAndProve(pool, OPTIONAL)).toEqual({ status: 200, success: true, usersLeft: 0 });
  });

  test('D3 the database connection is usable after the matrix (no aborted transaction left on a pooled client)', async () => {
    await deleteAndProve(pool, ['ai_usage_monthly']);
    const r = await pool.query('SELECT 1 AS ok');
    expect(r.rows[0].ok).toBe(1);
    const probe = await request(app).delete('/api/auth/account').set('Authorization', bearer());
    expect([200, 404]).toContain(probe.status);
  });
});
