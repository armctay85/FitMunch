'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-r3-secret';

/**
 * PR 223 round 3. The model is mocked. No live AI, Stripe, or email.
 * Each Must is checked with a normal input, an edge input, and a bad input.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const USER = '11111111-1111-4111-8111-111111111111';
const db = { plans: [] };

jest.mock('pg', () => ({
  Pool: class {
    query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      const rows = (r) => Promise.resolve({ rows: r, rowCount: r.length });
      if (/FROM meal_plans WHERE id=\$1/i.test(text)) {
        const row = db.plans.find((p) => p.id === params[0] && p.user_id === params[1]);
        return rows(row ? [row] : []);
      }
      if (/INSERT INTO shopping_lists/i.test(text)) {
        return rows([{ id: 1, name: params[2], items: JSON.parse(params[3]) }]);
      }
      if (/INSERT INTO workout_plans/i.test(text)) return rows([{ id: 1, name: params[1] }]);
      if (/SELECT role, pt_id FROM users/i.test(text)) return rows([{ role: 'client', pt_id: null }]);
      if (/SELECT settings, role FROM users/i.test(text)) return rows([{ role: 'client', settings: {} }]);
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
    getUserRole: jest.fn(async () => 'client'),
  };
});

const aiClient = require('./lib/ai-client');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');
const mealSafety = require('./lib/meal-safety');
const allergenNorm = require('./lib/allergen-norm');
const workoutProgram = require('./lib/workout-program');

const app = express();
app.use(express.json());
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));

const auth = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;
const FOODS = /peanut butter|prawns?|fish sauce/i;
const SULPHITE_FOODS = /dried apricots?|sultanas?|raisins?|currants?|\b(?:white|red|sparkling)?\s*wine\b/i;

function meal(name, item) {
  return {
    name,
    ingredients: [{ item, qty: '40g' }],
    calories: 400,
    protein: 25,
    carbs: 30,
    fat: 12,
  };
}
function week(lunch) {
  return {
    planName: 'AI week',
    summary: 'A week of meals.',
    days: ['Monday'].map((day) => ({
      day,
      meals: {
        breakfast: meal('Oat porridge', 'Rolled oats'),
        lunch,
        dinner: meal('Chicken and rice', 'Chicken breast'),
        snack: meal('Banana', 'Banana'),
      },
    })),
  };
}
function names(list) {
  return (list || []).map((item) => (item && item.name) || '').join(' ');
}

let profile;
beforeEach(() => {
  db.plans.length = 0;
  delete process.env.FILTERED_USERS_CHECKED_BUILDER;
  delete process.env.QA_TRAINER_ACCOUNT_IDS;
  profile = { dietaryPreferences: [], allergies: [], targetCalories: 2100, targetProtein: 150 };
  storage.getProfile.mockImplementation(async () => profile);
  aiClient.chat.mockReset();
  aiClient.chatJson.mockReset();
  aiClient.chat.mockResolvedValue({ ok: true, text: 'Have peanut butter, prawns and fish sauce.', provider: 'xai' });
  aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: week(meal('Rice bowl', 'White rice')) });
});

describe('M1 unknown and compound allergy foods are not served', () => {
  const three = ['peanut butter', 'prawns', 'fish sauce'];

  test('normal: a generated plan, shop list, chat, insight and workout leave those foods out', async () => {
    profile = { ...profile, allergies: three };
    const plan = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 1 });
    expect(plan.status).toBe(200);
    expect(plan.body.source).toBe('builder');
    expect(JSON.stringify(plan.body.plan)).not.toMatch(FOODS);
    expect(aiClient.chatJson).not.toHaveBeenCalled();

    db.plans.push({
      id: 9,
      user_id: USER,
      name: 'Typed',
      meals: [{ day: 'Monday', meals: { lunch: meal('Mixed plate', 'Peanut butter, prawns and fish sauce') } }],
    });
    const shop = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: 9 });
    expect(shop.status).toBe(200);
    expect(names(shop.body.list.items)).not.toMatch(FOODS);

    const chat = await request(app).post('/api/ai/chat').set('Authorization', auth)
      .send({ messages: [{ role: 'user', content: 'What should I eat tonight?' }] });
    expect(chat.status).toBe(200);
    expect(chat.body.reply).not.toMatch(FOODS);

    const insight = await request(app).post('/api/ai/insight').set('Authorization', auth)
      .send({ todayCalories: 400, todayProtein: 20, background: false });
    expect(insight.status).toBe(200);
    expect(String(insight.body.insight || '')).not.toMatch(FOODS);

    const work = await request(app).post('/api/ai/workout-plan').set('Authorization', auth).send({ daysPerWeek: 3 });
    expect(work.status).toBe(200);
    expect(work.body.source).toBe('fixed');
    expect(JSON.stringify(work.body.plan)).not.toMatch(FOODS);
    expect(work.body.notice || '').not.toMatch(/not ready/i);
  });

  test('edge: spacing and case still block the same foods', () => {
    const filters = dietGuard.savedFilters({ allergies: ['  Peanut   Butter ', 'PRAWNS', 'Fish   Sauce'] });
    for (const food of ['peanut butter toast', 'Garlic prawns', 'stir fry with fish sauce']) {
      expect(dietGuard.textBreaksFilters(food, filters)).toBe(true);
      const problems = mealSafety.mealProblems(
        { name: food, ingredients: [{ item: food, qty: '1' }] },
        mealSafety.excludedFlags({ allergies: ['  Peanut   Butter ', 'PRAWNS', 'Fish   Sauce'] }),
        mealSafety.customTerms({ allergies: ['  Peanut   Butter ', 'PRAWNS', 'Fish   Sauce'] })
      );
      expect(problems).not.toBeNull();
    }
  });

  test('bad: null, empty and non-strings do not throw or open the filter', () => {
    expect(() => dietGuard.savedFilters({ allergies: [null, '', 12, {}, 'peanut butter'] })).not.toThrow();
    const filters = dietGuard.savedFilters({ allergies: [null, '', 12, 'peanut butter'] });
    expect(filters).toEqual(expect.arrayContaining(['nut free']));
    expect(dietGuard.textBreaksFilters('peanut butter', filters)).toBe(true);
    // A junk item fails the list closed, so an ordinary grain is left out too.
    expect(dietGuard.textBreaksFilters('rolled oats', filters)).toBe(true);
    expect(mealSafety.groceryItemsSafe(
      [{ name: 'Peanut butter' }, { name: null }, { name: '' }, { name: 'Rice' }],
      { allergies: [null, '', 'peanut butter'] }
    ).map((item) => item.name)).toEqual([null, '', 'Rice']);
  });
});

describe('M2 combined chips keep both terms', () => {
  test.each([
    ['kiwi and peanut', 'normal'],
    ['kiwi & peanut', 'ampersand'],
    ['kiwi/peanut', 'slash'],
    ['kiwi, peanut', 'comma'],
    ['kiwi or peanut', 'or'],
    ['kiwi and/or peanut', 'and/or'],
    ['  Kiwi   AND   peanut  ', 'edge spacing'],
  ])('%s (%s) keeps kiwi and the peanut filter', (chip) => {
    expect(allergenNorm.splitAllergyChip(chip)).toEqual(expect.arrayContaining([
      expect.stringMatching(/kiwi/i),
      expect.stringMatching(/peanut/i),
    ]));
    const filters = dietGuard.savedFilters({ allergies: [chip] });
    expect(filters.some((item) => /kiwi/i.test(item))).toBe(true);
    expect(filters).toContain('nut free');
  });

  test('bad chips do not invent a second allergy or throw', () => {
    expect(allergenNorm.splitAllergyChip('')).toEqual([]);
    expect(allergenNorm.splitAllergyChip('   ')).toEqual([]);
    expect(allergenNorm.splitAllergyChip('and')).not.toEqual(expect.arrayContaining(['kiwi', 'peanut']));
    expect(allergenNorm.splitAllergyChip(null)).toEqual([]);
    expect(() => dietGuard.savedFilters({ allergies: ['kiwi and', 'and peanut', null] })).not.toThrow();
    const filters = dietGuard.savedFilters({ allergies: ['kiwi and', 'and peanut'] });
    expect(filters.some((item) => /kiwi/i.test(item))).toBe(true);
    expect(filters).toContain('nut free');
  });
});

describe('M3 sulphite foods are flagged and left off', () => {
  test('normal: dried apricots, wine, sultanas, raisins and currants are blocked', () => {
    const filters = dietGuard.savedFilters({ allergies: ['sulphites'] });
    for (const food of ['dried apricots', 'white wine', 'sultanas', 'raisins', 'currants']) {
      expect(dietGuard.textBreaksFilters(food, filters)).toBe(true);
      expect(allergenNorm.flagsForText(food).has('sulphites')).toBe(true);
    }
    const kept = mealSafety.groceryItemsSafe(
      ['dried apricots', 'white wine', 'sultanas', 'raisins', 'currants', 'Rice'].map((name) => ({ name })),
      { allergies: ['sulphites'] }
    );
    expect(kept.map((item) => item.name)).toEqual(['Rice']);
  });

  test('edge: sulphite, sulfites and a capitalised chip use the same flag', () => {
    for (const chip of ['sulphite', 'sulfites', 'SULPHITES']) {
      expect(allergenNorm.flagsForText(chip).has('sulphites')).toBe(true);
      expect(dietGuard.textBreaksFilters('dried apricot', dietGuard.savedFilters({ allergies: [chip] }))).toBe(true);
    }
  });

  test('bad: an empty sulphite note does not flag rice, and a junk chip fails closed', () => {
    expect(dietGuard.textBreaksFilters('Rice', dietGuard.savedFilters({ allergies: [''] }))).toBe(false);
    expect(() => dietGuard.savedFilters({ allergies: [null, 4, 'sulphites'] })).not.toThrow();
    const closed = dietGuard.savedFilters({ allergies: ['not-a-sulphite-word'] });
    expect(dietGuard.textBreaksFilters('dried apricots', closed)).toBe(true);
  });
});

describe('M4 workouts with the kill switch off still catch every allergy term', () => {
  function leaky(note) {
    return {
      ok: true,
      provider: 'xai',
      data: {
        planName: 'Arms',
        summary: note,
        level: 'intermediate',
        frequency: 3,
        workouts: [{ day: 1, name: 'Press', sets: 3, reps: '8', rest: 60, notes: note }],
      },
    };
  }

  test('normal: peanut butter, prawns, fish sauce and dried apricots are not served', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = '0';
    profile = { ...profile, allergies: ['peanut butter', 'prawns', 'fish sauce', 'sulphites', 'kiwi'] };
    const note = 'Finish with peanut butter, prawns, fish sauce, dried apricots and kiwi.';
    aiClient.chatJson.mockResolvedValue(leaky(note));
    const work = await request(app).post('/api/ai/workout-plan').set('Authorization', auth)
      .send({ daysPerWeek: 3, focus: note });
    expect(work.status).toBe(200);
    expect(aiClient.chatJson).toHaveBeenCalled();
    expect(JSON.stringify(work.body.plan)).not.toMatch(/peanut butter|prawns|fish sauce|dried apricot|kiwi/i);
    expect(work.body.notice || work.body.plan.notice || '').not.toMatch(/not ready/i);
  });

  test('edge: a leak only in the summary or only in the plan name is still caught', () => {
    const filters = dietGuard.savedFilters({ allergies: ['peanut butter', 'kiwi'] });
    expect(workoutProgram.workoutBreaksFilters({ planName: 'Day', summary: 'peanut butter', workouts: [{ day: 1, name: 'Squat', notes: '' }] }, filters)).toBe(true);
    expect(workoutProgram.workoutBreaksFilters({ planName: 'Kiwi arms', summary: 'Strength', workouts: [{ day: 1, name: 'Squat', notes: '' }] }, filters)).toBe(true);
    expect(workoutProgram.workoutBreaksFilters({ planName: 'Day', summary: 'Squat day', workouts: [{ day: 1, name: 'Squat', notes: 'rest 60s' }] }, filters)).toBe(false);
  });

  test('bad: a null model body is not served, and an unfiltered failure stays 502', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = 'off';
    profile = { ...profile, allergies: ['prawns'] };
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: null });
    const filtered = await request(app).post('/api/ai/workout-plan').set('Authorization', auth).send({ daysPerWeek: 2 });
    expect(filtered.status).toBe(200);
    expect(JSON.stringify(filtered.body.plan)).not.toMatch(/prawn/i);

    profile = { ...profile, allergies: [] };
    aiClient.chatJson.mockResolvedValue({ ok: false, error: 'down', provider: 'xai' });
    const open = await request(app).post('/api/ai/workout-plan').set('Authorization', auth).send({ daysPerWeek: 2 });
    expect(open.status).toBe(502);
  });
});

describe('M5 timing lines stay the PR 224 bounds', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'test_ai_allergen_stopgap_r6.js'), 'utf8').split(/\n/);

  test('line 230 is the 100 ms read and line 418 is the 500 ms plan read', () => {
    expect(lines[229]).toBe('    expect(Number(process.hrtime.bigint() - t) / 1e6).toBeLessThan(100);');
    expect(lines[417]).toBe('    expect(Date.now() - t2).toBeLessThan(500);');
  });

  test('edge: the saved-list title still says 500 ms, and 2000 ms is not a bound', () => {
    expect(lines.join('\n')).toContain('a stored 200k-key object is read under 500 ms');
    expect(lines.join('\n')).not.toContain('toBeLessThan(2000)');
  });

  test('bad: a missing file would not invent a looser bound', () => {
    expect(lines.length).toBeGreaterThan(418);
    expect(lines[229]).not.toMatch(/2000/);
    expect(lines[417]).not.toMatch(/2000/);
  });
});

describe('S1 retry names the allergen, and a typed save warns without feeding the shop', () => {
  test('the second meal prompt names the allergen that failed', async () => {
    process.env.FILTERED_USERS_CHECKED_BUILDER = '0';
    profile = { ...profile, allergies: ['peanut butter'] };
    const bad = week(meal('Peanut snack', 'Peanut butter'));
    const good = week(meal('Rice bowl', 'White rice'));
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'xai', data: bad })
      .mockResolvedValueOnce({ ok: true, provider: 'xai', data: good });
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', auth)
      .send({ calories: 2100, protein: 150, days: 1 });
    expect(res.status).toBe(200);
    expect(aiClient.chatJson.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(aiClient.chatJson.mock.calls[1][0].messages[0].content).toLowerCase()).toMatch(/nuts|peanut/);
    expect(JSON.stringify(res.body.plan)).not.toMatch(/peanut/i);
  });

  test('a saved typed meal can stay on the row, and the shopping list leaves it off', async () => {
    profile = { ...profile, allergies: ['peanut butter', 'prawns', 'fish sauce'] };
    db.plans.push({
      id: 4,
      user_id: USER,
      name: 'Typed',
      meals: [{ day: 'Monday', meals: { lunch: meal('Plate', 'Peanut butter') } }, { day: 'Tuesday', meals: { lunch: meal('Bowl', 'Prawns') } }, { day: 'Wednesday', meals: { lunch: meal('Fry', 'Fish sauce') } }],
    });
    expect(JSON.stringify(db.plans[0].meals)).toMatch(FOODS);
    const shop = await request(app).post('/api/shopping-list/generate').set('Authorization', auth).send({ mealPlanId: 4 });
    expect(shop.status).toBe(200);
    expect(names(shop.body.list.items)).not.toMatch(FOODS);
  });
});

describe('role and coach gate stay on the database role', () => {
  test('a QA allowlist id is not reported as role pt', async () => {
    process.env.QA_TRAINER_ACCOUNT_IDS = USER;
    const me = await request(app).get('/api/auth/me').set('Authorization', auth);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('client');
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(server).toContain("return res.status(403).json({ error: 'That plan cannot be opened from this sign-in.' })");
    expect(server).toContain("error: 'Coach plans are only available for trainer accounts.'");
    expect(server).not.toMatch(/normalizeCheckoutPlan\(requestedPlan,\s*decoded\.role\)/);
    expect(server).toContain('Coach checkout is not available for this account.');
  });
});
