'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-r2-secret';

/**
 * PR 223 round 2. The model is mocked. No live AI, Stripe, or email.
 */

const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const USER = '11111111-1111-4111-8111-111111111111';
const PT = '33333333-3333-4333-8333-333333333333';
const CLIENT = '44444444-4444-4444-8444-444444444444';

const db = { workouts: [], assignments: [], plans: [] };

jest.mock('pg', () => ({
  Pool: class {
    query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      const rows = (r) => Promise.resolve({ rows: r, rowCount: r.length });
      if (/SELECT role FROM users/i.test(text)) {
        const id = params[0];
        return rows([{ role: id === PT ? 'pt' : 'client' }]);
      }
      if (/SELECT settings FROM users/i.test(text)) return rows([{ settings: {} }]);
      if (/SELECT id, name, workouts FROM workout_plans WHERE user_id=\$1/i.test(text)) {
        return rows(db.workouts.filter((w) => w.user_id === params[0]));
      }
      if (/^INSERT INTO workout_plans/i.test(text)) {
        const row = {
          id: db.workouts.length + 1,
          user_id: params[0],
          name: params[1],
          description: params[2],
          level: params[3],
          frequency: params[4],
          workouts: JSON.parse(params[5]),
        };
        db.workouts.push(row);
        return rows([row]);
      }
      if (/SELECT 1 FROM pt_clients/i.test(text)) {
        return rows(params[0] === PT && params[1] === CLIENT ? [{ ok: 1 }] : []);
      }
      if (/^SELECT 1 FROM workout_plans WHERE id=\$1 AND user_id=\$2/i.test(text)) {
        return rows(db.workouts.filter((w) => w.id === params[0] && w.user_id === params[1]).map(() => ({ ok: 1 })));
      }
      if (/^SELECT name FROM workout_plans WHERE id=\$1/i.test(text)) {
        return rows(db.workouts.filter((w) => w.id === params[0] && w.user_id === params[1]).map((w) => ({ name: w.name })));
      }
      if (/^UPDATE workout_plans SET name=\$1/i.test(text)) {
        const row = db.workouts.find((w) => w.id === params[1] && w.user_id === params[2]);
        if (row) row.name = params[0];
        return rows(row ? [row] : []);
      }
      if (/UPDATE plan_assignments SET active=FALSE/i.test(text)) return rows([]);
      if (/INSERT INTO plan_assignments/i.test(text)) {
        db.assignments.push({ pt_id: params[0], client_id: params[1], plan_type: params[2], plan_id: params[3] });
        return rows([]);
      }
      if (/FROM meal_plans WHERE id=\$1/i.test(text)) {
        const row = db.plans.find((p) => p.id === params[0] && p.user_id === params[1]);
        return rows(row ? [row] : []);
      }
      if (/INSERT INTO shopping_lists/i.test(text)) {
        return rows([{ id: 1, name: params[2], items: JSON.parse(params[3]) }]);
      }
      return rows([]);
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
    getProfile: jest.fn(async () => ({ dietaryPreferences: [], allergies: [], targetCalories: 2100, targetProtein: 150 })),
    effectiveTier: () => 'free',
    createOrUpdateProfile: jest.fn(async () => ({})),
    mergeProfileFilters: jest.fn(async () => true),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
  };
});

const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');
const mealSafety = require('./lib/meal-safety');

const app = express();
app.use(express.json());
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));

function tokenFor(id) {
  return jwt.sign({ userId: id }, process.env.JWT_SECRET);
}
const auth = `Bearer ${tokenFor(USER)}`;

function meal(name, item, calories) {
  return {
    name,
    ingredients: [{ item, qty: '80g' }],
    calories,
    protein: 30,
    carbs: 40,
    fat: 10,
    prepMins: 10,
  };
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function week(extra) {
  return {
    planName: 'AI week',
    summary: 'A week of meals.',
    days: DAYS.map((day) => ({
      day,
      meals: {
        breakfast: meal('Oat porridge', 'Rolled oats', 500),
        lunch: meal('Rice bowl', 'White rice', 550),
        dinner: meal('Chicken and rice', 'Chicken breast', 700),
        snack: meal('Banana', 'Banana', 300),
        ...extra,
      },
    })),
  };
}

beforeEach(() => {
  db.workouts.length = 0;
  db.assignments.length = 0;
  db.plans.length = 0;
  delete process.env.FILTERED_USERS_CHECKED_BUILDER;
  aiClient.chat.mockReset();
  aiClient.chatJson.mockReset();
  aiUsage.checkAndConsume.mockClear();
  aiUsage.refundAiCall.mockClear();
  storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: [], targetCalories: 2100, targetProtein: 150 });
  aiClient.chat.mockResolvedValue({ ok: true, text: 'Try a peanut butter shake.', provider: 'xai' });
  aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: week() });
});

