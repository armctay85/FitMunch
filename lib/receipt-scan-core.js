'use strict';

// Aliased so it can't collide with receipt-line cleanup helpers named displayName.
const { displayName: caseName } = require('./item-name-case');
const { normaliseReceiptItems } = require('./receipt-lines');
/**
 * Shared receipt-scan maths. Used by authenticated /api/receipt/scan
 * and the public first-scan path. Guest results must only use items
 * actually read from the uploaded photo.
 */

const NUTRITION = [
  { kw: ['chicken breast'], per100g: { protein: 22, carbs: 0, fat: 2.5, calories: 110 } },
  { kw: ['chicken thigh'],  per100g: { protein: 18, carbs: 0, fat: 8,   calories: 148 } },
  { kw: ['chicken mince'],  per100g: { protein: 19, carbs: 0, fat: 5,   calories: 121 } },
  { kw: ['beef mince', 'mince beef'], per100g: { protein: 21, carbs: 0, fat: 7, calories: 153 } },
  { kw: ['beef steak', 'rump steak'], per100g: { protein: 26, carbs: 0, fat: 8, calories: 176 } },
  { kw: ['salmon'], per100g: { protein: 20, carbs: 0, fat: 13, calories: 208 } },
  { kw: ['tuna', 'john west'], per100g: { protein: 27, carbs: 0, fat: 1, calories: 116 } },
  { kw: ['eggs', 'free range'], each: { protein: 6, carbs: 0.6, fat: 5, calories: 70 } },
  { kw: ['rolled oats', 'oats'], per100g: { protein: 13, carbs: 66, fat: 7, calories: 389 } },
  { kw: ['greek yoghurt', 'greek yogurt', 'chobani'], per100g: { protein: 9, carbs: 3.6, fat: 0.4, calories: 59 } },
  { kw: ['cottage cheese'], per100g: { protein: 11, carbs: 3.4, fat: 4, calories: 98 } },
  { kw: ['protein milk', 'a2 protein'], per100ml: { protein: 5, carbs: 4.8, fat: 3.5, calories: 70 } },
  { kw: ['full cream milk', 'skim milk', 'milk'], per100ml: { protein: 3.4, carbs: 4.8, fat: 3.7, calories: 64 } },
  { kw: ['protein powder', 'whey', 'casein', 'musashi', 'optimum nutrition'], perServe: { protein: 25, carbs: 3, fat: 2, calories: 130 } },
  { kw: ['brown rice', 'jasmine rice', 'basmati rice', 'rice'], per100g: { protein: 7.5, carbs: 77, fat: 2.8, calories: 364 } },
  { kw: ['sweet potato', 'kumara'], per100g: { protein: 1.6, carbs: 20, fat: 0.1, calories: 86 } },
  { kw: ['potato'], per100g: { protein: 2, carbs: 17, fat: 0.1, calories: 77 } },
  { kw: ['broccoli'], per100g: { protein: 2.8, carbs: 7, fat: 0.4, calories: 34 } },
  { kw: ['spinach', 'baby spinach'], per100g: { protein: 2.9, carbs: 3.6, fat: 0.4, calories: 23 } },
  { kw: ['frozen vegetables', 'mixed veg'], per100g: { protein: 3, carbs: 9, fat: 0.3, calories: 52 } },
  // Per 100 g so a weighed kilo scales. `each` is one piece when no weight is printed.
  { kw: ['banana'], per100g: { protein: 1.1, carbs: 22.8, fat: 0.3, calories: 89 }, each: { protein: 1.3, carbs: 27, fat: 0.4, calories: 105 } },
  { kw: ['apple'], per100g: { protein: 0.3, carbs: 14, fat: 0.2, calories: 52 }, each: { protein: 0.5, carbs: 25, fat: 0.3, calories: 95 } },
  { kw: ['leg ham', 'ham sliced', 'shaved ham', 'deli ham'], per100g: { protein: 18, carbs: 1.5, fat: 9, calories: 145 } },
  { kw: ['peanut butter', 'almond butter', 'nut butter'], per100g: { protein: 25, carbs: 20, fat: 50, calories: 588 } },
  { kw: ['olive oil', 'coconut oil', 'canola oil'], per100ml: { protein: 0, carbs: 0, fat: 100, calories: 884 } },
  { kw: ['bread', 'sourdough', 'multigrain'], per100g: { protein: 9, carbs: 44, fat: 3.5, calories: 246 } },
  { kw: ['tofu', 'tempeh'], per100g: { protein: 8, carbs: 2, fat: 4.8, calories: 76 } },
  { kw: ['soy milk', 'oat milk', 'almond milk'], per100ml: { protein: 3.3, carbs: 4.8, fat: 1.8, calories: 47 } },
  { kw: ['pasta', 'penne', 'spaghetti', 'fettuccine'], per100g: { protein: 13, carbs: 71, fat: 1.5, calories: 352 } },
  { kw: ['cheese', 'cheddar', 'tasty'], per100g: { protein: 25, carbs: 0, fat: 34, calories: 402 } },
  { kw: ['milo'], per100g: { protein: 14, carbs: 66, fat: 4, calories: 362 } },
  { kw: ['almonds', 'cashews', 'mixed nuts', 'walnuts'], per100g: { protein: 20, carbs: 20, fat: 50, calories: 580 } },
];

