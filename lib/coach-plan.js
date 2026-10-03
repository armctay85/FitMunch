'use strict';

/**
 * FitMunch Coach plan builder.
 *
 * Builds a 7-day client plan from the same week the shopper already uses,
 * then prices a draft list from the public specials catalogue. No trolley
 * APIs, no supermarket ordering, no Stripe.
 *
 * Client-count gate hook for part B (billing):
 * Part A does not charge and does not create Stripe objects.
 * Part B sets `coachClientLimit` on the PT record (a number, or null while
 * the gate is not installed). `resolveCoachClientLimit` reads that field.
 * `evaluateCoachClientGate` allows plans for clients already on the roster,
 * and blocks a new client once the roster is at the cap.
 * A null limit means the gate is not installed and plan creation stays open.
 */

const shopper = require('./fitness-butler-shopper');
const { CATALOGUE, STORES, getItem } = require('./public-specials-catalogue');

const PRICE_NOTE = 'Prices vary by store and week.';
const DIETITIAN_LINE = 'See a dietitian for medical nutrition.';
const CLIENT_GATE_HOOK = 'coach.clientCountGate';

const STORES_OK = ['woolworths', 'coles', 'aldi'];
const FLAGS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free'];

const FLAG_BLOCKS = {
  vegetarian: ['meat', 'fish'],
  vegan: ['meat', 'fish', 'egg', 'dairy', 'animal'],
  'gluten-free': ['gluten'],
  'dairy-free': ['dairy'],
  'nut-free': ['nut'],
};

// Nutrition is per recipe amount unit (grams, millilitres, or each).
// Figures are kitchen estimates so a draft can be scaled to a calorie target.
const NUTRITION = {
  'chicken-breast-1kg': { kcal: 1.2, p: 0.23, c: 0, f: 0.025 },
  'chicken-thigh-1kg': { kcal: 1.77, p: 0.2, c: 0, f: 0.11 },
  'eggs-12': { kcal: 72, p: 6.3, c: 0.4, f: 4.8 },
  'greek-yoghurt-1kg': { kcal: 0.97, p: 0.09, c: 0.04, f: 0.05 },
  'oats-750g': { kcal: 3.79, p: 0.13, c: 0.67, f: 0.07 },
  'brown-rice-1kg': { kcal: 1.11, p: 0.026, c: 0.23, f: 0.009 },
  'broccoli-2pk': { kcal: 0.34, p: 0.028, c: 0.07, f: 0.004 },
  'spinach-120g': { kcal: 0.23, p: 0.029, c: 0.036, f: 0.004 },
  'salmon-400g': { kcal: 2.08, p: 0.2, c: 0, f: 0.13 },
  'tuna-4pk': { kcal: 90, p: 20, c: 0, f: 1 },
  'beef-mince-500g': { kcal: 1.76, p: 0.21, c: 0, f: 0.1 },
  'sweet-potato-1kg': { kcal: 0.86, p: 0.016, c: 0.2, f: 0.001 },
  'bananas-1kg': { kcal: 0.89, p: 0.011, c: 0.23, f: 0.003 },
  'frozen-berries-500g': { kcal: 0.4, p: 0.005, c: 0.09, f: 0.002 },
  'milk-2l': { kcal: 0.42, p: 0.034, c: 0.05, f: 0.01 },
  'cottage-cheese-250g': { kcal: 0.98, p: 0.11, c: 0.03, f: 0.04 },
  'pasta-500g': { kcal: 3.5, p: 0.12, c: 0.7, f: 0.015 },
  'onion-1kg': { kcal: 0.4, p: 0.011, c: 0.09, f: 0.001 },
  'garlic-bulb': { kcal: 4, p: 0.2, c: 1, f: 0 },
  'olive-oil-500ml': { kcal: 8.84, p: 0, c: 0, f: 1 },
  'bread-loaf': { kcal: 1100, p: 40, c: 190, f: 14 },
  'capsicum-2pk': { kcal: 30, p: 1, c: 6, f: 0.3 },
  'zucchini-500g': { kcal: 0.17, p: 0.012, c: 0.03, f: 0.003 },
  'tomatoes-400g': { kcal: 0.18, p: 0.009, c: 0.039, f: 0.002 },
  'peanut-butter-375g': { kcal: 5.88, p: 0.25, c: 0.2, f: 0.5 },
  'frozen-veg-1kg': { kcal: 0.35, p: 0.02, c: 0.06, f: 0.003 },
  'cheese-250g': { kcal: 3.5, p: 0.25, c: 0.01, f: 0.27 },
  'cucumber': { kcal: 20, p: 1, c: 3, f: 0.2 },
  'carrots-1kg': { kcal: 0.41, p: 0.009, c: 0.1, f: 0.002 },
  'soy-sauce-250ml': { kcal: 0.53, p: 0.08, c: 0.05, f: 0 },
};

