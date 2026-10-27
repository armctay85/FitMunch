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
jest.mock('./lib/db-migrate', () => ({ ...jest.requireActual('./lib/db-migrate'), ensureSchema: async () => true }));
const SCHEMA = `
drop table if exists shopping_lists, meal_logs, workout_logs, progress_logs, user_profiles, meal_plans, plan_assignments, users cascade;
create table plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int, active boolean default true, assigned_at timestamptz default now());
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
create table meal_plans(id serial primary key, user_id uuid, name text, meals jsonb, description text, goal_type text,
  total_calories int, total_protein int, total_carbs int, total_fat int, created_at timestamptz default now(), updated_at timestamptz);
create table shopping_lists(id serial primary key, user_id uuid, meal_plan_id int, name text, items jsonb,
  completed boolean default false, created_at timestamptz default now(), updated_at timestamptz);
`;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const reviewWindow = require('./lib/review-window');

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
  await aiUsage.getUsed(U);
  app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
});
beforeEach(async () => {
  if (!URL) return;
  await pool.query('truncate meal_logs, shopping_lists, meal_plans, user_profiles, users restart identity cascade');
  await pool.query('delete from ai_usage_monthly where user_id = $1', [U]);
  await pool.query("insert into users(id, email, name, password_hash, settings) values ($1, 'd8@example.com', 'N', 'x', $2)", [U, JSON.stringify({ aiDataConsent: true })]);
  aiClient.chatJson.mockReset();
});
afterAll(async () => { await aiUsage.endPoolForTests(); if (pool) await pool.end(); });

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
    expect(await aiUsage.getUsed(U, 'weekly_review')).toBe(0);
  });

  it('3 logged days -> the AI review, with the real stats', async () => {
    await logDays(3);
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { headline: 'Solid start', wins: ['Logged 3 days'], focus: ['Add a weigh-in'], score: 6 } });
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.review.score).toBe(6);
    expect(r.body.stats.daysLogged).toBe(3);
    expect(aiClient.chatJson).toHaveBeenCalledTimes(1);
    expect(await aiUsage.getUsed(U, 'weekly_review')).toBe(1);
  });

  it('a failed model call refunds the credit on the real ledger', async () => {
    await logDays(3);
    aiClient.chatJson.mockResolvedValueOnce({ ok: false, error: 'down', provider: 'mock' });
    const r = await review();
    expect(r.status).toBe(502);
    expect(await aiUsage.getUsed(U, 'weekly_review')).toBe(0);
  });

  it('three Sydney dates that are two UTC dates still count as 3', async () => {
    const dates = reviewWindow.sydneyDatesInclusive(new Date(), 7);
    const atSydney = (ymd, hhmm) => {
      for (const off of ['+11:00', '+10:00']) {
        const d = new Date(`${ymd}T${hhmm}:00${off}`);
        const hour = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', hourCycle: 'h23' }).format(d);
        if (reviewWindow.sydneyDay(d) === ymd && hour.slice(0, 2) === hhmm.slice(0, 2)) return d;
      }
      throw new Error('no Sydney instant');
    };
    let stamps = null;
    // Start at yesterday: today's 12:00 can still be in the future, and the route only reads meals up to now.
    for (let i = 1; i < dates.length - 2; i += 1) {
      const trio = [atSydney(dates[i + 2], '23:00'), atSydney(dates[i + 1], '00:30'), atSydney(dates[i], '12:00')];
      if (new Set(trio.map((d) => d.toDateString())).size === 2) { stamps = trio; break; }
    }
    expect(stamps).not.toBeNull();
    for (const d of stamps) {
      await pool.query('insert into meal_logs(user_id, date, meal_type, food_name, calories, protein) values ($1, $2, $3, $4, 500, 40)', [U, d, 'lunch', 'Chicken salad']);
    }
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { headline: 'Three days', wins: ['Logged'], focus: ['Keep going'], score: 6 } });
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.stats.daysLogged).toBe(3);
    expect(r.body.source).not.toBe('empty');
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
    const plan = { planName: 'w', days: [{ day: 'Monday', meals: { breakfast: { name: 'Toast', ingredients: [
      { item: 'Peanut butter', qty: '20g' }, { item: 'Butter', qty: '10g' }, { item: 'Butternut pumpkin', qty: '200g' },
      { item: 'Sunflower seed butter', qty: '20g' }, { item: 'Plant-based butter', qty: '10g' }, { item: 'Almond milk', qty: '250ml' },
      { item: 'Butter lettuce', qty: '1' }, { item: 'Butterhead lettuce', qty: '1' }, { item: 'Butterfly pea flower', qty: '5g' },
      { item: 'Butternut snap biscuits', qty: '40g' }, { item: 'Peanutbutter', qty: '20g' },
    ] } } }] };
    const r = await request(app).post('/api/meal-plan/shopping').set('Authorization', as(U)).send({ plan });
    expect(r.status).toBe(200);
    const aisle = (re) => r.body.list.items.find((i) => re.test(i.name)).aisle;
    expect(aisle(/peanut butter/i)).toBe('Pantry');
    expect(aisle(/^butter$/i)).toBe('Dairy & Eggs');
    expect(aisle(/butternut pumpkin/i)).toBe('Produce');
    for (const re of [/sunflower/i, /plant-based/i, /almond milk/i, /peanutbutter/i, /snap biscuits/i]) expect([String(re), aisle(re)]).toEqual([String(re), 'Pantry']);
    for (const re of [/butter lettuce/i, /butterhead/i, /butterfly/i]) expect([String(re), aisle(re)]).toEqual([String(re), 'Produce']);
  });

  it('POST /shopping-list/generate uses the same aisles', async () => {
    const meals = [{ day: 'Monday', meals: { breakfast: { name: 'Mix', ingredients: [
      { item: 'Sunflower seed butter', qty: '20g' }, { item: 'Plant-based butter', qty: '10g' }, { item: 'Almond milk', qty: '250ml' },
      { item: 'Butter lettuce', qty: '1' }, { item: 'Butterhead lettuce', qty: '1' }, { item: 'Butterfly pea flower', qty: '5g' },
      { item: 'Butternut snap biscuits', qty: '40g' }, { item: 'Peanutbutter', qty: '20g' }, { item: 'Butter', qty: '10g' },
      { item: 'Butternut pumpkin', qty: '200g' },
    ] } } }];
    const ins = await pool.query('insert into meal_plans(user_id, name, meals) values ($1, $2, $3::jsonb) returning id', [U, 'Week', JSON.stringify(meals)]);
    const r = await request(app).post('/api/shopping-list/generate').set('Authorization', as(U)).send({ mealPlanId: ins.rows[0].id });
    expect(r.status).toBe(200);
    const cat = (re) => r.body.list.items.find((i) => re.test(i.name)).category;
    for (const re of [/sunflower/i, /plant-based/i, /almond milk/i, /peanutbutter/i, /snap biscuits/i]) expect([String(re), cat(re)]).toEqual([String(re), 'pantry']);
    for (const re of [/butter lettuce/i, /butterhead/i, /butterfly/i, /butternut pumpkin/i]) expect([String(re), cat(re)]).toEqual([String(re), 'vegetables']);
    expect(cat(/^butter$/i)).toBe('dairy');
  });
});

maybe('meal log input on Postgres', () => {
  it('returns 400 for a huge calorie value and stores one row for an identical rapid insert', async () => {
    const bad = await request(app).post('/api/meals/log').set('Authorization', as(U)).send({ foodName: 'Apple', calories: 1e20, mealType: 'snack' });
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
    const storage = require('./server/storage.js');
    const first = await storage.logMeal(U, { foodName: 'Pear', mealType: 'lunch', calories: 90, date: new Date(), protein: 1 });
    const second = await storage.logMeal(U, { foodName: 'pear', mealType: 'Lunch', calories: 90, date: new Date(), protein: 1 });
    expect(second.id).toBe(first.id);
    const rows = await pool.query("select id from meal_logs where user_id=$1 and lower(food_name)='pear'", [U]);
    expect(rows.rows).toHaveLength(1);
  });
});