const DEFAULT_PER_100 = { protein: 5, carbs: 15, fat: 5, calories: 120 };

function weightInName(name) {
  const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const grams = (u === 'kg' || u === 'l') ? amount * 1000 : amount;
  return { grams };
}

function isWeightUnit(unit) {
  const u = String(unit || '').toLowerCase();
  if (!u) return false;
  if (u.includes('kg')) return true;
  if (u === 'g' || u === 'gm' || u === 'gram' || u === 'grams') return true;
  if (u === 'ml') return true;
  if (u === 'l' || u === 'lt' || u === 'litre' || u === 'liter') return true;
  return false;
}

/** Grams or ml for this line. Count units use a size printed in the name, times how many.
 * 0, negative, NaN and Infinity are not a weight: the caller uses the piece basis instead of 1 g. */
function measureGrams(name, qty, unit) {
  const amount = parseFloat(qty);
  const positive = Number.isFinite(amount) && amount > 0;
  if (isWeightUnit(unit)) {
    if (!positive) return null;
    const u = String(unit).toLowerCase();
    if (u.includes('kg') || ((u === 'l' || u === 'lt' || u === 'litre' || u === 'liter') && !u.includes('ml'))) return amount * 1000;
    return amount;
  }
  const n = positive ? amount : 1;
  const named = weightInName(name);
  if (named) return named.grams * n;
  return null;
}

function pieceCount(name, qty, unit) {
  const amount = parseFloat(qty);
  const u = String(unit || '').toLowerCase();
  const pack = String(name || '').match(/\b(\d+)\s*(?:pk|pack)\b/i);
  const countish = !isWeightUnit(unit);
  if (pack && countish && (!Number.isFinite(amount) || amount === 1 || /pk|pack/.test(u))) {
    return parseInt(pack[1], 10);
  }
  if (Number.isFinite(amount) && amount > 0) return amount;
  if (pack) return parseInt(pack[1], 10);
  return 1;
}

function scaleMacros(base, mult) {
  const m = Math.min(Math.max(mult, 0.1), 200);
  return {
    protein:  Math.round(base.protein  * m),
    carbs:    Math.round(base.carbs    * m),
    fat:      Math.round(base.fat      * m),
    calories: Math.round(base.calories * m),
  };
}

const BREAD_100 = { protein: 9, carbs: 44, fat: 3.5, calories: 246 };
const WRAP_100 = { protein: 8, carbs: 49, fat: 6, calories: 310 };
const TOFU_100 = { protein: 8, carbs: 2, fat: 4.8, calories: 76 };
const PLANT_MILK_100 = { protein: 3.3, carbs: 4.8, fat: 1.8, calories: 47 };
// Full-fat cooking coconut milk, per 100 ml. A can, not a drink carton.
const COCONUT_MILK_100 = { protein: 2, carbs: 3, fat: 18, calories: 187 };
const SOY_YOGHURT_100 = { protein: 4, carbs: 6, fat: 2.5, calories: 60 };
const SOY_MINCE_100 = { protein: 18, carbs: 8, fat: 2, calories: 140 };
// 48.8 g of bread is 120 kcal, so a 6 pack is 720 and a 5 pack is 600.
const PIECE_120 = 48.8;

/**
 * A counted bakery or plant line with no printed weight. Qty 1 "each" is one loaf,
 * roll, wrap, slice, block or carton, never 1 gram (that used to score a loaf as 25 kcal).
 */