describe('M1 kill switch', () => {
  test('ON by default: filtered meal and workout skip the model and do not charge', async () => {
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['peanuts'], targetCalories: 2100, targetProtein: 150 });
    const mealRes = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 7, dietary: [] });
    expect(mealRes.status).toBe(200);
    expect(mealRes.body.source).toBe('builder');
    expect(JSON.stringify(mealRes.body.plan)).not.toMatch(/peanut/i);
    const work = await request(app).post('/api/ai/workout-plan').set('Authorization', auth)
      .send({ daysPerWeek: 3, focus: 'Finish with a peanut butter shake' });
    expect(work.status).toBe(200);
    expect(work.body.source).toBe('fixed');
    expect(JSON.stringify(work.body.plan)).not.toMatch(/peanut/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  test('explicit OFF: the model is asked, then a peanut leak is replaced', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = '0';
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['peanuts'], targetCalories: 2100, targetProtein: 150 });
    aiClient.chatJson.mockResolvedValue({
      ok: true,
      provider: 'xai',
      data: {
        planName: 'Peanut power bulk',
        summary: 'Bulk with a peanut butter shake after each session.',
        level: 'intermediate',
        frequency: 3,
        workouts: [{ day: 1, name: 'Back squat', sets: 4, reps: '6-8', rest: 120, notes: 'Finish with a peanut butter and milk shake.' }],
      },
    });
    const work = await request(app).post('/api/ai/workout-plan').set('Authorization', auth)
      .send({ daysPerWeek: 3, focus: 'peanut butter shake' });
    expect(work.status).toBe(200);
    expect(aiClient.chatJson).toHaveBeenCalled();
    expect(JSON.stringify(work.body.plan)).not.toMatch(/peanut/i);
    expect(aiUsage.refundAiCall).toHaveBeenCalled();
    const second = String(aiClient.chatJson.mock.calls[1][0].messages[0].content);
    expect(second.toLowerCase()).toMatch(/nuts|peanut/);
  });
});

describe('M6 allergy map', () => {
  test.each([
    ['花生', 'nut free'],
    ['🥜', 'nut free'],
    ['Erdnuss', 'nut free'],
    ['cacahuète', 'nut free'],
    ['prawns', 'shellfish free'],
    ['tahini', 'sesame free'],
    ['ghee', 'dairy free'],
  ])('%s maps to %s', (allergy, flag) => {
    expect(dietGuard.savedFilters({ allergies: [allergy] })).toContain(flag);
  });

  test('花生 does not serve peanut in a checked meal, and an unknown term fails closed', () => {
    const excluded = mealSafety.excludedFlags({ dietary: [], allergies: ['花生'] });
    const terms = mealSafety.customTerms({ dietary: [], allergies: ['花生'] });
    const problems = mealSafety.mealProblems(
      { name: 'Peanut butter toast', ingredients: [{ item: 'Peanut butter', qty: '40g' }] },
      excluded,
      terms
    );
    expect(problems).not.toBeNull();
    const unknown = dietGuard.savedFilters({ allergies: ['zzzyxnotfood'] });
    expect(unknown).toContain('zzzyxnotfood');
    expect(dietGuard.unknownAllergyFlag(['zzzyxnotfood'])).toMatch(/zzzyxnotfood/);
    expect(dietGuard.savedFilters({ allergies: [] })).toEqual([]);
  });

  test('a saved 花生 allergy is builder-only and stays out of the plan, shop, chat and insight', async () => {
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['花生'], targetCalories: 2100, targetProtein: 150 });
    const gen = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 7 });
    expect(gen.body.source).toBe('builder');
    expect(JSON.stringify(gen.body)).not.toMatch(/peanut/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    db.plans.push({
      id: 4,
      user_id: USER,
      name: 'Typed',
      meals: [{ day: 'Monday', meals: { lunch: { name: 'Toast', ingredients: [{ item: 'Peanut butter', qty: '40g' }, { item: 'White rice', qty: '150g' }] } } }],
    });
    const shop = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: 4 });
    expect(shop.status).toBe(200);
    expect(shop.body.list.items.map((i) => i.name).join(' ')).not.toMatch(/peanut/i);
    expect(shop.body.list.items.map((i) => i.name).join(' ')).toMatch(/rice/i);
    const chat = await request(app).post('/api/ai/chat').set('Authorization', auth)
      .send({ messages: [{ role: 'user', content: 'What should I eat tonight?' }] });
    expect(chat.body.reply).not.toMatch(/peanut/i);
    const insight = await request(app).post('/api/ai/insight').set('Authorization', auth)
      .send({ todayCalories: 400, todayProtein: 20, background: false });
    expect(insight.body.insight).not.toMatch(/peanut/i);
  });

  test('an unknown allergy is a filter: checked builder, safe notice, no model call', async () => {
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['zzzyxnotfood'], targetCalories: 2100, targetProtein: 150 });
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    expect(res.body.notice).toMatch(/zzzyxnotfood/);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });
});

