'use strict';

/**
 * Diet-only onboarding must not wipe saved allergies (EQA on #149), and a second
 * onboarding updates the one "Your first week" row (launch audit D2, #146).
 * Save kiwi and peanut, then POST a diet with profileUpdatedAt and no allergies key.
 * The allergies column has to still be kiwi and peanut. The week is saved with
 * POST /meal-plans, then a second pass PUTs that same row.
 *
 * Own schema, so it never drops tables other Postgres suites use.
 * Needs TEST_DATABASE_URL (CI). Skipped locally without it; fails in CI if missing.
 * Every pool this file opens is ended in afterAll (CI previously hit "too many clients").
 */
const BASE = process.env.TEST_DATABASE_URL;
if (!BASE && process.env.CI) throw new Error('test_diet_filter_onboarding_pg: TEST_DATABASE_URL is required in CI');
if (BASE && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(BASE)) throw new Error('TEST_DATABASE_URL looks like a real database');

const SCHEMA = 'diet_filter_onboard_test';
const URL = BASE && `${BASE}${BASE.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const maybe = BASE ? describe : describe.skip;
const PREV_DB = process.env.DATABASE_URL;
if (URL) process.env.DATABASE_URL = URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'diet-filter-onboard-pg';

const USER = '00000000-0000-4000-8000-0000000d1491';
const USER2 = '00000000-0000-4000-8000-0000000d1492';
const hw = require('./public/js/fm-home-week');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let pool;
let app;
const auth = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;
const auth2 = `Bearer ${jwt.sign({ userId: USER2 }, process.env.JWT_SECRET)}`;

beforeAll(async () => {
  if (!BASE) return;
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: BASE });
  await admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
  await admin.end();
  pool = new Pool({ connectionString: URL });
  await pool.query(require('./lib/db-migrate').DDL);
  app = express();
  app.use(express.json());
  app.use('/api', require('./api_server'));
});

afterAll(async () => {
  if (!BASE) return;
  const ended = new Set();
  const stop = async (p) => {
    if (!p || ended.has(p) || typeof p.end !== 'function') return;
    ended.add(p);
    try { await p.end(); } catch (_) { /* already closed */ }
  };
  await stop(pool);
  try { await stop(require('./server/storage.js').__profileTx.pool); } catch (_) { /* storage not loaded */ }
  try { await stop(require('./lib/db-migrate').getPool()); } catch (_) { /* migrate pool not opened */ }
  try { await stop(require('./api_server').__pool); } catch (_) { /* api not loaded */ }
  if (PREV_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = PREV_DB;
});

maybe('diet-only onboarding keeps saved allergies (real SQL)', () => {
  it('saves kiwi and peanut, then a gluten free save with no allergies key leaves them in place', async () => {
    const first = await request(app).post('/api/user/profile').set('Authorization', auth).send({
      allergies: ['kiwi', 'peanut'],
    });
    expect(first.status).toBe(200);

    const loaded = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', auth);
    expect(loaded.status).toBe(200);
    expect(loaded.body.profile.allergies).toEqual(['kiwi', 'peanut']);
    const updatedAt = loaded.body.profile.updatedAt;
    expect(typeof updatedAt).toBe('string');

    const dietOnly = await request(app).post('/api/user/profile').set('Authorization', auth).send({
      dietaryPreferences: ['gluten free'],
      profileUpdatedAt: updatedAt,
    });
    expect(dietOnly.status).toBe(200);
    expect(dietOnly.body.success).toBe(true);

    const row = (await pool.query(
      'select allergies, dietary_preferences from user_profiles where user_id = $1 order by id limit 1',
      [USER],
    )).rows[0];
    expect(row.allergies).toEqual(['kiwi', 'peanut']);
    expect(row.dietary_preferences).toEqual(['gluten free']);

    const again = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', auth);
    expect(again.body.profile.allergies).toEqual(['kiwi', 'peanut']);
    expect(again.body.profile.dietaryPreferences).toEqual(['gluten free']);
  });

  it('merged onboarding keeps kiwi and peanut through a diet-only save, and a second pass reuses the one Your first week row', async () => {
    const first = await request(app).post('/api/user/profile').set('Authorization', auth2).send({
      allergies: ['kiwi', 'peanut'],
    });
    expect(first.status).toBe(200);

    // Targets are their own save and do not send profileUpdatedAt.
    const targets = await request(app).post('/api/user/profile').set('Authorization', auth2).send({
      fitnessGoal: 'lose_weight', targetCalories: 1860, targetProtein: 141, targetCarbs: 207, targetFat: 52,
    });
    expect(targets.status).toBe(200);

    const loaded = await request(app).get(`/api/user/profile/${USER2}`).set('Authorization', auth2);
    const updatedAt = loaded.body.profile.updatedAt;
    expect(loaded.body.profile.allergies).toEqual(['kiwi', 'peanut']);

    // Diet-only: the allergies key is omitted, the same way a save with no allergy chips does.
    const dietOnly = await request(app).post('/api/user/profile').set('Authorization', auth2).send({
      dietaryPreferences: ['gluten free'],
      profileUpdatedAt: updatedAt,
    });
    expect(dietOnly.status).toBe(200);

    const afterDiet = await request(app).get(`/api/user/profile/${USER2}`).set('Authorization', auth2);
    expect(afterDiet.body.profile.allergies).toEqual(['kiwi', 'peanut']);
    expect(afterDiet.body.profile.dietaryPreferences).toEqual(['gluten free']);

    const week = (mealName) => ({
      name: 'Your first week',
      description: 'Built at sign-up from your targets.',
      goalType: 'lose_weight',
      totalCalories: 1860,
      totalProtein: 141,
      meals: [{ day: 'Monday', meals: { breakfast: { name: mealName, calories: 400, protein: 20, ingredients: [{ item: 'Oats', qty: '80g' }] } } }],
    });
    await request(app).post('/api/meal-plans').set('Authorization', auth2).send({ name: 'Older plan', meals: [] });
    const created = await request(app).post('/api/meal-plans').set('Authorization', auth2).send(week('Oats'));
    expect(created.status).toBe(200);
    const createdId = created.body.plan.id;

    const listed = await request(app).get('/api/meal-plans').set('Authorization', auth2);
    expect(listed.status).toBe(200);
    const id = hw.onboardingPlanId(listed.body.plans);
    expect(id).toBe(createdId);

    const again = await request(app).put(`/api/meal-plans/${id}`).set('Authorization', auth2).send(week('Porridge'));
    expect(again.status).toBe(200);
    expect(again.body.plan.id).toBe(createdId);

    const rows = (await pool.query('select id, name, meals from meal_plans where user_id = $1 order by id', [USER2])).rows;
    const firstWeeks = rows.filter((r) => r.name === 'Your first week');
    expect(firstWeeks).toHaveLength(1);
    expect(firstWeeks[0].id).toBe(createdId);
    expect(JSON.stringify(firstWeeks[0].meals)).toContain('Porridge');
    expect(rows.some((r) => r.name === 'Older plan')).toBe(true);

    const still = await request(app).get(`/api/user/profile/${USER2}`).set('Authorization', auth2);
    expect(still.body.profile.allergies).toEqual(['kiwi', 'peanut']);
  });
});
