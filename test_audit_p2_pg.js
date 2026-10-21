'use strict';
/**
 * Weekly review for new users on real Postgres (launch audit D8): under 3 logged days it is an empty state with
 * no score, no wins, no AI call and no credit; with 3 logged days the AI review runs as before; a filtered user
 * still gets the fixed review. Also the shopping list puts peanut butter under Pantry through the real route.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally without it; fails in CI if it is
 * missing. Drops and recreates its tables, so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_audit_p2_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) { process.env.DATABASE_URL = URL; process.env.DATABASE_SSL = '0'; }

jest.mock('./lib/ai-client', () => ({ hasProvider: () => true, chat: jest.fn(), chatJson: jest.fn(), providerName: () => 'mock' }));
jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 5 })),
  refundAiCall: jest.fn(async () => true),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
}));
jest.mock('./lib/db-migrate', () => ({ ...jest.requireActual('./lib/db-migrate'), ensureSchema: async () => true }));
const SCHEMA = `
drop table if exists meal_logs, workout_logs, progress_logs, user_profiles, meal_plans, plan_assignments, users cascade;
create table users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamp default now() not null, updated_at timestamp default now() not null, last_login_at timestamp,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamp,
  stripe_customer_id varchar(255), settings jsonb default '{}', profile_image text, role text default 'client', pt_id uuid);
create table user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]',
  allergies jsonb default '[]', target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamp with time zone default now() not null);
create table meal_logs(id serial primary key, user_id uuid not null references users(id) on delete cascade, date timestamptz not null default now(),
  meal_type varchar(50) not null, food_name text not null, calories integer not null, protein real default 0, carbs real default 0, fat real default 0,
  fiber real default 0, serving_size text, created_at timestamptz not null default now());
`;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');

const U = '00000000-0000-4000-8000-0000000d8001';
const as = (id) => `Bearer ${jwt.sign({ userId: id }, process.env.JWT_SECRET)}`;
let app; let pool;
const review = () => request(app).get('/api/ai/weekly-review').set('Authorization', as(U));
const logDays = async (n) => { for (let d = 0; d < n; d += 1) await pool.query("insert into meal_logs(user_id, date, meal_type, food_name, calories, protein) values ($1, now() - ($2 || ' days')::interval, 'lunch', 'Chicken salad', 500, 40)", [U, String(d)]); };

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
  app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
});
beforeEach(async () => {
  if (!URL) return;
  await pool.query('truncate meal_logs, user_profiles, users restart identity cascade');
  await pool.query("insert into users(id, email, name, password_hash, settings) values ($1, 'd8@example.com', 'N', 'x', $2)", [U, JSON.stringify({ aiDataConsent: true })]);
  aiClient.chatJson.mockReset(); aiUsage.checkAndConsume.mockClear();
});
afterAll(async () => { if (pool) await pool.end(); });

maybe('weekly review (real SQL)', () => {
  it.each([0, 1, 2])('%i logged days -> empty state: no score, no wins, no AI call, no credit', async (n) => {
    await logDays(n);
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('empty');
    expect(r.body.review.score).toBeNull();
    expect(r.body.review.wins).toEqual([]);
    expect(r.body.review.headline).toMatch(/3 days/);
    expect(r.body.stats).toEqual({ daysLogged: n, daysNeeded: 3 });
    expect(JSON.stringify(r.body)).not.toMatch(/Showed up/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('3 logged days -> the AI review, with the real stats', async () => {
    await logDays(3);
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { headline: 'Solid start', wins: ['Logged 3 days'], focus: ['Add a weigh-in'], score: 6 } });
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.review.score).toBe(6);
    expect(r.body.stats.daysLogged).toBe(3);
    expect(aiClient.chatJson).toHaveBeenCalledTimes(1);
  });

  it('several meals on one day count as one day', async () => {
    for (let i = 0; i < 6; i += 1) await pool.query("insert into meal_logs(user_id, meal_type, food_name, calories) values ($1, 'snack', 'Apple', 90)", [U]);
    const r = await review();
    expect(r.body.source).toBe('empty');
    expect(r.body.stats.daysLogged).toBe(1);
  });

  it('a filtered user still gets the fixed review and no AI call', async () => {
    await pool.query("insert into user_profiles(user_id, allergies) values ($1, '[\"peanuts\"]')", [U]);
    const r = await review();
    expect(r.body.source).toBe('fixed');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
});

maybe('shopping list aisle (real route)', () => {
  it('peanut butter is Pantry, butter is Dairy & Eggs', async () => {
    const plan = { planName: 'w', days: [{ day: 'Monday', meals: { breakfast: { name: 'Toast', ingredients: [{ item: 'Peanut butter', qty: '20g' }, { item: 'Butter', qty: '10g' }, { item: 'Butternut pumpkin', qty: '200g' }] } } }] };
    const r = await request(app).post('/api/meal-plan/shopping').set('Authorization', as(U)).send({ plan });
    expect(r.status).toBe(200);
    const aisle = (re) => r.body.list.items.find((i) => re.test(i.name)).aisle;
    expect(aisle(/peanut/i)).toBe('Pantry');
    expect(aisle(/^butter$/i)).toBe('Dairy & Eggs');
    expect(aisle(/butternut/i)).toBe('Produce');
  });
});
