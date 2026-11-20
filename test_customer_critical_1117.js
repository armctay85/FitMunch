'use strict';

/**
 * Customer-critical 1117. One file, one describe per item.
 * The model is mocked. No live AI call.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

jest.mock('pg', () => ({
  Pool: class {
    query(sql) {
      const text = String(sql);
      if (/SELECT role FROM users/i.test(text)) return Promise.resolve({ rows: [{ role: 'client' }] });
      if (/SELECT settings FROM users/i.test(text)) return Promise.resolve({ rows: [{ settings: {} }] });
      if (/COUNT\(\*\)/i.test(text)) return Promise.resolve({ rows: [{ n: 0 }] });
      return Promise.resolve({ rows: [] });
    }
  },
}));
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  chat: jest.fn(),
  chatJson: jest.fn(),
  grokModel: () => 'grok-4.3',
}));
jest.mock('./lib/ai-usage', () => ({
  refundSmokeOnFailure: () => {},
  refundAiCall: jest.fn(async () => true),
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9, limit: 10, used: 1 })),
  isSmokeAccount: () => false,
  getUsed: jest.fn(async () => 0),
  freeMonthlyLimit: () => 10,
  monthKey: () => '2026-11',
  recordTokens: jest.fn(async () => 0),
}));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({
      id, name: 'Jordan', email: 'jordan@example.com', subscriptionTier: 'free', settings: { aiDataConsent: true },
    })),
    getProfile: jest.fn(async () => ({ dietaryPreferences: [], allergies: [], targetCalories: 2240, targetProtein: 162, weight: 85 })),
    effectiveTier: () => 'free',
    createOrUpdateProfile: jest.fn(async () => ({})),
  };
});

const aiClient = require('./lib/ai-client');
const storage = require('./server/storage.js');
const engine = require('./lib/meal-plan-engine');
const mealSafety = require('./lib/meal-safety');
const { PLAN_BOUNDS, computeTargets } = require('./public/js/fm-targets');
const { searchFoods, FOODS } = require('./food-db');
const receipt = require('./lib/receipt-scan-core');
const { AFCD_STAPLES } = require('./lib/afcd-r3-staples');
const checkout = require('./lib/fitmunch-checkout');
const qa = require('./lib/qa-trainer');
const support = require('./lib/support-confirm');
const workout = require('./lib/workout-program');
const { targetsFromBody } = require('./lib/first-run-plan');

function tokenFor(id) {
  return jwt.sign({ userId: id, role: 'client' }, process.env.JWT_SECRET || 'fitmunch-dev-secret');
}

function aiMeal(name, calories, ingredients) {
  return {
    name,
    ingredients: ingredients || [{ item: 'Rolled oats', qty: '60g' }, { item: 'Banana', qty: '1' }],
    calories,
    protein: Math.round(calories / 16),
    carbs: Math.round(calories / 9),
    fat: Math.round(calories / 40),
    prepMins: 10,
  };
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function aiPlan(swap) {
  const per = [500, 550, 700, 300];
  return {
    planName: 'AI plan',
    summary: 's',
    days: DAYS.map((day) => ({
      day,
      meals: {
        breakfast: aiMeal('B', per[0]),
        lunch: aiMeal('L', per[1]),
        dinner: aiMeal('D', per[2]),
        snack: aiMeal('S', per[3]),
      },
    })),
    avgDailyCalories: 2050,
  };
}

function blob(plan) {
  return JSON.stringify(plan || {}).toLowerCase();
}
function everyMealOk(plan, filters) {
  const excluded = mealSafety.excludedFlags(filters);
  const terms = mealSafety.customTerms(filters);
  for (const day of plan.days || []) {
    for (const meal of Object.values(day.meals || {})) {
      expect(mealSafety.mealProblems(meal, excluded, terms)).toBeNull();
    }
  }
}

describe('(a) meal plan time budget', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  const mealSecret = process.env.JWT_SECRET || 'fitmunch-secret-key-change-in-production';
  const mealToken = jwt.sign({ userId: USER }, mealSecret);
  const post = (body) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${mealToken}`).send(body);

  afterEach(() => {
    delete process.env.MEAL_PLAN_BUDGET_MS;
    delete process.env.MEAL_PLAN_ATTEMPT_MS;
    aiClient.chatJson.mockReset();
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: [] });
  });

  test('defaults are 70s budget and 62s attempt, and a fast AI plan is source ai', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'meal-planner.js'), 'utf8');
    expect(src).toMatch(/PLAN_BUDGET_MS = \(\) => Number\(process\.env\.MEAL_PLAN_BUDGET_MS\) \|\| 70000/);
    expect(src).toMatch(/PLAN_ATTEMPT_MS = \(\) => Number\(process\.env\.MEAL_PLAN_ATTEMPT_MS\) \|\| 62000/);
    expect(70000 + 19000).toBeLessThanOrEqual(89000);
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: aiPlan(), usage: { completionTokens: 40 } });
    const res = await post({ goal: 'lose_weight', calories: 2100, protein: 150, days: 7, dietary: [] });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(aiClient.chatJson.mock.calls[0][0].budgetMs).toBeGreaterThan(20000);
  });

  test('generatePlan keeps a 30s answer inside the new attempt window', async () => {
    jest.useFakeTimers();
    const pending = engine.generatePlan(
      { calories: 2100, protein: 150, days: 7, dietary: [] },
      {
        budgetMs: 70000,
        attemptMs: 62000,
        callAi: () => new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, provider: 'xai', data: aiPlan() }), 30000);
        }),
      }
    );
    await jest.advanceTimersByTimeAsync(30000);
    const result = await pending;
    expect(result.source).toBe('ai');
    jest.useRealTimers();
  });
});

describe('(b) diet and allergy filters on the AI plan', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  const mealSecret = process.env.JWT_SECRET || 'fitmunch-secret-key-change-in-production';
  const mealToken = jwt.sign({ userId: USER }, mealSecret);
  const post = (body) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${mealToken}`).send(body);

  beforeEach(() => {
    delete process.env.FILTERED_USERS_CHECKED_BUILDER;
    aiClient.chatJson.mockReset();
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: [] });
  });
  afterEach(() => { delete process.env.FILTERED_USERS_CHECKED_BUILDER; });

  function withOneBadMeal(ingredient) {
    const plan = aiPlan();
    plan.days[0].meals.snack = aiMeal('Bad snack', 300, [{ item: ingredient, qty: '40g' }]);
    return plan;
  }

  test('peanut allergy: the checked builder is used, the model is not called, and peanuts do not leak', async () => {
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['peanuts'] });
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: withOneBadMeal('Peanut butter') });
    const res = await post({ calories: 2100, protein: 150, days: 7, dietary: [] });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(blob(res.body.plan)).not.toMatch(/peanut/);
    everyMealOk(res.body.plan, { allergies: ['peanuts'] });
  });

  test('dairy allergy: a model that adds dairy does not leak dairy', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = '0';
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['dairy'] });
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: withOneBadMeal('Cheddar cheese') });
    const res = await post({ calories: 2100, protein: 150, days: 7 });
    delete process.env.FILTERED_USERS_CHECKED_BUILDER;
    expect(res.status).toBe(200);
    expect(blob(res.body.plan)).not.toMatch(/cheese|milk|yoghurt|yogurt/);
    everyMealOk(res.body.plan, { allergies: ['dairy'] });
  });

  test('vegan plus a meat request from the model does not leak meat', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = '0';
    aiClient.chatJson.mockResolvedValue({
      ok: true,
      provider: 'xai',
      data: (() => {
        const plan = aiPlan();
        for (const day of plan.days) {
          for (const key of Object.keys(day.meals)) {
            day.meals[key] = aiMeal('Chicken steak', day.meals[key].calories, [{ item: 'Chicken breast', qty: '150g' }, { item: 'Beef mince', qty: '80g' }]);
          }
        }
        return plan;
      })(),
    });
    const res = await post({ calories: 2100, protein: 150, days: 7, dietary: ['vegan'] });
    expect(res.status).toBe(200);
    expect(blob(res.body.plan)).not.toMatch(/chicken|beef|mince|salmon|tuna/);
    everyMealOk(res.body.plan, { dietary: ['vegan'] });
    delete process.env.FILTERED_USERS_CHECKED_BUILDER;
  });

  test('51 filters never call the AI', async () => {
    const dietary = Array.from({ length: 51 }, (_, i) => `filter ${i}`);
    const res = await post({ calories: 2100, protein: 150, days: 7, dietary });
    expect(res.status).toBe(400);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
});

describe('(c) support form keeps the message', () => {
  const emailLib = require('./server/email');
  const counters = require('./lib/shared-counters');

  afterEach(() => {
    support.setSupportQueryForTests(null);
    jest.restoreAllMocks();
  });

  test('mask hides the address and a .com.au suffix stays', () => {
    expect(support.maskEmail('jordan@gmail.com')).toBe('j***@g***.com');
    expect(support.maskEmail('a@fitmunch.com.au')).toBe('a***@f***.com.au');
  });

  test('stores the row, emails support, then the receipt', async () => {
    if (typeof counters.resetSharedCountersForTests === 'function') await counters.resetSharedCountersForTests();
    const order = [];
    const calls = [];
    support.setSupportQueryForTests(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/INSERT INTO support_messages/i.test(sql)) order.push('store');
      return { rows: [{ id: '00000000-0000-4000-8000-000000000009' }], rowCount: 1 };
    });
    const forward = jest.spyOn(emailLib, 'sendSupportInboxEmail').mockImplementation(async () => {
      order.push('forward');
      return { success: true, messageId: 're_1' };
    });
    const ack = jest.spyOn(emailLib, 'sendSupportReceivedEmail').mockImplementation(async () => {
      order.push('ack');
      return { success: true, messageId: 're_ack' };
    });
    const logs = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((line) => logs.push(String(line)));
    const logSpy = jest.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
    const res = await support.sendSupportConfirmation({
      email: 'jordan@gmail.com',
      name: 'Jordan',
      topic: 'billing',
      message: 'Please look at my trial.',
    });
    errSpy.mockRestore();
    logSpy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(order[0]).toBe('store');
    expect(order).toEqual(['store', 'forward', 'ack']);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0][0].replyTo).toBe('jordan@gmail.com');
    expect(ack).toHaveBeenCalledTimes(1);
    expect(calls[0].sql).toMatch(/INSERT INTO support_messages/);
    expect(String(calls[0].params[4])).toBe('failed');
    expect(String(calls[0].params[5])).toBe('failed');
    const blob = logs.join('\n');
    expect(blob).not.toContain('jordan@gmail.com');
    expect(blob).not.toContain('Please look at my trial');
    expect(blob).not.toContain('Jordan');
  });

  test('store and send both failing is 503 and no receipt', async () => {
    if (typeof counters.resetSharedCountersForTests === 'function') await counters.resetSharedCountersForTests();
    const ack = jest.spyOn(emailLib, 'sendSupportReceivedEmail').mockResolvedValue({ success: true });
    jest.spyOn(emailLib, 'sendSupportInboxEmail').mockResolvedValue({ success: false });
    support.setSupportQueryForTests(async () => {
      throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    });
    const res = await support.sendSupportConfirmation({
      email: 'jordan-down@example.com', name: '', topic: 'app', message: 'Hello there',
    });
    expect(res.status).toBe(503);
    expect(ack).not.toHaveBeenCalled();
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Could not send a confirmation just now.');
  });
});

describe('(d) and (j) shopping list ids and portal wait', () => {
  test('both list views get distinct element ids', () => {
    const { JSDOM } = require('jsdom');
    const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const start = html.indexOf('function renderShoppingList(');
    const end = html.indexOf('async function deleteShoppingList(');
    const dom = new JSDOM(`<!doctype html><div id="shopping-lists-body"></div><div id="portal-shopping-body"></div><script>
      function escapeHtml(s){return String(s==null?'':s);}
      ${html.slice(start, end)}
    </script>`, { runScripts: 'dangerously' });
    const lists = [{ id: 7, name: 'Week', items: [{ name: 'Oats', qty: '1', category: 'pantry', checked: false }] }];
    dom.window.renderShoppingLists(lists, 'shopping-lists-body');
    dom.window.renderShoppingLists(lists, 'portal-shopping-body');
    const ids = [...dom.window.document.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('shopping-lists-body-sl-7');
    expect(ids).toContain('portal-shopping-body-sl-7');
    expect(html).toContain('waitForPortal(15000)');
    expect(html).toContain('load your list, try again');
  });
});

describe('(f) food search servings', () => {
  test('a per-serving row shows its listed calories at the default serving', () => {
    const marked = FOODS.filter((f) => f.listedCalories != null);
    expect(marked.length).toBeGreaterThan(5);
    for (const food of marked) {
      const hit = searchFoods(food.name, 5).find((row) => row.name === food.name);
      expect(hit).toBeTruthy();
      expect(hit.calories).toBe(Math.round(food.listedCalories));
    }
  });

  test('chicken rice bowl, kangaroo and orange juice', () => {
    const bowl = searchFoods('chicken rice bowl', 3)[0];
    expect(bowl.calories).toBe(450);
    expect(bowl.protein).toBe(35);
    const per100 = bowl.per100g.cal;
    expect(Math.round(per100 * 200 / 100)).toBe(257);
    const roo = searchFoods('kangaroo', 3)[0];
    expect(roo.name).toMatch(/Kangaroo/);
    expect(roo.calories).toBe(102);
    expect(roo.protein).toBe(22.5);
    const juice = searchFoods('orange juice', 3)[0];
    expect(juice.calories).toBe(112);
    expect(searchFoods('a', 5)).toEqual([]);
    expect(searchFoods('asdf', 5)).toEqual([]);
    expect(FOODS.some((f) => f.name === 'Turkey sub, 6 inch (no sauce)')).toBe(true);
    expect(FOODS.some((f) => /subway/i.test(f.name))).toBe(false);
  });
});

describe('(g) receipt nutrition does not invent a placeholder', () => {
  test('unmatched is null and kangaroo 500 g uses the AFCD key', () => {
    expect(receipt.estimateNutrition('Finger lime', 100, 'g')).toBeNull();
    expect(receipt.estimateNutrition('Tempeh', 100, 'g')).toBeNull();
    const roo = receipt.estimateNutrition('Kangaroo steak', 500, 'g');
    expect(roo.source).toBe('afcd');
    expect(roo.afcdKey).toBe('F009791');
    expect(roo.protein).toBe(Math.round(22.5 * 5));
    const items = [
      { name: 'Kangaroo steak', quantity: 500, unit: 'g', price: 8, category: 'meat' },
      { name: 'Finger lime', quantity: 50, unit: 'g', price: 4, category: 'fruit' },
    ];
    const enriched = receipt.enrichItems(items, 'test');
    expect(enriched[1].nutrition).toBeNull();
    expect(enriched[1].nutritionSource).toBe('unmatched');
    const totals = receipt.totalsFrom(enriched);
    expect(totals.protein).toBe(roo.protein);
    expect(totals.unmatchedCount).toBe(1);
    for (const row of AFCD_STAPLES) expect(row.key).toMatch(/^F\d+/);
  });
});

describe('(h) export order does not need an id column', () => {
  test('pt_clients and client_invitations order by columns the legacy shape has', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(src).toContain("key: 'pt_clients', from: 'pt_clients', where: '(pt_id=$1 OR client_id=$1)', order: 'pt_id, client_id'");
    expect(src).toContain("key: 'client_invitations', from: 'client_invitations', where: 'pt_id=$1', order: 'created_at, token'");
    expect(src).toContain('42P01');
  });
});

describe('(i) shared plan bounds', () => {
  test('planner and targets share PLAN_BOUNDS and the preview matches computeTargets', () => {
    const src = fs.readFileSync(path.join(__dirname, 'meal-planner.js'), 'utf8');
    expect(src).toContain('PLAN_BOUNDS.minKcal');
    expect(PLAN_BOUNDS).toEqual({ minKcal: 1200, maxKcal: 4500, minProtein: 30, maxProtein: 350 });
    const heavy = computeTargets({ sex: 'male', age: 25, heightCm: 190, weightKg: 300, activity: 'very_active', goal: 'muscle_gain' });
    expect(heavy.calories).toBeLessThanOrEqual(4500);
    expect(heavy.protein).toBeLessThanOrEqual(350);
    expect(heavy.capped).toBe(true);
    const preview = targetsFromBody({ goal: 'lose_weight', weightKg: 85, training: 'moderate' });
    const same = computeTargets({ sex: 'other', age: 35, heightCm: 170, weightKg: 85, activity: 'moderate', goal: 'lose_weight' });
    expect(preview.calories).toBe(same.calories);
    expect(preview.protein).toBe(same.protein);
  });
});

describe('(k) Stripe test price override', () => {
  const live = checkout.PRICE_IDS.premium;
  const testId = 'price_1UcnAiGMuYRuJYDrOHq5rQdD';
  const prevKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE;
    delete process.env.STRIPE_TEST_PRICE_OVERRIDE;
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevKey;
  });

  test('unset env matches the live price id', () => {
    delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE;
    expect(checkout.priceIdForPlan('premium')).toBe(live);
    expect(checkout.tierForPriceId(live)).toBe('premium');
    expect(checkout.allFitMunchPriceIds()).toContain(live);
    expect(checkout.allFitMunchPriceIds().filter((id) => id === live)).toHaveLength(1);
  });

  test('flag plus sk_test_ uses the override and still maps to premium', () => {
    process.env.STRIPE_TEST_PRICE_OVERRIDE = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fitmunch';
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE = testId;
    expect(checkout.priceIdForPlan('premium')).toBe(testId);
    expect(checkout.tierForPriceId(testId)).toBe('premium');
    expect(checkout.tierForPriceId(live)).toBe('premium');
    expect(checkout.allFitMunchPriceIds()).toEqual(expect.arrayContaining([live, testId]));
  });

  test('flag plus sk_live_ ignores the override', () => {
    process.env.STRIPE_TEST_PRICE_OVERRIDE = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_live_fitmunch';
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE = testId;
    expect(checkout.priceIdForPlan('premium')).toBe(live);
  });

  test('no flag plus sk_test_ ignores the override', () => {
    delete process.env.STRIPE_TEST_PRICE_OVERRIDE;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fitmunch';
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE = testId;
    expect(checkout.priceIdForPlan('premium')).toBe(live);
  });
});

describe('(l) workout program uses the targets', () => {
  test('two calorie profiles produce different prompts and fallback volume', () => {
    const cut = { goal: 'lose_weight', level: 'intermediate', daysPerWeek: 4, equipment: 'gym', sessionMinutes: 60, weightKg: 85, calories: 2240, protein: 162, carbs: 259, fat: 62, mealWeek: 'Cut week, 2240 kcal' };
    const bulk = { ...cut, goal: 'muscle_gain', weightKg: 95, calories: 3200, protein: 220, carbs: 400, fat: 80, mealWeek: 'Build week, 3200 kcal' };
    const a = workout.workoutPrompt(cut);
    const b = workout.workoutPrompt(bulk);
    expect(a).toContain('2240');
    expect(a).toContain('162');
    expect(a).toContain('Cut week');
    expect(b).toContain('3200');
    expect(b).toContain('220');
    expect(a).not.toBe(b);
    const fa = workout.fallbackWorkoutPlan(cut);
    const fb = workout.fallbackWorkoutPlan(bulk);
    expect(fa.summary).toContain('2240');
    expect(fb.summary).toContain('3200');
    expect(fa.workouts[0].sets).not.toBe(fb.workouts[0].sets);
    expect(workout.wantsSavedProgram('How many sets for squats?')).toBe(false);
    expect(workout.wantsSavedProgram('Build me a 4 day gym program')).toBe(true);
  });
});

describe('(n) QA trainer allowlist', () => {
  const prev = process.env.QA_TRAINER_ACCOUNT_IDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.QA_TRAINER_ACCOUNT_IDS;
    else process.env.QA_TRAINER_ACCOUNT_IDS = prev;
  });

  test('empty, listed, unlisted, whitespace and malformed', () => {
    delete process.env.QA_TRAINER_ACCOUNT_IDS;
    expect(qa.qaTrainerAccountIds()).toEqual([]);
    expect(qa.isQaTrainerAccount(USER)).toBe(false);
    process.env.QA_TRAINER_ACCOUNT_IDS = '';
    expect(qa.isQaTrainerAccount(USER)).toBe(false);
    process.env.QA_TRAINER_ACCOUNT_IDS = `  ${USER} , ${OTHER}  `;
    expect(qa.isQaTrainerAccount(USER)).toBe(true);
    expect(qa.isQaTrainerAccount(OTHER)).toBe(true);
    expect(qa.isQaTrainerAccount('33333333-3333-4333-8333-333333333333')).toBe(false);
    expect(qa.isQaTrainerAccount(USER.slice(0, 8))).toBe(false);
    expect(qa.isQaTrainerAccount(`${USER}-extra`)).toBe(false);
    expect(qa.isQaTrainerAccount('')).toBe(false);
  });

  test('an unlisted free account is 403 and a listed id is allowed with no subscription', async () => {
    const api = require('./api_server');
    const app = express();
    app.use(express.json());
    app.use('/api', api);
    delete process.env.QA_TRAINER_ACCOUNT_IDS;
    const denied = await request(app).get('/api/clients').set('Authorization', `Bearer ${tokenFor(USER)}`);
    expect(denied.status).toBe(403);
    process.env.QA_TRAINER_ACCOUNT_IDS = USER;
    const allowed = await request(app).get('/api/clients').set('Authorization', `Bearer ${tokenFor(USER)}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);
    const stillOut = await request(app).get('/api/clients').set('Authorization', `Bearer ${tokenFor(OTHER)}`);
    expect(stillOut.status).toBe(403);
  });
});

describe('(o) refund lines', () => {
  test('the three Australian Consumer Law lines are verbatim', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/refund.html'), 'utf8');
    expect(html).toContain("Refunds after a charge are at our discretion. This doesn't limit your rights under the Australian Consumer Law. If something we sell doesn't work as described, you may be entitled to a remedy, including a refund.");
    expect(html).toContain('We do not run an automatic money-back window after that first charge, except where the Australian Consumer Law requires a remedy.');
    const fineAt = html.indexOf('Nothing on this page excludes rights you have under the Australian Consumer Law.');
    const medicalAt = html.indexOf('General food planning support only. Not medical advice.');
    expect(fineAt).toBeGreaterThan(-1);
    expect(fineAt).toBeLessThan(medicalAt);
  });
});

describe('claims copy', () => {
  test('training is not described as built from the body', () => {
    const files = [
      'public/index.html', 'public/pricing.html', 'public/for-pts.html',
      'public/meal-plan-and-workout-plan.html', 'public/weekly-meal-plan-australia.html',
      'lib/answer-pages.js',
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
      expect(text).not.toMatch(/meals and training from your body/i);
      expect(text).not.toMatch(/Unlimited AI meal \+ workout plans/);
      expect(text).not.toMatch(/Assign to individuals or groups/);
    }
    expect(fs.readFileSync(path.join(__dirname, 'public/for-pts.html'), 'utf8')).toContain('Assign to one client at a time.');
    expect(fs.readFileSync(path.join(__dirname, 'public/pricing.html'), 'utf8')).toContain('AI meal plans and a weekly training program');
  });
});

describe('app copy for the empty workout state and training prompts', () => {
  test('the consumer empty state is not PT copy, and Training has its own prompts', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    expect(html).not.toContain('Create a program and assign it to clients');
    expect(html).toContain('Build me a 4 day gym program for my goal');
    expect(html).toContain('The program did not come back. Try again.');
    expect(html).not.toMatch(/toast\('Could not generate program/);
  });
});
