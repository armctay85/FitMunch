'use strict';
/**
 * #140 r2 (EQA #140 r1 M1): an allergy past item 50 is still read, on real Postgres.
 * Based on the #127a stopgap PG suite: real users, real saved profiles, real
 * consent and usage tables. Only the AI provider is mocked, and it returns
 * unsafe meals (pasta, bread, peanut butter, satay). A filtered user must get
 * none of it, keep their saved filters, and not be charged a credit.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_ai_allergen_stopgap_r6_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stopgap-140-pg-secret';

jest.mock('./lib/ai-client', () => {
  const actual = jest.requireActual('./lib/ai-client');
  const meal = (name, item, calories, protein) => ({ name, ingredients: [{ item, qty: '200g' }], calories, protein, carbs: 50, fat: 15 });
  const day = (d) => ({ day: d, meals: {
    breakfast: meal('MOCKAI peanut butter toast', 'Peanut butter', 500, 30),
    lunch: meal('MOCKAI chicken satay', 'Satay sauce', 500, 40),
    dinner: meal('MOCKAI ricotta pasta', 'Pasta', 600, 50),
    snack: meal('MOCKAI bread roll', 'White bread', 400, 30),
  } });
  const plan = { planName: 'MOCKAI', summary: 'MOCKAI', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day) };
  return {
    ...actual,
    hasProvider: jest.fn(() => true),
    chat: jest.fn(async () => ({ ok: true, text: 'MOCKAI: peanut butter on toast, then a satay pasta bowl.', provider: 'mock', model: 'm' })),
    chatJson: jest.fn(async (opts) => (opts && opts.route === '/ai/weekly-review'
      ? { ok: true, provider: 'mock', data: { headline: 'Solid week', wins: ['Logged 6 days', 'Teriyaki chicken twice'], focus: ['Add a peanut butter snack for protein', 'Train 3 times'], score: 7 } }
      : { ok: true, json: plan, data: plan, text: JSON.stringify(plan), provider: 'mock' })),
  };
});

// Usage counting isn't under test here; a spy shows whether a credit was charged.
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return { ...actual, checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })), refundAiCall: jest.fn(async () => true) };
});

const SCHEMA = `
-- Fresh tables even on a reused test database (EQA #140 r2 L3).
drop table if exists meal_plans, plan_assignments, user_profiles, pt_clients, workout_plans, shopping_lists, users cascade;
create table if not exists users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_login_at timestamptz,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamptz,
  stripe_customer_id varchar(255), settings jsonb default '{}'::jsonb, profile_image text);
create table if not exists user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]'::jsonb,
  allergies jsonb default '[]'::jsonb, target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamptz not null default now());
create table if not exists meal_plans(id serial primary key, user_id uuid, name text, description text, goal_type text, meals jsonb, is_active boolean,
  total_calories int, total_protein int, total_carbs int, total_fat int, created_at timestamptz default now(), updated_at timestamptz);
create table if not exists plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int, active boolean default true, assigned_at timestamptz default now());
`;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const engine = require('./lib/meal-plan-engine');
const dietGuard = require('./lib/diet-guard');


const U = '00000000-0000-4000-8000-000000014001';
const JUNK = Array.from({ length: 50 }, (_, i) => `junk item ${i + 1}`);
let pool;
let app;
const as = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
function servedGroups(plan) {
  const items = [];
  for (const d of plan.days) for (const m of Object.values(d.meals)) {
    for (const i of m.ingredients || []) items.push([i.item || i.name]);
    for (const s of m.swaps || []) for (const i of s.ingredients || []) items.push([i.item || i.name]);
  }
  return engine.allergensOf(items);
}
/** Template meals named in a fixed Coach reply. */
const repliedMeals = (text) => engine.TEMPLATES.filter((t) => text.includes(`${t.name} (`));

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
  app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
});
async function profile(diet, allergies) {
  await pool.query('delete from users where id=$1', [U]);
  await pool.query(`insert into users(id,email,name,password_hash,settings) values ($1,'r6@example.test','T','x','{"aiDataConsent":true}'::jsonb)`, [U]);
  await pool.query('insert into user_profiles(user_id,dietary_preferences,allergies,target_calories,target_protein) values ($1,$2::jsonb,$3::jsonb,2000,150)',
    [U, JSON.stringify(diet), JSON.stringify(allergies)]);
}
beforeEach(() => { aiClient.chat.mockClear(); aiClient.chatJson.mockClear(); aiUsage.checkAndConsume.mockClear(); });
afterAll(async () => { if (pool) { await pool.query('delete from users where id=$1', [U]); await pool.end(); } });

const ask = (content, extra = {}) => request(app).post('/api/ai/chat').set('Authorization', as(U))
  .send({ intent: 'nutrition', messages: [{ role: 'user', content }], ...extra });
