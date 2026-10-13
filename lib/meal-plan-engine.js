'use strict';
/**
 * Meal plan engine: checks and corrects AI plans so every day lands within
 * ±5% of the calorie target, builds a plan from the local food DB when the AI
 * can't, keeps the whole request inside a time budget, and turns a plan into
 * a shopping list with combined quantities.
 */

const { FOODS } = require('../food-db');

const TOLERANCE = 0.05;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_SHARE = { breakfast: 0.25, lunch: 0.3, dinner: 0.33, snack: 0.12 };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;

const FOOD = new Map(FOODS.map((f) => [f.name, f]));
const LIQUIDS = new Set(['Skim milk', 'Full cream milk', 'Oat milk', 'Almond milk (unsweetened)', 'Olive oil']);

// [food name in food-db.js, grams]. Flags drive the dietary filters.
const TEMPLATES = [
  { slot: 'breakfast', name: 'Oats with banana and yoghurt', flags: ['dairy', 'gluten'], items: [['Rolled oats (dry)', 60], ['Banana', 120], ['Greek yoghurt (plain, low fat)', 150]] },
  { slot: 'breakfast', name: 'Eggs on wholegrain toast with spinach', flags: ['gluten'], items: [['Eggs (whole)', 150], ['Wholegrain bread', 80], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Berry protein smoothie', flags: ['dairy'], items: [['Whey protein powder', 30], ['Banana', 120], ['Mixed berries (frozen)', 100], ['Skim milk', 250]] },
  { slot: 'breakfast', name: 'Veggie omelette with potatoes', flags: [], items: [['Eggs (whole)', 150], ['Egg whites', 100], ['Capsicum (red)', 60], ['Spinach', 40], ['White potato (boiled)', 200]] },
  { slot: 'breakfast', name: 'Berry chia pudding', flags: [], items: [['Chia seeds', 30], ['Oat milk', 250], ['Mixed berries (frozen)', 120], ['Banana', 100]] },

  { slot: 'lunch', name: 'Chicken, brown rice and broccoli', flags: ['meat'], items: [['Chicken breast (raw)', 160], ['Brown rice (cooked)', 200], ['Broccoli', 120], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Tuna and avocado sandwich', flags: ['fish', 'gluten'], items: [['Tuna in water (canned)', 95], ['Wholegrain bread', 80], ['Mixed salad leaves', 50], ['Tomato', 100], ['Avocado', 50]] },
  { slot: 'lunch', name: 'Beef and sweet potato bowl', flags: ['meat'], items: [['Beef mince (lean raw)', 150], ['Sweet potato (baked)', 200], ['Spinach', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Egg and quinoa salad', flags: [], items: [['Eggs (whole)', 100], ['Quinoa (cooked)', 180], ['Cucumber', 80], ['Tomato', 100], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Ricotta and spinach pasta', flags: ['dairy', 'gluten'], items: [['Pasta (cooked)', 200], ['Ricotta', 100], ['Spinach', 60], ['Tomato', 100]] },

  { slot: 'dinner', name: 'Salmon with potatoes and broccoli', flags: ['fish'], items: [['Salmon fillet', 160], ['White potato (boiled)', 250], ['Broccoli', 120]] },
  { slot: 'dinner', name: 'Chicken stir-fry with rice', flags: ['meat'], items: [['Chicken breast (raw)', 170], ['White rice (cooked)', 220], ['Capsicum (red)', 100], ['Carrot', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Beef and zucchini pasta', flags: ['meat', 'gluten'], items: [['Beef mince (lean raw)', 150], ['Pasta (cooked)', 220], ['Tomato', 150], ['Zucchini', 100]] },
  { slot: 'dinner', name: 'Barramundi with brown rice and zucchini', flags: ['fish'], items: [['Barramundi fillet', 180], ['Brown rice (cooked)', 200], ['Zucchini', 120], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Egg fried rice with vegetables', flags: [], items: [['Eggs (whole)', 150], ['White rice (cooked)', 250], ['Corn (kernels)', 80], ['Capsicum (red)', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Quinoa bowl with egg whites and avocado', flags: [], items: [['Quinoa (cooked)', 220], ['Egg whites', 150], ['Avocado', 80], ['Spinach', 50]] },

  { slot: 'snack', name: 'Greek yoghurt with berries', flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 200], ['Mixed berries (frozen)', 100]] },
  { slot: 'snack', name: 'Apple with peanut butter', flags: ['nuts'], items: [['Apple', 180], ['Peanut butter (natural)', 30]] },
  { slot: 'snack', name: 'Protein shake', flags: ['dairy'], items: [['Whey protein powder', 30], ['Skim milk', 300]] },
  { slot: 'snack', name: 'Rice cakes with avocado and tomato', flags: [], items: [['Rice cakes (plain)', 20], ['Avocado', 60], ['Tomato', 50]] },
  { slot: 'snack', name: 'Cottage cheese with banana', flags: ['dairy'], items: [['Cottage cheese', 150], ['Banana', 120]] },
];

const DIET_EXCLUDES = {
  vegetarian: ['meat', 'fish'],
  'gluten free': ['gluten'],
  'dairy free': ['dairy'],
  'nut free': ['nuts'],
};

const round = (n) => Math.round(Number(n) || 0);
const withinTolerance = (value, target) => Math.abs(value - target) <= target * TOLERANCE;

function displayName(foodName) {
  // Keep "cooked" so a list of cooked rice weight isn't read as dry weight.
  const cooked = /\(cooked\)/.test(foodName);
  const base = foodName.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return cooked ? `${base}, cooked` : base;
}

function macrosFor(items) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const [name, grams] of items) {
    const f = FOOD.get(name);
    if (!f) throw new Error(`food-db is missing ${name}`);
    t.calories += (f.cal * grams) / 100;
    t.protein += (f.p * grams) / 100;
    t.carbs += (f.c * grams) / 100;
    t.fat += (f.f * grams) / 100;
  }
  return t;
}

const roundGrams = (g) => Math.max(5, Math.round(g / 5) * 5);

function templatesFor(slot, dietary) {
  const excluded = new Set((dietary || []).flatMap((d) => DIET_EXCLUDES[String(d).toLowerCase()] || []));
  return TEMPLATES.filter((t) => t.slot === slot && !t.flags.some((f) => excluded.has(f)));
}

function mealFromItems(name, items) {
  const m = macrosFor(items);
  return {
    name,
    ingredients: items.map(([food, grams]) => ({ item: displayName(food), qty: `${grams}${LIQUIDS.has(food) ? 'ml' : 'g'}` })),
    calories: round(m.calories),
    protein: round(m.protein),
    carbs: round(m.carbs),
    fat: round(m.fat),
    prepMins: 15,
  };
}

function totalsOf(meals) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const slot of SLOTS) {
    const m = meals[slot];
    if (!m) continue;
    for (const k of Object.keys(t)) t[k] += Number(m[k]) || 0;
  }
  for (const k of Object.keys(t)) t[k] = round(t[k]);
  return t;
}

/** Deterministic day from the food DB, scaled to the calorie target. */
function buildDay(dayIndex, { calories, dietary }) {
  const picked = {};
  for (const slot of SLOTS) {
    const options = templatesFor(slot, dietary);
    const t = options[dayIndex % options.length];
    const raw = macrosFor(t.items).calories;
    const scale = (calories * SLOT_SHARE[slot]) / raw;
    picked[slot] = { name: t.name, items: t.items.map(([food, g]) => [food, roundGrams(g * scale)]) };
  }
  // Close the rounding gap on the biggest dinner ingredient.
  const dinner = picked.dinner.items;
  const big = dinner.reduce((best, it, i) => (it[1] * FOOD.get(it[0]).cal > dinner[best][1] * FOOD.get(dinner[best][0]).cal ? i : best), 0);
  const all = () => SLOTS.flatMap((s) => picked[s].items);
  const gap = calories - macrosFor(all()).calories;
  const perGram = FOOD.get(dinner[big][0]).cal / 100;
  dinner[big] = [dinner[big][0], roundGrams(dinner[big][1] + gap / perGram)];

  const meals = Object.fromEntries(SLOTS.map((s) => [s, mealFromItems(picked[s].name, picked[s].items)]));
  return { day: DAY_NAMES[dayIndex % 7], meals, dailyTotals: totalsOf(meals) };
}

function buildPlan({ calories, protein, days, dietary = [], goal }) {
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(buildDay(i, { calories, dietary }));
  return finishPlan({
    planName: `${days}-day FitMunch plan`,
    summary: `${days} days at about ${calories} kcal a day, built from everyday Australian supermarket foods.`,
    goal,
    days: out,
    weeklyBudgetEst: null,
  }, { protein });
}

function scaleQty(qty, f) {
  const s = String(qty || '');
  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return s;
  const unit = m[2];
  const n = Number(m[1]) * f;
  const isMass = /^(g|kg|ml|l)\b/i.test(unit);
  const v = isMass ? (/^(kg|l)\b/i.test(unit) ? Math.round(n * 10) / 10 : roundGrams(n)) : Math.max(0.5, Math.round(n * 2) / 2);
  return `${v}${isMass ? '' : ' '}${unit}`.trim();
}

/**
 * Checks an AI plan. Days are re-totalled from their meals (the AI's own
 * dailyTotals are ignored), and a day off target is scaled into range when
 * the needed scale is between 0.6 and 1.6. Returns { ok, plan, scaledDays }.
 */
function normaliseAiPlan(plan, { calories, days, protein }) {
  if (!plan || !Array.isArray(plan.days)) return { ok: false, reason: 'no_days' };
  if (plan.days.length < days) return { ok: false, reason: `only_${plan.days.length}_of_${days}_days` };
  let scaledDays = 0;
  const outDays = [];
  for (let i = 0; i < days; i += 1) {
    const d = plan.days[i];
    const meals = d && d.meals && typeof d.meals === 'object' && !Array.isArray(d.meals) ? d.meals : null;
    if (!meals) return { ok: false, reason: `day_${i + 1}_no_meals` };
    const present = SLOTS.filter((s) => meals[s] && Number(meals[s].calories) > 0);
    if (present.length < 3) return { ok: false, reason: `day_${i + 1}_missing_meals` };
    const before = totalsOf(meals).calories;
    let fixed = Object.fromEntries(present.map((s) => [s, { ...meals[s], ingredients: Array.isArray(meals[s].ingredients) ? meals[s].ingredients : [] }]));
    if (!withinTolerance(before, calories)) {
      const f = calories / before;
      if (f < MIN_SCALE || f > MAX_SCALE) return { ok: false, reason: `day_${i + 1}_${before}kcal_unscalable` };
      fixed = Object.fromEntries(present.map((s) => {
        const m = fixed[s];
        return [s, {
          ...m,
          calories: round(m.calories * f),
          protein: round(m.protein * f),
          carbs: round(m.carbs * f),
          fat: round(m.fat * f),
          ingredients: m.ingredients.map((ing) => ({ ...ing, qty: scaleQty(ing.qty || ing.quantity, f) })),
        }];
      }));
      scaledDays += 1;
    }
    const totals = totalsOf(fixed);
    if (!withinTolerance(totals.calories, calories)) return { ok: false, reason: `day_${i + 1}_off_target` };
    outDays.push({ day: (d.day && String(d.day)) || DAY_NAMES[i % 7], meals: fixed, dailyTotals: totals });
  }
  return { ok: true, scaledDays, plan: finishPlan({ ...plan, days: outDays }, { protein }) };
}

function finishPlan(plan, { protein }) {
  const n = plan.days.length || 1;
  const sum = (k) => plan.days.reduce((s, d) => s + d.dailyTotals[k], 0);
  return {
    ...plan,
    avgDailyCalories: round(sum('calories') / n),
    avgDailyProtein: round(sum('protein') / n),
    targetProtein: protein,
  };
}

/** Every day within ±5% of target. Used by the route and the tests. */
function everyDayOnTarget(plan, calories) {
  return Array.isArray(plan.days) && plan.days.length > 0
    && plan.days.every((d) => withinTolerance(totalsOf(d.meals).calories, calories) && d.dailyTotals.calories === totalsOf(d.meals).calories);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), Math.max(0, ms)); });
  return Promise.race([Promise.resolve(promise).catch((e) => ({ ok: false, error: e && e.message })), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * AI first, one retry if time allows, then the food-DB builder. Never throws
 * for an AI fault, and returns inside budgetMs (plus the instant builder).
 * callAi() resolves to { ok, data, provider }.
 */
async function generatePlan(input, { callAi, budgetMs = 25000, attemptMs = 20000, minRetryMs = 8000, now = Date.now } = {}) {
  const started = now();
  const left = () => budgetMs - (now() - started);
  const attempts = [];
  for (let attempt = 1; attempt <= 2 && callAi; attempt += 1) {
    // Keep a small margin to build and send the response.
    const timeoutMs = Math.min(attemptMs, left() - Math.min(500, budgetMs * 0.1));
    if (timeoutMs <= 0 || (attempt > 1 && timeoutMs < minRetryMs)) break;
    const r = await withTimeout(callAi(attempt), timeoutMs);
    if (!r || !r.ok) { attempts.push((r && r.error) || 'ai_failed'); if (r && r.error === 'timeout') break; continue; }
    const checked = normaliseAiPlan(r.data, input);
    if (checked.ok) {
      return { plan: checked.plan, source: attempt === 1 ? 'ai' : 'ai_retry', provider: r.provider, scaledDays: checked.scaledDays, attempts };
    }
    attempts.push(checked.reason);
  }
  return { plan: buildPlan(input), source: 'builder', provider: null, scaledDays: 0, attempts };
}

// ── SHOPPING LIST ────────────────────────────────────────────────────────────

const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', litre: 'l', litres: 'l', liter: 'l',
};

function parseQty(qty) {
  const s = String(qty == null ? '' : qty).trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?\b\s*(.*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const word = m[2] || '';
  const unit = UNIT_ALIASES[word];
  if (unit === 'kg') return { family: 'g', amount: n * 1000 };
  if (unit === 'l') return { family: 'ml', amount: n * 1000 };
  if (unit) return { family: unit, amount: n };
  // Count units: "3 large", "2 slices", "1 can", "2" -> counted per word.
  const countWord = (word || 'each').replace(/s$/, '');
  return { family: `count:${countWord}`, amount: n };
}

function formatQty(family, amount) {
  if (family === 'g') return amount >= 1000 ? `${Math.round(amount / 10) / 100} kg` : `${Math.round(amount)} g`;
  if (family === 'ml') return amount >= 1000 ? `${Math.round(amount / 10) / 100} L` : `${Math.round(amount)} ml`;
  const word = family.slice(6);
  const n = Math.round(amount * 2) / 2;
  if (word === 'each') return `${n}`;
  const noPlural = /^(large|medium|small|whole|tbsp|tsp|x)$/.test(word) || /s$/.test(word);
  return `${n} ${word}${n === 1 || noPlural ? '' : 's'}`;
}

function singular(word) {
  if (word.length <= 3 || word.endsWith('ss')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function itemKey(name) {
  const words = String(name).toLowerCase().replace(/\((?!cooked)[^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.map(singular).join(' ');
}

function mealIngredients(day) {
  const meals = day && day.meals;
  if (!meals) return [];
  const list = Array.isArray(meals) ? meals : SLOTS.map((s) => meals[s]).filter(Boolean);
  const out = [];
  for (const meal of list) {
    if (!meal) continue;
    if (Array.isArray(meal.ingredients)) {
      for (const ing of meal.ingredients) {
        if (typeof ing === 'string') out.push({ name: ing, qty: '' });
        else if (ing) out.push({ name: ing.item || ing.name, qty: ing.qty || ing.quantity || '' });
      }
    } else if (Array.isArray(meal.foods)) {
      for (const f of meal.foods) out.push(typeof f === 'string' ? { name: f, qty: '' } : { name: f.name || f.item, qty: f.qty || f.quantity || '' });
    }
    else if (typeof meal === 'string') out.push({ name: meal, qty: '' });
    else if (meal.name || meal.foodName || meal.food) {
      // A logged food saved as a plan entry (older manual plans).
      out.push({ name: meal.name || meal.foodName || meal.food, qty: meal.servingSize || meal.quantity || meal.qty || '' });
    }
  }
  return out.filter((i) => i.name && String(i.name).trim());
}

/**
 * Combines every ingredient in the plan. Same item + same unit family are
 * summed (g with kg, ml with L, counts by their word); anything without a
 * number is listed once with how many meals use it.
 */
function aggregateShoppingList(plan) {
  const byKey = new Map();
  for (const day of (plan && plan.days) || []) {
    for (const ing of mealIngredients(day)) {
      const key = itemKey(ing.name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { name: String(ing.name).replace(/\s*\((?!cooked)[^)]*\)\s*/g, ' ').trim(), totals: new Map(), meals: 0, unparsed: 0 });
      const entry = byKey.get(key);
      entry.meals += 1;
      const q = parseQty(ing.qty);
      if (!q) { entry.unparsed += 1; continue; }
      entry.totals.set(q.family, (entry.totals.get(q.family) || 0) + q.amount);
    }
  }
  return [...byKey.values()].map((e) => {
    const parts = [...e.totals.entries()].map(([fam, amt]) => formatQty(fam, amt));
    if (e.unparsed && !parts.length) parts.push(`for ${e.meals} meal${e.meals === 1 ? '' : 's'}`);
    return {
      name: e.name,
      qty: parts.join(' + '),
      amounts: Object.fromEntries([...e.totals.entries()].map(([k, v]) => [k, Math.round(v * 10) / 10])),
      meals: e.meals,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  TOLERANCE,
  SLOTS,
  TEMPLATES,
  buildPlan,
  normaliseAiPlan,
  everyDayOnTarget,
  generatePlan,
  withTimeout,
  aggregateShoppingList,
  parseQty,
  scaleQty,
  itemKey,
};
