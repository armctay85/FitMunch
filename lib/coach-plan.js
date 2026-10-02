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
const { CATALOGUE, STORES, getItem, catalogueView } = require('./public-specials-catalogue');

const DIETITIAN_LINE = 'See a dietitian for medical nutrition.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function catalogueDay(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year || !month || !day) return String(iso || '');
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const PRICE_NOTE = `Prices from public specials on ${catalogueDay(CATALOGUE.pricedAt)}, check at checkout.`;
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
  'brown-rice-1kg': { kcal: 3.67, p: 0.075, c: 0.76, f: 0.027 },
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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PROTEIN_KNOBS = ['chicken-breast-1kg', 'chicken-thigh-1kg', 'beef-mince-500g', 'salmon-400g', 'tuna-4pk', 'eggs-12', 'cottage-cheese-250g', 'greek-yoghurt-1kg', 'peanut-butter-375g', 'oats-750g'];
const CARB_KNOBS = ['brown-rice-1kg', 'pasta-500g', 'oats-750g', 'sweet-potato-1kg', 'bread-loaf', 'bananas-1kg'];

const LIBRARY = [
  meal('Breakfast', 'yoghurt-oats-bowl', 'Yoghurt oats bowl', [
    'Stir the oats through the yoghurt.',
    'Fold in the berries.',
    'Leave it five minutes so the oats soften.',
  ], [need('greek-yoghurt-1kg', 150), need('oats-750g', 40), need('frozen-berries-500g', 60)]),
  meal('Breakfast', 'eggs-on-toast', 'Eggs on toast', [
    'Toast the bread.',
    'Fry the eggs in a dry pan.',
    'Pile on the spinach and eat straight away.',
  ], [need('eggs-12', 2), need('bread-loaf', 2 / 14), need('spinach-120g', 40)]),
  meal('Breakfast', 'berry-oats', 'Berry oats', [
    'Simmer the oats with a splash of water.',
    'Stir until the oats are creamy.',
    'Top with berries and eat warm.',
  ], [need('oats-750g', 40), need('frozen-berries-500g', 60), need('bananas-1kg', 40)]),
  meal('Breakfast', 'eggs-and-spinach', 'Eggs and spinach', [
    'Wilt the spinach in a pan.',
    'Crack in the eggs and set the whites.',
    'Season and serve from the pan.',
  ], [need('eggs-12', 2), need('spinach-120g', 60)]),
  meal('Breakfast', 'banana-rice', 'Banana rice', [
    'Warm the rice with a spoon of water.',
    'Slice the banana over the top.',
    'Stir and eat while it is warm.',
  ], [need('brown-rice-1kg', 40), need('bananas-1kg', 80)]),
  meal('Breakfast', 'spinach-oats', 'Spinach oats', [
    'Simmer the oats until creamy.',
    'Stir in the spinach until it wilts.',
    'Rest for a minute, then eat.',
  ], [need('oats-750g', 50), need('spinach-120g', 40)]),
  meal('Breakfast', 'carrot-rice-bowl', 'Carrot rice bowl', [
    'Warm the rice.',
    'Grate the carrot over the top.',
    'Fold it through and eat warm.',
  ], [need('brown-rice-1kg', 80), need('carrots-1kg', 80)]),
  meal('Lunch', 'chicken-rice-box', 'Chicken rice box', [
    'Cook the rice until the grains split.',
    'Pan-cook the chicken until the centre is white.',
    'Box it with broccoli for later.',
  ], [need('chicken-breast-1kg', 160), need('brown-rice-1kg', 120), need('broccoli-2pk', 80)]),
  meal('Lunch', 'tuna-rice', 'Tuna rice', [
    'Cook the rice and let it steam.',
    'Drain the tuna and break it up.',
    'Fold both through the spinach.',
  ], [need('tuna-4pk', 1), need('brown-rice-1kg', 120), need('spinach-120g', 40)]),
  meal('Lunch', 'chicken-veg-box', 'Chicken veg box', [
    'Cook the chicken in a hot pan.',
    'Steam the broccoli and zucchini.',
    'Pack the chicken on the vegetables.',
  ], [need('chicken-breast-1kg', 180), need('broccoli-2pk', 100), need('zucchini-500g', 100)]),
  meal('Lunch', 'rice-and-vegetables', 'Rice and vegetables', [
    'Cook the rice.',
    'Warm the frozen vegetables in a pan.',
    'Spoon the vegetables over the rice.',
  ], [need('brown-rice-1kg', 140), need('frozen-veg-1kg', 150)]),
  meal('Lunch', 'broccoli-rice-bowl', 'Broccoli rice bowl', [
    'Cook the rice.',
    'Steam the broccoli until just tender.',
    'Sit the broccoli on the rice.',
  ], [need('brown-rice-1kg', 140), need('broccoli-2pk', 120)]),
  meal('Lunch', 'tomato-rice-box', 'Tomato rice box', [
    'Cook the rice.',
    'Warm the tomatoes until they soften.',
    'Spoon them over the rice and box it.',
  ], [need('brown-rice-1kg', 140), need('tomatoes-400g', 120)]),
  meal('Lunch', 'zucchini-rice-bowl', 'Zucchini rice bowl', [
    'Cook the rice.',
    'Fry the zucchini until golden at the edges.',
    'Fold the zucchini through the rice.',
  ], [need('brown-rice-1kg', 140), need('zucchini-500g', 150)]),
  meal('Dinner', 'mince-pasta', 'Mince pasta', [
    'Brown the mince and drain the fat.',
    'Simmer it with the tomatoes and zucchini.',
    'Toss the pasta through the sauce.',
  ], [need('beef-mince-500g', 100), need('pasta-500g', 70), need('zucchini-500g', 80), need('tomatoes-400g', 60)]),
  meal('Dinner', 'chicken-tray-bake', 'Chicken tray bake', [
    'Heat the oven hot.',
    'Roast the chicken with capsicum and zucchini.',
    'Rest five minutes, then plate it.',
  ], [need('chicken-breast-1kg', 180), need('capsicum-2pk', 1), need('zucchini-500g', 120)]),
  meal('Dinner', 'salmon-sweet-potato', 'Salmon and sweet potato', [
    'Roast the sweet potato until soft.',
    'Pan-cook the salmon skin side first.',
    'Serve the salmon on the potato.',
  ], [need('salmon-400g', 80), need('sweet-potato-1kg', 160), need('spinach-120g', 40)]),
  meal('Dinner', 'salmon-greens', 'Salmon and greens', [
    'Pan-cook the salmon until it flakes.',
    'Wilt the spinach beside it.',
    'Plate the salmon on the greens.',
  ], [need('salmon-400g', 80), need('spinach-120g', 60), need('broccoli-2pk', 80)]),
  meal('Dinner', 'chicken-rice-dinner', 'Chicken rice dinner', [
    'Cook the rice.',
    'Pan-cook the chicken with garlic.',
    'Slice the chicken over the rice.',
  ], [need('chicken-breast-1kg', 180), need('brown-rice-1kg', 100), need('garlic-bulb', 1), need('broccoli-2pk', 80)]),
  meal('Dinner', 'beef-veg-tray', 'Beef and vegetable tray', [
    'Brown the mince.',
    'Add the tomatoes, zucchini and rice.',
    'Simmer until the rice is tender.',
  ], [need('beef-mince-500g', 100), need('brown-rice-1kg', 60), need('zucchini-500g', 80), need('tomatoes-400g', 60)]),
  meal('Dinner', 'vegetable-tray', 'Vegetable tray', [
    'Heat the oven hot.',
    'Roast the sweet potato, capsicum and zucchini.',
    'Serve over the rice.',
  ], [need('sweet-potato-1kg', 220), need('capsicum-2pk', 1), need('zucchini-500g', 120), need('brown-rice-1kg', 100)]),
  meal('Dinner', 'zucchini-tomato-rice', 'Zucchini tomato rice', [
    'Cook the rice.',
    'Fry the zucchini with the tomatoes.',
    'Fold the pan through the rice.',
  ], [need('brown-rice-1kg', 140), need('zucchini-500g', 150), need('tomatoes-400g', 100)]),
  meal('Dinner', 'capsicum-carrot-rice', 'Capsicum carrot rice', [
    'Cook the rice.',
    'Fry the capsicum with the grated carrot.',
    'Spoon the vegetables over the rice.',
  ], [need('brown-rice-1kg', 80), need('capsicum-2pk', 1), need('carrots-1kg', 40)]),
  meal('Dinner', 'sweet-potato-spinach', 'Sweet potato and spinach', [
    'Roast the sweet potato until soft.',
    'Wilt the spinach in a pan.',
    'Serve the spinach over the potato.',
  ], [need('sweet-potato-1kg', 280), need('spinach-120g', 60), need('broccoli-2pk', 80)]),
  meal('Dinner', 'tomato-spinach-rice', 'Tomato spinach rice', [
    'Cook the rice.',
    'Warm the tomatoes until they slump.',
    'Stir in the spinach and take it off the heat.',
  ], [need('brown-rice-1kg', 150), need('tomatoes-400g', 120), need('spinach-120g', 40)]),
  meal('Snack', 'cottage-cheese', 'Cottage cheese', [
    'Spoon the cottage cheese into a bowl.',
    'Eat it cold.',
    'Add a grind of pepper if you want.',
  ], [need('cottage-cheese-250g', 120)]),
  meal('Snack', 'banana', 'Banana', [
    'Peel the banana.',
    'Eat it on its own.',
    'Keep the rest of the bunch for tomorrow.',
  ], [need('bananas-1kg', 80)]),
  meal('Snack', 'greek-yoghurt', 'Greek yoghurt', [
    'Spoon the yoghurt into a bowl.',
    'Eat it cold.',
    'Stop when the bowl is empty.',
  ], [need('greek-yoghurt-1kg', 150)]),
];

