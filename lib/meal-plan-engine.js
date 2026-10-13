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
const MACRO_TOLERANCE = 0.15;

/** A finite number, or a numeric string like "500" (not "500 kcal" or "abc"). */
function strictNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

const FOOD = new Map(FOODS.map((f) => [f.name, f]));
const LIQUIDS = new Set(['Skim milk', 'Full cream milk', 'Soy milk', 'Oat milk', 'Almond milk (unsweetened)', 'Olive oil']);

// [food name in food-db.js, grams]. Flags drive the dietary filters.
const TEMPLATES = [
  { slot: 'breakfast', name: 'Oats with banana and yoghurt', flags: ['dairy', 'gluten'], items: [['Rolled oats (dry)', 60], ['Banana', 120], ['Greek yoghurt (plain, low fat)', 150]] },
  { slot: 'breakfast', name: 'Eggs on wholegrain toast with spinach', flags: ['gluten', 'eggs'], items: [['Eggs (whole)', 150], ['Wholegrain bread', 80], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Berry protein smoothie', flags: ['dairy'], items: [['Whey protein powder', 30], ['Banana', 120], ['Mixed berries (frozen)', 100], ['Skim milk', 250]] },
  { slot: 'breakfast', name: 'Veggie omelette with potatoes', flags: ['eggs'], items: [['Eggs (whole)', 150], ['Egg whites', 100], ['Capsicum (red)', 60], ['Spinach', 40], ['White potato (boiled)', 200]] },
  { slot: 'breakfast', name: 'Berry chia pudding', flags: [], items: [['Chia seeds', 30], ['Oat milk', 250], ['Mixed berries (frozen)', 120], ['Banana', 100]] },

  { slot: 'breakfast', name: 'Greek yoghurt protein bowl', flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 300], ['Whey protein powder', 30], ['Mixed berries (frozen)', 100]] },

  // Plant-protein meals (plant: true): tofu, tempeh, seitan, edamame, lentils, chickpeas, soy milk and
  // coconut yoghurt with pea protein. Offered to vegan and vegetarian weeks so they can reach a protein target.
  { slot: 'breakfast', name: 'Tofu scramble on wholegrain toast', plant: true, flags: ['gluten', 'soy'], items: [['Firm tofu', 200], ['Wholegrain bread', 60], ['Spinach', 50], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Tempeh and sweet potato hash', plant: true, flags: ['soy'], items: [['Tempeh', 130], ['Sweet potato (baked)', 120], ['Spinach', 50], ['Capsicum (red)', 60]] },
  { slot: 'breakfast', name: 'Seitan and avocado toast', plant: true, flags: ['gluten'], items: [['Seitan', 130], ['Wholegrain bread', 60], ['Avocado', 40], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Soy milk oats with coconut yoghurt', plant: true, flags: ['soy', 'gluten'], items: [['Rolled oats (dry)', 50], ['Soy milk', 300], ['Coconut yoghurt with pea protein (vanilla)', 100], ['Mixed berries (frozen)', 80]] },

  { slot: 'lunch', name: 'Chicken salad', flags: ['meat'], items: [['Chicken breast (raw)', 200], ['Mixed salad leaves', 80], ['Tomato', 100], ['Cucumber', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Quinoa, corn and avocado bowl', flags: [], items: [['Quinoa (cooked)', 220], ['Corn (kernels)', 90], ['Avocado', 70], ['Spinach', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Chicken, brown rice and broccoli', flags: ['meat'], items: [['Chicken breast (raw)', 160], ['Brown rice (cooked)', 200], ['Broccoli', 120], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Tuna and avocado sandwich', flags: ['fish', 'gluten'], items: [['Tuna in water (canned)', 95], ['Wholegrain bread', 80], ['Mixed salad leaves', 50], ['Tomato', 100], ['Avocado', 50]] },
  { slot: 'lunch', name: 'Beef and sweet potato bowl', flags: ['meat'], items: [['Beef mince (lean raw)', 150], ['Sweet potato (baked)', 200], ['Spinach', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Egg and quinoa salad', flags: ['eggs'], items: [['Eggs (whole)', 100], ['Quinoa (cooked)', 180], ['Cucumber', 80], ['Tomato', 100], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Ricotta and spinach pasta', flags: ['dairy', 'gluten'], items: [['Pasta (cooked)', 200], ['Ricotta', 100], ['Spinach', 60], ['Tomato', 100]] },

  { slot: 'lunch', name: 'Lentil and tofu salad', plant: true, flags: ['soy'], items: [['Lentils (cooked)', 180], ['Firm tofu', 160], ['Mixed salad leaves', 60], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Seitan and chickpea bowl', plant: true, flags: ['gluten'], items: [['Seitan', 160], ['Chickpeas (cooked)', 120], ['Cucumber', 80], ['Spinach', 50]] },
  { slot: 'lunch', name: 'Edamame, tofu and quinoa bowl', plant: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['Firm tofu', 120], ['Quinoa (cooked)', 130], ['Capsicum (red)', 80]] },
  { slot: 'lunch', name: 'Tempeh, brown rice and broccoli', plant: true, flags: ['soy'], items: [['Tempeh', 150], ['Brown rice (cooked)', 140], ['Broccoli', 120]] },

  { slot: 'dinner', name: 'Salmon with potatoes and broccoli', flags: ['fish'], items: [['Salmon fillet', 160], ['White potato (boiled)', 250], ['Broccoli', 120]] },
  { slot: 'dinner', name: 'Chicken stir-fry with rice', flags: ['meat'], items: [['Chicken breast (raw)', 170], ['White rice (cooked)', 220], ['Capsicum (red)', 100], ['Carrot', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Beef and zucchini pasta', flags: ['meat', 'gluten'], items: [['Beef mince (lean raw)', 150], ['Pasta (cooked)', 220], ['Tomato', 150], ['Zucchini', 100]] },
  { slot: 'dinner', name: 'Barramundi with brown rice and zucchini', flags: ['fish'], items: [['Barramundi fillet', 180], ['Brown rice (cooked)', 200], ['Zucchini', 120], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Egg fried rice with vegetables', flags: ['eggs'], items: [['Eggs (whole)', 150], ['White rice (cooked)', 250], ['Corn (kernels)', 80], ['Capsicum (red)', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Quinoa bowl with egg whites and avocado', flags: ['eggs'], items: [['Quinoa (cooked)', 220], ['Egg whites', 150], ['Avocado', 80], ['Spinach', 50]] },

  { slot: 'dinner', name: 'Lean beef with greens and sweet potato', flags: ['meat'], items: [['Beef steak (rump)', 200], ['Broccoli', 150], ['Sweet potato (baked)', 150]] },
  { slot: 'dinner', name: 'Sweet potato, quinoa and greens', flags: [], items: [['Sweet potato (baked)', 250], ['Quinoa (cooked)', 180], ['Kale', 60], ['Avocado', 60], ['Olive oil', 7]] },

  { slot: 'dinner', name: 'Tofu stir-fry with rice', plant: true, flags: ['soy'], items: [['Firm tofu', 250], ['White rice (cooked)', 170], ['Capsicum (red)', 100], ['Broccoli', 100], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Seitan and zucchini pasta', plant: true, flags: ['gluten'], items: [['Seitan', 190], ['Pasta (cooked)', 170], ['Tomato', 150], ['Zucchini', 100]] },
  { slot: 'dinner', name: 'Lentil and tempeh bolognese', plant: true, flags: ['soy', 'gluten'], items: [['Lentils (cooked)', 150], ['Tempeh', 130], ['Pasta (cooked)', 140], ['Tomato', 150]] },
  { slot: 'dinner', name: 'Chickpea and tofu curry with rice', plant: true, flags: ['soy'], items: [['Firm tofu', 220], ['Chickpeas (cooked)', 120], ['Spinach', 80], ['Tomato', 120], ['Brown rice (cooked)', 110]] },
  { slot: 'dinner', name: 'Seitan stir-fry with quinoa', plant: true, flags: ['gluten'], items: [['Seitan', 210], ['Quinoa (cooked)', 140], ['Broccoli', 120], ['Carrot', 60], ['Olive oil', 5]] },

  { slot: 'snack', name: 'Salted edamame', plant: true, flags: ['soy'], items: [['Edamame (cooked)', 200]] },
  { slot: 'snack', name: 'Coconut yoghurt with berries', plant: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 170], ['Mixed berries (frozen)', 80]] },
  { slot: 'snack', name: 'Soy milk, tofu and banana smoothie', plant: true, flags: ['soy'], items: [['Soy milk', 300], ['Firm tofu', 100], ['Banana', 100]] },
  { slot: 'snack', name: 'Tofu and edamame snack box', plant: true, flags: ['soy'], items: [['Firm tofu', 100], ['Edamame (cooked)', 100], ['Cucumber', 60]] },
  { slot: 'snack', name: 'Greek yoghurt with berries', flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 200], ['Mixed berries (frozen)', 100]] },
  { slot: 'snack', name: 'Apple with peanut butter', flags: ['nuts'], items: [['Apple', 180], ['Peanut butter (natural)', 30]] },
  { slot: 'snack', name: 'Protein shake', flags: ['dairy'], items: [['Whey protein powder', 30], ['Skim milk', 300]] },
  { slot: 'snack', name: 'Rice cakes with avocado and tomato', flags: [], items: [['Rice cakes (plain)', 20], ['Avocado', 60], ['Tomato', 50]] },
  { slot: 'snack', name: 'Cottage cheese with banana', flags: ['dairy'], items: [['Cottage cheese', 150], ['Banana', 120]] },
];

// Hands-on prep and cook minutes per template, from typical recipes (not a fixed default).
const PREP_MINS = Object.freeze({
  'Oats with banana and yoghurt': 5,
  'Eggs on wholegrain toast with spinach': 10,
  'Berry protein smoothie': 5,
  'Veggie omelette with potatoes': 20,
  'Berry chia pudding': 5,
  'Greek yoghurt protein bowl': 3,
  'Tofu scramble on wholegrain toast': 12,
  'Tempeh and sweet potato hash': 20,
  'Seitan and avocado toast': 8,
  'Soy milk oats with coconut yoghurt': 5,
  'Chicken salad': 15,
  'Quinoa, corn and avocado bowl': 10,
  'Chicken, brown rice and broccoli': 25,
  'Tuna and avocado sandwich': 5,
  'Beef and sweet potato bowl': 25,
  'Egg and quinoa salad': 15,
  'Ricotta and spinach pasta': 15,
  'Lentil and tofu salad': 10,
  'Seitan and chickpea bowl': 10,
  'Edamame, tofu and quinoa bowl': 12,
  'Tempeh, brown rice and broccoli': 20,
  'Salmon with potatoes and broccoli': 25,
  'Chicken stir-fry with rice': 20,
  'Beef and zucchini pasta': 25,
  'Barramundi with brown rice and zucchini': 20,
  'Egg fried rice with vegetables': 15,
  'Quinoa bowl with egg whites and avocado': 15,
  'Lean beef with greens and sweet potato': 25,
  'Sweet potato, quinoa and greens': 30,
  'Tofu stir-fry with rice': 20,
  'Seitan and zucchini pasta': 20,
  'Lentil and tempeh bolognese': 25,
  'Chickpea and tofu curry with rice': 25,
  'Seitan stir-fry with quinoa': 15,
  'Salted edamame': 5,
  'Coconut yoghurt with berries': 2,
  'Soy milk, tofu and banana smoothie': 5,
  'Tofu and edamame snack box': 5,
  'Greek yoghurt with berries': 2,
  'Apple with peanut butter': 2,
  'Protein shake': 2,
  'Rice cakes with avocado and tomato': 5,
  'Cottage cheese with banana': 2,
});

const DIET_EXCLUDES = {
  vegetarian: ['meat', 'fish'],
  vegan: ['meat', 'fish', 'dairy', 'eggs'],
  pescatarian: ['meat'],
  'gluten free': ['gluten'],
  'dairy free': ['dairy'],
  'nut free': ['nuts'],
  'egg free': ['eggs'],
};
const DIET_STYLES = new Set(['high protein', 'low carb']);

/** "Gluten-Free", "gluten_free", " dairy free " -> "gluten free", "dairy free". */
function normaliseDiet(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((d) => String(d).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))];
}

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
  const diet = normaliseDiet(dietary);
  const excluded = new Set(diet.flatMap((d) => DIET_EXCLUDES[d] || []));
  // Any diet that drops dairy or eggs loses the main protein sources, so it gets the plant meals too.
  const plantWeek = ['vegan', 'vegetarian', 'dairy free', 'egg free'].some((d) => diet.includes(d));
  return TEMPLATES.filter((t) => t.slot === slot && (plantWeek || !t.plant) && !t.flags.some((f) => excluded.has(f)));
}

const share = (t, k) => { const m = macrosFor(t.items); return (k === 'fat' ? 9 : 4) * m[k] / m.calories; };

/**
 * Options for a slot in the order they rotate. A high protein target (over
 * 25% of calories, or the "high protein" tag) keeps the most protein-dense
 * half; "low carb" keeps the lowest-carb half.
 */
function slotOptions(slot, { dietary, calories, protein }) {
  const diet = normaliseDiet(dietary);
  let options = templatesFor(slot, diet);
  const keepHalf = (key, desc) => {
    const sorted = [...options].sort((a, b) => (desc ? share(b, key) - share(a, key) : share(a, key) - share(b, key)));
    options = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
  };
  // A numeric protein target is matched per day in chooseDay; the tag alone keeps the dense half.
  if (diet.includes('high protein') && !protein) keepHalf('protein', true);
  if (diet.includes('low carb')) keepHalf('carbs', false);
  return options;
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
    ...(PREP_MINS[name] ? { prepMins: PREP_MINS[name] } : {}),
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
/**
 * With a protein target, pick the slot combination whose scaled protein is
 * closest to it, nudged towards meals not used yet this week for variety.
 * Without one, rotate through the options. Deterministic either way.
 */
function chooseDay(dayIndex, { calories, dietary, protein }, used) {
  const opts = SLOTS.map((slot) => slotOptions(slot, { dietary, calories, protein }));
  const rotate = SLOTS.map((slot, i) => opts[i][dayIndex % opts[i].length]);
  if (!protein) return rotate;
  const pOf = SLOTS.map((slot, i) => opts[i].map((t) => (share(t, 'protein') * calories * SLOT_SHARE[slot]) / 4));
  let best = rotate; let bestCost = Infinity;
  const idx = [0, 0, 0, 0];
  const walk = (k, pSum) => {
    if (k === SLOTS.length) {
      const pick = idx.map((j, i) => opts[i][j]);
      const repeat = pick.reduce((n, t) => n + (used.get(t.name) || 0), 0);
      // Protein is capped at the target: a day over it by more than 10% only wins if nothing fits; buildDay trims the rest.
      const over = pSum > protein * 1.10 ? 10 + (pSum - protein) / protein : 0;
      const cost = Math.abs(pSum - protein) / protein + 0.012 * repeat + over;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = pick; }
      return;
    }
    for (let j = 0; j < opts[k].length; j += 1) { idx[k] = j; walk(k + 1, pSum + pOf[k][j]); }
  };
  walk(0, 0);
  return best;
}

function buildDay(dayIndex, { calories, dietary, protein }, used = new Map()) {
  const picked = {};
  const chosen = chooseDay(dayIndex, { calories, dietary, protein }, used);
  for (const t of chosen) used.set(t.name, (used.get(t.name) || 0) + 1);
  for (const [si, slot] of SLOTS.entries()) {
    const t = chosen[si];
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

  const build = () => Object.fromEntries(SLOTS.map((s) => [s, mealFromItems(picked[s].name, picked[s].items)]));
  let meals = build();
  // Protein never goes over the target. Trim the most protein-dense ingredient 5g at a time and put
  // the lost calories back on the lowest-protein starch or fruit, until both are in range.
  const pick = (score, ok) => {
    let best = null;
    for (const s of SLOTS) {
      picked[s].items.forEach((it, i) => {
        const f = FOOD.get(it[0]);
        if (!ok(f, it)) return;
        const v = score(f);
        if (!best || v > best.v) best = { s, i, v, f };
      });
    }
    return best;
  };
  for (let n = 0; protein && n < 80; n += 1) {
    const t = totalsOf(meals);
    if (t.protein > protein) {
      const d = pick((f) => f.p, (f, it) => it[1] > 5);
      if (!d) break;
      const it = picked[d.s].items[d.i]; picked[d.s].items[d.i] = [it[0], it[1] - 5];
    } else if (calories - t.calories > calories * 0.005) {
      const lowCarb = normaliseDiet(dietary).includes('low carb');
      const l = pick((f) => -(f.p * 4 + (lowCarb ? f.c * 4 : 0)) / f.cal, (f) => f.cal > 0 && f.cal <= 400);
      if (!l) break;
      const it = picked[l.s].items[l.i];
      picked[l.s].items[l.i] = [it[0], roundGrams(it[1] + (calories - t.calories) / (l.f.cal / 100))];
    } else break;
    meals = build();
  }
  return { day: DAY_NAMES[dayIndex % 7], meals, dailyTotals: totalsOf(meals) };
}

function buildPlan({ calories, protein, days, dietary = [], goal }) {
  const out = [];
  const used = new Map();
  for (let i = 0; i < days; i += 1) out.push(buildDay(i, { calories, dietary, protein }, used));
  const plan = finishPlan({
    planName: `${days}-day FitMunch plan`,
    summary: `${days} days at about ${calories} kcal a day, built from everyday foods.`,
    goal,
    days: out,
  }, { protein });
  const notes = [];
  if (protein && plan.avgDailyProtein < protein * 0.9) {
    const diet = normaliseDiet(dietary);
    const fix = diet.includes('vegan') ? 'Tofu, tempeh or legumes'
      : diet.includes('vegetarian') ? 'Eggs, Greek yoghurt or tofu'
        : 'A protein shake or extra lean meat or fish';
    notes.push(`Protein averages ${plan.avgDailyProtein} g a day against your ${protein} g target. ${fix} would close the gap.`);
  }
  const unknown = normaliseDiet(dietary).filter((d) => !DIET_EXCLUDES[d] && !DIET_STYLES.has(d));
  if (unknown.length) notes.push(`Not applied: ${unknown.join(', ')}. Check the ingredients for these.`);
  return notes.length ? { ...plan, notes } : plan;
}

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/** Leading amount: "2", "1.5", "1/2", "1 1/2", "½", "1½". Returns { n, rest } or null. */
function leadingAmount(text) {
  const s = String(text == null ? '' : text).trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
  if (m && Number(m[3])) return { n: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };
  m = s.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (m) return Number(m[2]) ? { n: Number(m[1]) / Number(m[2]), rest: m[3] } : null;
  m = s.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛])\s*(.*)$/);
  if (m) return { n: (m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]], rest: m[3] };
  m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) return { n: Number(m[1]), rest: m[2] };
  return null;
}

function scaleQty(qty, f) {
  const s = String(qty || '');
  const lead = leadingAmount(s);
  if (!lead) return s;
  const unit = lead.rest;
  const n = lead.n * f;
  const isMass = /^(g|kg|ml|l)\b/i.test(unit);
  const v = isMass ? (/^(kg|l)\b/i.test(unit) ? Math.round(n * 100) / 100 : roundGrams(n)) : (n >= 2 ? Math.round(n) : Math.max(0.25, Math.round(n * 4) / 4));
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
    const present = SLOTS.filter((s) => meals[s] && typeof meals[s] === 'object' && !Array.isArray(meals[s]));
    if (present.length < 3) return { ok: false, reason: `day_${i + 1}_missing_meals` };
    let fixed = {};
    for (const slot of present) {
      const m = meals[slot];
      const nums = {};
      for (const k of ['calories', 'protein', 'carbs', 'fat']) {
        nums[k] = strictNumber(m[k]);
        if (nums[k] === null || nums[k] < 0 || (k === 'calories' && nums[k] <= 0)) return { ok: false, reason: `day_${i + 1}_${slot}_bad_${k}` };
      }
      // The meal's own macros must back up its calories (4P + 4C + 9F, ±15%).
      const fromMacros = 4 * nums.protein + 4 * nums.carbs + 9 * nums.fat;
      if (Math.abs(fromMacros - nums.calories) > nums.calories * MACRO_TOLERANCE) return { ok: false, reason: 'meal_macros_mismatch' };
      fixed[slot] = { ...m, ...nums, ingredients: Array.isArray(m.ingredients) ? m.ingredients : [] };
    }
    const before = totalsOf(fixed).calories;
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
  // Only the fields the app shows; no AI price or budget figures pass through.
  const clean = { planName: String(plan.planName || '').slice(0, 120), summary: String(plan.summary || '').slice(0, 300), days: outDays };
  return { ok: true, scaledDays, plan: finishPlan(clean, { protein }) };
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

function withTimeout(promise, ms, controller) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve({ ok: false, error: 'timeout' });
    }, Math.max(0, ms));
  });
  return Promise.race([Promise.resolve(promise).catch((e) => ({ ok: false, error: e && e.message })), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * AI first, one retry if time allows, then the food-DB builder. Never throws
 * for an AI fault, and returns inside budgetMs (plus the instant builder).
 * callAi(attempt, signal) resolves to { ok, data, provider }.
 */
async function generatePlan(input, { callAi, budgetMs = 25000, attemptMs = 20000, minRetryMs = 8000, now = Date.now } = {}) {
  const started = now();
  const left = () => budgetMs - (now() - started);
  const attempts = [];
  for (let attempt = 1; attempt <= 2 && callAi; attempt += 1) {
    // Keep a small margin to build and send the response.
    const timeoutMs = Math.min(attemptMs, left() - Math.min(500, budgetMs * 0.1));
    if (timeoutMs <= 0 || (attempt > 1 && timeoutMs < minRetryMs)) break;
    // The signal lets the AI client drop the HTTP request when time is up.
    const controller = new AbortController();
    const r = await withTimeout(Promise.resolve().then(() => callAi(attempt, controller.signal)), timeoutMs, controller);
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
  const lead = leadingAmount(String(qty == null ? '' : qty).trim().toLowerCase());
  if (!lead) return null;
  const n = lead.n;
  const word = (lead.rest.match(/^([a-z]+)/) || [])[1] || '';
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
  const n = Math.round(amount * 4) / 4;
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
  const words = String(name).toLowerCase().replace(/\((?!(?:cooked|uncooked|raw|dry)\))[^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
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
      if (!byKey.has(key)) byKey.set(key, { name: String(ing.name).replace(/\s*\((?!(?:cooked|uncooked|raw|dry)\))[^)]*\)\s*/g, ' ').trim(), totals: new Map(), meals: 0, unparsed: 0 });
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
  PREP_MINS,
  TOLERANCE,
  SLOTS,
  TEMPLATES,
  buildPlan,
  normaliseAiPlan,
  everyDayOnTarget,
  generatePlan,
  withTimeout,
  aggregateShoppingList,
  normaliseDiet,
  parseQty,
  scaleQty,
  itemKey,
};