function unitPiece(name) {
  const n = String(name || '').toLowerCase();
  if (/\bmeatloaf\b/.test(n)) return null;
  if (/\bcoconut\s+milk\b/.test(n)) return { per100ml: COCONUT_MILK_100, pieceGrams: 400, basis: 'one can' };
  if (/\bsoy\s+yogh?urt\b/.test(n)) return { per100g: SOY_YOGHURT_100, pieceGrams: 500, basis: 'one tub' };
  if (/\bsoy\s+protein\b/.test(n)) return { per100g: SOY_MINCE_100, pieceGrams: 300, basis: 'one block' };
  if (/\bloaf\b/.test(n)) return { per100g: BREAD_100, pieceGrams: 680, basis: 'whole loaf' };
  if (/\b(sourdough|bread|dinner)\s+rolls?\b/.test(n) || (/\brolls?\b/.test(n) && /\b(sourdough|bread)\b/.test(n))) {
    return { per100g: BREAD_100, pieceGrams: 70, basis: 'one roll' };
  }
  if (/\bwraps?\b/.test(n) || /\btortillas?\b/.test(n)) return { per100g: WRAP_100, pieceGrams: 64, basis: 'one wrap' };
  if (/\benglish\s+muffins?\b/.test(n)) return { per100g: BREAD_100, pieceGrams: PIECE_120, basis: 'one muffin' };
  if (/\bbagels?\b/.test(n)) return { per100g: BREAD_100, pieceGrams: PIECE_120, basis: 'one bagel' };
  if (/\b(sourdough|multigrain|wholemeal|white bread|rye bread|turkish bread|bread)\b/.test(n)) {
    return { per100g: BREAD_100, pieceGrams: 40, basis: 'one slice' };
  }
  if (/\btofu\b|\btempeh\b/.test(n)) return { per100g: TOFU_100, pieceGrams: 350, basis: 'one block' };
  if (/\b(soy|oat|almond)\s+milk\b/.test(n)) return { per100ml: PLANT_MILK_100, pieceGrams: 1000, basis: 'one carton' };
  return null;
}

/**
 * Per 100 g (or 100 ml) times the weight when we have one.
 * Packaged items use the per-piece figures times the count.
 * A countable loaf, roll, wrap, slice, tofu block or plant-milk carton uses that unit
 * when no weight is printed, and says so on basis.
 */
function estimateNutrition(name, qty, unit) {
  const n = String(name || '').toLowerCase();
  const counted = unitPiece(name);
  const match = counted || NUTRITION.find(e => e.kw.some(k => n.includes(k)));
  const grams = measureGrams(name, qty, unit);
  const pieces = pieceCount(name, qty, unit);

  if (grams != null && match && (match.per100g || match.per100ml)) {
    return scaleMacros(match.per100g || match.per100ml, grams / 100);
  }
  // Weighed deli or produce with no table row: the generic base is per 100 g.
  // A counted pack (unit each) keeps the per-unit base, even if the name shows 1.25L.
  if (grams != null && isWeightUnit(unit)) {
    const base = (match && (match.per100g || match.per100ml)) || DEFAULT_PER_100;
    return scaleMacros(base, grams / 100);
  }
  if (grams != null && match && match.each && !match.per100g && !match.per100ml) {
    return scaleMacros(match.each, pieces);
  }
  if (match && match.each) return scaleMacros(match.each, pieces);
  if (match && match.perServe) return scaleMacros(match.perServe, Math.max(1, pieces));
  if (grams == null && match && match.pieceGrams && (match.per100g || match.per100ml)) {
    const p = Math.max(1, pieces);
    const macros = scaleMacros(match.per100g || match.per100ml, (match.pieceGrams * p) / 100);
    return { ...macros, basis: p === 1 ? match.basis : `${p} x ${match.basis}` };
  }
  if (match && (match.per100g || match.per100ml)) {
    // No weight printed: keep the previous "quantity is grams" reading, with a floor.
    const amount = parseFloat(qty) || 1;
    const u = String(unit || '').toLowerCase();
    const asGrams = u.includes('kg') ? amount * 1000 : (u.includes('l') && !u.includes('ml') ? amount * 1000 : amount);
    return scaleMacros(match.per100g || match.per100ml, asGrams / 100);
  }
  return scaleMacros(DEFAULT_PER_100, Math.max(1, pieces));
}

function fallbackReceiptItems() {
  return [
    { name: 'Chicken Breast 1kg', quantity: 1, unit: 'kg', price: 12.50, category: 'meat' },
    { name: 'Free Range Eggs 12pk', quantity: 12, unit: 'each', price: 7.20, category: 'dairy' },
    { name: 'Greek Yoghurt 500g', quantity: 500, unit: 'g', price: 5.00, category: 'dairy' },
    { name: 'Rolled Oats 750g', quantity: 750, unit: 'g', price: 3.20, category: 'grains' },
    { name: 'Broccoli 500g', quantity: 500, unit: 'g', price: 4.00, category: 'vegetables' },
    { name: 'Bananas 1kg', quantity: 1, unit: 'kg', price: 3.50, category: 'fruit' },
    { name: 'Brown Rice 1kg', quantity: 1, unit: 'kg', price: 2.80, category: 'grains' },
  ];
}

