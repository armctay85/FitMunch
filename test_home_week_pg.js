'use strict';
/**
 * Onboarding -> Home on real Postgres (launch audit D2). The same calls the app makes on "Save and build my week"
 * and Done: save the targets, build the week (builder, with a ticked diet), save it, re-save it after a swap, then
 * read it back for Home and build its shopping list. The diet tick still goes through rememberFilters, and the saved
 * week is still re-checked on every read against the filters the user has then.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally without it; fails in CI if it is
 * missing. Drops and recreates its tables, so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_home_week_pg: TEST_DATABASE_URL is required in CI');
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
drop table if exists user_profiles, meal_plans, plan_assignments, users cascade;
create table users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamp default now() not null, updated_at timestamp default now() not null, last_login_at timestamp,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamp,
  stripe_customer_id varchar(255), settings jsonb default '{}', profile_image text, role text default 'client', pt_id uuid);
create table user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]',
  allergies jsonb default '[]', target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamp with time zone default now() not null);
create table meal_plans(id serial primary key, user_id uuid, name text, description text, goal_type text, meals jsonb,
  total_calories int, total_protein int, total_carbs int, total_fat int, is_active boolean, created_at timestamptz default now(), updated_at timestamptz);
create table plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int, active boolean default true, assigned_at timestamptz default now());
`;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const hw = require('./public/js/fm-home-week');
const wow = require('./public/js/fm-week-wow');

const U = '00000000-0000-4000-8000-0000000d2a01';
const V = '00000000-0000-4000-8000-0000000d2a02';
const as = (id) => `Bearer ${jwt.sign({ userId: id }, process.env.JWT_SECRET)}`;
let app; let pool;
const post = (p, body, who = U) => request(app).post(p).set('Authorization', as(who)).send(body);
const get = (p, who = U) => request(app).get(p).set('Authorization', as(who));
// The body onboardSaveWeek() sends.
const weekBody = (plan) => { const a = wow.weekAverages(plan); return { name: 'Your first week', description: plan.summary || 'x', goalType: 'lose_weight', totalCalories: a.calories, totalProtein: a.protein, meals: plan.days }; };

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
  app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
});
beforeEach(async () => {
  if (!URL) return;
  await pool.query('truncate user_profiles, meal_plans, users restart identity cascade');
  await pool.query("insert into users(id, email, name, password_hash) values ($1, 'd2-a@example.com', 'A', 'x'), ($2, 'd2-b@example.com', 'B', 'x')", [U, V]);
  aiClient.chatJson.mockReset();
});
afterAll(async () => { if (pool) await pool.end(); });

maybe('Save and build my week -> Home (real SQL)', () => {
  it('a brand-new user saves calories and all three macros with no profile row and no profileUpdatedAt', async () => {
    const r = await post('/api/user/profile', { fitnessGoal: 'lose_weight', targetCalories: 1860, targetProtein: 141, targetCarbs: 207, targetFat: 52 });
    expect(r.status).toBe(200);
    const p = (await get(`/api/user/profile/${U}`)).body.profile;
    expect([p.fitnessGoal, p.targetCalories, p.targetProtein, p.targetCarbs, p.targetFat]).toEqual(['lose_weight', 1860, 141, 207, 52]);
    expect(hw.targets(p)).toEqual({ calories: 1860, protein: 141, carbs: 207, fat: 52 });
  });

  it('the ticked diet week is saved, comes back first for Home, and gives a meat-free shopping list; 0 AI calls', async () => {
    await post('/api/user/profile', { fitnessGoal: 'lose_weight', targetCalories: 1860, targetProtein: 141, targetCarbs: 207, targetFat: 52 });
    await post('/api/meal-plans', { name: 'Older plan', meals: [] });
    const g = await post('/api/meal-plan/generate', { builderOnly: true, goal: 'lose_weight', days: 7, calories: 1860, protein: 141, dietary: ['vegetarian'] });
    expect(g.status).toBe(200);
    // rememberFilters (under #142's lock) still stores the tick.
    expect((await get(`/api/user/profile/${U}`)).body.profile.dietaryPreferences).toContain('vegetarian');
    const s = await post('/api/meal-plans', weekBody(g.body.plan));
    expect(s.status).toBe(200);
    expect(s.body.allergenWarnings).toEqual([]);

    const list = await get('/api/meal-plans');
    expect(list.status).toBe(200);
    const row = list.body.plans[0];
    expect(row.name).toBe('Your first week');
    expect(row.allergenWarnings).toEqual([]);
    expect(row.total_calories).toBeGreaterThan(1700);
    const sum = hw.summary(row);
    expect(sum.days).toHaveLength(7);
    expect(sum.today.meals.length).toBe(4);

    const shop = await post('/api/meal-plan/shopping', { plan: sum.shoppingPlan });
    expect(shop.status).toBe(200);
    expect(shop.body.list.itemCount).toBeGreaterThan(5);
    const names = shop.body.list.items.map((i) => i.name.toLowerCase()).join(' | ');
    expect(names).not.toMatch(/chicken|beef|pork|lamb|salmon|tuna|prawn|turkey|mince/);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it('Done after a swap updates the same row (no duplicate week)', async () => {
    const g = await post('/api/meal-plan/generate', { builderOnly: true, goal: 'maintain', days: 7, calories: 2200, protein: 140, dietary: [] });
    const s = await post('/api/meal-plans', weekBody(g.body.plan));
    const plan = g.body.plan;
    const d0 = plan.days[0]; const slot = Object.keys(d0.meals).find((k) => (d0.meals[k].swaps || []).length);
    if (slot) wow.swapMeal(d0, slot, 0);
    const swapped = slot ? d0.meals[slot].name : null;
    const put = await request(app).put(`/api/meal-plans/${s.body.plan.id}`).set('Authorization', as(U)).send(weekBody(plan));
    expect(put.status).toBe(200);
    const rows = (await get('/api/meal-plans')).body.plans;
    expect(rows).toHaveLength(1);
    if (swapped) expect(JSON.stringify(rows[0].meals)).toContain(swapped);
  });

  it('an allergy added after onboarding shows on the saved week at read time', async () => {
    const meals = [{ day: 'Monday', meals: { breakfast: { name: 'Peanut butter toast', calories: 400, protein: 15, ingredients: [{ item: 'Peanut butter', qty: '20g' }, { item: 'Wholemeal bread', qty: '2 slices' }] } } }];
    await post('/api/meal-plans', { name: 'Your first week', meals });
    expect((await get('/api/meal-plans')).body.plans[0].allergenWarnings).toEqual([]);
    const prof = (await get(`/api/user/profile/${U}`)).body.profile;
    const save = await post('/api/user/profile', { allergies: ['peanuts'], profileUpdatedAt: prof && prof.updatedAt });
    expect(save.status).toBe(200);
    const row = (await get('/api/meal-plans')).body.plans[0];
    expect(row.allergenWarnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(row.allergenWarnings).toLowerCase()).toMatch(/peanut/);
    // The card reads exactly this shape: { meal, contains }, with no `message` field, and builds its own text.
    expect(row.allergenWarnings.every((w) => !('message' in w) && typeof w.meal === 'string' && Array.isArray(w.contains))).toBe(true);
    const shown = hw.warnings(row.allergenWarnings);
    expect(shown.red.length).toBeGreaterThan(0);
    // The group the API puts in `contains` is "nuts", not the word in the meal name.
    expect(shown.red.join(' | ')).toMatch(/Peanut butter toast contains nuts/);
    expect(row.allergenWarnings.some((w) => w.meal === 'Peanut butter toast' && Array.isArray(w.contains) && w.contains.includes('nuts'))).toBe(true);
  });

  it("another user's Home never sees the week", async () => {
    const g = await post('/api/meal-plan/generate', { builderOnly: true, goal: 'maintain', days: 7, calories: 2000, protein: 120, dietary: [] });
    await post('/api/meal-plans', weekBody(g.body.plan));
    expect((await get('/api/meal-plans', V)).body.plans).toEqual([]);
    const s = (await get('/api/meal-plans')).body.plans[0];
    expect((await request(app).put(`/api/meal-plans/${s.id}`).set('Authorization', as(V)).send({ name: 'x' })).status).toBe(404);
  });
});
