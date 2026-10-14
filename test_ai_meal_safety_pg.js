'use strict';
/**
 * AI allergen check against real Postgres (Elite QA #127 r1 M1, M2, S2). The profile, consent and saved
 * plans are real rows; only the AI provider and the usage meter are mocked.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally without it; fails in CI if it is
 * missing. Writes its own user and plan rows, so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_ai_meal_safety_pg: TEST_DATABASE_URL is required in CI');
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

const U = '00000000-0000-4000-8000-0000000127a2';
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
  await pool.query("insert into users(id, email, name, password_hash, subscription_tier) values ($1, 'allergen-pg@example.com', 'T', 'x', 'premium')", [U]);
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

maybe('AI meal plans on real Postgres', () => {
  it('saved gluten free + sesame free + peanut allergy, nothing ticked: no pasta, hummus or peanut butter, saved filters kept', async () => {
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: week({
      dinner: meal('Ricotta and spinach pasta', ['Pasta', 'Ricotta', 'Spinach'], 700),
      lunch: meal('Hummus plate', ['Hummus', 'Rice'], 600),
      snack: { ...meal('Apple slices', ['Apple'], 200), ingredients: [{ item: 'Apple', qty: '2 tbsp peanut butter' }] },
    }) });
    const res = await gen([]);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.plan)).not.toMatch(/pasta|hummus|peanut/i);
    expect(await savedDiet()).toEqual(['gluten free', 'sesame free']);
    expect(aiClient.chatJson.mock.calls[0][0].messages[0].content).toMatch(/gluten free[\s\S]*sesame free|sesame free[\s\S]*gluten free/);
  });
  it('a new filter is added, never replacing the saved ones', async () => {
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: week({}) });
    await gen(['nut free']);
    await new Promise((r) => setTimeout(r, 200)); // the profile write is not awaited by the route
    expect(await savedDiet()).toEqual(['gluten free', 'sesame free', 'nut free']);
  });
  it('consent refused: 403-style refusal and the saved filters are unchanged', async () => {
    await storage.setAIDataConsent(U, false);
    const res = await gen(['nut free']);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await new Promise((r) => setTimeout(r, 200));
    expect(await savedDiet()).toEqual(['gluten free', 'sesame free']);
  });
  it('a saved plan with prawn satay and peanut butter toast is stored as entered, with warnings; an old row gets one on read', async () => {
    await storage.createOrUpdateProfile(U, { dietaryPreferences: ['shellfish free'], allergies: ['peanuts'] });
    const satay = meal('Prawn satay', ['Prawns', 'Rice'], 700);
    const toast = { name: 'Toast', foods: [{ name: 'Toast' }, { name: 'Peanut butter' }] };
    const res = await request(app).post('/api/meal-plans').set('Authorization', auth).send({ name: 'Mine', meals: [{ day: 'Monday', meals: { dinner: satay } }, toast] });
    expect(res.status).toBe(200);
    const row = (await pool.query('select meals from meal_plans where user_id=$1', [U])).rows[0].meals;
    const { allergenWarning: w1, ...dinner } = row[0].meals.dinner;
    expect(dinner).toEqual(satay);
    expect(w1.allergens).toEqual(expect.arrayContaining(['shellfish', 'nuts']));
    const { allergenWarning: w2, ...t } = row[1];
    expect(t).toEqual(toast);
    expect(w2.allergens).toContain('nuts');
    await pool.query("insert into meal_plans(user_id, name, meals) values ($1, 'Old', $2)", [U, JSON.stringify([{ day: 'Monday', meals: { lunch: meal('Garlic prawns', ['Prawns', 'Rice'], 600) } }])]);
    const list = await request(app).get('/api/meal-plans').set('Authorization', auth);
    expect(list.status).toBe(200);
    const old = list.body.plans.find((p) => p.name === 'Old').meals[0].meals.lunch;
    expect(old.name).toBe('Garlic prawns');
    expect(old.allergenWarning.allergens).toContain('shellfish');
  });
});

// r6: QA's three r5 escapes, end to end through the generate route on real Postgres.
maybe('r6: stand-ins that sit beside the dish, and English muffins, on real Postgres', () => {
  it.each([
    ['egg', 'dinner', meal('Chicken fried rice with tofu', ['White rice', 'Chicken breast', 'Firm tofu', 'Peas'], 700), /fried rice/i],
    ['egg', 'dinner', meal('Fried rice with a side of tofu', ['White rice', 'Firm tofu', 'Peas'], 700), /fried rice/i],
    ['gluten', 'breakfast', meal('English muffin with almond flour', ['Almond flour', 'Banana'], 500), /english muffin/i],
  ])('%s allergy: the AI %s is swapped and the user told', async (allergy, slot, bad, re) => {
    await storage.createOrUpdateProfile(U, { dietaryPreferences: [], allergies: [allergy] });
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: week({ [slot]: bad }) });
    const res = await gen([]);
    expect(res.status).toBe(200);
    const monday = res.body.plan.days[0].meals[slot];
    expect(monday.name).not.toMatch(re);
    expect(monday.replacedForFilters).toBe(true);
    expect(JSON.stringify(res.body.plan.days.map((d) => d.meals))).not.toMatch(re);
  });
});

// Every FSANZ PEAL label term (and its plural or alternate spelling) typed as an allergy, against an AI meal
// that contains it. The meal must be swapped and the user told.
const FSANZ = [
  ['crustacea', 'Garlic prawns with rice', ['Prawns', 'White rice', 'Garlic']],
  ['crustacean', 'Chilli crab with rice', ['Crab', 'White rice']],
  ['crustaceans', 'Lobster and rice', ['Lobster', 'White rice']],
  ['bivalves', 'Oysters with rice', ['Oysters', 'White rice']],
  ['bivalve', 'Mussels and rice', ['Mussels', 'White rice']],
  ['molluscs', 'Scallops and rice', ['Scallops', 'White rice']],
  ['mollusks', 'Clams and rice', ['Clams', 'White rice']],
  ['cephalopods', 'Calamari and rice', ['Calamari', 'White rice']],
  ['shellfish', 'Balmain bugs with rice', ['Balmain bugs', 'White rice']],
  ['fish', 'Salmon and rice', ['Salmon fillet', 'White rice']],
  ['tree nuts', 'Almond rice bowl', ['Almonds', 'White rice']],
  ['tree nut', 'Cashew rice bowl', ['Cashews', 'White rice']],
  ['peanut', 'Peanut rice bowl', ['Peanuts', 'White rice']],
  ['peanuts', 'Satay rice bowl', ['Peanut butter', 'White rice']],
  ['sesame', 'Sesame rice', ['Sesame seeds', 'White rice']],
  ['soy', 'Tofu rice bowl', ['Tofu', 'White rice']],
  ['soybeans', 'Edamame rice bowl', ['Edamame', 'White rice']],
  ['gluten', 'Pasta bowl', ['Pasta', 'Tomato']],
  ['cereals containing gluten', 'Barley soup', ['Pearl barley', 'Carrot']],
  ['wheat', 'Toast and tomato', ['Bread', 'Tomato']],
  ['egg', 'Egg fried rice', ['Eggs', 'White rice']],
  ['eggs', 'Rice and eggs', ['Eggs', 'White rice']],
  ['milk', 'Ricotta rice bowl', ['Ricotta', 'White rice']],
  ['lupin', 'Lupin rice bowl', ['Lupin flakes', 'White rice']],
];
maybe('every FSANZ allergen term typed as an allergy, on real Postgres', () => {
  it.each(FSANZ)('allergy "%s": the AI meal "%s" is swapped and the plan says so', async (term, name, items) => {
    await storage.createOrUpdateProfile(U, { dietaryPreferences: [], allergies: [term] });
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: week({ dinner: meal(name, items, 700) }) });
    const res = await gen([]);
    expect(res.status).toBe(200);
    const served = JSON.stringify(res.body.plan.days);
    expect(served).not.toContain(name);
    for (const i of items.filter((x) => !/^(?:White rice|Tomato|Carrot|Garlic)$/.test(x))) expect(served.toLowerCase()).not.toContain(i.toLowerCase());
    expect(res.body.plan.notes.join(' ')).toMatch(/replaced with a safe meal/);
  });
});
