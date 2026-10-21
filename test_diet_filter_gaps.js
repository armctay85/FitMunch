'use strict';
/**
 * Allergy and diet filter gaps: removable saved filters (profileUpdatedAt / 409),
 * fish free as a real builder filter, onboarding multi-select, and typed allergens
 * matched on ingredient names.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'diet-filter-gaps-secret';

const profileState = {
  row: {
    dietaryPreferences: ['gluten free', 'dairy free', 'fish free'],
    allergies: ['kiwi', 'peanut'],
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
};

// Do not load server/storage.js. Requiring it opens a Postgres pool (max 20) that this
// suite never ends, and in CI that exhausts max_connections for the database suites.
jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  class Pool {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); }
    connect() { return Promise.resolve({ query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }); }
    end() { return Promise.resolve(); }
    on() { return this; }
  }
  return { ...actual, Pool };
});

jest.mock('./server/storage.js', () => ({
  getUserById: jest.fn(async () => ({ id: 'u', subscriptionTier: 'free', settings: { aiDataConsent: true } })),
  effectiveTier: () => 'free',
  getProfile: jest.fn(async () => profileState.row),
  createOrUpdateProfile: jest.fn(async (_userId, data, opts = {}) => {
    if (profileState.row && opts.requireVersion && opts.ifUpdatedAt == null) {
      const err = new Error('version');
      err.code = 'PROFILE_VERSION_REQUIRED';
      throw err;
    }
    if (profileState.row && opts.ifUpdatedAt != null && opts.ifUpdatedAt !== profileState.row.updatedAt) {
      const err = new Error('stale');
      err.code = 'PROFILE_STALE';
      throw err;
    }
    profileState.row = {
      ...(profileState.row || {}),
      ...data,
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    return profileState.row;
  }),
  mergeProfileFilters: jest.fn(async () => true),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const engine = require('./lib/meal-plan-engine');
const safety = require('./lib/meal-safety');
const dietGuard = require('./lib/diet-guard');
const coach = require('./lib/coach-plan');

const USER = '00000000-0000-4000-8000-0000000f1111';
const token = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;
const app = express();
app.use(express.json());
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));

const STALE = 'Your profile changed since this page loaded. Reload it and try again.';
const FISH = /salmon|tuna|barramundi|prawn|shrimp|anchovy|sardine|mackerel|seafood|\bfish\b/i;

function ingredientBlob(plan) {
  const bits = [];
  for (const day of plan.days || []) {
    for (const meal of Object.values(day.meals || {})) {
      bits.push(meal.name || '');
      for (const ing of meal.ingredients || []) bits.push(ing.item || ing.name || '');
      for (const swap of meal.swaps || []) {
        bits.push(swap.name || '');
        for (const ing of swap.ingredients || []) bits.push(ing.item || ing.name || '');
      }
    }
  }
  return bits.join(' | ');
}

function resetProfile() {
  profileState.row = {
    dietaryPreferences: ['gluten free', 'dairy free', 'fish free'],
    allergies: ['kiwi', 'peanut'],
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('typed allergens match ingredient names', () => {
  it('matches kiwi to kiwifruit, and does not match butter to butternut or egg to eggplant', () => {
    expect(engine.typedAllergenTerm('kiwi')).toBe('kiwi');
    expect(engine.typedAllergenTerm('???')).toBeNull();
    expect(engine.typedAllergenTerm('egg')).toBe('egg');
    expect(engine.textHasTypedAllergen('Kiwifruit', 'kiwi')).toBe(true);
    expect(engine.textHasTypedAllergen('kiwi', 'kiwifruit')).toBe(true);
    expect(engine.textHasTypedAllergen('Butternut pumpkin', 'butter')).toBe(false);
    expect(engine.textHasTypedAllergen('butter beans', 'butter')).toBe(false);
    expect(engine.textHasTypedAllergen('cocoa butter', 'butter')).toBe(false);
    expect(engine.textHasTypedAllergen('Salted butter', 'butter')).toBe(true);
    expect(engine.textHasTypedAllergen('Eggplant', 'egg')).toBe(false);
    expect(engine.textHasTypedAllergen('Eggs', 'egg')).toBe(true);
  });

  it('does not call soy milk smoothie or butternut risotto dairy, and egg still skips eggplant', () => {
    expect([...safety.flagsInText('Soy milk smoothie')].sort()).toEqual(['soy']);
    expect(safety.flagsInText('butternut risotto').has('dairy')).toBe(false);
    expect([...safety.flagsInText('butternut risotto')]).toEqual([]);
    expect(safety.flagsInText('cocoa butter').has('dairy')).toBe(false);
    expect([...safety.flagsInText('butter beans')]).toEqual([]);
    expect(safety.flagsInText('Banana smoothie').has('dairy')).toBe(true);
    expect(safety.flagsInText('Soy milk smoothie with yoghurt').has('dairy')).toBe(true);
    expect(safety.flagsInText('Oat milk smoothie').has('dairy')).toBe(false);
    expect(safety.flagsInText('Oat milk smoothie').has('gluten')).toBe(true);
    expect(safety.flagsInText('Almond milk smoothie').has('dairy')).toBe(false);
    expect(safety.flagsInText('Almond milk smoothie').has('nuts')).toBe(true);
    expect(safety.flagsInText('butter').has('dairy')).toBe(true);
    expect(dietGuard.brokenGroups('Soy milk smoothie', ['dairy free'])).toEqual([]);
    expect(dietGuard.brokenGroups('butternut risotto', ['dairy free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Soy milk smoothie with yoghurt', ['dairy free'])).toEqual(['dairy']);
    const dairy = safety.excludedFlags({ dietary: ['dairy free'] });
    expect(safety.mealProblems({ name: 'Soy milk smoothie', ingredients: ['Soy milk smoothie'] }, dairy)).toBeNull();
    expect(safety.mealProblems({ name: 'Butternut risotto', ingredients: ['Butternut pumpkin', 'Rice'] }, dairy)).toBeNull();
    expect(safety.mealProblems({ name: 'Banana smoothie', ingredients: ['Banana'] }, dairy)).toContain('dairy');
  });

  it('drops banana from meals and swaps, and does not say the filter was not applied', () => {
    const plan = engine.withSwaps(engine.buildPlan({ calories: 2000, protein: 140, days: 7, dietary: ['banana'] }), ['banana'], 2000);
    expect(plan.days).toHaveLength(7);
    expect(ingredientBlob(plan)).not.toMatch(/banana|plantain/i);
    expect(JSON.stringify(plan.notes || [])).not.toMatch(/Not applied|couldn't check/i);
  });

  it('keeps a calm note for text that cannot be matched, and stays quiet when kiwi is absent', () => {
    const odd = engine.buildPlan({ calories: 2000, protein: 120, days: 1, dietary: ['???'] });
    expect((odd.notes || []).join(' ')).toMatch(/couldn't check \?\?\? against your allergies/i);
    expect((odd.notes || []).join(' ')).not.toMatch(/Not applied/);
    const kiwi = engine.buildPlan({ calories: 2000, protein: 140, days: 7, dietary: ['kiwi'] });
    expect(JSON.stringify(kiwi.notes || [])).not.toMatch(/Not applied|couldn't check/i);
  });
});

describe('fish free', () => {
  it('is a builder filter and excludes fish and shellfish from the week and its swaps', () => {
    expect(engine.DIET_FILTERS).toContain('fish free');
    expect(engine.DIET_EXCLUDES['fish free']).toEqual(['fish', 'shellfish']);
    const plan = engine.withSwaps(engine.buildPlan({ calories: 2000, protein: 140, days: 7, dietary: ['fish free'] }), ['fish free'], 2000);
    expect(plan.days).toHaveLength(7);
    for (const day of plan.days) expect(Object.keys(day.meals)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(ingredientBlob(plan)).not.toMatch(FISH);
    expect(JSON.stringify(plan.notes || [])).not.toMatch(/Not applied/);
    for (const day of plan.days) for (const meal of Object.values(day.meals)) {
      const flags = engine.allergensOf((meal.ingredients || []).map((i) => i.item));
      expect(flags).not.toEqual(expect.arrayContaining(['fish']));
      expect(flags).not.toEqual(expect.arrayContaining(['shellfish']));
    }
  });

  it('is on every filter picker', () => {
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const coachHtml = fs.readFileSync(path.join(__dirname, 'public/coach.html'), 'utf8');
    expect(appHtml).toMatch(/id="dietary-tags"[\s\S]{0,2500}data-val="fish free"/);
    expect(appHtml).toMatch(/id="ob-diet"[\s\S]{0,4000}data-val="fish free"/);
    expect(coachHtml).toContain('value="fish-free"');
    for (const allergy of ['peanut', 'tree nuts', 'milk', 'egg', 'wheat', 'soy', 'sesame', 'fish', 'crustacea', 'molluscs', 'lupin', 'sulphites']) {
      expect(appHtml).toContain(`data-allergy="${allergy}"`);
    }
  });

  it('a fish-free Coach plan does not keep salmon or tuna', () => {
    const base = { kcal: 2000, protein: 140, carbs: 180, fat: 60 };
    const open = JSON.stringify(coach.buildCoachPlan({ ...base, flags: [] }));
    const closed = JSON.stringify(coach.buildCoachPlan({ ...base, flags: ['fish-free'] }));
    expect(open).toMatch(/salmon|tuna/i);
    expect(closed).not.toMatch(/salmon|tuna/i);
  });
});

describe('saved filters can be replaced under the profile lock', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');

  it('the meal plan screen saves the ticked set with profileUpdatedAt and stops on a stale profile', () => {
    expect(html).toContain('profileUpdatedAt');
    expect(html).toContain('id="mp-save-filters"');
    expect(html).toContain("querySelectorAll('#dietary-tags .diet-tag.active[data-val]')");
    const save = html.slice(html.indexOf('async function saveDietFilters'), html.indexOf('async function generateMealPlan'));
    expect(save).toContain('profileUpdatedAt');
    expect(save).toContain('r.stale');
    expect(save).not.toContain('fitnessGoal');
    const build = html.slice(html.indexOf('async function onboardBuildWeek'), html.indexOf('// ── GOALS ONBOARDING'));
    expect(build).toContain('JSON.stringify({ fitnessGoal, targetCalories: r.calories, targetProtein: r.protein, targetCarbs: r.carbs, targetFat: r.fat })');
    expect(build.indexOf('JSON.stringify({ fitnessGoal, targetCalories: r.calories, targetProtein: r.protein, targetCarbs: r.carbs, targetFat: r.fat })')).toBeLessThan(build.indexOf('dietaryPreferences: diet'));
    expect(build.slice(0, build.indexOf('dietaryPreferences: diet'))).not.toContain('profileUpdatedAt');
    expect(build).not.toContain('const body = { dietaryPreferences: diet, allergies }');
    expect(build).toContain('const allergySave = obAllergySave(allergies, prof && prof.profile && prof.profile.allergies)');
    expect(build).toContain('if (allergySave) body.allergies = allergySave');
    expect(build).toContain(".filter(s => s && String(s).trim())");
    const helper = html.slice(html.indexOf('function obAllergySave'), html.indexOf('function rememberProfileFilters'));
    const obAllergySave = new Function(`${html.slice(html.indexOf('function normFilterWord'), html.indexOf('function rememberProfileFilters'))}; return obAllergySave;`)();
    expect(helper).toContain('if (!chips || !chips.length) return null');
    expect(obAllergySave([], ['kiwi', 'peanut'])).toBeNull();
    expect(obAllergySave(['peanut'], ['kiwi', 'Peanut'])).toEqual(['kiwi', 'Peanut']);
    expect(obAllergySave(['milk'], ['kiwi'])).toEqual(['kiwi', 'milk']);
    expect(obAllergySave(['peanut'], { peanut: { name: 'x' } })).toBeNull();
  });

  beforeEach(resetProfile);

  it('POST with the loaded profileUpdatedAt replaces diets and allergies', async () => {
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({
      dietaryPreferences: ['gluten free'],
      allergies: ['kiwi'],
      profileUpdatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(r.status).toBe(200);
    const got = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', token);
    expect(got.status).toBe(200);
    expect(got.body.profile.dietaryPreferences).toEqual(['gluten free']);
    expect(got.body.profile.allergies).toEqual(['kiwi']);
    expect(got.body.profile.dietaryPreferences).not.toContain('fish free');
    expect(got.body.profile.allergies).not.toContain('peanut');
  });

  it('a stale profileUpdatedAt is 409 and the previous lists stay', async () => {
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({
      dietaryPreferences: [],
      allergies: [],
      profileUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ success: false, stale: true, error: STALE });
    const got = await request(app).get(`/api/user/profile/${USER}`).set('Authorization', token);
    expect(got.body.profile.dietaryPreferences).toEqual(['gluten free', 'dairy free', 'fish free']);
    expect(got.body.profile.allergies).toEqual(['kiwi', 'peanut']);
  });

  it('a filter save without profileUpdatedAt is 400 once a profile row exists', async () => {
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({
      dietaryPreferences: ['gluten free'],
      allergies: [],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Saving allergies or diet needs the profile's updatedAt as profileUpdatedAt.");
    expect(profileState.row.dietaryPreferences).toContain('fish free');
  });
});

describe('generate applies fish free and typed allergies', () => {
  beforeEach(resetProfile);

  it('accepts fish free and serves no fish or shellfish', async () => {
    profileState.row = { dietaryPreferences: [], allergies: [], updatedAt: '2026-10-01T00:00:00.000Z' };
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token).send({
      builderOnly: true, goal: 'maintain', days: 7, calories: 2000, protein: 140, dietary: ['fish free'],
    });
    expect(r.status).toBe(200);
    expect(r.body.notice).toBeUndefined();
    expect(r.body.plan.days).toHaveLength(7);
    expect(ingredientBlob(r.body.plan)).not.toMatch(FISH);
    expect(JSON.stringify(r.body)).not.toMatch(/Not applied/);
  });

  it('applies a saved banana allergy and does not warn that kiwi was not applied', async () => {
    profileState.row = { dietaryPreferences: [], allergies: ['banana', 'kiwi'], updatedAt: '2026-10-01T00:00:00.000Z' };
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token).send({
      builderOnly: true, goal: 'maintain', days: 7, calories: 2000, protein: 140, dietary: [],
    });
    expect(r.status).toBe(200);
    expect(ingredientBlob(r.body.plan)).not.toMatch(/banana|plantain/i);
    expect(JSON.stringify(r.body)).not.toMatch(/Not applied/);
    expect(JSON.stringify(r.body.plan.notes || [])).not.toMatch(/couldn't check kiwi/i);
  });

  it('leaves banana, mango and kiwi out of the week when they sit after an unreadable allergy entry', async () => {
    const junk = Array.from({ length: 15 }, (_, i) => `qzz${i}food`);
    for (const fruit of ['banana', 'mango', 'kiwi']) {
      profileState.row = {
        dietaryPreferences: [],
        allergies: [{ x: 1 }, ...junk, fruit],
        updatedAt: '2026-10-01T00:00:00.000Z',
      };
      for (const body of [{}, { builderOnly: true }]) {
        const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token).send({
          goal: 'maintain', days: 7, calories: 2000, protein: 120, dietary: [], ...body,
        });
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body.plan)).not.toMatch(new RegExp(fruit, 'i'));
        expect(JSON.stringify(r.body.plan.notes || [])).not.toMatch(/couldn't check/i);
        if (body.builderOnly) {
          expect(r.body.notice).toBe(dietGuard.UNREADABLE_NOTICE);
          expect(String(r.body.notice).trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
