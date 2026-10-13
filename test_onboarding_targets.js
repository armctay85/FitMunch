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

describe('buildSimpleWeek', () => {
  it('is deterministic, 7 days, near the calorie target', () => {
    const a = T.buildSimpleWeek({ calories: 2400, protein: 160 });
    expect(a).toEqual(T.buildSimpleWeek({ calories: 2400, protein: 160 }));
    expect(a.days).toHaveLength(7);
    for (const d of a.days) expect(Math.abs(d.totals.calories - 2400)).toBeLessThanOrEqual(40);
  });
  it('respects a vegan diet', () => {
    const w = T.buildSimpleWeek({ calories: 2000, protein: 120, diet: ['vegan'] });
    const names = w.days.flatMap((d) => d.meals.map((m) => m.name)).join(' ');
    expect(names).not.toMatch(/chicken|beef|salmon|tuna|egg|yoghurt/i);
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
    expect(fn.indexOf('if (!consented) { local(); return; }')).toBeGreaterThan(-1);
    expect(fn.indexOf('if (!consented)')).toBeLessThan(fn.indexOf("/meal-plan/generate"));
    expect(fn).toContain('FMTargets.buildSimpleWeek');
  });
});
