'use strict';
/**
 * #127a stopgap against real Postgres: real users, real saved profiles, real
 * consent and usage tables. Only the AI provider is mocked, and it returns
 * unsafe meals (pasta, bread, peanut butter, satay). A filtered user must get
 * none of it, keep their saved filters, and not be charged a credit.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_ai_allergen_stopgap_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stopgap-127a-pg-secret';

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
    chatJson: jest.fn(async () => ({ ok: true, json: plan, text: JSON.stringify(plan), provider: 'mock' })),
  };
});

// Usage counting isn't under test here; a spy shows whether a credit was charged.
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return { ...actual, checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })), refundAiCall: jest.fn(async () => true) };
});

const SCHEMA = `
drop table if exists user_profiles, users cascade;
create table users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_login_at timestamptz,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamptz,
  stripe_customer_id varchar(255), settings jsonb default '{}'::jsonb, profile_image text);
create table user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]'::jsonb,
  allergies jsonb default '[]'::jsonb, target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamptz not null default now());
`;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const engine = require('./lib/meal-plan-engine');
const dietGuard = require('./lib/diet-guard');

const GF = '00000000-0000-4000-8000-0000000127a1';
const PEANUT = '00000000-0000-4000-8000-0000000127a2';
const PLAIN = '00000000-0000-4000-8000-0000000127a3';

let pool;
let app;
const as = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
const profileOf = async (id) => (await pool.query('select dietary_preferences, allergies from user_profiles where user_id=$1', [id])).rows[0];

function servedGroups(plan) {
  const items = [];
  for (const d of plan.days) for (const m of Object.values(d.meals)) {
    for (const i of m.ingredients || []) items.push([i.item || i.name]);
    for (const s of m.swaps || []) for (const i of s.ingredients || []) items.push([i.item || i.name]);
  }
  return engine.allergensOf(items);
}

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
  await pool.query('delete from users where id = any($1::uuid[])', [[GF, PEANUT, PLAIN]]);
  for (const [id, email] of [[GF, 'gf@example.test'], [PEANUT, 'pn@example.test'], [PLAIN, 'pl@example.test']]) {
    await pool.query(`insert into users(id,email,name,password_hash,settings) values ($1,$2,'T','x','{"aiDataConsent":true}'::jsonb)`, [id, email]);
  }
  await pool.query(`insert into user_profiles(user_id,dietary_preferences,allergies,target_calories,target_protein) values
    ($1,'["gluten free"]'::jsonb,'[]'::jsonb,2000,150),
    ($2,'[]'::jsonb,'["peanuts"]'::jsonb,2200,140),
    ($3,'[]'::jsonb,'[]'::jsonb,2000,150)`, [GF, PEANUT, PLAIN]);
  aiClient.chat.mockClear(); aiClient.chatJson.mockClear(); aiUsage.checkAndConsume.mockClear();
});
afterAll(async () => { if (pool) await pool.end(); });

maybe('#127a on real Postgres', () => {
  it('saved gluten free, nothing ticked -> no pasta, bread or gluten; saved filters kept; no credit', async () => {
    const before = await profileOf(GF);
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(GF)).send({ calories: 2000, protein: 150, days: 7, dietary: [] });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|pasta|spaghetti|\bbread\b|\boats?\b|couscous/i);
    expect(servedGroups(r.body.plan)).not.toContain('gluten');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(await profileOf(GF)).toEqual(before);
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('saved gluten free + sent nut free -> both apply, saved list unchanged', async () => {
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(GF)).send({ calories: 2000, protein: 150, days: 7, dietary: ['nut free'] });
    expect(r.body.dietary).toEqual(expect.arrayContaining(['gluten free', 'nut free']));
    expect(servedGroups(r.body.plan)).not.toContain('gluten');
    expect(servedGroups(r.body.plan)).not.toContain('nuts');
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
  });

  it('peanut allergy -> no peanut butter or satay in plans, onboarding week or Coach', async () => {
    const plan = await request(app).post('/api/meal-plan/generate').set('Authorization', as(PEANUT)).send({ calories: 2200, protein: 140, days: 7 });
    const week = await request(app).post('/api/meal-plan/generate').set('Authorization', as(PEANUT)).send({ calories: 2200, protein: 140, days: 7, builderOnly: true });
    const food = await request(app).post('/api/ai/chat').set('Authorization', as(PEANUT)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });
    const other = await request(app).post('/api/ai/chat').set('Authorization', as(PEANUT)).send({ intent: 'workout', messages: [{ role: 'user', content: 'How many sets of squats?' }] });
    for (const r of [plan, week, food, other]) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|peanut|satay/i);
    }
    expect(servedGroups(plan.body.plan)).not.toContain('nuts');
    expect(servedGroups(week.body.plan)).not.toContain('nuts');
    expect(food.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect((await profileOf(PEANUT)).allergies).toEqual(['peanuts']);
  });

  it('no filters -> unchanged: the AI is asked', async () => {
    await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7 });
    expect(aiClient.chatJson).toHaveBeenCalled();
    const c = await request(app).post('/api/ai/chat').set('Authorization', as(PLAIN)).send({ messages: [{ role: 'user', content: 'dinner idea?' }] });
    expect(c.body.reply).toMatch(/MOCKAI/);
  });
});
