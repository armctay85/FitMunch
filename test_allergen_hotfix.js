'use strict';
/**
 * P0 allergen hotfix: stored filters on every food path, fixed synonym map,
 * unknown terms fail closed, and trainer role is read from the database.
 * AI calls are mocked.
 */
const fs = require('fs');
const path = require('path');
const plans = [];
const lists = [];

jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      const q = String(sql);
      if (/INSERT INTO meal_plans/i.test(q)) {
        const row = { id: plans.length + 1, user_id: params[0], name: params[1], meals: JSON.parse(params[4]) };
        plans.push(row);
        return Promise.resolve({ rows: [{ ...row, meals: params[4] }] });
      }
      if (/FROM meal_plans/i.test(q) && /WHERE id=/i.test(q)) {
        const row = plans.find((p) => String(p.id) === String(params[0]));
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (/INSERT INTO shopping_lists/i.test(q)) {
        const items = JSON.parse(params[3]);
        const row = { id: lists.length + 1, user_id: params[0], name: params[2], items };
        lists.push(row);
        return Promise.resolve({ rows: [row] });
      }
      if (/FROM shopping_lists/i.test(q)) {
        return Promise.resolve({ rows: lists.filter((row) => row.user_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    }
  },
}));

jest.mock('./lib/ai-client', () => ({
  hasProvider: () => true,
  chat: jest.fn(),
  chatJson: jest.fn(),
  providerName: () => 'xai',
  MIN_ATTEMPT_MS: 2500,
}));

jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 5 })),
  refundAiCall: jest.fn(async () => true),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
  smokeDailyCap: () => 10,
  smokeUsedToday: async () => 0,
  freeMonthlyLimit: () => 3,
  getUsed: async () => 0,
  monthKey: () => '2026-11',
  sydneyDay: () => '2026-11-17',
}));

const roles = {};
let profile = {};
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, email: 'smoke@fitmunch.com.au', name: 'Smoke', subscriptionTier: 'premium', settings: { aiDataConsent: true }, role: roles[id] })),
    getUserRole: jest.fn(async (id) => (Object.prototype.hasOwnProperty.call(roles, id) ? roles[id] : null)),
    getProfile: jest.fn(async () => profile),
    createOrUpdateProfile: jest.fn(async () => {}),
    mergeProfileFilters: jest.fn(async () => {}),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
    effectiveTier: () => 'premium',
  };
});

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const HAD_DB = process.env.DATABASE_URL;
process.env.DATABASE_URL = HAD_DB || 'postgres://mocked/never-used';
afterAll(() => { if (HAD_DB === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = HAD_DB; });

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const safety = require('./lib/meal-safety');
const dietGuard = require('./lib/diet-guard');
const norm = require('./lib/allergen-norm');
const { accountRole } = require('./lib/account-role');

const USER = '00000000-0000-4000-8000-00000000a11e';
const auth = `Bearer ${jwt.sign({ userId: USER, role: 'pt' }, process.env.JWT_SECRET)}`;
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));

const CASES = [
  { allergy: '花生', hits: [/花生/, /peanut butter/i] },
  { allergy: 'ghee', hits: [/ghee/i] },
  { allergy: 'surimi', hits: [/surimi/i] },
  { allergy: 'tahini', hits: [/tahini/i] },
  { allergy: 'peanut butter', hits: [/peanut butter/i, /花生/] },
];

function zeroHits(text, hits) {
  const body = String(text);
  for (const hit of hits) expect(body).not.toMatch(hit);
}

function mealWith(food) {
  return {
    name: food,
    calories: 400,
    protein: 20,
    ingredients: [{ item: food, qty: '30g' }, { item: 'Rice', qty: '150g' }],
  };
}

beforeEach(() => {
  plans.length = 0;
  lists.length = 0;
  profile = {};
  for (const k of Object.keys(roles)) delete roles[k];
  aiClient.chat.mockReset();
  aiClient.chatJson.mockReset();
});