const SKU_TAGS = {
  'chicken-breast-1kg': ['meat'],
  'chicken-thigh-1kg': ['meat'],
  'beef-mince-500g': ['meat'],
  'salmon-400g': ['meat', 'fish'],
  'tuna-4pk': ['meat', 'fish'],
  'eggs-12': ['egg', 'animal'],
  'greek-yoghurt-1kg': ['dairy', 'animal'],
  'cottage-cheese-250g': ['dairy', 'animal'],
  'milk-2l': ['dairy', 'animal'],
  'cheese-250g': ['dairy', 'animal'],
  'bread-loaf': ['gluten'],
  'pasta-500g': ['gluten'],
  'soy-sauce-250ml': ['gluten'],
  'peanut-butter-375g': ['nut'],
};

const LIBRARY = [
  meal('Breakfast', 'Yoghurt oats bowl', [
    need('greek-yoghurt-1kg', 180),
    need('oats-750g', 60),
    need('frozen-berries-500g', 80),
  ]),
  meal('Breakfast', 'Eggs on toast', [
    need('eggs-12', 2),
    need('bread-loaf', 0.15),
    need('spinach-120g', 40),
  ]),
  meal('Breakfast', 'Peanut oats', [
    need('oats-750g', 70),
    need('peanut-butter-375g', 25),
    need('bananas-1kg', 120),
  ]),
  meal('Breakfast', 'Berry oats', [
    need('oats-750g', 80),
    need('frozen-berries-500g', 80),
    need('bananas-1kg', 120),
  ]),
  meal('Lunch', 'Chicken rice box', [
    need('chicken-breast-1kg', 180),
    need('brown-rice-1kg', 150),
    need('broccoli-2pk', 100),
  ]),
  meal('Lunch', 'Egg rice box', [
    need('eggs-12', 2),
    need('brown-rice-1kg', 150),
    need('spinach-120g', 40),
  ]),
  meal('Lunch', 'Rice and vegetables', [
    need('brown-rice-1kg', 180),
    need('frozen-veg-1kg', 150),
    need('olive-oil-500ml', 10),
  ]),
  meal('Dinner', 'Mince pasta', [
    need('beef-mince-500g', 150),
    need('pasta-500g', 90),
    need('zucchini-500g', 120),
    need('tomatoes-400g', 80),
  ]),
  meal('Dinner', 'Vegetable tray', [
    need('sweet-potato-1kg', 250),
    need('capsicum-2pk', 1),
    need('zucchini-500g', 150),
    need('olive-oil-500ml', 12),
    need('brown-rice-1kg', 150),
  ]),
  meal('Snack', 'Cottage cheese', [need('cottage-cheese-250g', 125)]),
  meal('Snack', 'Banana', [need('bananas-1kg', 120)]),
];

function meal(slot, name, ingredients) {
  return { slot, name, ingredients };
}