function meal(slot, slug, name, method, ingredients) {
  return { slot, slug, name, method, ingredients };
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

function clientFoodName(item) {
  const catalog = getItem(item.sku);
  const raw = item.name || (catalog && catalog.name) || '';
  return String(raw)
    .replace(/\s+\d+(\.\d+)?\s*(kg|g|ml|l)\b.*$/i, '')
    .replace(/\s+\d+\s*pack\b.*$/i, '')
    .replace(/\s+each$/i, '')
    .replace(/\s+punnet$/i, '')
    .trim();
}

function snapMass(amount) {
  const n = Number(amount) || 0;
  if (n <= 0) return 0;
  const step = n < 100 ? 5 : 10;
  return Math.max(step, Math.round(n / step) * step);
}

function snapAmount(sku, amount) {
  const n = Number(amount) || 0;
  if (n <= 0) return 0;
  const item = getItem(sku);
  const unit = item ? item.unit : 'g';
  if (sku === 'bread-loaf') return roundAmount(Math.max(1, Math.round(n * 14)) / 14);
  if (unit === 'each') return Math.max(1, Math.round(n));
  return snapMass(n);
}

function formatQty(item) {
  const sku = item.sku;
  const catalog = getItem(sku);
  const unit = item.unit || (catalog && catalog.unit) || '';
  const amount = Number(item.amount) || 0;
  if (sku === 'bread-loaf') {
    const slices = Math.max(1, Math.round(amount * 14));
    return slices === 1 ? '1 slice' : `${slices} slices`;
  }
  if (unit === 'each') {
    const n = Math.max(1, Math.round(amount));
    if (sku === 'eggs-12') return n === 1 ? '1 egg' : `${n} eggs`;
    if (sku === 'tuna-4pk') return n === 1 ? '1 can' : `${n} cans`;
    if (sku === 'capsicum-2pk') return n === 1 ? '1 capsicum' : `${n} capsicums`;
    if (sku === 'garlic-bulb') return n === 1 ? '1 bulb' : `${n} bulbs`;
    if (sku === 'cucumber') return n === 1 ? '1 cucumber' : `${n} cucumbers`;
    const name = clientFoodName(item);
    return name ? `${n} ${name}` : String(n);
  }
  const snapped = snapMass(amount);
  const measure = unit === 'ml' ? 'ml' : 'g';
  const name = clientFoodName(item);
  return name ? `${snapped} ${measure} ${name}` : `${snapped} ${measure}`;
}

function packNoun(line) {
  const name = `${line.name || ''} ${line.sku || ''}`;
  if (/yoghurt|cottage/i.test(name)) return 'tub';
  if (/egg/i.test(name)) return 'carton';
  if (/loaf|bread/i.test(name)) return 'loaf';
  if (/milk|oil|sauce/i.test(name)) return 'bottle';
  if (/peanut/i.test(name)) return 'jar';
  if (/tomato/i.test(name)) return 'punnet';
  if (/garlic/i.test(name)) return 'bulb';
  if (/banana/i.test(name)) return 'bunch';
  return 'pack';
}

function pluralNoun(noun) {
  if (noun === 'loaf') return 'loaves';
  if (noun === 'bunch') return 'bunches';
  return `${noun}s`;
}

function formatPack(line) {
  const packs = Math.max(1, Math.round(Number(line.packs) || 1));
  const noun = packNoun(line);
  const word = packs === 1 ? noun : pluralNoun(noun);
  return `${line.name}: ${packs} ${word}`;
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

function cloneMeal(row) {
  return {
    slot: row.slot,
    slug: row.slug,
    name: row.name,
    method: row.method.slice(),
    ingredients: row.ingredients
      .map((ing) => ({ sku: ing.sku, amount: snapAmount(ing.sku, ing.amount) }))
      .filter((ing) => ing.amount > 0),
  };
}

function poolFor(slot, blocked) {
  return LIBRARY.filter((item) => item.slot === slot && !mealBlocked(item, blocked));
}

function assignSlot(pool, count, minDistinct) {
  if (!pool.length || pool.length * 2 < count) {
    throw fail('no_meals', 'No catalogue meals match these dietary flags.');
  }
  const used = new Map();
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    const ranked = [...pool].sort((a, b) => {
      const ua = used.get(a.name) || 0;
      const ub = used.get(b.name) || 0;
      return ua - ub || a.name.localeCompare(b.name);
    });
    const pick = ranked.find((item) => (used.get(item.name) || 0) < 2) || ranked[0];
    chosen.push(pick);
    used.set(pick.name, (used.get(pick.name) || 0) + 1);
  }
  const distinct = new Set(chosen.map((item) => item.name)).size;
  if (minDistinct && distinct < Math.min(minDistinct, pool.length)) {
    throw fail('no_meals', 'Not enough different meals for this week.');
  }
  return chosen;
}

function locateKnob(meals, skus) {
  for (const sku of skus) {
    for (let mi = meals.length - 1; mi >= 0; mi -= 1) {
      const ii = meals[mi].ingredients.findIndex((ing) => ing.sku === sku);
      if (ii >= 0) return { mi, ii, sku };
    }
  }
  return null;
}

function knobChoices(sku) {
  const item = getItem(sku);
  if (!item) return [1];
  if (sku === 'bread-loaf') return [1, 2, 3, 4].map((slices) => roundAmount(slices / 14));
  if (item.unit === 'each') {
    const max = sku === 'eggs-12' ? 4 : sku === 'tuna-4pk' ? 3 : 2;
    return Array.from({ length: max }, (_, index) => index + 1);
  }
  if (sku === 'olive-oil-500ml') return [0, 5, 10, 15, 20, 25, 30, 35];
  let min = 80;
  let max = 520;
  if (sku === 'brown-rice-1kg') {
    min = 40;
    max = 220;
  } else if (sku === 'oats-750g') {
    min = 30;
    max = 140;
  } else if (sku === 'pasta-500g') {
    min = 40;
    max = 220;
  } else if (sku === 'sweet-potato-1kg') {
    min = 80;
    max = 500;
  } else if (sku === 'bananas-1kg') {
    min = 80;
    max = 240;
  } else if (sku === 'salmon-400g') {
    min = 80;
    max = 320;
  }
  const values = [];
  for (let n = min; n <= max; n += (n < 100 ? 10 : 20)) values.push(n);
  return values;
}

function fitScore(rounded, spec) {
  const rows = [
    [rounded.kcal, spec.kcal, 4],
    [rounded.p, spec.protein, 3],
    [rounded.c, spec.carbs, 3],
    [rounded.f, spec.fat, 3],
  ];
  let score = 0;
  for (const [actual, goal, weight] of rows) {
    if (!goal) continue;
    const err = Math.abs(actual - goal) / goal;
    score += (err <= 0.05 ? err : 12 + err) * weight;
  }
  return score;
}

function roundedMacros(meals) {
  const raw = sumMacros(meals.flatMap((row) => row.ingredients));
  return {
    kcal: roundMacro(raw.kcal),
    p: roundMacro(raw.p),
    c: roundMacro(raw.c),
    f: roundMacro(raw.f),
  };
}

function tuneDay(rows, spec, blocked) {
  const meals = rows.map(cloneMeal);
  const dinner = meals.find((row) => row.slot === 'Dinner') || meals[meals.length - 1];
  if (!skuBlocked('olive-oil-500ml', blocked) && !meals.some((row) => row.ingredients.some((ing) => ing.sku === 'olive-oil-500ml'))) {
    dinner.ingredients.push({ sku: 'olive-oil-500ml', amount: 10 });
  }
  const proteinSkus = PROTEIN_KNOBS.filter((sku) => !skuBlocked(sku, blocked));
  const carbSkus = CARB_KNOBS.filter((sku) => !skuBlocked(sku, blocked));
  if (!skuBlocked('brown-rice-1kg', blocked) && !meals.some((row) => row.ingredients.some((ing) => ing.sku === 'brown-rice-1kg' || ing.sku === 'pasta-500g'))) {
    const host = meals.find((row) => row.slot === 'Lunch') || dinner;
    host.ingredients.push({ sku: 'brown-rice-1kg', amount: 120 });
  }
  if (!skuBlocked('chicken-breast-1kg', blocked) && !meals.some((row) => row.ingredients.some((ing) => ing.sku === 'chicken-breast-1kg'))) {
    dinner.ingredients.push({ sku: 'chicken-breast-1kg', amount: 160 });
  }
  let protein = locateKnob(meals, proteinSkus);
  let carb = locateKnob(meals, carbSkus.filter((sku) => !protein || sku !== protein.sku));
  if (carb) {
    meals.forEach((row, mi) => {
      row.ingredients.forEach((ing, ii) => {
        if (ing.sku === carb.sku && (mi !== carb.mi || ii !== carb.ii)) ing.amount = snapAmount(ing.sku, 20);
      });
    });
  }
  let boostSku = null;
  if (!skuBlocked('cottage-cheese-250g', blocked)) boostSku = 'cottage-cheese-250g';
  else if (!skuBlocked('greek-yoghurt-1kg', blocked)) boostSku = 'greek-yoghurt-1kg';
  if (boostSku && (!protein || protein.sku !== boostSku) && (!carb || carb.sku !== boostSku)) {
    if (!meals.some((row) => row.ingredients.some((ing) => ing.sku === boostSku))) {
      const snack = meals.find((row) => row.slot === 'Snack') || dinner;
      snack.ingredients.push({ sku: boostSku, amount: 0 });
    }
  }
  const boost = boostSku ? locateKnob(meals, [boostSku]) : null;
  const fat = locateKnob(meals, ['olive-oil-500ml']);
  const proteinValues = protein ? knobChoices(protein.sku) : [null];
  const carbValues = carb ? knobChoices(carb.sku) : [null];
  const fatValues = fat ? knobChoices(fat.sku) : [null];
  const boostValues = boost && boost.sku !== (protein && protein.sku) && boost.sku !== (carb && carb.sku)
    ? [0, 40, 80, 120, 160, 200, 240]
    : [null];
  let best = null;
  let bestScore = Infinity;
  for (const proteinAmount of proteinValues) {
    if (protein) meals[protein.mi].ingredients[protein.ii].amount = proteinAmount;
    for (const carbAmount of carbValues) {
      if (carb) meals[carb.mi].ingredients[carb.ii].amount = carbAmount;
      for (const fatAmount of fatValues) {
        if (fat) meals[fat.mi].ingredients[fat.ii].amount = fatAmount;
        for (const boostAmount of boostValues) {
          if (boost && boostValues.length > 1) meals[boost.mi].ingredients[boost.ii].amount = boostAmount;
          const score = fitScore(roundedMacros(meals), spec);
          if (score < bestScore) {
            bestScore = score;
            best = meals.map(cloneMeal);
          }
        }
      }
    }
  }
  return (best || meals).map((row) => ({
    ...row,
    ingredients: row.ingredients.filter((ing) => ing.amount > 0),
  }));
}

function buildVariedWeek(spec) {
  const blocked = blockedTagSet(spec.flags);
  const breakfasts = assignSlot(poolFor('Breakfast', blocked), 7, 1);
  const lunches = assignSlot(poolFor('Lunch', blocked), 7, 1);
  const dinners = assignSlot(poolFor('Dinner', blocked), 7, 5);
  const snacks = poolFor('Snack', blocked);
  if (!snacks.length) throw fail('no_meals', 'No catalogue meals match these dietary flags.');
  return {
    id: 'coach-week',
    name: 'Coach week',
    days: DAYS.map((day, index) => ({
      day,
      meals: tuneDay([
        breakfasts[index],
        lunches[index],
        dinners[index],
        snacks[index % snacks.length],
      ], spec, blocked),
    })),
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
  const row = {
    sku: ing.sku,
    name: item ? item.name : ing.sku,
    amount: ing.amount,
    unit: item ? item.unit : '',
  };
  row.qty = formatQty(row);
  return row;
}

function presentDays(week) {
  return week.days.map((day) => {
    const meals = day.meals.map((row) => {
      const macros = sumMacros(row.ingredients);
      return {
        slot: row.slot,
        slug: row.slug,
        name: row.name,
        method: row.method,
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
  }).map((line) => ({ ...line, packLabel: formatPack(line) }));
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
  const plate = buildVariedWeek(spec);
  const shopWeek = multiplyWeek(plate, spec.householdSize);
  const ingredients = shopper.writeIngredients(shopWeek);
  const priced = shopper.priceIngredients(ingredients, CATALOGUE);
  const shopping = priceForStore(priced, spec.storeId);
  shopping.estimates = STORES_OK.map((storeId) => {
    const quote = priceForStore(priced, storeId);
    return {
      storeId,
      storeName: quote.storeName,
      totalAud: quote.totalAud,
      totalCents: quote.totalCents,
      unpricedCount: quote.unpricedCount,
    };
  });
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
    catalogue: catalogueView(),
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
  formatQty,
  formatPack,
  adherenceFromLogs,
  targetsFromLogs,
  resolveCoachClientLimit,
  evaluateCoachClientGate,
  transitionPlanStatus,
  STATUSES,
};