describe('fixed allergen map', () => {
  test('花生, ghee, surimi, tahini and peanut butter map to canonical allergens', () => {
    expect(norm.dietsFor('花生')).toEqual(['nut free']);
    expect(norm.dietsFor('ghee')).toEqual(['dairy free']);
    expect(norm.dietsFor('surimi')).toEqual(['shellfish free', 'fish free']);
    expect(norm.dietsFor('tahini')).toEqual(['sesame free']);
    expect(norm.dietsFor('peanut butter')).toEqual(['nut free']);
    expect(norm.dietsFor('milk')).toContain('dairy free');
    expect(norm.dietsFor('butter')).toContain('dairy free');
    expect(norm.dietsFor('cheese')).toContain('dairy free');
    expect(norm.dietsFor('whey')).toContain('dairy free');
    expect(norm.dietsFor('casein')).toContain('dairy free');
    expect(norm.dietsFor('tree nuts')).toEqual(['nut free']);
    expect(norm.dietsFor('wheat')).toEqual(['gluten free']);
    expect(norm.dietsFor('egg')).toEqual(['egg free']);
    expect(norm.dietsFor('soy')).toEqual(['soy free']);
  });

  test('plant milks, nut butters and butter beans are not dairy', () => {
    for (const name of ['coconut milk', 'almond milk', 'oat milk', 'rice milk', 'butter beans', 'butternut', 'peanut butter', 'cocoa butter']) {
      expect(norm.flagsForText(name).has('dairy')).toBe(false);
    }
    expect(safety.flagsInText('coconut milk').has('dairy')).toBe(false);
    expect(safety.flagsInText('butter beans').has('dairy')).toBe(false);
  });

  test('an unknown term fails closed and is flagged', () => {
    expect(norm.unmappable('古早味')).toBe(true);
    expect(norm.unmappable('花生')).toBe(false);
    expect(norm.unmappable('kiwi')).toBe(false);
    const diets = dietGuard.allergyDiets(['古早味']);
    for (const diet of dietGuard.ALL_FREE) expect(diets).toContain(diet);
    const flag = dietGuard.unknownAllergyFlag(['古早味']);
    expect(flag).toBe("We couldn't match this allergy (古早味). Foods that may contain it are left out.");
    expect(flag).not.toMatch(/—|--/);
  });
});

describe('EQA allergen cases return zero hits on every food output', () => {
  test.each([1, 2])('pass %s on the smoke account', async () => {
    for (const c of CASES) {
      profile = { allergies: [c.allergy], targetCalories: 2000, targetProtein: 120 };
      const saved = await request(app).post('/api/meal-plans').set('Authorization', auth).send({
        name: 'Saved week',
        meals: [{ day: 'Monday', meals: { lunch: mealWith(c.allergy === '花生' ? '花生酱' : c.allergy) } }],
      });
      expect(saved.status).toBe(200);
      expect(saved.body.allergenWarnings.length).toBeGreaterThan(0);
      const typed = await request(app).post('/api/meal-plans').set('Authorization', auth).send({
        name: 'Typed',
        meals: [mealWith(c.allergy === '花生' ? '花生' : c.allergy)],
      });
      expect(typed.status).toBe(200);
      const shopSaved = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: saved.body.plan.id });
      const shopTyped = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: typed.body.plan.id });
      expect(shopSaved.status).toBe(200);
      expect(shopTyped.status).toBe(200);
      zeroHits(JSON.stringify(shopSaved.body.list.items), c.hits);
      zeroHits(JSON.stringify(shopTyped.body.list.items), c.hits);

      aiClient.chatJson.mockResolvedValue({
        ok: true,
        provider: 'xai',
        data: { days: [{ meals: { lunch: mealWith('ghee surimi tahini peanut butter 花生') } }] },
      });
      const plan = await request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({
        goal: 'maintain', days: 1, calories: 2000, protein: 120, dietary: [],
      });
      expect(plan.status).toBe(200);
      expect(plan.body.source).toBe('builder');
      expect(aiClient.chatJson).not.toHaveBeenCalled();
      zeroHits(JSON.stringify(plan.body.plan), c.hits);

      const basket = await request(app).post('/api/meal-plan/shopping').set('Authorization', auth).send({
        plan: { planName: 'Week', days: [{ meals: { lunch: mealWith('ghee') } }, { meals: { lunch: mealWith('surimi') } }, { meals: { lunch: mealWith('tahini') } }, { meals: { lunch: mealWith('peanut butter') } }, { meals: { lunch: mealWith('花生') } }] },
      });
      expect(basket.status).toBe(200);
      zeroHits(JSON.stringify(basket.body.list), c.hits);

      aiClient.chat.mockResolvedValue({ ok: true, text: 'Have ghee, surimi, tahini, peanut butter and 花生 tonight.', provider: 'xai' });
      const chat = await request(app).post('/api/ai/chat').set('Authorization', auth).send({
        messages: [{ role: 'user', content: 'What should I eat for lunch?' }],
      });
      expect(chat.status).toBe(200);
      zeroHits(chat.body.reply, c.hits);

      const insight = await request(app).post('/api/ai/insight').set('Authorization', auth).send({
        todayCalories: 400, todayProtein: 20, streak: 1, goal: 'general_fitness', targetCalories: 2000, targetProtein: 120,
      });
      expect(insight.status).toBe(200);
      zeroHits(insight.body.insight, c.hits);

      aiClient.chatJson.mockResolvedValue({
        ok: true,
        provider: 'xai',
        data: { planName: 'Arms', summary: 'Eat peanut butter, ghee, surimi, tahini and 花生 after training.', level: 'intermediate', frequency: 3, workouts: [{ day: 1, name: 'Press', sets: 3, reps: '8', rest: 60, notes: 'peanut butter' }] },
      });
      const workout = await request(app).post('/api/ai/workout-plan').set('Authorization', auth).send({ daysPerWeek: 3, level: 'intermediate' });
      expect(workout.status).toBe(200);
      expect(workout.body.source).toBe('fixed');
      expect(aiClient.chatJson).not.toHaveBeenCalled();
      zeroHits(JSON.stringify(workout.body.plan), c.hits);
    }
  });
});

