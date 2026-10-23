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
  // The app's sessions run in AEDT (not UTC), so timezone bugs in the updatedAt token show (EQA #142 S1).
  process.env.DATABASE_URL = URL + (URL.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c TimeZone=Australia/Sydney');
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
drop table if exists meal_logs, meal_plans, plan_assignments, user_profiles, users cascade;
create table users(id uuid primary key, email varchar(255) not null unique, name text not null, password_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_login_at timestamptz,
  email_verified boolean default false, subscription_tier varchar(50) default 'free', subscription_expires_at timestamptz,
  stripe_customer_id varchar(255), settings jsonb default '{}'::jsonb, profile_image text);
create table user_profiles(id serial primary key, user_id uuid not null references users(id) on delete cascade, height real, weight real,
  age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), dietary_preferences jsonb default '[]'::jsonb,
  allergies jsonb default '[]'::jsonb, target_calories integer default 2000, target_steps integer default 10000, target_protein integer,
  target_carbs integer, target_fat integer, updated_at timestamptz not null default now());
create table meal_logs(id serial primary key, user_id uuid not null references users(id) on delete cascade, date timestamptz not null default now(), meal_type varchar(50) not null, food_name text not null, calories integer not null, protein real default 0, carbs real default 0, fat real default 0, fiber real default 0, serving_size text, created_at timestamptz not null default now());
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
    expect(aiClient.chatJson).not.toHaveBeenCalled();
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

  // ── #141 r2 (Elite QA #141 r1) ──
  const gen = (who, dietary, extra = {}) => request(app).post('/api/meal-plan/generate').set('Authorization', as(who)).send({ calories: 2000, protein: 150, days: 7, dietary, ...extra });
  const setDiet = (id, v) => pool.query('update user_profiles set dietary_preferences=$2::jsonb where user_id=$1', [id, JSON.stringify(v)]);
  const sorted = async (id) => [...(await profileOf(id)).dietary_preferences].sort();

  it.each(Array.from({ length: 10 }, (_, i) => [i + 1]))('#141 M1 race %i/10: two generates at once (nut + dairy) keep both filters', async () => {
    const [a, b] = await Promise.all([gen(PLAIN, ['nut free']), gen(PLAIN, ['dairy free'])]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await sorted(PLAIN)).toEqual(['dairy free', 'nut free']);
    expect((await pool.query('select count(*)::int n from user_profiles where user_id=$1', [PLAIN])).rows[0].n).toBe(1);
  });

  const save = (who, body) => request(app).post('/api/user/profile').set('Authorization', as(who)).send(body);
  const updatedAt = async (id) => (await pool.query('select updated_at from user_profiles where user_id=$1', [id])).rows[0].updated_at.toISOString();
  // Deterministic ordering: a second client holds the row lock; requests are started one by one and each
  // is seen waiting on a lock before the next starts; then the lock is released (EQA #141 r2 S1).
  const waiting = async () => (await pool.query("select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()")).rows[0].n;
  const until = async (n) => { for (let i = 0; i < 200 && (await waiting()) < n; i++) await new Promise((r) => setTimeout(r, 10)); expect(await waiting()).toBeGreaterThanOrEqual(n); };
  async function ordered(id, first, second) {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from user_profiles where user_id=$1 for update', [id]);
      const p1 = first(); p1.then(() => {}, () => {}); const r1 = p1.then((x) => x);
      await until(1);
      const p2 = second(); const r2 = p2.then((x) => x);
      await until(2);
      await holder.query('commit');
      return [await r1, await r2];
    } finally { await holder.query('rollback').catch(() => {}); holder.release(); }
  }

  it.each(Array.from({ length: 10 }, (_, i) => [i + 1]))('#141 M1 race %i/10: generate (nut free) then a stale profile save -> 409, nut free and the old value kept', async () => {
    await setDiet(PLAIN, ['gluten free']);
    const loaded = await updatedAt(PLAIN);
    const [g, p] = await ordered(PLAIN, () => gen(PLAIN, ['nut free']), () => save(PLAIN, { dietaryPreferences: [], weight: 70, profileUpdatedAt: loaded }));
    expect(g.status).toBe(200);
    expect(p.status).toBe(409);
    expect(await sorted(PLAIN)).toEqual(['gluten free', 'nut free']);
  });

  it.each(Array.from({ length: 10 }, (_, i) => [i + 1]))('#141 M1 race %i/10: profile save (gluten free) then generate (nut free) -> both kept', async () => {
    const loaded = await updatedAt(PLAIN);
    const [p, g] = await ordered(PLAIN, () => save(PLAIN, { dietaryPreferences: ['gluten free'], profileUpdatedAt: loaded }), () => gen(PLAIN, ['nut free']));
    expect([p.status, g.status]).toEqual([200, 200]);
    expect(await sorted(PLAIN)).toEqual(['gluten free', 'nut free']);
  });

  it.each(Array.from({ length: 20 }, (_, i) => [i + 1]))('#141 M1 race %i/20: generate racing a [] save with a fresh updatedAt -> filters, AI and credits stay safe', async () => {
    const loaded = await updatedAt(PLAIN);
    const [g, p] = await Promise.all([gen(PLAIN, ['nut free']), save(PLAIN, { dietaryPreferences: [], weight: 70, profileUpdatedAt: loaded })]);
    expect(g.status).toBe(200);
    // Either the save ran first (200, then the generate adds nut free) or second (409, nut free kept).
    expect([200, 409]).toContain(p.status);
    expect((await profileOf(PLAIN)).dietary_preferences).toEqual(['nut free']);
    const c = await request(app).post('/api/ai/chat').set('Authorization', as(PLAIN)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });
    expect(c.body.provider).toBeNull();
    expect(JSON.stringify(c.body)).not.toMatch(/MOCKAI|peanut|satay/i);
  });

  it.each(Array.from({ length: 10 }, (_, i) => [i + 1]))('#141 M1 race %i/10: no profile row, a save racing a generate -> exactly 1 row with nut free', async () => {
    await pool.query('delete from user_profiles where user_id=$1', [PLAIN]);
    const [p, g] = await Promise.all([save(PLAIN, { weight: 70 }), gen(PLAIN, ['nut free'])]);
    expect([p.status, g.status]).toEqual([200, 200]);
    const rows = (await pool.query('select dietary_preferences d, weight from user_profiles where user_id=$1', [PLAIN])).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].d).toEqual(['nut free']);
    expect(rows[0].weight).toBe(70);
  });

  it('#141 L1: a brand-new user (no users row) with two concurrent generates keeps both ticks', async () => {
    const NEW = '00000000-0000-4000-8000-0000000141a1';
    await pool.query('delete from users where id=$1', [NEW]);
    await Promise.all([gen(NEW, ['nut free']), gen(NEW, ['dairy free'])]);
    const rows = (await pool.query('select dietary_preferences d from user_profiles where user_id=$1', [NEW])).rows;
    expect(rows.length).toBe(1);
    expect([...rows[0].d].sort()).toEqual(['dairy free', 'nut free']);
    await pool.query('delete from users where id=$1', [NEW]);
  });

  it('#141 M1: a user with no profile row gets exactly one row from two concurrent generates', async () => {
    await pool.query('delete from user_profiles where user_id=$1', [PLAIN]);
    await Promise.all([gen(PLAIN, ['nut free']), gen(PLAIN, ['egg free'])]);
    const rows = (await pool.query('select dietary_preferences d from user_profiles where user_id=$1', [PLAIN])).rows;
    expect(rows.length).toBe(1);
    expect([...rows[0].d].sort()).toEqual(['egg free', 'nut free']);
  });

  it('#141 M2: onboarding (builderOnly) nut free -> saved; Coach, weekly review and insights make 0 AI calls, 0 credits', async () => {
    const r = await gen(PLAIN, ['nut free'], { builderOnly: true });
    expect(r.body.source).toBe('builder');
    expect((await profileOf(PLAIN)).dietary_preferences).toEqual(['nut free']);
    const c = await request(app).post('/api/ai/chat').set('Authorization', as(PLAIN)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });
    const w = await request(app).get('/api/ai/weekly-review').set('Authorization', as(PLAIN));
    const i = await request(app).post('/api/ai/insight').set('Authorization', as(PLAIN)).send({ todayCalories: 800, targetCalories: 2000, targetProtein: 150 });
    for (const x of [c, w, i]) { expect(x.status).toBe(200); expect(JSON.stringify(x.body)).not.toMatch(/MOCKAI|peanut/i); }
    expect(c.body.provider).toBeNull();
    expect(w.body.source).toBe('fixed');
    expect(i.body.provider).toBeNull();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it('#141 S1: dedupe, case-folding and nothing-added write nothing new', async () => {
    await setDiet(GF, ['Gluten Free']);
    await gen(GF, ['gluten free', 'GLUTEN_FREE']);
    expect((await profileOf(GF)).dietary_preferences).toEqual(['Gluten Free']);
    await gen(GF, ['nut free', 'Nut-Free']);
    expect((await profileOf(GF)).dietary_preferences).toEqual(['Gluten Free', 'nut free']);
  });

  const coachFood = () => request(app).post('/api/ai/chat').set('Authorization', as(GF)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });

  it.each([['none'], [''], ['[]'], [{}], [['none']], [{ 'nut free': false }]])('#141 r2 M2: empty-looking saved %j + nut free tick -> saved; Coach, review, insight make 0 AI calls', async (empty) => {
    await setDiet(GF, empty);
    await gen(GF, ['nut free']);
    expect((await profileOf(GF)).dietary_preferences).toEqual(['nut free']);
    const c = await coachFood();
    const w = await request(app).get('/api/ai/weekly-review').set('Authorization', as(GF));
    const i = await request(app).post('/api/ai/insight').set('Authorization', as(GF)).send({ todayCalories: 800, targetCalories: 2000, targetProtein: 150 });
    for (const x of [c, w, i]) expect(JSON.stringify(x.body)).not.toMatch(/MOCKAI|peanut/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it.each([[[{ name: 'gluten free' }]], [{ gluten: { severe: true } }], ['peanut-free diet'], [['Paleo']]])('#141 S2/M2: odd saved format %j is never overwritten; the tick goes to allergies and Coach names no peanut', async (odd) => {
    await setDiet(GF, odd);
    await gen(GF, ['nut free']);
    expect((await profileOf(GF)).dietary_preferences).toEqual(odd);
    expect((await profileOf(GF)).allergies).toEqual(['nut free']);
    const c = await coachFood();
    expect(c.body.provider).toBeNull();
    // The meals name no nut food ('Not applied' only echoes the user's own saved words).
    expect(String(c.body.reply).replace(/^Not applied:.*$/m, '')).not.toMatch(/MOCKAI|peanut|satay|almond|cashew/i);
    const saved = dietGuard.savedFilters({ dietaryPreferences: odd, allergies: ['nut free'] });
    if (dietGuard.unreadable(saved)) expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('#141 M1: a stale save without filters still saves; a bad profileUpdatedAt is a 400', async () => {
    const r = await save(GF, { weight: 80, profileUpdatedAt: '2001-01-01T00:00:00Z' });
    expect(r.status).toBe(200);
    expect((await save(GF, { dietaryPreferences: [], profileUpdatedAt: 'nope' })).status).toBe(400);
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
  });

  // ── #142 r2 (Elite QA #142) ──
  const setAllergies = (id, v) => pool.query('update user_profiles set allergies=$2::jsonb where user_id=$1', [id, JSON.stringify(v)]);
  const mealsOf = (reply) => String(reply).replace(/^Not applied:.*$/m, '');

  it.each([
    ['peanut-free diet', 'sesame'],
    ['gluten free', 'sesame'],
    [[{ name: 'gluten free' }], [{ severe: 'egg' }]],
    [{ gluten: { severe: true } }, { egg: { severe: true } }],
  ])('#142 M1: saved diet %j + allergies %j, tick nut free -> tick saved, nothing dropped, Coach meals name no nut food', async (diet, allergies) => {
    await setDiet(GF, diet); await setAllergies(GF, allergies);
    await gen(GF, ['nut free']);
    const after = await profileOf(GF);
    expect(dietGuard.savedFilters({ dietaryPreferences: after.dietary_preferences, allergies: after.allergies })).toContain('nut free');
    if (typeof allergies !== 'string') expect(JSON.stringify(after)).toContain(JSON.stringify(allergies).replace(/^\[|\]$/g, ''));
    const c = await request(app).post('/api/ai/chat').set('Authorization', as(GF)).send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Give me a meal plan for tomorrow' }] });
    expect(c.body.provider).toBeNull();
    expect(mealsOf(c.body.reply)).not.toMatch(/MOCKAI|peanut|satay|almond|cashew|\bnuts?\b/i);
    const saved = dietGuard.savedFilters({ dietaryPreferences: diet, allergies });
    if (dietGuard.unreadable(saved)) expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('#142 S1: GET then POST with the loaded updatedAt round-trips in an AEDT session (200), and goes stale after a generate (409)', async () => {
    const tz = await require('./server/storage.js').db.execute(require('drizzle-orm').sql`show timezone`);
    expect(JSON.stringify(tz.rows || tz)).toMatch(/Australia\/Sydney/);
    const load = async () => (await request(app).get(`/api/user/profile/${GF}`).set('Authorization', as(GF))).body.profile.updatedAt;
    const t1 = await load();
    expect((await save(GF, { dietaryPreferences: ['gluten free', 'dairy free'], profileUpdatedAt: t1 })).status).toBe(200);
    const t2 = await load();
    await gen(GF, ['nut free']);
    expect((await save(GF, { dietaryPreferences: ['gluten free'], profileUpdatedAt: t2 })).status).toBe(409);
    expect(await sorted(GF)).toEqual(['dairy free', 'gluten free', 'nut free']);
    expect((await save(GF, { dietaryPreferences: ['gluten free'], profileUpdatedAt: await load() })).status).toBe(200);
  });

  it('#142 S5: a filter save without profileUpdatedAt is a 400 and writes nothing', async () => {
    for (const body of [{ dietaryPreferences: [] }, { allergies: [] }, { dietaryPreferences: [], weight: 70 }]) {
      expect((await save(GF, body)).status).toBe(400);
    }
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
  });

  // ── #142 follow-up ──
  it('#142 fu: with no profile row yet, a filter save without profileUpdatedAt saves (exactly 1 row)', async () => {
    await pool.query('delete from user_profiles where user_id=$1', [PLAIN]);
    const r = await save(PLAIN, { allergies: ['peanut'], dietaryPreferences: ['vegan'], weight: 71 });
    expect(r.status).toBe(200);
    const rows = (await pool.query('select dietary_preferences d, allergies a, weight from user_profiles where user_id=$1', [PLAIN])).rows;
    expect(rows).toEqual([{ d: ['vegan'], a: ['peanut'], weight: 71 }]);
    // Once the row exists, the next filter save must name the version again.
    expect((await save(PLAIN, { allergies: [] })).status).toBe(400);
    expect((await profileOf(PLAIN)).allergies).toEqual(['peanut']);
  });

  it('#142 fu: an impossible calendar date in profileUpdatedAt is a 400, not a 500, and writes nothing', async () => {
    for (const bad of ['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-15T24:00:00Z', '2026-10-15T10:60:00Z', '2026-10-15T10:00:00+15:00', '2025-02-29T00:00:00Z', '0000-01-01T00:00:00Z']) {
      expect([bad, (await save(GF, { dietaryPreferences: [], profileUpdatedAt: bad })).status]).toEqual([bad, 400]);
    }
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
    expect((await save(GF, { dietaryPreferences: ['gluten free'], profileUpdatedAt: await updatedAt(GF) })).status).toBe(200);
  });

  it('#142 fu: odd keys like constructor and __proto__ in the body are ignored safely', async () => {
    for (const body of [{ constructor: 5 }, { constructor: { prototype: { x: 1 } } }, JSON.parse('{"__proto__":{"allergies":[]},"weight":72}'), { toString: 5, hasOwnProperty: 1 }]) {
      const r = await save(GF, body);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 200]);
    }
    expect((await profileOf(GF)).dietary_preferences).toEqual(['gluten free']);
    expect(({}).constructor).toBe(Object);
    expect(Object.prototype.allergies).toBeUndefined();
  });

  it('#142 S2: a profile save whose DB connection is killed mid-transaction does not crash, and later saves succeed', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from user_profiles where user_id=$1 for update', [GF]);
      const p = save(GF, { weight: 81 }).then((r) => r, (e) => e);
      await until(1);
      const victim = (await pool.query("select pid from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()")).rows.map((r) => r.pid);
      expect(victim.length).toBe(1);
      await pool.query('select pg_terminate_backend($1)', victim);
      const r = await p;
      expect(r.status).toBeGreaterThanOrEqual(500);
      await holder.query('commit');
    } finally { await holder.query('rollback').catch(() => {}); holder.release(); }
    // The killed client was destroyed, not pooled: every following write gets a live connection.
    for (let i = 0; i < 25; i++) expect((await save(GF, { weight: 60 + i })).status).toBe(200);
    expect((await pool.query('select weight from user_profiles where user_id=$1', [GF])).rows[0].weight).toBe(84);
  });

  it('#142 S3: with 3 profile rows, reads, generate merges and saves all target the lowest id; other rows untouched', async () => {
    await pool.query(`insert into user_profiles(user_id,dietary_preferences,allergies,weight) values ($1,'["vegan"]','[]',90),($1,'["egg free"]','[]',91)`, [GF]);
    // The lowest-id row is updated last, so it is not first in physical order.
    await pool.query("update user_profiles set weight=50 where id=(select min(id) from user_profiles where user_id=$1)", [GF]);
    const rows = async () => (await pool.query('select id, dietary_preferences d, weight from user_profiles where user_id=$1 order by id', [GF])).rows;
    const [low, mid, high] = await rows();
    const p = (await request(app).get(`/api/user/profile/${GF}`).set('Authorization', as(GF))).body.profile;
    expect([p.id, p.weight]).toEqual([low.id, 50]);
    await gen(GF, ['nut free']);
    expect((await save(GF, { weight: 55 })).status).toBe(200);
    const after = await rows();
    expect(after[0]).toEqual({ id: low.id, d: ['gluten free', 'nut free'], weight: 55 });
    expect(after[1]).toEqual(mid);
    expect(after[2]).toEqual(high);
  });

  it('#142 L3: a held profile lock uses the profile namespace key (classid 1410141, two-key form)', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from user_profiles where user_id=$1 for update', [GF]);
      const p = save(GF, { weight: 77 }).then((r) => r);
      await until(1);
      const locks = (await pool.query("select classid::bigint c, objsubid s from pg_locks where locktype='advisory' and granted")).rows;
      expect(locks).toEqual(expect.arrayContaining([{ c: '1410141', s: 2 }]));
      await holder.query('commit');
      expect((await p).status).toBe(200);
    } finally { await holder.query('rollback').catch(() => {}); holder.release(); }
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
        expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), who === GF ? ['gluten free'] : ['dairy free'])).toBe(false);
      }
    }
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
  it('r4: dairy free and gluten free get a checked reply; a gluten question is not repeated', async () => {
    await pool.query(`update user_profiles set dietary_preferences='["dairy free"]'::jsonb where user_id=$1`, [PLAIN]);
    for (const [who, f] of [[PLAIN, 'dairy free'], [GF, 'gluten free']]) {
      for (const q of ['How many sets for squats?', 'Is teriyaki chicken ok?', 'What do I grab before training?']) {
        const r = await ask(who, q, { intent: 'workout' });
        expect(r.status).toBe(200);
        expect(r.body.reply).not.toContain(COMING);
        // Teriyaki is gluten, not dairy. A dairy-free user may see their own question quoted. A gluten-free user must not.
        expect(r.body.reply).not.toMatch(/MOCKAI|Milo|Up ?& ?Go/i);
        if (f === 'gluten free') expect(r.body.reply).not.toMatch(/teriyaki/i);
        safeMealIn(r.body.reply, [f]);
      }
    }
  });

  it('r4: filtered insight reaches the model and stays safe; a weekly review under 3 logged days does not call it', async () => {
    for (const [who, f] of [[PEANUT, 'nut free'], [GF, 'gluten free']]) {
      const r = await request(app).get('/api/ai/weekly-review').set('Authorization', as(who));
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('fixed');
      expect(JSON.stringify(r.body.review)).not.toContain(COMING);
      expect(r.body.review.score).toBeNull();
      expect(JSON.stringify(r.body.review)).not.toMatch(/showed up|peanut/i);
      safeMealIn(JSON.stringify(r.body.review), [f]);
      const i = await request(app).post('/api/ai/insight').set('Authorization', as(who)).send({ todayCalories: 800, targetCalories: 2000, targetProtein: 150 });
      expect(i.body.insight).not.toContain(COMING);
      expect(i.body.insight).not.toMatch(/MOCKAI|peanut/i);
      safeMealIn(i.body.insight, [f]);
    }
    expect(aiClient.chat).toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    // Three logged days: past the weekly review's new-user empty state (launch audit D8).
    for (let d = 0; d < 3; d += 1) await pool.query("insert into meal_logs(user_id, date, meal_type, food_name, calories) values ($1, now() - ($2 || ' days')::interval, 'lunch', 'Chicken salad', 500)", [PLAIN, String(d)]);
    const p = await request(app).get('/api/ai/weekly-review').set('Authorization', as(PLAIN));
    expect(aiClient.chatJson).toHaveBeenCalled();
    expect(p.body.review.score).toBe(7);
    expect(JSON.stringify(p.body.review)).toMatch(/peanut butter/);
    expect(JSON.stringify(p.body.review)).not.toMatch(/showed up/i);
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