function need(sku, amount) {
  return { sku, amount };
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function roundAmount(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function roundMacro(value) {
  return Math.round(Number(value) || 0);
}

function cloneWeek(week) {
  return {
    id: week.id,
    name: week.name,
    days: week.days.map((day) => ({
      day: day.day,
      meals: day.meals.map((row) => ({
        slot: row.slot,
        name: row.name,
        ingredients: row.ingredients.map((ing) => ({ sku: ing.sku, amount: ing.amount })),
      })),
    })),
  };
}

function blockedTagSet(flags) {
  const tags = new Set();
  for (const flag of flags) {
    for (const tag of FLAG_BLOCKS[flag]) tags.add(tag);
  }
  return tags;
}

function skuBlocked(sku, blocked) {
  return (SKU_TAGS[sku] || []).some((tag) => blocked.has(tag));
}

function mealBlocked(row, blocked) {
  return row.ingredients.some((ing) => skuBlocked(ing.sku, blocked));
}

function replacementFor(row, blocked) {
  const sameSlot = LIBRARY.find((item) => item.slot === row.slot && !mealBlocked(item, blocked));
  if (sameSlot) return { slot: row.slot, name: sameSlot.name, ingredients: sameSlot.ingredients.map((ing) => ({ ...ing })) };
  const any = LIBRARY.find((item) => !mealBlocked(item, blocked));
  if (!any) throw fail('no_meals', 'No catalogue meals match these dietary flags.');
  return { slot: row.slot, name: any.name, ingredients: any.ingredients.map((ing) => ({ ...ing })) };
}

function applyFlags(week, flags) {
  const blocked = blockedTagSet(flags);
  return {
    ...week,
    days: week.days.map((day) => ({
      day: day.day,
      meals: day.meals.map((row) => (mealBlocked(row, blocked) ? replacementFor(row, blocked) : {
        slot: row.slot,
        name: row.name,
        ingredients: row.ingredients.map((ing) => ({ sku: ing.sku, amount: ing.amount })),
      })),
    })),
  };
}

function ingredientMacros(ing) {
  const row = NUTRITION[ing.sku];
  if (!row) return { kcal: 0, p: 0, c: 0, f: 0 };
  const amount = Number(ing.amount) || 0;
  return {
    kcal: row.kcal * amount,
    p: row.p * amount,
    c: row.c * amount,
    f: row.f * amount,
  };
}

function sumMacros(ingredients) {
  return ingredients.reduce((sum, ing) => {
    const row = ingredientMacros(ing);
    sum.kcal += row.kcal;
    sum.p += row.p;
    sum.c += row.c;
    sum.f += row.f;
    return sum;
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}

function scaleWeekToKcal(week, kcal) {
  return {
    ...week,
    days: week.days.map((day) => {
      const current = sumMacros(day.meals.flatMap((row) => row.ingredients)).kcal;
      let factor = current > 0 ? kcal / current : 1;
      if (factor < 0.45) factor = 0.45;
      if (factor > 2.2) factor = 2.2;
      return {
        day: day.day,
        meals: day.meals.map((row) => ({
          slot: row.slot,
          name: row.name,
          ingredients: row.ingredients.map((ing) => ({
            sku: ing.sku,
            amount: roundAmount(ing.amount * factor),
          })),
        })),
      };
    }),
  };
}

function multiplyWeek(week, householdSize) {
  const factor = householdSize;
  return {
    ...week,
    days: week.days.map((day) => ({
      day: day.day,
      meals: day.meals.map((row) => ({
        slot: row.slot,
        name: row.name,
        ingredients: row.ingredients.map((ing) => ({
          sku: ing.sku,
          amount: roundAmount(ing.amount * factor),
        })),
      })),
    })),
  };
}

function presentIngredient(ing) {
  const item = getItem(ing.sku);
  return {
    sku: ing.sku,
    name: item ? item.name : ing.sku,
    amount: ing.amount,
    unit: item ? item.unit : '',
  };
}

function presentDays(week) {
  return week.days.map((day) => {
    const meals = day.meals.map((row) => {
      const macros = sumMacros(row.ingredients);
      return {
        slot: row.slot,
        name: row.name,
        kcal: roundMacro(macros.kcal),
        protein: roundMacro(macros.p),
        carbs: roundMacro(macros.c),
        fat: roundMacro(macros.f),
        ingredients: row.ingredients.map(presentIngredient),
      };
    });
    const totals = meals.reduce((sum, row) => {
      sum.kcal += row.kcal;
      sum.protein += row.protein;
      sum.carbs += row.carbs;
      sum.fat += row.fat;
      return sum;
    }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    return { day: day.day, ...totals, meals };
  });
}

function normaliseInput(input) {
  const src = input || {};
  const kcal = Number(src.kcal);
  const protein = Number(src.protein);
  const carbs = Number(src.carbs);
  const fat = Number(src.fat);
  if (!Number.isFinite(kcal) || kcal < 800 || kcal > 6000) {
    throw fail('bad_targets', 'Calorie target must be between 800 and 6000.');
  }
  for (const [label, value] of [['protein', protein], ['carbs', carbs], ['fat', fat]]) {
    if (!Number.isFinite(value) || value < 0 || value > 500) {
      throw fail('bad_targets', `${label} must be between 0 and 500 grams.`);
    }
  }
  const householdSize = Number(src.householdSize == null ? 1 : src.householdSize);
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 8) {
    throw fail('bad_household', 'Household size must be a whole number from 1 to 8.');
  }
  const storeId = String(src.storeId || 'woolworths');
  if (!STORES_OK.includes(storeId)) throw fail('bad_store', 'Choose Woolworths, Coles, or Aldi.');
  const flags = Array.isArray(src.flags) ? src.flags.map(String) : [];
  const unknown = flags.filter((flag) => !FLAGS.includes(flag));
  if (unknown.length) throw fail('bad_flags', 'Unknown dietary flag.');
  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    householdSize,
    storeId,
    flags: [...new Set(flags)],
  };
}

function priceForStore(pricedLines, storeId) {
  let totalCents = 0;
  let unpricedCount = 0;
  const lines = pricedLines.map((line) => {
    const quote = line.quotes[storeId];
    if (!quote) {
      unpricedCount += 1;
      return {
        sku: line.sku,
        name: line.name,
        aisle: line.aisle,
        packs: line.packs,
        amount: line.amount,
        unit: line.unit,
        priced: false,
        lineAud: null,
        unitAud: null,
        onSpecial: false,
      };
    }
    totalCents += quote.lineCents;
    return {
      sku: line.sku,
      name: line.name,
      aisle: line.aisle,
      packs: line.packs,
      amount: line.amount,
      unit: line.unit,
      priced: true,
      lineAud: shopper.aud(quote.lineCents),
      unitAud: shopper.aud(quote.unitCents),
      onSpecial: Boolean(quote.onSpecial),
    };
  });
  lines.sort((a, b) => a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name));
  return {
    storeId,
    storeName: STORES[storeId].name,
    lines,
    totalCents,
    totalAud: shopper.aud(totalCents),
    unpricedCount,
    note: PRICE_NOTE,
  };
}

function buildCoachPlan(input) {
  const spec = normaliseInput(input);
  const base = applyFlags(cloneWeek(shopper.getWeek()), spec.flags);
  const plate = scaleWeekToKcal(base, spec.kcal);
  const shopWeek = multiplyWeek(plate, spec.householdSize);
  const ingredients = shopper.writeIngredients(shopWeek);
  const priced = shopper.priceIngredients(ingredients, CATALOGUE);
  const shopping = priceForStore(priced, spec.storeId);
  const days = presentDays(plate);
  const avg = days.reduce((sum, day) => {
    sum.kcal += day.kcal;
    sum.protein += day.protein;
    sum.carbs += day.carbs;
    sum.fat += day.fat;
    return sum;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const n = days.length || 1;
  return {
    days,
    dayCount: days.length,
    targets: {
      kcal: spec.kcal,
      protein: spec.protein,
      carbs: spec.carbs,
      fat: spec.fat,
    },
    draftAverages: {
      kcal: Math.round(avg.kcal / n),
      protein: Math.round(avg.protein / n),
      carbs: Math.round(avg.carbs / n),
      fat: Math.round(avg.fat / n),
    },
    flags: spec.flags,
    householdSize: spec.householdSize,
    storeId: spec.storeId,
    shopping,
    catalogue: {
      id: CATALOGUE.id,
      sourceKind: CATALOGUE.sourceKind,
    },
    priceNote: PRICE_NOTE,
    dietitianLine: DIETITIAN_LINE,
    honesty: {
      paysWoolworths: false,
      paysColes: false,
      paysAldi: false,
      trolleyApi: false,
      ordersPlaced: false,
      pricesFrom: 'public_specials_catalogue',
    },
  };
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function adherenceFromLogs(logs, targets, now) {
  const end = now ? new Date(now) : new Date();
  const cursor = Number.isNaN(end.getTime()) ? new Date() : end;
  const keys = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() - i);
    keys.push(date.toISOString().slice(0, 10));
  }
  const grouped = new Map();
  for (const row of logs || []) {
    const key = dayKey(row.date || row.created_at);
    if (!key || !keys.includes(key)) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  let daysLogged = 0;
  let kcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  for (const key of keys) {
    const rows = grouped.get(key);
    if (!rows || !rows.length) continue;
    daysLogged += 1;
    for (const row of rows) {
      kcal += Number(row.calories) || 0;
      protein += Number(row.protein) || 0;
      carbs += Number(row.carbs) || 0;
      fat += Number(row.fat) || 0;
    }
  }
  const avg = (value) => (daysLogged ? Math.round(value / daysLogged) : null);
  const goal = targets || {};
  return {
    windowDays: 7,
    daysLogged,
    avgKcal: avg(kcal),
    avgProtein: avg(protein),
    avgCarbs: avg(carbs),
    avgFat: avg(fat),
    targetKcal: goal.kcal == null ? null : Number(goal.kcal),
    targetProtein: goal.protein == null ? null : Number(goal.protein),
    targetCarbs: goal.carbs == null ? null : Number(goal.carbs),
    targetFat: goal.fat == null ? null : Number(goal.fat),
  };
}

function targetsFromLogs(logs, now) {
  const adherence = adherenceFromLogs(logs, {}, now);
  if (!adherence.daysLogged) return { available: false, adherence };
  return {
    available: true,
    source: 'logs',
    kcal: adherence.avgKcal,
    protein: adherence.avgProtein,
    carbs: adherence.avgCarbs,
    fat: adherence.avgFat,
    adherence,
  };
}

function resolveCoachClientLimit(pt) {
  if (!pt) return null;
  const raw = pt.coachClientLimit;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function evaluateCoachClientGate({ limit, clientId, rosterIds }) {
  const cap = resolveCoachClientLimit({ coachClientLimit: limit == null ? null : limit });
  const installed = cap != null;
  const roster = [...new Set((rosterIds || []).filter((id) => id != null && id !== '').map(String))];
  const id = clientId == null || clientId === '' ? '' : String(clientId);
  const already = Boolean(id) && roster.includes(id);
  const allowed = installed ? (already || roster.length < cap) : true;
  return {
    hook: CLIENT_GATE_HOOK,
    installed,
    allowed,
    activeClients: roster.length,
    limit: cap,
    clientId: id || null,
    reason: allowed ? null : 'client_count_gate',
  };
}

const STATUSES = ['draft', 'sent', 'viewed'];

function transitionPlanStatus(current, event) {
  if (!STATUSES.includes(current)) throw fail('bad_status', 'Unknown plan status.');
  if (event === 'send') {
    if (current === 'draft') return 'sent';
    return current;
  }
  if (event === 'view') {
    if (current === 'draft') throw fail('not_sent', 'Draft plans are not shared.');
    return 'viewed';
  }
  throw fail('bad_transition', 'Unknown plan transition.');
}

module.exports = {
  PRICE_NOTE,
  DIETITIAN_LINE,
  CLIENT_GATE_HOOK,
  FLAGS,
  STORES_OK,
  buildCoachPlan,
  adherenceFromLogs,
  targetsFromLogs,
  resolveCoachClientLimit,
  evaluateCoachClientGate,
  transitionPlanStatus,
  STATUSES,
};