describe('unknown allergy term fails closed', () => {
  test('the plan, list, chat, insight and workout name the term and skip allergen foods', async () => {
    profile = { allergies: ['古早味'], targetCalories: 2000, targetProtein: 120 };
    const plan = await request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({
      goal: 'maintain', days: 1, calories: 2000, protein: 120, dietary: [],
    });
    expect(plan.status).toBe(200);
    expect(plan.body.source).toBe('builder');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(plan.body.notice).toMatch(/古早味/);
    expect(plan.body.notice).toMatch(/left out/);
    zeroHits(JSON.stringify(plan.body.plan), [/ghee/i, /surimi/i, /tahini/i, /peanut butter/i, /花生/]);

    const saved = await request(app).post('/api/meal-plans').set('Authorization', auth).send({
      name: 'Typed',
      meals: [mealWith('ghee')],
    });
    expect(JSON.stringify(saved.body.allergenWarnings)).toMatch(/古早味/);
    const shop = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: saved.body.plan.id });
    zeroHits(JSON.stringify(shop.body.list.items), [/ghee/i]);
    expect(shop.body.allergyFlag).toMatch(/古早味/);
  });
});

describe('role is the database column', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
  const ddl = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');

  test('checkout and trainer access do not trust the token role', () => {
    expect(serverSrc).not.toMatch(/normalizeCheckoutPlan\(requestedPlan,\s*decoded\.role\)/);
    expect(serverSrc).not.toMatch(/decoded\.role\s*!==\s*'pt'/);
    expect(apiSrc).not.toMatch(/decoded\.role\s*!==\s*'pt'/);
    expect(apiSrc).not.toMatch(/enforceSavedMeals\(sentMeals,\s*\{\}\)/);
  });

  test('the new default is user and existing rows are not rewritten', () => {
    expect(ddl).toContain("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'");
    expect(ddl).not.toMatch(/UPDATE\s+users\s+SET\s+role/i);
    expect(apiSrc).not.toContain("DEFAULT 'pt'");
    expect(apiSrc).toContain("SET DEFAULT 'user'");
  });

  test('a token role does not override the database role', async () => {
    roles[USER] = 'user';
    expect(await accountRole({ id: USER, role: 'pt' })).toBe('user');
    roles[USER] = 'pt';
    expect(await accountRole({ id: USER, role: 'client' })).toBe('pt');
    expect(await accountRole({ id: 'pt-1', role: 'pt' })).toBe('pt');
  });
});
