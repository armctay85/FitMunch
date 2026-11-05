'use strict';

/**
 * Signed-out first week. Uses the same activity and goal multipliers as
 * in-app onboarding, then the deterministic meal builder. This screen does
 * not collect age, sex or height, so resting energy is weight times a fixed
 * kcal-per-kg estimate (about the middle of the usual 20-25 adult range).
 * Meals come from buildPlan. Nothing here is a saved sample day.
 */

const { ACTIVITY, GOALS } = require('../public/js/fm-targets');
const { validGoalWeight, headerLine } = require('../public/js/fm-week-wow');
const { buildPlan } = require('./meal-plan-engine');

const REST_KCAL_PER_KG = 24;
const FLOOR_KCAL = 1350;
const PROTEIN_KCAL_CAP = 0.35;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const GOALS_OK = new Set(Object.keys(GOALS));

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
}

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function targetsFromBody({ goal, weightKg, training }) {
  if (!GOALS_OK.has(goal)) throw fail('Pick a goal.');
  if (!Object.prototype.hasOwnProperty.call(ACTIVITY, training)) throw fail('Pick how often you train.');
  const w = num(weightKg);
  if (!(w >= 35 && w <= 300)) throw fail('Current weight must be 35-300 kg.');
  const g = GOALS[goal];
  const tdee = w * REST_KCAL_PER_KG * ACTIVITY[training];
  const calories = Math.max(FLOOR_KCAL, Math.round((tdee * (1 + g.adjust)) / 10) * 10);
  const protein = Math.min(Math.round(w * g.proteinPerKg), Math.floor((calories * PROTEIN_KCAL_CAP) / 4));
  return { calories, protein, weightKg: w };
}

function slimDay(day) {
  const meals = {};
  for (const slot of SLOTS) {
    const meal = day && day.meals && day.meals[slot];
    if (!meal) continue;
    meals[slot] = {
      name: meal.name,
      calories: meal.calories,
      protein: meal.protein,
    };
  }
  return {
    day: day.day,
    dailyTotals: day.dailyTotals,
    meals,
  };
}

function previewWeek({ goal, weightKg, targetWeightKg, training }) {
  const targets = targetsFromBody({ goal, weightKg, training });
  const gw = validGoalWeight(targetWeightKg, targets.weightKg);
  if (!gw.ok) throw fail(gw.error);
  if (gw.value == null) throw fail('Enter a target weight in kg.');
  if (goal === 'lose_weight' && gw.value > targets.weightKg) {
    throw fail('For fat loss, target weight needs to be below your current weight.');
  }
  if (goal === 'muscle_gain' && gw.value < targets.weightKg) {
    throw fail('For muscle gain, target weight needs to be above your current weight.');
  }
  const plan = buildPlan({
    calories: targets.calories,
    protein: targets.protein,
    days: 7,
    goal,
  });
  const days = (plan.days || []).map(slimDay);
  const day = days[0];
  if (!day || !day.meals || !Object.keys(day.meals).length) throw fail('Could not build a day from those numbers.');
  const header = headerLine({
    weightKg: targets.weightKg,
    goalKg: gw.value,
    goal,
    calories: day.dailyTotals && day.dailyTotals.calories,
    protein: day.dailyTotals && day.dailyTotals.protein,
    meals: Object.keys(day.meals).length,
  });
  return {
    success: true,
    targets: {
      calories: targets.calories,
      protein: targets.protein,
      weightKg: targets.weightKg,
      targetWeightKg: gw.value,
      goal,
      training,
    },
    header,
    note: 'Built from your weight, goal and training. Age, sex and height are not on this screen, so the numbers can move once you add them in the app.',
    day,
    days,
  };
}

module.exports = { previewWeek, targetsFromBody, REST_KCAL_PER_KG, FLOOR_KCAL };
