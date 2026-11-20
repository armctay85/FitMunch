'use strict';

const dietGuard = require('./diet-guard');

const WORKOUT_BUDGET_MS = 70000;
const WORKOUT_ATTEMPT_MS = 62000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function workoutContextLine(ctx) {
  const c = ctx || {};
  const weight = num(c.weightKg);
  const calories = num(c.calories);
  const protein = num(c.protein);
  const carbs = num(c.carbs);
  const fat = num(c.fat);
  const meal = c.mealWeek ? String(c.mealWeek).replace(/\s+/g, ' ').slice(0, 400) : '';
  return [
    weight != null ? `Body weight: ${weight} kg.` : 'Body weight: not logged.',
    calories != null ? `Daily calorie target: ${calories} kcal.` : 'Daily calorie target: not logged.',
    protein != null ? `Daily protein target: ${protein} g.` : 'Daily protein target: not logged.',
    carbs != null ? `Daily carb target: ${carbs} g.` : 'Daily carb target: not logged.',
    fat != null ? `Daily fat target: ${fat} g.` : 'Daily fat target: not logged.',
    meal ? `Linked meal week: ${meal}` : 'Linked meal week: none saved yet.',
  ].join('\n');
}

function workoutPrompt(input) {
  const src = input || {};
  const days = Math.min(Math.max(parseInt(src.daysPerWeek, 10) || 3, 1), 7);
  const level = src.level || 'intermediate';
  return `You are an Australian strength and conditioning coach building a weekly program.

Goal: ${src.goal || 'general_fitness'}
Experience level: ${level}
Training days per week: ${days}
Equipment: ${src.equipment || 'gym'}
Session length: ~${src.sessionMinutes || 60} minutes
${src.focus ? `Special focus / constraints: ${String(src.focus).slice(0, 240)}` : ''}

${workoutContextLine(src)}

The summary must name the calorie target and the protein target when they are logged, and say how the week's volume fits that goal. A lower calorie target keeps the volume moderate. A higher calorie target can use a little more work. Do not say the program was built from a body scan. Training is planned beside the meal week, using these targets as context.

Design a practical ${days}-day weekly program. Progressive overload friendly, sensible exercise order (compounds first), realistic volume.

Return ONLY valid JSON, no markdown:
{
  "planName": "string",
  "summary": "one or two sentences that name the calorie and protein targets when logged",
  "level": "${level}",
  "frequency": ${days},
  "workouts": [
    {"day": 1, "name": "Goblet squat", "sets": 4, "reps": "8-10", "rest": 90, "notes": "warm up for 5 minutes first"}
  ]
}
Each element of "workouts" is ONE exercise with a "day" number (1-${days}). Give 4-7 exercises per day. "name" is the exercise name. Include a short warm-up note in "notes" of each day's first exercise. Include a rest value in seconds. Put a simple progression note on the last exercise of each day.`;
}

function withTargets(plan, ctx) {
  const c = ctx || {};
  const calories = num(c.calories);
  const protein = num(c.protein);
  const bits = [];
  if (calories != null) bits.push(`${calories} kcal`);
  if (protein != null) bits.push(`${protein} g protein`);
  const link = bits.length ? ` Targets for this week: ${bits.join(', ')}.` : '';
  const meal = c.mealPlanName ? ` Sits with meal plan ${String(c.mealPlanName).slice(0, 80)}.` : '';
  return {
    ...plan,
    summary: `${plan.summary || ''}${link}${meal}`.replace(/\s+/g, ' ').trim(),
    mealPlanId: c.mealPlanId || null,
    targets: {
      weightKg: num(c.weightKg),
      calories,
      protein,
      carbs: num(c.carbs),
      fat: num(c.fat),
    },
  };
}

function fallbackWorkoutPlan(ctx) {
  const c = ctx || {};
  const base = dietGuard.safeWorkoutPlan({
    daysPerWeek: c.daysPerWeek,
    level: c.level,
    goal: c.goal,
    equipment: c.equipment,
  });
  const calories = num(c.calories);
  const extraSet = calories != null && calories >= 2800;
  const workouts = (base.workouts || []).map((w) => ({
    ...w,
    sets: extraSet ? Math.min(5, Number(w.sets || 3) + 1) : w.sets,
  }));
  return withTargets({
    ...base,
    workouts,
    source: 'fixed',
    notice: c.filtered
      ? 'To keep your allergies and diet safe, this program was built from the checked template. It did not use an AI credit.'
      : 'This program was built from the checked full-body template. It did not use an AI credit.',
  }, c);
}

function normaliseWorkout(data, ctx) {
  if (!data || !Array.isArray(data.workouts) || !data.workouts.length) return null;
  const c = ctx || {};
  const workouts = data.workouts.filter((w) => w && w.name).map((w) => ({
    day: Math.min(7, Math.max(1, parseInt(w.day, 10) || 1)),
    name: String(w.name).slice(0, 120),
    sets: Math.min(12, Math.max(1, parseInt(w.sets, 10) || 3)),
    reps: String(w.reps || '8-12').slice(0, 24),
    rest: Math.min(300, Math.max(0, parseInt(w.rest, 10) || 90)),
    notes: w.notes ? String(w.notes).slice(0, 240) : '',
  }));
  if (!workouts.length) return null;
  const level = ['beginner', 'intermediate', 'advanced'].includes(data.level) ? data.level : (c.level || 'intermediate');
  return withTargets({
    planName: String(data.planName || 'Weekly program').slice(0, 120),
    summary: String(data.summary || '').slice(0, 500),
    level,
    frequency: Math.min(7, Math.max(1, parseInt(data.frequency, 10) || c.daysPerWeek || 3)),
    workouts,
  }, c);
}

function workoutBreaksFilters(plan, filters) {
  if (!plan || !Array.isArray(filters) || !filters.length) return false;
  return dietGuard.textBreaksFilters(renderWorkoutText(plan), filters);
}

function dedupeWorkoutRows(workouts) {
  const list = Array.isArray(workouts) ? workouts : [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name || '').trim().toLowerCase();
    const key = `${Number(row.day) || 1}|${name}`;
    if (name && seen.has(key)) continue;
    if (name) seen.add(key);
    out.push(row);
  }
  return out.length ? out : list;
}

function renderWorkoutText(plan) {
  const byDay = {};
  (plan.workouts || []).forEach((w) => {
    const d = w.day || 1;
    (byDay[d] = byDay[d] || []).push(w);
  });
  const days = Object.keys(byDay).sort((a, b) => Number(a) - Number(b)).map((d) => {
    const lines = byDay[d].map((e) => `${e.name}: ${e.sets} x ${e.reps}, rest ${e.rest}s${e.notes ? '. ' + e.notes : ''}`);
    return `Day ${d}\n${lines.join('\n')}`;
  });
  return `${plan.planName}\n${plan.summary || ''}\n\n${days.join('\n\n')}\n\nSaved to My Plan.`;
}

function wantsSavedProgram(text) {
  const t = String(text || '');
  if (/\b(program|workout plan|training plan|gym plan|weekly program)\b/i.test(t)) return true;
  return /\b\d\s*-?\s*days?\b/i.test(t) && /\b(gym|workout|train|lift|split)\b/i.test(t);
}

module.exports = {
  WORKOUT_BUDGET_MS,
  WORKOUT_ATTEMPT_MS,
  workoutPrompt,
  workoutContextLine,
  fallbackWorkoutPlan,
  normaliseWorkout,
  workoutBreaksFilters,
  dedupeWorkoutRows,
  renderWorkoutText,
  wantsSavedProgram,
  withTargets,
};
