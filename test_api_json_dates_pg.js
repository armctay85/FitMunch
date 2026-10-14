'use strict';

/**
 * Real-Postgres date serialisation (Elite QA #124 S1). The mocked route tests
 * in test_api_json_dates.js never see a TIMESTAMPTZ; this inserts a plan and a
 * favourite and asserts created_at/updated_at come back as ISO strings.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Drops and recreates its tables,
 * so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_api_json_dates_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) process.env.DATABASE_URL = URL;

const USER = '00000000-0000-4000-8000-0000000000aa';
const CREATED = '2026-10-14T01:23:45.678Z';
const UPDATED = '2026-10-14T02:00:00.000Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const SCHEMA = `
drop table if exists favourites, meal_plans, users cascade;
create table users(id uuid primary key, email text, name text, password_hash text, role text, pt_id uuid, settings jsonb, subscription_tier text, subscription_expires_at timestamptz);
create table meal_plans(id serial primary key, user_id uuid references users(id) on delete cascade, name text, description text, goal_type text, meals jsonb,
  total_calories int, total_protein int, total_carbs int, total_fat int, created_at timestamptz default now(), updated_at timestamptz);
create table favourites(id serial primary key, user_id uuid not null references users(id) on delete cascade, item_type varchar(50) not null, item_id text not null, item_data jsonb default '{}'::jsonb, created_at timestamptz not null default now());
`;
const SEED = `
truncate favourites, meal_plans, users restart identity cascade;
insert into users(id, email, name, password_hash) values ('${USER}', 'dates@example.com', 'Dates', 'x');
insert into meal_plans(user_id, name, meals, created_at, updated_at) values
  ('${USER}', 'Week 1', '[]'::jsonb, '${CREATED}', '${UPDATED}');
insert into favourites(user_id, item_type, item_id, item_data, created_at) values
  ('${USER}', 'meal', 'm1', '{"name":"Oats"}'::jsonb, '${CREATED}');
`;

let pool;
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { attachApiJsonSanitizer } = require('./lib/sanitize-api-json');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const app = express();
app.use(express.json());
app.use(attachApiJsonSanitizer);
app.use('/api', require('./api_server'));
const auth = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
});
beforeEach(async () => { if (URL) await pool.query(SEED); });
afterAll(async () => { if (pool) await pool.end(); });

maybe('real PG dates serialise to ISO strings (EQA #124 S1)', () => {
  it('GET /api/meal-plans returns ISO created_at and updated_at, not {}', async () => {
    const res = await request(app).get('/api/meal-plans').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].created_at).toMatch(ISO);
    expect(res.body.plans[0].updated_at).toMatch(ISO);
    expect(res.body.plans[0].created_at).toBe(CREATED);
    expect(res.body.plans[0].updated_at).toBe(UPDATED);
    expect(typeof res.body.plans[0].created_at).toBe('string');
    expect(res.body.plans[0].created_at).not.toEqual({});
  });

  it('GET /api/favourites returns ISO created_at, not {}', async () => {
    const res = await request(app).get('/api/favourites').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.favourites).toHaveLength(1);
    expect(res.body.favourites[0].created_at).toMatch(ISO);
    expect(res.body.favourites[0].created_at).toBe(CREATED);
    expect(res.body.favourites[0].item_data).toEqual({ name: 'Oats' });
    expect(res.body.favourites[0].created_at).not.toEqual({});
  });
});
