/*
 * FitMunch daily targets. The week itself comes from lib/meal-plan-engine
 * (POST /api/meal-plan/generate, builderOnly without AI consent).
 * Mifflin-St Jeor BMR -> activity multiplier -> goal adjustment -> macros.
 * Shared by the onboarding flow (browser global FMTargets) and tests (CommonJS).
 * No network, no AI.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FMTargets = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIVITY = Object.freeze({
    sedentary: 1.2,   // desk job, little exercise
    light: 1.375,     // 1-3 sessions a week
    moderate: 1.55,   // 3-5 sessions a week
    active: 1.725,    // 6-7 sessions a week
    very_active: 1.9, // physical job plus training
  });

  // kcal adjustment as a fraction of TDEE, and protein in g per kg bodyweight.
  const GOALS = Object.freeze({
    lose_weight: { adjust: -0.20, proteinPerKg: 2.0 },
    maintain: { adjust: 0, proteinPerKg: 1.6 },
    general_fitness: { adjust: 0, proteinPerKg: 1.6 },
    muscle_gain: { adjust: 0.10, proteinPerKg: 2.0 },
  });

  const FLOOR_KCAL = { male: 1500, female: 1200, other: 1350 };
  const FAT_SHARE = 0.25; // 25% of calories from fat

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

  function validate(input) {
    const errors = [];
    const age = num(input.age), heightCm = num(input.heightCm), weightKg = num(input.weightKg);
    if (!(age >= 16 && age <= 100)) errors.push('age');
    if (!(heightCm >= 120 && heightCm <= 230)) errors.push('heightCm');
    if (!(weightKg >= 35 && weightKg <= 300)) errors.push('weightKg');
    if (!['male', 'female', 'other'].includes(input.sex)) errors.push('sex');
    if (!Object.prototype.hasOwnProperty.call(ACTIVITY, input.activity)) errors.push('activity');
    if (!Object.prototype.hasOwnProperty.call(GOALS, input.goal)) errors.push('goal');
    return errors;
  }

  /** Mifflin-St Jeor. "other" uses the midpoint of the male and female constants. */
  function bmr({ sex, age, heightCm, weightKg }) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    const k = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
    return base + k;
  }

  function computeTargets(input) {
    const errors = validate(input);
    if (errors.length) { const e = new Error('Invalid onboarding input: ' + errors.join(', ')); e.fields = errors; throw e; }
    const p = { ...input, age: num(input.age), heightCm: num(input.heightCm), weightKg: num(input.weightKg) };
    const b = bmr(p);
    const tdee = b * ACTIVITY[p.activity];
    const g = GOALS[p.goal];
    const calories = Math.max(FLOOR_KCAL[p.sex], Math.round((tdee * (1 + g.adjust)) / 10) * 10);
    const protein = Math.round(p.weightKg * g.proteinPerKg);
    const fat = Math.round((calories * FAT_SHARE) / 9);
    const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
    return { bmr: Math.round(b), tdee: Math.round(tdee), calories, protein, carbs, fat };
  }

  /** Re-derive carbs and fat after the user edits calories or protein. */
  function rebalance({ calories, protein }) {
    const c = Math.round(num(calories)), pr = Math.round(num(protein));
    const fat = Math.round((c * FAT_SHARE) / 9);
    return { calories: c, protein: pr, fat, carbs: Math.max(0, Math.round((c - pr * 4 - fat * 9) / 4)) };
  }

  return { ACTIVITY, GOALS, bmr, computeTargets, rebalance, validate };
}));
