'use strict';

/**
 * FitMunch Coach plan builder.
 *
 * Builds a 7-day client plan and a shopping list split across stores.
 * The client share and PDF do not show supermarket prices, totals, or
 * catalogue dates. No trolley, cart, or checkout APIs, no Stripe.
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
const { STORES, getItem } = require('./public-specials-catalogue');

const DIETITIAN_LINE = 'See a dietitian for medical nutrition.';
const PRICE_NOTE = 'Check prices at checkout.';
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

function per100(kcal, p, c, f) {
  return { kcal: kcal / 100, p: p / 100, c: c / 100, f: f / 100 };
}

function perItem(kcal, p, c, f) {
  return { kcal, p, c, f };
}

// Nutrition is per catalogue unit (grams, millilitres, or each).
// Meat and fish are cooked weights. Rice, oats and pasta are dry.
// Per 100 g (or per item): cooked chicken breast 165/31/0/3.6,
// large egg 72/6.3/0.4/4.8, whole-milk Greek yoghurt 97/9/3.9/5,
// dry oats 379/13.2/67.7/6.5, dry brown rice 367/7.5/76.2/2.8,
// broccoli 34/2.8/6.6/0.4, spinach 23/2.9/3.6/0.4,
// cooked salmon 206/22.1/0/12.4, drained tuna can 116/25.5/0/0.8,
// extra-lean cooked mince 171/26.3/0/6.5, sweet potato 86/1.6/20.1/0.1,
// banana 89/1.1/22.8/0.3, berries 57/0.7/14.5/0.3,
// cottage cheese 98/11.1/3.4/4.3, dry pasta 371/13/74.7/1.5,
// olive oil 8.84 kcal and 0.91 g fat per ml,
// wholegrain slice 110/4/20/1.5 (14 slices in the loaf),
// capsicum 31/1/6/0.3 each.
const NUTRITION = {
  'chicken-breast-1kg': per100(165, 31, 0, 3.6),
  'chicken-thigh-1kg': per100(209, 26, 0, 10.9),
  'eggs-12': perItem(72, 6.3, 0.4, 4.8),
  'greek-yoghurt-1kg': per100(97, 9, 3.9, 5),
  'oats-750g': per100(379, 13.2, 67.7, 6.5),
  'brown-rice-1kg': per100(367, 7.5, 76.2, 2.8),
  'broccoli-2pk': per100(34, 2.8, 6.6, 0.4),
  'spinach-120g': per100(23, 2.9, 3.6, 0.4),
  'salmon-400g': per100(206, 22.1, 0, 12.4),
  'tuna-4pk': perItem(116, 25.5, 0, 0.8),
  'beef-mince-500g': per100(171, 26.3, 0, 6.5),
  'sweet-potato-1kg': per100(86, 1.6, 20.1, 0.1),
  'bananas-1kg': per100(89, 1.1, 22.8, 0.3),
  'frozen-berries-500g': per100(57, 0.7, 14.5, 0.3),
  'milk-2l': per100(42, 3.4, 5, 1),
  'cottage-cheese-250g': per100(98, 11.1, 3.4, 4.3),
  'pasta-500g': per100(371, 13, 74.7, 1.5),
  'onion-1kg': per100(40, 1.1, 9.3, 0.1),
  'garlic-bulb': perItem(4, 0.2, 1, 0),
  'olive-oil-500ml': perItem(8.84, 0, 0, 0.91),
  'bread-loaf': perItem(110 * 14, 4 * 14, 20 * 14, 1.5 * 14),
  'capsicum-2pk': perItem(31, 1, 6, 0.3),
  'zucchini-500g': per100(17, 1.2, 3.1, 0.3),
  'tomatoes-400g': per100(18, 0.9, 3.9, 0.2),
  'peanut-butter-375g': per100(588, 25, 20, 50),
  'frozen-veg-1kg': per100(45, 2.5, 8, 0.4),
  'cheese-250g': per100(403, 25, 1.3, 33),
  'cucumber': perItem(20, 1, 3, 0.2),
  'carrots-1kg': per100(41, 0.9, 9.6, 0.2),
  'soy-sauce-250ml': per100(53, 8.1, 4.9, 0.1),
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
const BANDS_2000 = {
  Breakfast: [350, 600],
  Lunch: [450, 700],
  Dinner: [500, 800],
  Snack: [150, 350],
};

function fix(sku, amount) {
  return { sku, amount };
}

function knob(sku, options) {
  return { sku, options };
}

function slices(options) {
  return knob('bread-loaf', options.map((count) => count / 14));
}

function dish(slot, slug, name, method, fixed, knobs, soft) {
  return {
    slot,
    slug,
    name,
    method,
    fixed,
    knobs,
    softProtein: Boolean(soft),
  };
}

const LIBRARY = [
  dish('Breakfast', 'yoghurt-oats-bowl', 'Yoghurt oats bowl', [
    'Stir the oats through the yoghurt.',
    'Fold in the berries and banana.',
    'Leave it five minutes so the oats soften.',
  ], [fix('frozen-berries-500g', 40)], [
    knob('greek-yoghurt-1kg', [160, 220, 280, 340]),
    knob('oats-750g', [30, 45, 60]),
    knob('bananas-1kg', [0, 50, 90]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Breakfast', 'eggs-on-toast', 'Eggs on toast', [
    'Toast the bread.',
    'Fry the eggs in a dry pan.',
    'Wilt the spinach and serve.',
  ], [fix('spinach-120g', 40)], [
    knob('eggs-12', [2, 3, 4]),
    slices([1, 2, 3]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Breakfast', 'eggs-and-spinach', 'Eggs and spinach', [
    'Wilt the spinach in a pan.',
    'Crack in the eggs and set the whites.',
    'Stir through the oats and serve.',
  ], [fix('spinach-120g', 60)], [
    knob('eggs-12', [2, 3, 4]),
    knob('oats-750g', [20, 35, 50, 65]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Breakfast', 'cottage-cheese', 'Cottage oats', [
    'Stir the oats through the cottage cheese.',
    'Fold in the berries.',
    'Leave it five minutes, then eat.',
  ], [fix('frozen-berries-500g', 40)], [
    knob('cottage-cheese-250g', [150, 200, 250, 300]),
    knob('oats-750g', [25, 40, 55, 70]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Breakfast', 'egg-rice', 'Egg rice', [
    'Warm the rice with a spoon of water.',
    'Fry the eggs and wilt the spinach.',
    'Serve the eggs on the rice.',
  ], [fix('spinach-120g', 40)], [
    knob('eggs-12', [2, 3, 4]),
    knob('brown-rice-1kg', [35, 50, 70, 90]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Breakfast', 'berry-oats', 'Berry oats', [
    'Simmer the oats with a splash of water.',
    'Stir until the oats are creamy.',
    'Top with banana and berries.',
  ], [fix('frozen-berries-500g', 50)], [
    knob('oats-750g', [45, 70, 95, 120]),
    knob('bananas-1kg', [60, 100, 140]),
  ], true),
  dish('Breakfast', 'spinach-oats', 'Spinach oats', [
    'Simmer the oats until creamy.',
    'Stir in the spinach until it wilts.',
    'Rest for a minute, then eat.',
  ], [fix('spinach-120g', 50)], [
    knob('oats-750g', [55, 80, 105, 130]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ], true),
  dish('Breakfast', 'carrot-rice-bowl', 'Carrot rice bowl', [
    'Warm the rice.',
    'Grate the carrot over the top.',
    'Fold it through and eat warm.',
  ], [fix('carrots-1kg', 80)], [
    knob('brown-rice-1kg', [55, 80, 105, 120]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Breakfast', 'banana-rice', 'Banana rice', [
    'Warm the rice with a spoon of water.',
    'Slice the banana over the top.',
    'Stir and eat while it is warm.',
  ], [], [
    knob('brown-rice-1kg', [50, 75, 100, 120]),
    knob('bananas-1kg', [80, 120]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ], true),
  dish('Lunch', 'chicken-rice-box', 'Chicken rice box', [
    'Cook the rice until the grains split.',
    'Pan-cook the chicken until the centre is white.',
    'Box it with broccoli for later.',
  ], [fix('broccoli-2pk', 80)], [
    knob('chicken-breast-1kg', [80, 110, 140, 170, 200]),
    knob('brown-rice-1kg', [40, 60, 80, 100]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Lunch', 'tuna-rice', 'Tuna rice', [
    'Cook the rice and let it steam.',
    'Drain the tuna and break it up.',
    'Fold the tuna, egg and spinach through the rice.',
  ], [fix('spinach-120g', 40)], [
    knob('tuna-4pk', [1, 2]),
    knob('eggs-12', [0, 1, 2]),
    knob('brown-rice-1kg', [40, 60, 80, 100]),
    knob('olive-oil-500ml', [0, 5, 10]),
  ]),
  dish('Lunch', 'chicken-veg-box', 'Chicken veg box', [
    'Cook the chicken in a hot pan.',
    'Steam the broccoli and zucchini.',
    'Pack the chicken on the vegetables and rice.',
  ], [fix('broccoli-2pk', 70), fix('zucchini-500g', 80)], [
    knob('chicken-breast-1kg', [80, 110, 140, 170, 200]),
    knob('brown-rice-1kg', [45, 65, 85, 105]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Lunch', 'mince-rice', 'Mince rice', [
    'Brown the mince.',
    'Cook the rice and steam the broccoli.',
    'Spoon the mince over the rice.',
  ], [fix('broccoli-2pk', 80)], [
    knob('beef-mince-500g', [80, 120, 160, 200]),
    knob('brown-rice-1kg', [40, 60, 80, 100]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Lunch', 'rice-and-vegetables', 'Rice and vegetables', [
    'Cook the rice.',
    'Warm the frozen vegetables in a pan.',
    'Spoon the vegetables over the rice.',
  ], [fix('frozen-veg-1kg', 160)], [
    knob('brown-rice-1kg', [55, 80, 105, 120]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Lunch', 'broccoli-rice-bowl', 'Broccoli rice bowl', [
    'Cook the rice.',
    'Steam the broccoli until just tender.',
    'Sit the broccoli on the rice.',
  ], [fix('broccoli-2pk', 140)], [
    knob('brown-rice-1kg', [55, 80, 105, 120]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Lunch', 'tomato-rice-box', 'Tomato rice box', [
    'Cook the rice.',
    'Warm the tomatoes until they soften.',
    'Spoon them over the rice and box it.',
  ], [fix('tomatoes-400g', 120)], [
    knob('brown-rice-1kg', [55, 80, 105, 120]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Lunch', 'zucchini-rice-bowl', 'Zucchini rice bowl', [
    'Cook the rice.',
    'Fry the zucchini until golden at the edges.',
    'Fold the zucchini through the rice.',
  ], [fix('zucchini-500g', 140)], [
    knob('brown-rice-1kg', [55, 80, 105, 120]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Dinner', 'mince-pasta', 'Mince pasta', [
    'Brown the mince and drain the fat.',
    'Simmer it with the tomatoes and zucchini.',
    'Toss the pasta through the sauce.',
  ], [fix('zucchini-500g', 80), fix('tomatoes-400g', 60)], [
    knob('beef-mince-500g', [100, 140, 180]),
    knob('pasta-500g', [45, 65, 85, 105]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Dinner', 'chicken-tray-bake', 'Chicken tray bake', [
    'Heat the oven hot.',
    'Roast the chicken with capsicum and zucchini.',
    'Serve it with the rice.',
  ], [fix('capsicum-2pk', 1), fix('zucchini-500g', 100)], [
    knob('chicken-breast-1kg', [90, 130, 170, 200]),
    knob('brown-rice-1kg', [40, 60, 85, 105]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Dinner', 'chicken-rice-dinner', 'Chicken rice dinner', [
    'Cook the rice.',
    'Pan-cook the chicken until the centre is white.',
    'Slice the chicken over the rice and broccoli.',
  ], [fix('broccoli-2pk', 80)], [
    knob('chicken-breast-1kg', [90, 130, 170, 200]),
    knob('brown-rice-1kg', [45, 70, 95, 115]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Dinner', 'beef-veg-tray', 'Beef and vegetable tray', [
    'Brown the mince.',
    'Add the tomatoes, zucchini and rice.',
    'Simmer until the rice is tender.',
  ], [fix('zucchini-500g', 100), fix('tomatoes-400g', 80)], [
    knob('beef-mince-500g', [100, 140, 180]),
    knob('brown-rice-1kg', [40, 60, 80, 100]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Dinner', 'chicken-sweet-potato', 'Chicken and sweet potato', [
    'Heat the oven hot.',
    'Roast the sweet potato until soft.',
    'Cook the chicken and plate it on top.',
  ], [fix('spinach-120g', 40)], [
    knob('chicken-breast-1kg', [90, 130, 170, 200]),
    knob('sweet-potato-1kg', [150, 230, 310, 400]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ]),
  dish('Dinner', 'vegetable-tray', 'Vegetable tray', [
    'Heat the oven hot.',
    'Roast the sweet potato, capsicum and zucchini.',
    'Serve over the rice.',
  ], [fix('capsicum-2pk', 1), fix('zucchini-500g', 100)], [
    knob('sweet-potato-1kg', [180, 260, 340]),
    knob('brown-rice-1kg', [50, 80, 110]),
    knob('olive-oil-500ml', [5, 10, 15]),
  ], true),
  dish('Dinner', 'zucchini-tomato-rice', 'Zucchini tomato rice', [
    'Cook the rice.',
    'Fry the zucchini with the tomatoes.',
    'Fold the pan through the rice.',
  ], [fix('zucchini-500g', 120), fix('tomatoes-400g', 80)], [
    knob('brown-rice-1kg', [55, 85, 115]),
    knob('olive-oil-500ml', [5, 10, 15]),
  ], true),
  dish('Dinner', 'capsicum-carrot-rice', 'Capsicum carrot rice', [
    'Cook the rice.',
    'Fry the capsicum with the grated carrot.',
    'Spoon the vegetables over the rice.',
  ], [fix('capsicum-2pk', 1), fix('carrots-1kg', 80)], [
    knob('brown-rice-1kg', [55, 85, 115]),
    knob('olive-oil-500ml', [0, 5, 10, 15]),
  ], true),
  dish('Dinner', 'sweet-potato-spinach', 'Sweet potato and spinach', [
    'Roast the sweet potato until soft.',
    'Wilt the spinach in a pan.',
    'Serve the spinach over the potato.',
  ], [fix('spinach-120g', 50), fix('broccoli-2pk', 80)], [
    knob('sweet-potato-1kg', [220, 320, 420]),
    knob('olive-oil-500ml', [5, 10, 15]),
  ], true),
  dish('Dinner', 'tomato-spinach-rice', 'Tomato spinach rice', [
    'Cook the rice.',
    'Warm the tomatoes until they slump.',
    'Stir in the spinach and take it off the heat.',
  ], [fix('tomatoes-400g', 100), fix('spinach-120g', 40)], [
    knob('brown-rice-1kg', [55, 85, 115]),
    knob('olive-oil-500ml', [5, 10, 15]),
  ], true),
  dish('Snack', 'greek-yoghurt', 'Greek yoghurt', [
    'Spoon the yoghurt into a bowl.',
    'Stir through the oats if you are using them.',
    'Eat it cold.',
  ], [], [
    knob('greek-yoghurt-1kg', [150, 200, 250, 300, 350]),
    knob('oats-750g', [0, 25, 40]),
    knob('bananas-1kg', [0, 50, 80]),
  ]),
  dish('Snack', 'banana', 'Banana and yoghurt', [
    'Spoon the yoghurt into a bowl.',
    'Slice the banana over the top.',
    'Eat it cold.',
  ], [], [
    knob('bananas-1kg', [80, 120]),
    knob('greek-yoghurt-1kg', [100, 160, 220, 280]),
  ]),
  dish('Snack', 'banana-oats', 'Banana oats', [
    'Stir the oats with a splash of water.',
    'Slice the banana through the oats.',
    'Eat it straight away.',
  ], [], [
    knob('oats-750g', [25, 45, 65, 85]),
    knob('bananas-1kg', [80, 120, 160]),
  ], true),
];

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

function mealSkus(row) {
  const skus = row.fixed.map((ing) => ing.sku);
  for (const item of row.knobs) skus.push(item.sku);
  return skus;
}

function mealBlocked(row, blocked) {
  return mealSkus(row).some((sku) => skuBlocked(sku, blocked));
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
    const slicesCount = Math.max(1, Math.round(amount * 14));
    return slicesCount === 1 ? '1 slice' : `${slicesCount} slices`;
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

function sumIngredientMacros(ingredients) {
  const raw = sumMacros(ingredients || []);
  return {
    kcal: raw.kcal,
    protein: raw.p,
    carbs: raw.c,
    fat: raw.f,
  };
}

function mealBand(slot, targetKcal) {
  const scale = Number(targetKcal) / 2000;
  const pair = BANDS_2000[slot];
  if (!pair) return [0, 900];
  return [Math.round(pair[0] * scale), Math.min(900, Math.round(pair[1] * scale))];
}

function portionIngredients(row, choices) {
  const parts = row.fixed.concat(choices);
  return parts
    .map((ing) => ({ sku: ing.sku, amount: snapAmount(ing.sku, ing.amount) }))
    .filter((ing) => ing.amount > 0);
}

function macroWindow(goal) {
  if (!goal) return null;
  return [Math.ceil(goal * 0.95 - 1e-9), Math.floor(goal * 1.05 + 1e-9)];
}

const plateCache = new Map();

function platesFor(row, targetKcal) {
  const key = `${row.slug}:${targetKcal}`;
  if (plateCache.has(key)) return plateCache.get(key);
  const [lo, hi] = mealBand(row.slot, targetKcal);
  const combos = [[]];
  for (const item of row.knobs) {
    const next = [];
    for (const combo of combos) {
      for (const amount of item.options) {
        next.push(combo.concat([{ sku: item.sku, amount }]));
      }
    }
    combos.length = 0;
    for (const combo of next) combos.push(combo);
  }
  const seen = new Set();
  const plates = [];
  for (const combo of combos) {
    const ingredients = portionIngredients(row, combo);
    const raw = sumMacros(ingredients);
    const kcal = roundMacro(raw.kcal);
    const protein = roundMacro(raw.p);
    const carbs = roundMacro(raw.c);
    const fat = roundMacro(raw.f);
    if (kcal <= 0 || kcal > 900 || kcal < lo || kcal > hi) continue;
    if (row.slot !== 'Snack' && !row.softProtein && protein < 25) continue;
    const stamp = `${kcal}|${protein}|${carbs}|${fat}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    plates.push({
      slot: row.slot,
      slug: row.slug,
      name: row.name,
      method: row.method,
      kcal,
      protein,
      carbs,
      fat,
      ingredients,
    });
  }
  const mid = (lo + hi) / 2;
  plates.sort((a, b) => Math.abs(a.kcal - mid) - Math.abs(b.kcal - mid) || a.protein - b.protein);
  plateCache.set(key, plates);
  return plates;
}

function searchWithin(lists, spec) {
  const goals = [
    ['kcal', spec.kcal],
    ['protein', spec.protein],
    ['carbs', spec.carbs],
    ['fat', spec.fat],
  ];
  const bounds = goals.map((pair) => macroWindow(pair[1]));
  const n = lists.length;
  const suffix = Array.from({ length: n + 1 }, () => goals.map(() => [0, 0]));
  for (let i = n - 1; i >= 0; i -= 1) {
    goals.forEach((pair, index) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const plate of lists[i]) {
        const value = plate[pair[0]];
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
      suffix[i][index] = [suffix[i + 1][index][0] + lo, suffix[i + 1][index][1] + hi];
    });
  }
  let best = null;
  let bestScore = Infinity;
  const chosen = new Array(n);
  function walk(index, acc) {
    if (index === n) {
      let score = 0;
      for (let i = 0; i < goals.length; i += 1) {
        const goal = goals[i][1];
        score += goal ? Math.abs(acc[i] - goal) / goal : 0;
      }
      if (score < bestScore) {
        bestScore = score;
        best = chosen.slice();
      }
      return;
    }
    for (const plate of lists[index]) {
      const next = acc.slice();
      let ok = true;
      for (let i = 0; i < goals.length; i += 1) {
        next[i] = acc[i] + plate[goals[i][0]];
        const bound = bounds[i];
        if (!bound) continue;
        const lo = next[i] + suffix[index + 1][i][0];
        const hi = next[i] + suffix[index + 1][i][1];
        if (hi < bound[0] || lo > bound[1]) ok = false;
      }
      if (!ok) continue;
      chosen[index] = plate;
      walk(index + 1, next);
      if (bestScore <= 0.04) return;
    }
  }
  walk(0, goals.map(() => 0));
  return best;
}

function centerPlate(row, targetKcal) {
  const plates = platesFor(row, targetKcal);
  if (!plates.length) {
    throw fail('no_meals', `No portion of ${row.name} fits this calorie target.`);
  }
  return plates[0];
}

function balanceDay(rows, spec) {
  const lists = rows.map((row) => platesFor(row, spec.kcal));
  if (lists.some((list) => !list.length)) {
    const missing = rows[lists.findIndex((list) => !list.length)];
    throw fail('no_meals', `No portion of ${missing.name} fits this calorie target.`);
  }
  const found = searchWithin(lists, spec);
  const chosen = found || rows.map((row) => centerPlate(row, spec.kcal));
  return chosen.map((plate) => ({
    slot: plate.slot,
    slug: plate.slug,
    name: plate.name,
    method: plate.method.slice(),
    ingredients: plate.ingredients.map((ing) => ({ sku: ing.sku, amount: ing.amount })),
  }));
}

function poolFor(slot, blocked) {
  const allowed = LIBRARY.filter((item) => item.slot === slot && !mealBlocked(item, blocked));
  const strong = allowed.filter((item) => !item.softProtein);
  const days = slot === 'Snack' ? 1 : 7;
  const need = slot === 'Dinner' ? 5 : slot === 'Snack' ? 1 : 4;
  if (strong.length >= need && strong.length * 2 >= days) return strong;
  return allowed;
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
      meals: balanceDay([
        breakfasts[index],
        lunches[index],
        dinners[index],
        snacks[index % snacks.length],
      ], spec),
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

const SERVE = {
  'chicken-breast-1kg': 180,
  'chicken-thigh-1kg': 180,
  'beef-mince-500g': 180,
  'salmon-400g': 150,
  'tuna-4pk': 1,
  'eggs-12': 2,
  'greek-yoghurt-1kg': 170,
  'cottage-cheese-250g': 150,
  'milk-2l': 250,
  'cheese-250g': 30,
  'oats-750g': 40,
  'brown-rice-1kg': 60,
  'pasta-500g': 80,
  'bread-loaf': 2 / 14,
  'peanut-butter-375g': 20,
  'broccoli-2pk': 80,
  'spinach-120g': 40,
  'bananas-1kg': 120,
  'frozen-berries-500g': 40,
  'sweet-potato-1kg': 150,
  'olive-oil-500ml': 10,
  'capsicum-2pk': 1,
  'zucchini-500g': 100,
  'tomatoes-400g': 100,
  'onion-1kg': 80,
  'garlic-bulb': 1,
  'frozen-veg-1kg': 100,
  'carrots-1kg': 80,
  'soy-sauce-250ml': 15,
  'cucumber': 1,
};

const SWAP_TO = {
  'chicken-thigh-1kg': { sku: 'chicken-breast-1kg', name: 'Breast' },
  'beef-mince-500g': { sku: 'chicken-breast-1kg', name: 'Breast' },
  'milk-2l': { sku: 'greek-yoghurt-1kg', name: 'Yoghurt' },
  'greek-yoghurt-1kg': { sku: 'cottage-cheese-250g', name: 'Cottage cheese' },
};

function proteinGrams(sku, amount) {
  const row = NUTRITION[sku];
  if (!row || !amount) return 0;
  return Math.round(row.p * amount);
}

function nutritionFacts(sku, flags) {
  const serve = SERVE[sku];
  const grams = serve ? proteinGrams(sku, serve) : 0;
  const blocked = blockedTagSet(flags || []);
  const swap = SWAP_TO[sku];
  let swapLabel = '';
  if (swap && serve && !skuBlocked(swap.sku, blocked)) {
    const gain = proteinGrams(swap.sku, serve) - grams;
    if (gain >= 4) swapLabel = `${swap.name} +${gain}g protein`;
  }
  return {
    proteinGrams: grams,
    proteinLabel: grams >= 1 ? `${grams}g protein` : '',
    swapLabel,
  };
}

function stockedAt(sku, storeId) {
  const item = getItem(sku);
  return Boolean(item && item.stores && item.stores[storeId]);
}

function assignStore(sku, preferred) {
  if (stockedAt(sku, preferred)) return preferred;
  const other = STORES_OK.find((id) => stockedAt(sku, id));
  return other || preferred;
}

function splitLabel(stores) {
  const names = stores.map((row) => row.storeName);
  if (names.length <= 1) return `All at ${names[0] || 'one store'}.`;
  if (names.length === 2) return `Split across ${names[0]} and ${names[1]}.`;
  return `Split across ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}

function buildShopping(ingredientLines, storeId, flags) {
  const lines = ingredientLines.map((line) => {
    const assigned = assignStore(line.sku, storeId);
    const facts = nutritionFacts(line.sku, flags);
    return {
      sku: line.sku,
      name: line.name,
      aisle: line.aisle,
      packs: line.packs,
      amount: line.amount,
      unit: line.unit,
      storeId: assigned,
      storeName: STORES[assigned].name,
      proteinLabel: facts.proteinLabel,
      swapLabel: facts.swapLabel,
      packLabel: formatPack(line),
    };
  });
  const storeIds = [];
  for (const id of [storeId, ...STORES_OK]) {
    if (lines.some((line) => line.storeId === id) && !storeIds.includes(id)) storeIds.push(id);
  }
  const stores = storeIds.map((id) => ({
    storeId: id,
    storeName: STORES[id].name,
    count: lines.filter((line) => line.storeId === id).length,
  }));
  lines.sort((a, b) => (
    storeIds.indexOf(a.storeId) - storeIds.indexOf(b.storeId)
    || a.aisle.localeCompare(b.aisle)
    || a.name.localeCompare(b.name)
  ));
  return {
    storeId,
    storeName: STORES[storeId].name,
    split: stores.length > 1,
    splitLabel: splitLabel(stores),
    stores,
    lines,
    note: PRICE_NOTE,
  };
}

function buildCoachPlan(input) {
  const spec = normaliseInput(input);
  const plate = buildVariedWeek(spec);
  const shopWeek = multiplyWeek(plate, spec.householdSize);
  const ingredients = shopper.writeIngredients(shopWeek);
  const shopping = buildShopping(ingredients, spec.storeId, spec.flags);
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
    priceNote: PRICE_NOTE,
    dietitianLine: DIETITIAN_LINE,
    honesty: {
      paysWoolworths: false,
      paysColes: false,
      paysAldi: false,
      trolleyApi: false,
      ordersPlaced: false,
      pricesFrom: 'none',
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
  nutritionFacts,
  formatQty,
  formatPack,
  mealBand,
  sumIngredientMacros,
  adherenceFromLogs,
  targetsFromLogs,
  resolveCoachClientLimit,
  evaluateCoachClientGate,
  transitionPlanStatus,
  STATUSES,
};
