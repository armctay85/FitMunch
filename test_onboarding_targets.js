'use strict';
const T = require('./public/js/fm-targets');

describe('Mifflin-St Jeor BMR', () => {
  it('matches the published formula for men and women', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(T.bmr({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 })).toBeCloseTo(1780, 6);
    // 10*60 + 6.25*165 - 5*28 - 161 = 1330.25
    expect(T.bmr({ sex: 'female', age: 28, heightCm: 165, weightKg: 60 })).toBeCloseTo(1330.25, 6);
  });
  it('"other" sits midway between male and female', () => {
    const p = { age: 40, heightCm: 170, weightKg: 70 };
    const m = T.bmr({ ...p, sex: 'male' }), f = T.bmr({ ...p, sex: 'female' });
    expect(T.bmr({ ...p, sex: 'other' })).toBeCloseTo((m + f) / 2, 6);
  });
});

describe('computeTargets', () => {
  const man = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' };
  it('applies the activity multiplier', () => {
    const t = T.computeTargets(man);
    expect(t.bmr).toBe(1780);
    expect(t.tdee).toBe(Math.round(1780 * 1.55)); // 2759
    expect(t.calories).toBe(2760);
  });
  it('applies the goal adjustment: -20% to lose, +10% to gain', () => {
    expect(T.computeTargets({ ...man, goal: 'lose_weight' }).calories).toBe(Math.round(1780 * 1.55 * 0.8 / 10) * 10);
    expect(T.computeTargets({ ...man, goal: 'muscle_gain' }).calories).toBe(Math.round(1780 * 1.55 * 1.1 / 10) * 10);
  });
  it('sets protein from g/kg by goal', () => {
    expect(T.computeTargets(man).protein).toBe(128); // 1.6 g/kg
    expect(T.computeTargets({ ...man, goal: 'lose_weight' }).protein).toBe(160); // 2.0 g/kg
    expect(T.computeTargets({ ...man, goal: 'muscle_gain' }).protein).toBe(160);
  });
  it('macros add back up to calories within rounding', () => {
    for (const goal of Object.keys(T.GOALS)) {
      for (const activity of Object.keys(T.ACTIVITY)) {
        const t = T.computeTargets({ ...man, goal, activity });
        expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.calories)).toBeLessThanOrEqual(8);
      }
    }
  });
  it('never goes below a safe calorie floor', () => {
    const t = T.computeTargets({ sex: 'female', age: 80, heightCm: 150, weightKg: 40, activity: 'sedentary', goal: 'lose_weight' });
    expect(t.calories).toBe(1200);
  });
  it('rejects out-of-range and unknown input', () => {
    expect(() => T.computeTargets({ ...man, age: 12 })).toThrow(/age/);
    expect(() => T.computeTargets({ ...man, activity: 'couch' })).toThrow(/activity/);
    expect(() => T.computeTargets({ ...man, goal: '__proto__' })).toThrow(/goal/);
    expect(() => T.computeTargets({ ...man, weightKg: 'abc' })).toThrow(/weightKg/);
  });
  it('accepts numeric strings from form inputs', () => {
    expect(T.computeTargets({ ...man, age: '30', heightCm: '180', weightKg: '80' })).toEqual(T.computeTargets(man));
  });
});

describe('rebalance after the user edits targets', () => {
  it('keeps protein and calories, re-derives fat and carbs', () => {
    const r = T.rebalance({ calories: 2000, protein: 150 });
    expect(r).toEqual({ calories: 2000, protein: 150, fat: 56, carbs: 224 });
  });
});