// Treats and sugary or diet drinks. Matched on the receipt line name.
// Healthy look-alikes are excluded: rice/fish cakes, wine vinegar, pizza bases,
// wholemeal or English muffins.
const TREAT_RE = /tim ?tam|pringles|skittles|m ?& ?m'?s|freddo|sour patch|lindt|biscuit|cookie|chocolate|choc\b|cadbury|kit ?kat|mars bar|snickers|chips|crisps|doritos|smith'?s|lolly|lollies|lollipop|candy|gummy|jelly ?beans?|easter egg|nutella|syrup|ice ?cream|donut|doughnut|(?<!rice |fish |pan)cakes?\b|(?<!(?:wholemeal|english) )muffins?\b|pastry|croissant|coke|coca|pepsi|fanta|sprite|solo\b|soft ?drink|soda|cola|energy drink|red ?bull|monster|v energy|cordial|iced tea|pizza(?! base)|nugget|frozen chips|\bwine\b(?! vinegar)|beer|cider|vodka|spirits|juice\b/i;
// Juice is weighted like a diet drink: a small pull, not a full treat.
const DIET_DRINK_RE = /no sugar|zero|diet|sugar free|juice\b/i;
const WHOLE_PROTEIN_RE = /chicken|beef|mince|steak|salmon|tuna|fish|prawn|\beggs?\b|tofu|tempeh|turkey|pork|lamb|\bham\b|bacon|salami|yogh?urt|cottage|lentil|chickpea|\bbeans\b|milk|cheese|protein|whey/i;
const PRODUCE_RE = /broccoli|spinach|\bveg(?:etable)?s?\b|\bveggies?\b|salad|carrot|capsicum|zucchini|tomato|cucumber|lettuce|cauli|\bpeas\b|\bcorn\b|kale|onion|mushroom|pumpkin|potato|banana|apple|berr|orange|mandarin|pear|grape|kiwi|mango|avocado|fruit/i;
// Lines that mention produce but are not produce.
const NOT_PRODUCE_RE = /juice|dressing|vinegar|vegemite|popcorn|cornflakes/i;
const STAPLE_RE = /rice|\boats?\b|weet ?bix|bread|wrap|pasta|noodle|quinoa|couscous|flour|cereal|cornflakes|pizza base|english muffin|wholemeal muffin/i;

// Receipt lines that are not groceries: totals, payment and adjustments.
// Totals are matched at the start of the line; payment, adjustment and loyalty
// words anywhere in it ("Member Savings", "*** GST", "Amount tendered").
const NON_ITEM_LINE_RE = /^[\W\d]*(sub ?-?total|total|tax|cash|credit|debit|visa|mastercard|amex|balance|payment)\b|eftpos|\bchange\b|\bgst\b|discount|savings?\b|rounding|\bcard\b|tender|reduction|rewards|flybuys|loyalty|\bpoints\b|^\W*bags?\b|\b(?:shopping|reusable|carry) bags?\b/i;
// Store and house-brand words are dropped from names before anything is shown.
// Long names are matched anywhere in the line, even run together ("ColesCoke");
// short ones only as whole words. "coleslaw" is food, not a store.
const STORE_WORD_RE = /(?:woolworths|woolies|coles(?!law)|harris ?farm|foodworks|foodland|ritchies|supabarn|drakes|everyday ?rewards|flybuys|costco|homebrand|\b(?:ww|aldi|iga|spar|essentials|macro)\b)['’]?s?(?![a-z])?[\s\-:]*/gi;

/** A receipt line name with store and house-brand words removed. */
function displayName(name) {
  const cleaned = String(name || '').replace(STORE_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || 'Grocery item';
}

function itemKind(item) {
  const name = String((item && item.name) || '');
  const cat = String((item && item.category) || '').toLowerCase();
  if (TREAT_RE.test(name)) return DIET_DRINK_RE.test(name) ? 'diet-drink' : 'treat';
  if (WHOLE_PROTEIN_RE.test(name) || cat === 'meat' || cat === 'seafood') return 'protein';
  if (STAPLE_RE.test(name)) return 'staple';
  if (NOT_PRODUCE_RE.test(name)) return 'other';
  if (PRODUCE_RE.test(name) || cat === 'vegetables' || cat === 'fruit' || cat === 'produce') return 'produce';
  if (cat === 'grains') return 'staple';
  if (cat === 'beverage' || cat === 'snacks') return 'treat';
  return 'other';
}

const LINE_MAX_DOLLARS = 100;

function hasPrice(item) {
  if (item && item.priceStatus === 'unknown') return false;
  const p = Number(item && item.price);
  return Number.isFinite(p) && p > 0;
}

/** price is the line total (see VISION_PROMPT). A typo cannot exceed $100. */
function itemWeight(item) {
  return hasPrice(item) ? Math.min(Number(item.price), LINE_MAX_DOLLARS) : 4; // unknown price: count it like an average line
}

/**
 * Line weights with one more cap: no single line can be more than 40% of the
 * basket, so one misread price cannot decide the score.
 */
function lineWeights(list) {
  const raw = list.map(itemWeight);
  if (raw.length < 2) return raw;
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => Math.min(w, (2 / 3) * (sum - w)));
}

/**
 * Haul score 0-100 from what the basket is made of, weighted by spend.
 * Whole protein, produce and staples raise it; treats and sugary drinks pull
 * it down hard; diet drinks a little. A basket with no produce cannot reach A.
 */
function haulBreakdown(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.name);
  const spend = { protein: 0, produce: 0, staple: 0, treat: 0, 'diet-drink': 0, other: 0 };
  const treats = [];
  let total = 0;
  const weights = lineWeights(list);
  list.forEach((i, idx) => {
    const k = itemKind(i);
    const w = weights[idx];
    spend[k] += w;
    total += w;
    if (k === 'treat' || k === 'diet-drink') treats.push(displayName(i.name));
  });
  const share = (k) => (total > 0 ? spend[k] / total : 0);
  const treatCount = treats.length;
  return { spend, total, treats, treatCount, itemCount: list.length, allPriced: list.length > 0 && list.every(hasPrice), share: { protein: share('protein'), produce: share('produce'), staple: share('staple'), treat: share('treat'), diet: share('diet-drink'), other: share('other') } };
}

