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
drop table if exists meal_plans, plan_assignments, user_profiles, users cascade;
create table users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_login_at timestamptz,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamptz,
  stripe_customer_id varchar(255), settings jsonb default '{}'::jsonb, profile_image text);
create table user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]'::jsonb,
  allergies jsonb default '[]'::jsonb, target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamptz not null default now());
create table meal_plans(id serial primary key, user_id uuid, name text, description text, goal_type text, meals jsonb, is_active boolean,
  total_calories int, total_protein int, total_carbs int, total_fat int, created_at timestamptz default now(), updated_at timestamptz);
create table plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int, active boolean default true, assigned_at timestamptz default now());
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

  it('saved gluten free + sent nut free -> both apply, and nut free is added to the saved list', async () => {
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(GF)).send({ calories: 2000, protein: 150, days: 7, dietary: ['nut free'] });
    expect(r.body.dietary).toEqual(expect.arrayContaining(['gluten free', 'nut free']));
    expect(servedGroups(r.body.plan)).not.toContain('gluten');
    expect(servedGroups(r.body.plan)).not.toContain('nuts');
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free', 'nut free']);
  });

  it('hotfix: tick a filter on the meal plan page, generate -> saved to the profile; Coach and weekly review make 0 AI calls', async () => {
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7, dietary: ['nut free'] });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect((await profileOf(PLAIN)).dietary_preferences).toEqual(['nut free']);
    expect((await profileOf(PLAIN)).allergies).toEqual([]);
    // A later chat sends no filters: the saved profile alone must keep it off the AI.
    const c = await request(app).post('/api/ai/chat').set('Authorization', as(PLAIN)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });
    expect(c.status).toBe(200);
    expect(c.body.provider).toBeNull();
    expect(JSON.stringify(c.body)).not.toMatch(/MOCKAI|peanut/i);
    const w = await request(app).get('/api/ai/weekly-review').set('Authorization', as(PLAIN));
    expect(w.body.source).toBe('fixed');
    expect(JSON.stringify(w.body)).not.toMatch(/MOCKAI|peanut/i);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    // Generating again with nothing ticked never removes the saved filter.
    await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7, dietary: [] });
    expect((await profileOf(PLAIN)).dietary_preferences).toEqual(['nut free']);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
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

  // ── r2 (Elite QA #135 r1) ──
  const ask = (who, content, extra = {}) => request(app).post('/api/ai/chat').set('Authorization', as(who)).send({ messages: [{ role: 'user', content }], ...extra });

  it('M1: peanut allergy asking for dessert, brekkie, tea or a smoothie gets checked recipes, never the AI', async () => {
    for (const q of ['Give me a dessert idea', 'Any ideas for brekkie?', 'What should I have tonight?', 'Suggest a smoothie', 'What do I make for tea?']) {
      const r = await ask(PEANUT, q);
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('builder');
      expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|peanut|satay|baklava/i);
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('M2: a no-filter user sending null-ish filters still reaches the AI', async () => {
    await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7, dietary: [null, 'null', 'undefined', ''] });
    expect(aiClient.chatJson).toHaveBeenCalled();
  });

  it('S3: allergies stored as an object count', async () => {
    await pool.query(`update user_profiles set allergies='{"peanut":true}'::jsonb where user_id=$1`, [PLAIN]);
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7 });
    expect(r.body.source).toBe('builder');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it('M4: shellfish, fish and soy allergies get no prawns, fish or tofu in the plan', async () => {
    for (const [allergy, re] of [['shellfish', /prawn|shrimp|crab|mussel|squid/i], ['fish', /fish|salmon|tuna|barramundi|prawn/i], ['soy', /tofu|tempeh|edamame|\bsoy/i]]) {
      await pool.query('update user_profiles set allergies=$2::jsonb, dietary_preferences=$3::jsonb where user_id=$1', [PLAIN, JSON.stringify([allergy]), JSON.stringify(allergy === 'soy' ? ['vegan'] : [])]);
      const r = await request(app).post('/api/meal-plan/generate').set('Authorization', as(PLAIN)).send({ calories: 2000, protein: 150, days: 7 });
      expect(r.body.source).toBe('builder');
      expect(JSON.stringify(r.body.plan.days)).not.toMatch(re);
    }
  });

  it('typed meals are saved as typed, with an allergen warning', async () => {
    const meals = [{ name: 'Prawn satay', foods: [{ name: 'Satay sauce', calories: 300 }] }];
    const r = await request(app).post('/api/meal-plans').set('Authorization', as(PEANUT)).send({ name: 'Mine', meals });
    expect(r.status).toBe(200);
    expect(r.body.allergenWarnings).toEqual([{ meal: 'Prawn satay', contains: ['nuts'] }]);
    const row = (await pool.query('select meals from meal_plans where id=$1', [r.body.plan.id])).rows[0];
    expect(row.meals).toEqual(meals);
  });

  // ── r3 (Elite QA #135 r2) ──
  it("r3 M1: QA's 4 training-framed asks get checked recipes for dairy-free and gluten-free users", async () => {
    await pool.query(`update user_profiles set dietary_preferences='["dairy free"]'::jsonb, allergies='[]'::jsonb where user_id=$1`, [PLAIN]);
    for (const who of [PLAIN, GF]) {
      for (const q of ['Best thing to smash after the gym?', 'What do I grab before training?', 'what should I neck after squats', 'What helps recovery after a run?']) {
        const r = await ask(who, q, { intent: 'workout' });
        expect(r.status).toBe(200);
        expect(r.body.source).toBe('builder');
        expect(r.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
      }
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('r3 S1: a typed PB toast keeps a persistent allergen warning in the plan list', async () => {
    const meals = [{ name: 'PB toast', foods: [] }];
    await request(app).post('/api/meal-plans').set('Authorization', as(PEANUT)).send({ name: 'Typed', meals });
    const r = await request(app).get('/api/meal-plans').set('Authorization', as(PEANUT));
    const plan = r.body.plans.find((p) => p.name === 'Typed');
    expect(plan.meals).toEqual(meals);
    expect(plan.allergenWarnings).toEqual([{ meal: 'PB toast', contains: expect.arrayContaining(['nuts']) }]);
  });

  // ── r4 (Elite QA #135 r3): filtered users never reach the AI ──
  const COMING = dietGuard.COMING_SOON;
  const safeMealIn = (text, filters) => {
    expect(engine.TEMPLATES.some((t) => text.includes(`${t.name} (`))).toBe(true);
    expect(dietGuard.textBreaksFilters(text.replace(dietGuard.SAFE_NOTICE, ''), filters)).toBe(false);
  };
  it("r4: QA's leaks (dairy free and GF asking 'How many sets for squats?', GF teriyaki) make no AI call; replies name no food or brand beyond one checked meal", async () => {
    await pool.query(`update user_profiles set dietary_preferences='["dairy free"]'::jsonb where user_id=$1`, [PLAIN]);
    for (const [who, f] of [[PLAIN, 'dairy free'], [GF, 'gluten free']]) {
      for (const q of ['How many sets for squats?', 'Is teriyaki chicken ok?', 'What do I grab before training?']) {
        const r = await ask(who, q, { intent: 'workout' });
        expect(r.status).toBe(200);
        expect(r.body.reply).toContain(COMING);
        expect(r.body.reply).not.toMatch(/MOCKAI|Milo|Up ?& ?Go|teriyaki/i);
        safeMealIn(r.body.reply, [f]);
      }
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('r4: weekly review and insight are fixed for filtered users (no AI, safe meal, coming-soon line); no-filter users still reach the AI', async () => {
    for (const [who, f] of [[PEANUT, 'nut free'], [GF, 'gluten free']]) {
      const r = await request(app).get('/api/ai/weekly-review').set('Authorization', as(who));
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('fixed');
      expect(r.body.review.focus).toContain(COMING);
      safeMealIn(JSON.stringify(r.body.review), [f]);
      const i = await request(app).post('/api/ai/insight').set('Authorization', as(who)).send({ todayCalories: 800, targetCalories: 2000, targetProtein: 150 });
      expect(i.body.insight).not.toContain(COMING);
      expect(r.body.review.score).toBeNull();
      safeMealIn(i.body.insight, [f]);
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    const p = await request(app).get('/api/ai/weekly-review').set('Authorization', as(PLAIN));
    expect(aiClient.chatJson).toHaveBeenCalled();
    expect(JSON.stringify(p.body.review)).toMatch(/peanut butter/);
    const c = await ask(PLAIN, 'How many sets for squats?', { intent: 'workout' });
    expect(c.body.reply).toMatch(/MOCKAI/);
  });

  // ── r5 (Elite QA #135 r4) ──
  it("r5 M1: peanut + crustacea: typed 'Satay prawn noodles' warns nuts and shellfish; Coach has no 'Not applied'; every FSANZ term maps", async () => {
    await pool.query(`update user_profiles set allergies='["peanut","crustacea"]'::jsonb where user_id=$1`, [PLAIN]);
    const s = await request(app).post('/api/meal-plans').set('Authorization', as(PLAIN)).send({ name: 'Typed', meals: [{ name: 'Satay prawn noodles', foods: [] }] });
    expect(s.body.allergenWarnings).toEqual([{ meal: 'Satay prawn noodles', contains: expect.arrayContaining(['nuts', 'shellfish']) }]);
    const g = await request(app).get('/api/meal-plans').set('Authorization', as(PLAIN));
    expect(g.body.plans.find((p) => p.name === 'Typed').allergenWarnings[0].contains).toEqual(expect.arrayContaining(['nuts', 'shellfish']));
    const c = await ask(PLAIN, 'Dinner idea?', { intent: 'nutrition' });
    expect(c.body.reply).not.toMatch(/Not applied/i);
    for (const term of ['crustacea', 'crustaceans', 'bivalves', 'molluscs', 'mollusks', 'cephalopods', 'gastropods']) {
      await pool.query(`update user_profiles set allergies=$2::jsonb where user_id=$1`, [PLAIN, JSON.stringify([term])]);
      const r = await request(app).post('/api/meal-plans').set('Authorization', as(PLAIN)).send({ name: term, meals: [{ name: 'Garlic prawns, mussels and squid', foods: [] }] });
      expect([term, r.body.allergenWarnings[0] && r.body.allergenWarnings[0].contains]).toEqual([term, ['shellfish']]);
      const q = await ask(PLAIN, 'Lunch idea?', { intent: 'nutrition' });
      expect([term, /Not applied/i.test(q.body.reply)]).toEqual([term, false]);
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('r5 S1: malformed saved filters fail closed (no AI); saving them is a 400', async () => {
    for (const bad of [[{ name: 'peanut' }], [['peanut']], 7]) {
      await pool.query(`update user_profiles set allergies=$2::jsonb where user_id=$1`, [PLAIN, JSON.stringify(bad)]);
      const r = await ask(PLAIN, 'How many sets for squats?', { intent: 'workout' });
      expect(r.body.source).toBe('fixed');
      const w = await request(app).post('/api/user/profile').set('Authorization', as(PLAIN)).send({ allergies: bad });
      expect(w.status).toBe(400);
    }
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect((await profileOf(PLAIN)).allergies).toEqual(7);
  });

  it('r5 S2: workout plan for a filtered user is fixed and food-free, no AI, no credit', async () => {
    const r = await request(app).post('/api/ai/workout-plan').set('Authorization', as(PEANUT)).send({ daysPerWeek: 3, focus: 'bulk with peanut butter shakes' });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(JSON.stringify(r.body.plan)).not.toMatch(/peanut|shake|MOCKAI/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('r5 S3: a saved checked template never warns for a filter it fits', async () => {
    await pool.query(`update user_profiles set dietary_preferences='["vegan","gluten free","egg free"]'::jsonb, allergies='[]'::jsonb where user_id=$1`, [PLAIN]);
    const meals = [{ name: 'Tofu scramble on wholegrain toast', foods: [] }, { name: 'Soy milk, tofu and banana smoothie', foods: [] }];
    const r = await request(app).post('/api/meal-plans').set('Authorization', as(PLAIN)).send({ name: 'Checked', meals });
    // Tofu scramble is on wholegrain toast, so gluten free honestly warns; eggs and dairy must not.
    expect(JSON.stringify(r.body.allergenWarnings)).not.toMatch(/eggs|dairy/);
  });
});