describe('the 72 kg example gets a week on target from the #88 builder', () => {
  const engine = require('./lib/meal-plan-engine');
  const example = { sex: 'female', age: 34, heightCm: 168, weightKg: 72, activity: 'moderate', goal: 'lose_weight' };
  const t = T.computeTargets(example);

  it('targets are 1780 kcal and 144 g protein', () => {
    expect(t).toMatchObject({ calories: 1780, protein: 144 });
  });

  it.each([[[]], [['vegetarian']], [['dairy free']], [['gluten free']]])('diet %j: weekly protein and calories within 5%%, every day calories within 5%%', (dietary) => {
    const plan = engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary });
    expect(plan.days).toHaveLength(7);
    expect(Math.abs(plan.avgDailyProtein - t.protein)).toBeLessThanOrEqual(t.protein * 0.05);
    expect(Math.abs(plan.avgDailyCalories - t.calories)).toBeLessThanOrEqual(t.calories * 0.05);
    for (const d of plan.days) expect(Math.abs(d.dailyTotals.calories - t.calories)).toBeLessThanOrEqual(t.calories * 0.05);
    expect(plan).toEqual(engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary })); // deterministic
  });

  it('the week has variety (not one day repeated)', () => {
    const plan = engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary: [] });
    const names = new Set(plan.days.flatMap((d) => Object.values(d.meals).map((m) => m.name)));
    expect(names.size).toBeGreaterThanOrEqual(8);
  });
});

