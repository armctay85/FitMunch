'use strict';

/**
 * Diet-only onboarding must not wipe saved allergies (EQA on #149).
 * Save kiwi and peanut, then POST a diet with profileUpdatedAt and no allergies key.
 * The allergies column has to still be kiwi and peanut.
 *
 * Own schema, so it never drops tables other Postgres suites use.
 * Needs TEST_DATABASE_URL (CI). Skipped locally without it; fails in CI if missing.
 * Every pool this file opens is ended in afterAll (CI previously hit "too many clients").
 */
const BASE = process.env.TEST_DATABASE_URL;
if (!BASE && process.env.CI) throw new Error('test_diet_filter_onboarding_pg: TEST_DATABASE_URL is required in CI');
if (BASE && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(BASE)) throw new Error('TEST_DATABASE_URL looks like a real database');

const SCHEMA = 'diet_filter_onboard_test';
const URL = BASE && `${BASE}${BASE.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const maybe = BASE ? describe : describe.skip;
const PREV_DB = process.env.DATABASE_URL;
if (URL) process.env.DATABASE_URL = URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'diet-filter-onboard-pg';

const USER = '00000000-0000-4000-8000-0000000d1491';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let pool;
let app;
const auth = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;

beforeAll(async () => {
  if (!BASE) return;
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: BASE });
  await admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
  await admin.end();
  pool = new Pool({ connectionString: URL });
  await pool.query(require('./lib/db-migrate').DDL);
  app = express();
  app.use(express.json());
  app.use('/api', require('./api_server'));
});

afterAll(async () => {
  if (!BASE) return;
  const ended = new Set();
  const stop = async (p) => {
    if (!p || ended.has(p) || typeof p.end !== 'function') return;
    ended.add(p);
    try { await p.end(); } catch (_) { /* already closed */ }
  };
  await stop(pool);
  try { await stop(require('./server/storage.js').__profileTx.pool); } catch (_) { /* storage not loaded */ }
  try { await stop(require('./lib/db-migrate').getPool()); } catch (_) { /* migrate pool not opened */ }
  try { await stop(require('./api_server').__pool); } catch (_) { /* api not loaded */ }
  if (PREV_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = PREV_DB;
});

maybe('diet-only onboarding keeps saved allergies (real SQL)', () => {
  it('saves kiwi and peanut, then a gluten free save with no allergies key leaves them in place', async () => {
    const first = await request(app).post('/api/user/profile').set('Authorization', auth).send({
      allergies: ['kiwi', 'peanut'],
    });
    expect(first.status).toBe(200);

    const loaded = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', auth);
    expect(loaded.status).toBe(200);
    expect(loaded.body.profile.allergies).toEqual(['kiwi', 'peanut']);
    const updatedAt = loaded.body.profile.updatedAt;
    expect(typeof updatedAt).toBe('string');

    const dietOnly = await request(app).post('/api/user/profile').set('Authorization', auth).send({
      dietaryPreferences: ['gluten free'],
      profileUpdatedAt: updatedAt,
    });
    expect(dietOnly.status).toBe(200);
    expect(dietOnly.body.success).toBe(true);

    const row = (await pool.query(
      'select allergies, dietary_preferences from user_profiles where user_id = $1 order by id limit 1',
      [USER],
    )).rows[0];
    expect(row.allergies).toEqual(['kiwi', 'peanut']);
    expect(row.dietary_preferences).toEqual(['gluten free']);

    const again = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', auth);
    expect(again.body.profile.allergies).toEqual(['kiwi', 'peanut']);
    expect(again.body.profile.dietaryPreferences).toEqual(['gluten free']);
  });
});
