'use strict';
/**
 * #127 r10 on real Postgres (Elite QA #127 r10 M1, M2): typed-meal warnings are never weaker than main's,
 * and every readable typed allergy is checked when part of the list can't be read. The profile, consent and saved
 * plans are real rows; only the AI provider and the usage meter are mocked.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally without it; fails in CI if it is
 * missing. Writes its own user and plan rows, so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_ai_meal_safety_r10_pg: TEST_DATABASE_URL is required in CI');
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

// CI's postgres has no SSL; this test creates the tables it needs itself (dropped and recreated).
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
  target_carbs integer, target_fat integer, updated_at timestamp default now() not null);
create table meal_plans(id serial primary key, user_id uuid, name text, description text, goal_type text, meals jsonb,
  total_calories int, total_protein int, total_carbs int, total_fat int, is_active boolean, created_at timestamptz default now(), updated_at timestamptz);
create table plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int, active boolean default true, assigned_at timestamptz default now());
`;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');

const U = '00000000-0000-4000-8000-0000001270a0';
const auth = `Bearer ${jwt.sign({ userId: U }, process.env.JWT_SECRET)}`;
let app; let storage; let pool;

const meal = (name, items, kcal) => ({ name, ingredients: items.map((item) => ({ item, qty: '100g' })), calories: kcal, protein: Math.round(kcal * 0.25 / 4), carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.3 / 9) });
const SAFE = { breakfast: meal('Banana rice porridge', ['White rice', 'Banana'], 500), lunch: meal('Chickpea and potato bowl', ['Chickpeas', 'Potato', 'Spinach'], 600), dinner: meal('Lentil and rice curry', ['Lentils', 'Brown rice', 'Tomato'], 700), snack: meal('Apple and rice cakes', ['Apple', 'Rice cakes'], 200) };
const week = (monday) => ({ planName: 'AI week', summary: 's', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, i) => ({ day, meals: { ...SAFE, ...(i === 0 ? monday : {}) } })) });
const savedDiet = async () => (await storage.getProfile(U)).dietaryPreferences;
const gen = (dietary) => request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({ goal: 'maintain', days: 7, calories: 2000, protein: 120, dietary });

beforeAll(async () => {
  if (!URL) return;
  storage = require('./server/storage.js');
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
  await pool.query("insert into users(id, email, name, password_hash, subscription_tier) values ($1, 'allergen-r10@example.com', 'T', 'x', 'premium')", [U]);
  app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
});
beforeEach(async () => {
  if (!URL) return;
  await storage.createOrUpdateProfile(U, { dietaryPreferences: ['gluten free', 'sesame free'], allergies: ['peanuts'] });
  await storage.setAIDataConsent(U, true);
  await pool.query('delete from meal_plans where user_id=$1', [U]);
  aiClient.chatJson.mockReset();
});
afterAll(async () => { if (pool) await pool.end(); });


const NOTE = "We couldn't check this meal against your allergies, so check the ingredients.";
const dietGuard = require('./lib/diet-guard');
const setAllergies = (allergies) => pool.query('update user_profiles set allergies=$2::jsonb, dietary_preferences=$3::jsonb where user_id=$1', [U, JSON.stringify(allergies), '[]']);
const save = (meals) => request(app).post('/api/meal-plans').set('Authorization', auth).send({ name: 'Typed', meals });
const listed = async () => (await request(app).get('/api/meal-plans').set('Authorization', auth)).body.plans.find((p) => p.name === 'Typed').allergenWarnings;

// M1: main's check on the same typed meal; any hit from either check is red.
const PAIRS = [
  ["Arnott's Tim Tam", 'peanut', 'nuts'],
  ["Arnott's Tim Tam", 'sesame', 'sesame'],
  ['Satay chicken', 'soy', 'soy'],
  ["Domino's pizza", 'egg', 'eggs'],
  ['Maccas brekkie', 'fish', 'fish'],
  ['Arancini', 'egg', 'eggs'],
  ['Golden Gaytime', 'egg', 'eggs'],
  ['Char kway teow', 'shellfish', 'shellfish'],
];
maybe('r10 M1: typed-meal warnings never weaker than main, on real Postgres', () => {
  it.each(PAIRS)('%s with a %s allergy is red (%s) on save and on read', async (name, allergy, group) => {
    await setAllergies([allergy]);
    const res = await save([{ name, foods: [] }]);
    expect(res.status).toBe(200);
    for (const w of [res.body.allergenWarnings, await listed()]) {
      const mine = w.filter((x) => x.meal === name);
      expect(mine).toHaveLength(1);
      expect(mine[0].unchecked).toBeUndefined();
      expect(mine[0].contains).toContain(group);
    }
  });
  it("Arancini plus Mum's special with an egg allergy: Arancini red, Mum's special the calm note", async () => {
    await setAllergies(['egg']);
    const res = await save([{ name: 'Arancini', foods: [] }, { name: "Mum's special", foods: [] }]);
    for (const w of [res.body.allergenWarnings, await listed()]) {
      expect(w).toEqual([
        { meal: 'Arancini', contains: expect.arrayContaining(['eggs']) },
        { meal: "Mum's special", contains: [], unchecked: true, note: NOTE },
      ]);
    }
  });
});

// M2: an odd entry makes the list unreadable but every readable typed item is still checked; past the
// 20k-character read budget the later items were never read, so the meal is only "unchecked".
const FRUIT = ['banana', 'mango', 'avocado', 'strawberry'];
const junk = (n) => Array.from({ length: n }, (_, i) => `qzz${i}food`);
const servesFruit = (plan, f) => new RegExp(f, 'i').test(JSON.stringify(plan));
maybe('r10 M2: typed allergies when the list cannot all be read, on real Postgres', () => {
  it.each(FRUIT)('%s at #17 after one non-string entry: red on the typed meal, and /generate leaves it out', async (f) => {
    await setAllergies([{ x: 1 }, ...junk(15), f]);
    const res = await save([{ name: `${f} smoothie bowl`, foods: [] }]);
    for (const w of [res.body.allergenWarnings, await listed()]) {
      expect(w[0]).toEqual({ meal: '', contains: [], notice: dietGuard.UNREADABLE_NOTICE });
      const mine = w.find((x) => x.meal === `${f} smoothie bowl`);
      expect(mine.unchecked).toBeUndefined();
      expect(mine.contains).toContain(f);
    }
    for (const body of [{}, { builderOnly: true }]) {
      const g = await request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({ days: 7, calories: 2000, protein: 120, ...body });
      expect(g.status).toBe(200);
      expect(g.body.plan).toBeUndefined();
      expect(g.body.notice).toBe(dietGuard.UNREADABLE_NOTICE);
      expect(g.body.provider).toBeNull();
      expect(JSON.stringify(g.body).split(dietGuard.UNREADABLE_NOTICE).join('')).not.toMatch(new RegExp(f, 'i'));
      expect(aiClient.chatJson).not.toHaveBeenCalled();
    }
  });
  it.each(FRUIT)('%s after 200 items of 100 characters (past the budget): the notice, and the meal is unchecked, never clean', async (f) => {
    await setAllergies([...Array.from({ length: 200 }, (_, i) => `${i}`.padEnd(100, 'q')), f]);
    const res = await save([{ name: `${f} smoothie bowl`, foods: [] }, { name: `${f} and rice`, foods: [] }]);
    for (const w of [res.body.allergenWarnings, await listed()]) {
      expect(w[0].notice).toBe(dietGuard.UNREADABLE_NOTICE);
      // Smoothie reads as dairy (every '... free' filter is on), so it's red; it is never silently clean.
      const bowl = w.find((x) => x.meal === `${f} smoothie bowl`);
      expect(bowl.contains.length > 0 || bowl.unchecked === true).toBe(true);
      expect(w.find((x) => x.meal === `${f} and rice`)).toEqual({ meal: `${f} and rice`, contains: [], unchecked: true, note: NOTE });
    }
  });
  it('the notice never claims foods the user typed were all checked', () => {
    expect(dietGuard.UNREADABLE_NOTICE).not.toMatch(/every allergen filter is on\./i);
    expect(dietGuard.UNREADABLE_NOTICE).toMatch(/foods you typed may not all be checked/i);
  });
});