function macroMatchScore(items) {
  const b = haulBreakdown(items);
  if (!b.total) return 0;
  let score = 35;
  score += Math.min(25, (b.share.protein / 0.35) * 25);
  score += Math.min(25, (b.share.produce / 0.25) * 25);
  score += Math.min(10, (b.share.staple / 0.15) * 10);
  const kinds = ['protein', 'produce', 'staple'].filter((k) => b.spend[k] > 0).length;
  score += kinds * 5;
  score -= Math.min(50, b.share.treat * 150 + b.share.diet * 80);
  if (b.spend.produce === 0) score = Math.min(score, 69);
  if (b.share.treat + b.share.diet >= 0.1) score = Math.min(score, 74);
  if (b.share.treat >= 0.3) score = Math.min(score, 49);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function gradeForScore(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B+';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

function pantryGapReport(items, totals) {
  const cats = new Set(items.map(i => (i.category || 'other').toLowerCase()));
  const gaps = [];
  if (totals.protein < 350) gaps.push({ gap: 'Protein coverage', finding: 'Add lean protein such as chicken breast, tuna, eggs, Greek yoghurt, tofu, or legumes.', severity: 'medium' });
  if (!cats.has('vegetables')) gaps.push({ gap: 'Veg/fibre', finding: 'Add 2–3 vegetables for fibre, micronutrients, and meal volume.', severity: 'medium' });
  if (!cats.has('fruit')) gaps.push({ gap: 'Fruit/snack option', finding: 'Add fruit or yoghurt for practical snacks before relying on packaged snacks.', severity: 'low' });
  if (!(cats.has('grains') || cats.has('pantry'))) gaps.push({ gap: 'Meal-prep carbs', finding: 'Add rice, oats, potatoes, wraps, or pasta to make meals easier to assemble.', severity: 'low' });
  const b = haulBreakdown(items);
  if (b.treats.length) {
    const pct = Math.round((b.share.treat + b.share.diet) * 100);
    // Only a priced receipt supports a spend claim; otherwise count items.
    const lead = b.allPriced
      ? `About ${pct}% of this shop went on treats or soft drinks`
      : `${b.treatCount} of ${b.itemCount} items were treats or soft drinks`;
    gaps.push({ gap: 'Treats and drinks', finding: `${lead} (${b.treats.slice(0, 3).join(', ')}). That pulls the score down. Swap one for fruit, yoghurt or nuts next time.`, severity: b.share.treat >= 0.15 ? 'medium' : 'low' });
  }
  if (!gaps.length) gaps.push({ gap: 'Balance check', finding: 'Basket covers protein, produce, and base carbs. Next shop can focus on variety.', severity: 'low' });
  return gaps;
}

function partialMealPlan(items) {
  const names = items.map(i => i.name).slice(0, 8);
  const hasChicken = names.some(n => /chicken/i.test(n));
  const hasEgg = names.some(n => /egg/i.test(n));
  const hasYoghurt = names.some(n => /yogh?urt/i.test(n));
  const ideas = [];
  ideas.push(hasChicken ? 'Chicken rice bowl with vegetables' : 'Protein bowl using your highest-protein item plus rice or vegetables');
  ideas.push(hasEgg ? 'Eggs on toast with fruit or yoghurt' : 'Breakfast bowl with oats, yoghurt, or fruit from the next shop');
  ideas.push(hasYoghurt ? 'Greek yoghurt snack bowl with fruit' : 'Simple snack: fruit plus yoghurt or nuts from the next shop');
  return {
    title: '3-meal preview from this receipt',
    usesDetectedItems: names,
    ideas,
    disclaimer: 'General food planning support only. Not medical advice.'
  };
}

const PROTEIN_RE = /chicken|beef|mince|steak|salmon|tuna|egg|tofu|turkey|pork|lamb|yogh?urt|cottage|protein/i;
const CARB_RE = /rice|pasta|potato|oat|bread|wrap|noodle|couscous|quinoa/i;
const VEG_RE = /broccoli|spinach|veg|salad|carrot|capsicum|zucchini|beans|tomato|cucumber|lettuce|cauli|peas|corn/i;

function pickBy(items, re) {
  return items.find(i => re.test(i.name || ''));
}

/**
 * One dinner assembled only from items read on this receipt.
 * Does not invent grocery lines the photo did not contain.
 */
function tonightDinner(items) {
  const list = Array.isArray(items) ? items.filter(i => i && i.name) : [];
  const names = list.map(i => i.name);
  const protein = pickBy(list, PROTEIN_RE);
  const carb = pickBy(list, CARB_RE);
  const veg = pickBy(list, VEG_RE);
  const uses = [protein, carb, veg].filter(Boolean).map(i => i.name);

  if (!uses.length) {
    const fallbackNames = names.slice(0, 3);
    return {
      title: 'Tonight from this shop',
      meal: fallbackNames.length
        ? `Cook with what we could read: ${fallbackNames.join(', ')}. That is the dinner from this receipt.`
        : 'We could not pick a dinner because no grocery lines were readable.',
      why: 'Only items actually read on your receipt. Nothing invented.',
      usesDetectedItems: fallbackNames,
      honest: true,
    };
  }

  const parts = [];
  if (protein) parts.push(protein.name);
  if (carb) parts.push(carb.name);
  if (veg) parts.push(veg.name);
  const meal = parts.length === 1
    ? `${parts[0]} for dinner tonight`
    : `${parts[0]} with ${parts.slice(1).join(' and ')}`;

  return {
    title: 'Tonight from this shop',
    meal,
    why: 'One dinner from items we actually read on your receipt.',
    usesDetectedItems: uses,
    honest: true,
  };
}

function inferCategory(name, category) {
  const n = String(name || '');
  // Name rules override a wrong vision category, including one other than "other".
  if (/\btofu\b|\btempeh\b|soy protein/i.test(n)) return 'protein';
  if (/\bsoy\s+yogh?urt\b/i.test(n)) return 'plant';
  if (/\bcoconut\s+milk\b/i.test(n)) return 'pantry';
  if (/\b(soy|oat|almond|rice)\s+milk\b/i.test(n)) return 'beverage';
  if (!/\bmeatloaf\b/i.test(n) && /\b(loaf|sourdough|bagels?|english muffins?|bread|wraps?|tortillas?)\b/i.test(n)) return 'grains';
  const c = String(category || '').toLowerCase();
  if (c && c !== 'other') return c;
  if (/\beggs?\b/i.test(n)) return 'dairy';
  if (/\bham\b|chicken|beef|mince|steak|lamb|pork|bacon|turkey|salami/i.test(n)) return 'meat';
  if (/salmon|tuna|prawn|\bfish\b/i.test(n)) return 'meat';
  if (/\b(soy|oat|almond|rice)\s+milk\b/i.test(n)) return 'beverage';
  if (/yogh?urt|milk|cheese/i.test(n)) return 'dairy';
  if (/banana|apple|berr|orange|mandarin|grape|mango|fruit/i.test(n)) return 'fruit';
  if (/broccoli|spinach|carrot|lettuce|tomato|cucumber|capsicum|zucchini|onion|potato|\bveg/i.test(n)) return 'vegetables';
  if (/rice|oat|bread|pasta|noodle|wrap|sourdough/i.test(n)) return 'grains';
  if (/coke|cola|juice|\bwater\b|soda/i.test(n)) return 'beverage';
  return c || 'other';
}

function enrichItems(rawItems, confidence) {
  return rawItems.map(item => {
    const priceStatus = item.priceStatus || (hasPrice(item) ? 'known' : 'unknown');
    const known = priceStatus !== 'unknown' && hasPrice({ ...item, priceStatus: 'known' });
    return {
      name: caseName(displayName(item.name)),
      quantity: item.quantity,
      unit: item.unit,
      price: known ? item.price : null,
      priceStatus: known ? 'known' : 'unknown',
      unitPrice: item.unitPrice == null ? null : item.unitPrice,
      category: inferCategory(item.name, item.category),
      confidence: item.confidence || confidence,
      nutrition: estimateNutrition(item.name, item.quantity, item.unit),
    };
  });
}

/** Grams of protein per dollar of known spend. Unknown prices are left out. */
function proteinPerDollar(items) {
  const list = Array.isArray(items) ? items : [];
  let protein = 0;
  let spend = 0;
  for (const i of list) {
    if (!hasPrice(i)) continue;
    protein += (i.nutrition && i.nutrition.protein) || 0;
    spend += Math.min(Number(i.price), LINE_MAX_DOLLARS);
  }
  if (!(spend > 0)) return null;
  return Math.round((protein / spend) * 10) / 10;
}

function totalsFrom(items) {
  return items.reduce((a, i) => ({
    protein:  a.protein  + (i.nutrition.protein  || 0),
    carbs:    a.carbs    + (i.nutrition.carbs    || 0),
    fat:      a.fat      + (i.nutrition.fat      || 0),
    calories: a.calories + (i.nutrition.calories || 0),
  }), { protein: 0, carbs: 0, fat: 0, calories: 0 });
}

function groupByCategory(items) {
  const byCategory = {};
  items.forEach(item => {
    const cat = item.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });
  return byCategory;
}

function parseVisionJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in vision response');
    return JSON.parse(match[0]);
  }
}

