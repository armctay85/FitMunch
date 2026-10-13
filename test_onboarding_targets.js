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

  it('targets are 1780 kcal and 141 g protein (72kg capped to 70.6kg at 168cm)', () => {
    expect(t).toMatchObject({ calories: 1780, protein: 141 });
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

describe('builderOnly week with no AI consent', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  it('never calls the AI client, even with a provider configured and no consent recorded', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'onboarding-test-secret';
    const aiClient = require('./lib/ai-client');
    const storage = require('./server/storage.js');
    // A configured provider and an account with no AI consent: the AI branch would run if reached.
    const spies = Object.keys(aiClient).filter((k) => typeof aiClient[k] === 'function')
      .map((k) => jest.spyOn(aiClient, k).mockImplementation(() => { throw new Error(`AI client ${k} called`); }));
    expect(spies.length).toBeGreaterThan(0);
    const userSpy = jest.spyOn(storage, 'getUserById').mockResolvedValue({ id: 'u', settings: {}, subscriptionTier: 'free' });
    try {
      const app = require('./server');
      const tok = jwt.sign({ userId: '00000000-0000-4000-8000-0000000000ab' }, process.env.JWT_SECRET);
      const res = await request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${tok}`)
        .send({ builderOnly: true, goal: 'lose_weight', days: 7, calories: 1780, protein: 144, dietary: [] });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('builder');
      for (const s of spies) expect(s).toHaveBeenCalledTimes(0);
    } finally {
      spies.forEach((s) => s.mockRestore());
      userSpy.mockRestore();
    }
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
  const PLANT = ['Firm tofu', 'Tempeh', 'Seitan', 'Edamame (cooked)', 'Lentils (cooked)', 'Chickpeas (cooked)', 'Soy milk', 'Coconut yoghurt with pea protein (vanilla)'];
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

describe('large bodies and dairy-free or egg-free weeks (EQA r1 M2)', () => {
  const engine = require('./lib/meal-plan-engine');
  const PROFILES = {
    'M 130kg 180cm cut sedentary': { sex: 'male', age: 45, heightCm: 180, weightKg: 130, activity: 'sedentary', goal: 'lose_weight' },
    'F 110kg 165cm cut light': { sex: 'female', age: 40, heightCm: 165, weightKg: 110, activity: 'light', goal: 'lose_weight' },
    'F 60kg 165cm cut sedentary': { sex: 'female', age: 30, heightCm: 165, weightKg: 60, activity: 'sedentary', goal: 'lose_weight' },
    'M 95kg 185cm bulk active': { sex: 'male', age: 25, heightCm: 185, weightKg: 95, activity: 'active', goal: 'muscle_gain' },
  };
  it('bases protein on min(weight, 25 x height^2) and caps it at 35% of calories', () => {
    for (const p of Object.values(PROFILES)) {
      const t = T.computeTargets(p);
      const capped = Math.min(p.weightKg, 25 * (p.heightCm / 100) ** 2);
      const perKg = T.GOALS[p.goal].proteinPerKg;
      expect(t.protein).toBe(Math.min(Math.round(capped * perKg), Math.floor((t.calories * 0.35) / 4)));
      expect(t.protein * 4).toBeLessThanOrEqual(t.calories * 0.35);
    }
    // 130kg at 180cm: capped weight 81kg, so 162g rather than 260g.
    expect(T.computeTargets(PROFILES['M 130kg 180cm cut sedentary']).protein).toBe(162);
  });
  for (const [name, p] of Object.entries(PROFILES)) {
    for (const diet of [['vegan'], ['dairy free'], ['egg free'], ['dairy free', 'egg free'], ['vegetarian'], []]) {
      it(`${name}, ${diet.join(' + ') || 'no filter'}: every day within 10% of protein`, () => {
        const t = T.computeTargets(p);
        const plan = engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary: diet });
        for (const d of plan.days) expect(Math.abs(d.dailyTotals.protein - t.protein)).toBeLessThanOrEqual(t.protein * 0.1);
      });
    }
  }
  it('dairy-free and egg-free weeks get the plant meals', () => {
    const plantNames = new Set(engine.TEMPLATES.filter((t) => t.plant).map((t) => t.name));
    for (const diet of [['dairy free'], ['egg free']]) {
      const plan = engine.buildPlan({ calories: 1940, protein: 160, days: 7, dietary: diet });
      const names = plan.days.flatMap((d) => Object.values(d.meals).map((m) => m.name));
      expect(names.some((n) => plantNames.has(n))).toBe(true);
    }
  });
  it('every template has a real prep time, not a fixed 15', () => {
    for (const t of engine.TEMPLATES) expect(engine.PREP_MINS[t.name]).toBeGreaterThan(0);
    expect(new Set(Object.values(engine.PREP_MINS)).size).toBeGreaterThan(4);
  });
  it('labels the vanilla coconut yoghurt honestly (EQA L1)', () => {
    const db = require('fs').readFileSync(require('path').join(__dirname, 'food-db.js'), 'utf8');
    expect(db).toContain("name:'Coconut yoghurt with pea protein (vanilla)'");
    expect(db).not.toMatch(/Pea-protein yoghurt \(Greek style\)/);
  });
});

describe('protein never goes over the target (EQA r1 L2)', () => {
  const engine = require('./lib/meal-plan-engine');
  it('no day is over its protein target, and none is more than 10% under, across bodies, goals and diets', () => {
    let days = 0;
    for (const sex of ['male', 'female', 'other']) for (const weightKg of [50, 72, 95, 130]) for (const heightCm of [155, 180]) {
      for (const goal of Object.keys(T.GOALS)) for (const activity of ['sedentary', 'moderate', 'very_active']) {
        const t = T.computeTargets({ sex, age: 35, heightCm, weightKg, activity, goal });
        for (const dietary of [[], ['vegan'], ['vegetarian'], ['dairy free'], ['egg free'], ['gluten free']]) {
          const plan = engine.buildPlan({ calories: t.calories, protein: t.protein, days: 7, dietary });
          for (const d of plan.days) {
            days += 1;
            expect(d.dailyTotals.protein).toBeLessThanOrEqual(t.protein);
            expect(d.dailyTotals.protein).toBeGreaterThanOrEqual(t.protein * 0.9);
          }
        }
      }
    }
    expect(days).toBeGreaterThan(5000);
  });
});

describe('onboarding modal markup (EQA r1 M1, S1-S3)', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
  it('44px fields and close, 48px buttons, AA green', () => {
    expect(html).toContain('#modal-onboard .form-input,#modal-onboard .form-select{min-height:44px}');
    expect(html).toContain('#modal-onboard .btn{min-height:48px}');
    expect(html).toMatch(/#modal-onboard \.modal-close\{min-width:44px;min-height:44px/);
    expect(html).toContain('#modal-onboard .btn-green{background:#15803d');
  });
  it('step progress, focusable week region, Privacy wording, title-case slots and macro bars', () => {
    expect(html).toContain('id="ob-stepno" aria-live="polite">Step 1 of 3</p>');
    expect(html).toContain("'Step ' + n + ' of 3'");
    expect(html).toContain('<div id="ob-week" tabindex="0" role="region" aria-label="Your first week, day by day"');
    expect(html).toContain('Turn on AI in Privacy for AI-written plans.');
    expect(html).not.toContain('Turn on AI in Me, Privacy');
    expect(html).toContain("breakfast: ['🍳', 'Breakfast']");
    expect(html).toContain("obBar('Protein', tot.protein, tg.protein, 'g')");
    expect(html).toContain('n.textContent = obTitle(m.name)');
  });
  it('a builderOnly plan never opens the AI consent prompt', () => {
    expect(html).toMatch(/const builderOnly = path === '\/meal-plan\/generate'[^\n]*"builderOnly":true/);
    expect(html).toContain('if (!builderOnly && AI_PATHS.some(p => path.startsWith(p)) && !(await ensureAiConsent()))');
  });
});