async function expectNutSafe() {
  const food = await ask('Give me a meal plan for tomorrow');
  const other = await ask('How many sets of squats?', { intent: 'workout' });
  for (const r of [food, other]) {
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|peanut|satay/i);
    for (const t of repliedMeals(r.body.reply)) expect(engine.flagsOf(t)).not.toContain('nuts');
  }
  expect(repliedMeals(food.body.reply).length).toBeGreaterThan(0);
  const g = await request(app).post('/api/meal-plan/generate').set('Authorization', as(U)).send({ calories: 2000, protein: 150, days: 7 });
  expect(g.status).toBe(200);
  expect(g.body.dietary).toContain('nut free');
  expect(servedGroups(g.body.plan)).not.toContain('nuts');
  await pool.query('delete from meal_plans where user_id=$1', [U]);
  await pool.query(`insert into meal_plans(user_id,name,meals) values ($1,'Typed',$2::jsonb)`, [U, JSON.stringify([{ name: 'Satay chicken', foods: [] }])]);
  const l = await request(app).get('/api/meal-plans').set('Authorization', as(U));
  expect(l.body.plans[0].allergenWarnings).toEqual(expect.arrayContaining([{ meal: 'Satay chicken', contains: expect.arrayContaining(['nuts']) }]));
  expect(aiClient.chatJson).not.toHaveBeenCalled();
}

maybe('#140 r2 M1 on real Postgres: item #51 is still read', () => {
  it("stored allergies: 50 junk items + 'peanut'", async () => {
    await profile([], [...JUNK, 'peanut']);
    await expectNutSafe();
  });
  it("stored diet: 50 junk items + 'nut free'", async () => {
    await profile([...JUNK, 'nut free'], []);
    await expectNutSafe();
  });
  it("chat-sent context: 50 junk + 'peanut' (allergies) and 50 junk + 'nut free' (dietary)", async () => {
    await profile([], []);
    for (const context of [{ allergies: [...JUNK, 'peanut'] }, { dietary: [...JUNK, 'nut free'] }]) {
      for (const [content, intent] of [['Give me a meal plan for tomorrow', 'nutrition'], ['How many sets of squats?', 'workout']]) {
        const r = await ask(content, { intent, context });
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|peanut|satay/i);
        for (const t of repliedMeals(r.body.reply)) expect(engine.flagsOf(t)).not.toContain('nuts');
      }
    }
  });
  it("past the character budget: every '... free' filter applies and the user is told", async () => {
    const big = new Array(5000).fill('zzzzzzzzzz');
    await profile([], big);
    const g = await request(app).post('/api/meal-plan/generate').set('Authorization', as(U)).send({ calories: 2000, protein: 150, days: 7 });
    expect(g.body.dietary).toEqual(expect.arrayContaining(dietGuard.ALL_FREE));
    expect(g.body.notice).toContain(dietGuard.UNREADABLE_NOTICE);
    for (const grp of ['nuts', 'gluten', 'dairy', 'eggs', 'soy', 'sesame', 'shellfish', 'fish']) expect(servedGroups(g.body.plan)).not.toContain(grp);
    const c = await ask('Give me a meal plan for tomorrow');
    expect(c.body.reply.startsWith(dietGuard.UNREADABLE_NOTICE)).toBe(true);
    await pool.query('delete from meal_plans where user_id=$1', [U]);
    await pool.query(`insert into meal_plans(user_id,name,meals) values ($1,'Typed',$2::jsonb)`, [U, JSON.stringify([{ name: 'Satay chicken', foods: [] }])]);
    const l = await request(app).get('/api/meal-plans').set('Authorization', as(U));
    expect(l.body.plans[0].allergenWarnings[0]).toEqual({ meal: '', contains: [], notice: dietGuard.unreadableNotice(true) });
    expect(l.body.plans[0].allergenWarnings).toEqual(expect.arrayContaining([{ meal: 'Satay chicken', contains: expect.arrayContaining(['nuts']) }]));
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it.each([
    ['16 junk diet items plus a fish allergy', Array.from({ length: 16 }, (_, i) => `junk diet ${i}`), ['fish']],
    ['60 junk allergy items plus fish', [], [...Array.from({ length: 60 }, (_, i) => `junk allergy ${i}`), 'fish']],
  ])('r3 M1: %s -> /generate serves no fish', async (_l, diet, allergies) => {
    await profile(diet, allergies);
    const g = await request(app).post('/api/meal-plan/generate').set('Authorization', as(U)).send({ calories: 2000, protein: 150, days: 7 });
    expect(g.status).toBe(200);
    expect(g.body.dietary).toContain('fish free');
    expect(servedGroups(g.body.plan)).not.toContain('fish');
    expect(servedGroups(g.body.plan)).not.toContain('shellfish');
    const w = await request(app).post('/api/meal-plan/generate').set('Authorization', as(U)).send({ calories: 2000, protein: 150, days: 7, builderOnly: true });
    expect(w.body.plan && servedGroups(w.body.plan)).not.toContain('fish');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
  it('a stored 1M-item list keeps chat, generate and the plan list under 500 ms', async () => {
    await profile([], new Array(1e6).fill('zzzz'));
    const time = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };
    const [, tc] = await time(() => ask('How many sets of squats?', { intent: 'workout' }));
    const [, tg] = await time(() => request(app).post('/api/meal-plan/generate').set('Authorization', as(U)).send({ calories: 2000, protein: 150, days: 7 }));
    const [, tl] = await time(() => request(app).get('/api/meal-plans').set('Authorization', as(U)));
    expect({ tc, tg, tl }).toEqual({ tc: expect.any(Number), tg: expect.any(Number), tl: expect.any(Number) });
    expect(Math.max(tc, tg, tl)).toBeLessThan(500);
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
});