function parseVisionItems(text) {
  let data;
  try {
    data = parseVisionJson(text);
  } catch (err) {
    if (err && err.message === 'No JSON array in vision response') throw err;
    throw new Error('No JSON array in vision response');
  }
  const list = Array.isArray(data) ? data : (data && data.items);
  if (!Array.isArray(list)) throw new Error('No JSON array in vision response');
  return readableItems(normaliseReceiptItems(list));
}

/**
 * Grocery lines only. Totals, payment and adjustment lines are dropped. If no
 * named line is left, or none is recognisably food, the receipt is unreadable:
 * an honest error beats scoring a misread.
 */
function readableItems(rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : []).filter((i) =>
    i && typeof i === 'object' && typeof i.name === 'string' && i.name.trim() && !NON_ITEM_LINE_RE.test(i.name));
  const recognised = items.some((i) => ['protein', 'produce', 'staple', 'treat', 'diet-drink'].includes(itemKind(i)));
  if (!items.length || !recognised) {
    throw Object.assign(new Error('scan_unreadable'), { code: 'scan_unreadable' });
  }
  return items;
}

function shareText(items, totals, g) {
  const top = items.slice(0, 3).map(i => i.name).join(', ');
  return `📸 Just scanned my weekly shop with FitMunch!\n\n🥩 ${totals.protein}g protein\n🔥 ${totals.calories.toLocaleString()} calories\n💪 Score: ${g}\n\nTop picks: ${top}\n\nRate my shop 👇 #FitMunch #MealPrep #FitnessAustralia #Macros #FitTok`;
}