describe('l2 checked programs differ', () => {
  test('two profiles produce different exercise lists', () => {
    const home = dietGuard.safeWorkoutPlan({ daysPerWeek: 3, level: 'beginner', goal: 'lose_weight', equipment: 'home' });
    const gym = dietGuard.safeWorkoutPlan({ daysPerWeek: 3, level: 'advanced', goal: 'muscle_gain', equipment: 'gym' });
    const names = (plan) => plan.workouts.map((row) => row.name).join('|');
    expect(names(home)).not.toBe(names(gym));
    expect(names(home)).toMatch(/Sit to stand/);
    expect(names(gym)).toMatch(/Back squat/);
  });
});

describe('S1 retry reason', () => {
  test('the second meal prompt names the allergen that failed', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = 'off';
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['peanuts'], targetCalories: 2100, targetProtein: 150 });
    aiClient.chatJson
      .mockResolvedValueOnce({ ok: true, provider: 'xai', data: week({ snack: meal('Peanut snack', 'Peanut butter', 300) }) })
      .mockResolvedValueOnce({ ok: true, provider: 'xai', data: week() });
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 7 });
    expect(res.status).toBe(200);
    expect(aiClient.chatJson.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(aiClient.chatJson.mock.calls[1][0].messages[0].content).toLowerCase()).toMatch(/nuts|peanut/);
    expect(JSON.stringify(res.body.plan)).not.toMatch(/peanut/i);
  });
});

describe('S7 workout save', () => {
  test('a repeated save does not add a second row, duplicates collapse, and a null name is replaced', async () => {
    const body = {
      name: null,
      workouts: [
        { day: 1, name: 'Squat', sets: 3, reps: '8' },
        { day: 1, name: 'Squat', sets: 5, reps: '5' },
        { day: 2, name: 'Row', sets: 3, reps: '10' },
      ],
    };
    const first = await request(app).post('/api/workout-plans').set('Authorization', auth).send(body);
    expect(first.status).toBe(200);
    expect(first.body.plan.name).toBe('Weekly program');
    expect(first.body.plan.workouts).toHaveLength(2);
    const second = await request(app).post('/api/workout-plans').set('Authorization', auth).send(body);
    expect(second.body.plan.id).toBe(first.body.plan.id);
    expect(db.workouts).toHaveLength(1);
    db.workouts.push({ id: 9, user_id: PT, name: null, workouts: [{ day: 1, name: 'Deadlift' }] });
    const assigned = await request(app).post(`/api/clients/${CLIENT}/assign-plan`).set('Authorization', `Bearer ${tokenFor(PT)}`)
      .send({ planType: 'workout', planId: 9 });
    expect(assigned.status).toBe(200);
    expect(db.workouts.find((w) => w.id === 9).name).toBe('Weekly program');
  });
});

describe('S8 tempeh', () => {
  test('tempeh is soy', () => {
    expect([...mealSafety.flagsInText('Tempeh bowl')]).toContain('soy');
    expect(dietGuard.savedFilters({ allergies: ['tempeh'] })).toContain('soy free');
    const problems = mealSafety.mealProblems(
      { name: 'Tempeh bowl', ingredients: [{ item: 'Tempeh', qty: '100g' }] },
      mealSafety.excludedFlags({ dietary: ['soy free'] }),
      new Set()
    );
    expect(problems).not.toBeNull();
  });
});

describe('S11 home insight', () => {
  test('a Home background insight does not charge the free pool', async () => {
    const res = await request(app).post('/api/ai/insight').set('Authorization', auth)
      .send({ todayCalories: 800, todayProtein: 40, background: true });
    expect(res.status).toBe(200);
    expect(res.body.charged).toBe(false);
    expect(res.body.source).toBe('fixed');
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
});

describe('S14 filtered coach credit', () => {
  test('the safe notice returns the credit', async () => {
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [], allergies: ['peanuts'], targetCalories: 2100, targetProtein: 150 });
    const res = await request(app).post('/api/ai/chat').set('Authorization', auth)
      .send({ messages: [{ role: 'user', content: 'What is for dinner?' }] });
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/checked recipes/i);
    expect(res.body.reply).not.toMatch(/peanut/i);
    expect(aiUsage.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalled();
    expect(res.body.remaining).toBe(10);
  });
});
