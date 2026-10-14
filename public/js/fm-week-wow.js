/*
 * FitMunch first-week extras, shared by the onboarding modal (browser global FMWeekWow) and the
 * tests (CommonJS). No network, no AI.
 *  - headerLine: one personal line built from the user's own answers and their actual week.
 *  - projectWeight: a conservative estimated weight curve to the goal weight.
 *  - swapMeal: replace one meal with one of its builder alternatives and recompute the day.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FMWeekWow = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  // Conservative weekly rates, as a share of current body weight, with a hard cap in kg.
  const RATES = Object.freeze({
    lose: { share: 0.005, capKg: 0.9 },  // 0.5% a week, at most 0.9 kg
    gain: { share: 0.0025, capKg: 0.35 }, // 0.25% a week, at most 0.35 kg
  });
  const MAX_WEEKS = 104;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const kg = (n) => `${Number.isInteger(r1(n)) ? r1(n) : r1(n).toFixed(1)}kg`;
  const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /** 'lose' | 'gain' | null for a start and goal weight. */
  function direction(weightKg, goalKg) {
    const w = num(weightKg); const g = num(goalKg);
    if (!(w > 0) || !(g > 0) || Math.abs(w - g) < 0.5) return null;
    return g < w ? 'lose' : 'gain';
  }

  /**
   * Weekly points from today to the goal weight at a conservative rate. Returns null when there is
   * no goal weight, or it points the other way from the goal (eg "lose fat" with a higher weight).
   */
  function projectWeight({ weightKg, goalKg, goal, start = new Date() }) {
    const dir = direction(weightKg, goalKg);
    if (!dir) return null;
    if (goal === 'lose_weight' && dir !== 'lose') return null;
    if (goal === 'muscle_gain' && dir !== 'gain') return null;
    const rate = RATES[dir];
    const w0 = num(weightKg); const g = num(goalKg);
    const points = [{ week: 0, kg: r1(w0) }];
    let w = w0;
    for (let week = 1; week <= MAX_WEEKS; week += 1) {
      const step = Math.min(rate.capKg, w * rate.share);
      w = dir === 'lose' ? Math.max(g, w - step) : Math.min(g, w + step);
      points.push({ week, kg: r1(w) });
      if (w === g) break;
    }
    const weeks = points[points.length - 1].week;
    const reached = points[points.length - 1].kg === r1(g);
    const goalDate = new Date(new Date(start).getTime() + weeks * 7 * 864e5);
    return { direction: dir, weeks, reached, goalDate, firstWeekKg: r1(Math.abs(points[1].kg - w0)), points };
  }

  const GOAL_MIN_KG = 35; const GOAL_MAX_KG = 300; const GOAL_MAX_SHARE = 0.4;
  /**
   * Goal weight check, shared by the onboarding form and the server. Blank means no goal (ok, null).
   * Otherwise a number 35-300 kg and within 40% of the current weight.
   */
  function validGoalWeight(goalKg, weightKg) {
    if (goalKg === null || goalKg === undefined || String(goalKg).trim() === '') return { ok: true, value: null };
    const g = typeof goalKg === 'number' ? goalKg : (/^\s*\d+(\.\d+)?\s*$/.test(String(goalKg)) ? Number(goalKg) : NaN);
    if (!Number.isFinite(g) || g < GOAL_MIN_KG || g > GOAL_MAX_KG) return { ok: false, error: 'Goal weight must be 35-300 kg.' };
    const w = num(weightKg);
    if (!(w >= GOAL_MIN_KG && w <= GOAL_MAX_KG)) return { ok: false, error: 'Enter your current weight first.' };
    if (Math.abs(g - w) > w * GOAL_MAX_SHARE) return { ok: false, error: 'Goal weight must be within 40% of your current weight.' };
    return { ok: true, value: r1(g) };
  }

  /** "Built for 82kg, cutting to 78kg: 2,000 cal, 148g protein, 4 meals a day". */
  function headerLine({ weightKg, goalKg, goal, calories, protein, meals = 4 }) {
    const w = num(weightKg);
    const dir = direction(weightKg, goalKg);
    let who = Number.isFinite(w) && w > 0 ? `Built for ${kg(w)}` : 'Built for you';
    if (dir === 'lose' && goal !== 'muscle_gain') who += `, cutting to ${kg(num(goalKg))}`;
    else if (dir === 'gain' && goal !== 'lose_weight') who += `, building to ${kg(num(goalKg))}`;
    else if (Number.isFinite(w) && w > 0 && (goal === 'maintain' || goal === 'general_fitness')) who += ', holding steady';
    return `${who}: ${thousands(calories)} cal, ${Math.round(protein)}g protein, ${meals} meals a day`;
  }

  function dayTotals(day) {
    const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const s of SLOTS) {
      const m = day.meals && day.meals[s];
      if (!m) continue;
      for (const k of Object.keys(t)) t[k] += Number(m[k]) || 0;
    }
    for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
    return t;
  }

  /** Week averages of the (possibly swapped) days. */
  function weekAverages(plan) {
    const days = (plan && plan.days) || [];
    const n = days.length || 1;
    const sum = (k) => days.reduce((s, d) => s + dayTotals(d)[k], 0);
    return { calories: Math.round(sum('calories') / n), protein: Math.round(sum('protein') / n) };
  }

  /**
   * Swap a meal for alternative `altIndex` of its `swaps`. The meal it replaces becomes a swap
   * option itself, so the user can swap back. Mutates and returns the day with fresh totals.
   */
  function swapMeal(day, slot, altIndex) {
    const cur = day && day.meals && day.meals[slot];
    const alts = (cur && Array.isArray(cur.swaps)) ? cur.swaps : [];
    const next = alts[altIndex];
    if (!next) return day;
    const { swaps: _drop, ...plainCur } = cur;
    const rest = alts.filter((_, i) => i !== altIndex).map((a) => { const { swaps: _s, ...p } = a; return p; });
    day.meals[slot] = { ...next, swaps: [plainCur, ...rest] };
    day.dailyTotals = dayTotals(day);
    return day;
  }

  return { RATES, MAX_WEEKS, GOAL_MIN_KG, GOAL_MAX_KG, GOAL_MAX_SHARE, validGoalWeight, direction, projectWeight, headerLine, dayTotals, weekAverages, swapMeal, thousands };
}));