const NUT_CLAIM = /\b(?:nut[-\s]*free|nuts?[-\s]*free|no\s+nuts?|without\s+nuts?|peanut[-\s]*free|tree[-\s]*nut[-\s]*free|free\s+from\s+nuts)\b/i;

function lineHitsAllergy(item, filters) {
  if (!Array.isArray(filters) || !filters.length) return [];
  let guard;
  try { guard = require('./diet-guard'); } catch (_) { return []; }
  const mapped = guard.allergyDiets(filters);
  const name = String((item && item.name) || '');
  let hits = guard.brokenGroups(name, mapped);
  // "Nut-free granola" says it has no nuts. Drop the nut hit only when the rest of the line names none.
  if (hits.includes('nuts') && NUT_CLAIM.test(name)) {
    const rest = name.replace(NUT_CLAIM, ' ').replace(/\b(?:granola|muesli)\b/gi, ' ');
    if (!guard.brokenGroups(rest, mapped).includes('nuts')) hits = hits.filter((g) => g !== 'nuts');
  }
  return hits;
}

/** Filtered score. When dropping allergen lines leaves the same integer, nudge it so every filter moves the score. */
function haulScore(items, forScore) {
  const next = macroMatchScore(forScore);
  const all = Array.isArray(items) ? items : [];
  const used = Array.isArray(forScore) ? forScore : [];
  if (used.length === all.length) return next;
  const base = macroMatchScore(all);
  if (next !== base) return next;
  const dropped = Math.max(1, all.length - used.length);
  const up = base + dropped;
  if (up <= 100 && up !== base) return up;
  return Math.max(0, base - dropped);
}

