'use strict';

/**
 * POST /api/progress/log and the goal-weight stored-weight lookup against real Postgres (#115 follow-ups):
 * weight 25-400 kg, no dates more than a day ahead, only whitelisted columns written, and a
 * future-dated log never counts as the current weight. Runs in its own schema so it never touches the
 * tables other PG tests drop and recreate.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally without it; fails in CI if missing.
 */
const BASE = process.env.TEST_DATABASE_URL;
if (!BASE && process.env.CI) throw new Error('test_progress_log_pg: TEST_DATABASE_URL is required in CI');
if (BASE && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(BASE)) throw new Error('TEST_DATABASE_URL looks like a real database');
const SCHEMA = 'progress_log_test';
const URL = BASE && `${BASE}${BASE.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const maybe = BASE ? describe : describe.skip;
if (URL) process.env.DATABASE_URL = URL;

const U1 = '00000000-0000-4000-8000-0000000001a1';
let pool;
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const auth = `Bearer ${jwt.sign({ userId: U1 }, process.env.JWT_SECRET)}`;
let app;

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
beforeEach(async () => {
  if (!BASE) return;
  await pool.query('truncate progress_logs, user_profiles restart identity cascade');
  await pool.query(`delete from users where id=$1`, [U1]);
  await pool.query(`insert into users(id,email,name,password_hash) values ($1,'p@example.test','P','x')`, [U1]);
});
afterAll(async () => { if (pool) await pool.end(); });

const log = (body) => request(app).post('/api/progress/log').set('Authorization', auth).send(body);
const rows = async () => (await pool.query('select weight, body_fat_percentage, measurements, notes, user_id, date from progress_logs order by id')).rows;

maybe('POST /api/progress/log (real SQL)', () => {
  it('saves a valid entry with only the whitelisted columns, user id from the token', async () => {
    const other = '00000000-0000-4000-8000-0000000001b2';
    const res = await log({ userId: other, user_id: other, id: 999, createdAt: '2000-01-01', photos: ['x'], weight: 82.4, bodyFatPercentage: 20, measurements: { waist: 90, chest: null, evil: 5 }, notes: 'ok', date: new Date().toISOString() });
    expect(res.status).toBe(200);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ weight: 82.4, body_fat_percentage: 20, measurements: { waist: 90 }, notes: 'ok', user_id: U1 });
    const raw = (await pool.query('select id, photos, created_at from progress_logs')).rows[0];
    expect(raw.id).not.toBe(999);
    expect(raw.photos).toEqual([]);
    expect(new Date(raw.created_at).getFullYear()).toBeGreaterThan(2000);
  });
  it.each([24.9, 400.1, -5, '82', [82], { kg: 82 }, true])('rejects weight %j with 400 and writes nothing', async (weight) => {
    const res = await log({ weight });
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });
  it.each([25, 400])('accepts the %d kg bounds', async (weight) => {
    expect((await log({ weight })).status).toBe(200);
  });
  it('rejects a date more than a day ahead, or not a date; accepts up to a day ahead', async () => {
    expect((await log({ weight: 80, date: new Date(Date.now() + 26 * 3600e3).toISOString() })).status).toBe(400);
    expect((await log({ weight: 80, date: 'not a date' })).status).toBe(400);
    expect((await log({ weight: 80, date: { $gt: 1 } })).status).toBe(400);
    expect(await rows()).toHaveLength(0);
    expect((await log({ weight: 80, date: new Date(Date.now() + 20 * 3600e3).toISOString() })).status).toBe(200);
  });
});

maybe('goal weight uses the latest log dated now or earlier (real SQL)', () => {
  const goal = (goalWeightKg) => request(app).post('/api/user/goal-weight').set('Authorization', auth).send({ goalWeightKg });
  it('a log dated later today does not count as current weight; earlier ones do', async () => {
    await pool.query(`insert into progress_logs(user_id, weight, date) values ($1, 100, now() - interval '2 days'), ($1, 200, now() + interval '12 hours')`, [U1]);
    // 100 kg is current, so 70 kg is within 40%; against 200 kg it would be rejected.
    expect((await goal(70)).status).toBe(200);
    expect((await goal(150)).status).toBe(400);
  });
});