describe('POST /api/meal-plan/generate builderOnly', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'onboarding-test-secret';
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  it('returns the deterministic plan with no AI call and no consent check', async () => {
    const aiClient = require('./lib/ai-client');
    const spy = jest.spyOn(aiClient, 'chatJson');
    const app = require('./server');
    const tok = jwt.sign({ userId: '00000000-0000-4000-8000-0000000000aa' }, process.env.JWT_SECRET);
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${tok}`)
      .send({ builderOnly: true, goal: 'lose_weight', days: 7, calories: 1780, protein: 144, dietary: ['vegetarian'] });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    expect(res.body.plan.days).toHaveLength(7);
    expect(Math.abs(res.body.plan.avgDailyProtein - 144)).toBeLessThanOrEqual(144 * 0.05);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('onboarding UI wiring', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
  it('loads the shared targets maths and collects every input', () => {
    expect(html).toContain('<script src="/js/fm-targets.js"></script>');
    for (const id of ['ob-age', 'ob-sex', 'ob-height', 'ob-weight', 'ob-activity', 'ob-goal', 'ob-diet', 'ob-cals', 'ob-prot']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
  it('only calls the AI plan with recorded consent, otherwise builds the deterministic week', () => {
    const fn = html.slice(html.indexOf('async function onboardBuildWeek'), html.indexOf('// ── GOALS ONBOARDING'));
    expect(fn).toMatch(/aiConsentState\(\) === true/);
    expect(fn.indexOf('if (!consented) { await local(); return; }')).toBeGreaterThan(-1);
    expect(fn.indexOf('if (!consented)')).toBeLessThan(fn.indexOf('JSON.stringify({ goal: fitnessGoal'));
    expect(fn.indexOf('JSON.stringify({ goal: fitnessGoal')).toBeGreaterThan(-1);
    expect(fn).toContain('builderOnly: true');
  });
});

describe('vegan and vegetarian weeks hit protein with real plant proteins', () => {
  const engine = require('./lib/meal-plan-engine');
  const { FOODS } = require('./food-db');
  const PLANT = ['Firm tofu', 'Tempeh', 'Seitan', 'Edamame (cooked)', 'Lentils (cooked)', 'Chickpeas (cooked)', 'Soy milk', 'Pea-protein yoghurt (Greek style)'];
  const ANIMAL = /chicken|beef|lamb|pork|salmon|tuna|barramundi|prawn|egg|whey|casein|milk \(|skim milk|full cream|yoghurt \(plain|cottage|ricotta|cheddar/i;
  const PROFILES = {
    'the 72 kg example': { sex: 'female', age: 34, heightCm: 168, weightKg: 72, activity: 'moderate', goal: 'lose_weight' },
    'male 85 kg maintain': { sex: 'male', age: 40, heightCm: 180, weightKg: 85, activity: 'moderate', goal: 'maintain' },
    'female 60 kg muscle gain': { sex: 'female', age: 28, heightCm: 163, weightKg: 60, activity: 'active', goal: 'muscle_gain' },
    'male 95 kg fat loss': { sex: 'male', age: 45, heightCm: 183, weightKg: 95, activity: 'light', goal: 'lose_weight' },
  };

  it('every plant protein is in food-db with a source and consistent macros (kcal within 15% of 4P+4C+9F)', () => {
    for (const name of PLANT) {
      const f = FOODS.find((x) => x.name === name);
      expect(f).toBeDefined();
      expect(f.src).toMatch(/^FDC \d+ /);
      expect(Math.abs(f.cal - (4 * f.p + 4 * f.c + 9 * f.f))).toBeLessThanOrEqual(f.cal * 0.15);
    }
  });

  it('every meal template is within 15% of 4P+4C+9F and has quantities', () => {
    for (const t of engine.TEMPLATES) {
      let cal = 0; let est = 0;
      for (const [food, g] of t.items) {
        const f = FOODS.find((x) => x.name === food);
        expect(g).toBeGreaterThan(0);
        cal += (f.cal * g) / 100;
        est += ((4 * f.p + 4 * f.c + 9 * f.f) * g) / 100;
      }
      expect([t.name, Math.abs(cal - est) <= cal * 0.15]).toEqual([t.name, true]);
    }
  });

  it('there are vegan templates for every slot built around the plant proteins', () => {
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const vegan = engine.TEMPLATES.filter((t) => t.slot === slot && !t.flags.some((f) => ['meat', 'fish', 'dairy', 'eggs'].includes(f)));
      const withPlant = vegan.filter((t) => t.items.some(([food]) => PLANT.includes(food)));
      expect([slot, withPlant.length >= 4]).toEqual([slot, true]);
    }
  });

  for (const [label, profile] of Object.entries(PROFILES)) {
    for (const diet of ['vegan', 'vegetarian']) {
      it(`${label}, ${diet}: protein within 10%, calories within 5% every day, 8+ distinct meals, no shortfall note`, () => {
        const t = T.computeTargets(profile);
        const plan = engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary: [diet] });
        expect(plan.days).toHaveLength(7);
        expect(Math.abs(plan.avgDailyProtein - t.protein)).toBeLessThanOrEqual(t.protein * 0.1);
        for (const d of plan.days) expect(Math.abs(d.dailyTotals.calories - t.calories)).toBeLessThanOrEqual(t.calories * 0.05);
        expect(Math.abs(plan.avgDailyCalories - t.calories)).toBeLessThanOrEqual(t.calories * 0.05);
        const meals = plan.days.flatMap((d) => Object.values(d.meals));
        expect(new Set(meals.map((m) => m.name)).size).toBeGreaterThanOrEqual(8);
        expect(plan.notes || []).toEqual([]);
        if (diet === 'vegan') {
          for (const m of meals) for (const ing of m.ingredients) expect([m.name, ANIMAL.test(ing.item)]).toEqual([m.name, false]);
        }
      });
    }
  }

  it('the shortfall note only appears when protein really is short', () => {
    const plan = engine.buildPlan({ calories: 1500, protein: 300, days: 7, dietary: ['vegan'] });
    expect(plan.avgDailyProtein).toBeLessThan(270);
    expect(plan.notes.join(' ')).toMatch(/Protein averages/);
  });
});

describe('plant-protein meals are kept for vegan and vegetarian weeks', () => {
  const engine = require('./lib/meal-plan-engine');
  it('an omnivore week keeps its usual meals', () => {
    const plan = engine.buildPlan({ calories: 2100, protein: 150, days: 7 });
    const plantNames = new Set(engine.TEMPLATES.filter((t) => t.plant).map((t) => t.name));
    for (const d of plan.days) for (const m of Object.values(d.meals)) expect(plantNames.has(m.name)).toBe(false);
  });
});