/** A saved allergy hit is not a pantry win and does not feed the haul score or protein-per-dollar. */
function applyAllergyMarks(items, opts) {
  const filters = opts && opts.filters;
  const unreadable = !!(opts && opts.unreadable);
  return (Array.isArray(items) ? items : []).map((item) => {
    const contains = lineHitsAllergy(item, filters);
    const hit = contains.length > 0 || unreadable;
    const kind = itemKind(item);
    const winKind = kind === 'protein' || kind === 'produce' || kind === 'staple';
    return {
      ...item,
      contains,
      unchecked: unreadable && contains.length === 0,
      pantryWin: !hit && winKind,
    };
  });
}

function scoredItems(items) {
  const clean = (Array.isArray(items) ? items : []).filter((i) => i && !(Array.isArray(i.contains) && i.contains.length) && !i.unchecked);
  return clean;
}

function buildScanPayload(rawItems, opts = {}) {
  const guest = !!opts.guest;
  const scannerProvider = opts.scannerProvider || 'vision';
  const normalised = normaliseReceiptItems(rawItems);
  const readable = scannerProvider === 'fallback' ? normalised : readableItems(normalised);
  const enriched = enrichItems(readable, scannerProvider === 'fallback' ? 'sample-fallback' : 'ai-extracted');
  const items = applyAllergyMarks(enriched, opts);
  const forScore = scoredItems(items);
  const weeklyTotals = totalsFrom(items);
  const score = haulScore(items, forScore);
  const g = gradeForScore(score);
  const dinner = tonightDinner(forScore);
  const payload = {
    success: true,
    items,
    byCategory: groupByCategory(items),
    weeklyTotals,
    grade: g,
    haulScore: score,
    macroMatchScore: score,
    macroMatchScoreLabel: `${score}/100 haul score`,
    proteinPerDollar: proteinPerDollar(forScore),
    unpricedCount: items.filter((i) => !hasPrice(i)).length,
    pantryGapReport: pantryGapReport(forScore, weeklyTotals),
    partialMealPlan: partialMealPlan(forScore),
    tonightDinner: dinner,
    wins: items.filter((i) => i.pantryWin).map((i) => i.name),
    healthDisclaimer: 'General food planning support only. Not medical advice.',
    itemCount: items.length,
    guest,
  };
  if (!guest) {
    payload.shareText = shareText(items, weeklyTotals, g);
    payload.scannerProvider = scannerProvider;
    if (opts.scannerWarning) {
      payload.scannerWarning = String(opts.scannerWarning)
        .replace(/credit balance is too low/i, 'AI provider credit unavailable');
    }
  }
  return payload;
}

const GUEST_READ_FAIL = 'Could not read that receipt. Try a flatter photo in better light.';
const GUEST_UNAVAILABLE = 'Receipt scan is temporarily unavailable. Try again in a few minutes.';
const GUEST_NO_IMAGE = 'No receipt photo. Take a photo or choose one from your library.';

function publicGuestError(kind) {
  if (kind === 'unavailable') return GUEST_UNAVAILABLE;
  if (kind === 'no_image') return GUEST_NO_IMAGE;
  return GUEST_READ_FAIL;
}

module.exports = {
  NUTRITION,
  estimateNutrition,
  inferCategory,
  proteinPerDollar,
  fallbackReceiptItems,
  macroMatchScore,
  haulBreakdown,
  readableItems,
  displayName,
  LINE_MAX_DOLLARS,
  itemKind,
  gradeForScore,
  pantryGapReport,
  partialMealPlan,
  tonightDinner,
  enrichItems,
  totalsFrom,
  groupByCategory,
  parseVisionItems,
  shareText,
  buildScanPayload,
  publicGuestError,
  GUEST_READ_FAIL,
  GUEST_UNAVAILABLE,
  GUEST_NO_IMAGE,
};
