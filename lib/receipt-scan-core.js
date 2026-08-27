'use strict';
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
  { kw: ['banana'], each: { protein: 1.3, carbs: 27, fat: 0.4, calories: 105 } },
  { kw: ['apple'], each: { protein: 0.5, carbs: 25, fat: 0.3, calories: 95 } },
  { kw: ['peanut butter', 'almond butter', 'nut butter'], per100g: { protein: 25, carbs: 20, fat: 50, calories: 588 } },
  { kw: ['olive oil', 'coconut oil', 'canola oil'], per100ml: { protein: 0, carbs: 0, fat: 100, calories: 884 } },
  { kw: ['bread', 'sourdough', 'multigrain'], per100g: { protein: 9, carbs: 44, fat: 3.5, calories: 246 } },
  { kw: ['pasta', 'penne', 'spaghetti', 'fettuccine'], per100g: { protein: 13, carbs: 71, fat: 1.5, calories: 352 } },
  { kw: ['cheese', 'cheddar', 'tasty'], per100g: { protein: 25, carbs: 0, fat: 34, calories: 402 } },
  { kw: ['milo'], per100g: { protein: 14, carbs: 66, fat: 4, calories: 362 } },
  { kw: ['almonds', 'cashews', 'mixed nuts', 'walnuts'], per100g: { protein: 20, carbs: 20, fat: 50, calories: 580 } },
];

function estimateNutrition(name, qty, unit) {
  const n = String(name || '').toLowerCase();
  const match = NUTRITION.find(e => e.kw.some(k => n.includes(k)));
  const base = match
    ? (match.per100g || match.per100ml || match.perServe || match.each)
    : { protein: 5, carbs: 15, fat: 5, calories: 120 };

  const amount = parseFloat(qty) || 1;
  const u = (unit || '').toLowerCase();
  let mult = 1;

  if (match && (match.per100g || match.per100ml)) {
    const grams = u.includes('kg') ? amount * 1000 : (u.includes('l') && !u.includes('ml') ? amount * 1000 : amount);
    mult = grams / 100;
  } else if (match && match.each) {
    mult = amount;
  } else if (match && match.perServe) {
    mult = Math.max(1, amount);
  }

  mult = Math.min(Math.max(mult, 0.1), 200);
  return {
    protein:  Math.round(base.protein  * mult),
    carbs:    Math.round(base.carbs    * mult),
    fat:      Math.round(base.fat      * mult),
    calories: Math.round(base.calories * mult),
  };
}

function grade(totals) {
  let score = 0;
  score += totals.protein >= 700 ? 40 : totals.protein >= 400 ? 25 : totals.protein >= 200 ? 10 : 0;
  score += (totals.calories >= 7000 && totals.calories <= 20000) ? 30 : totals.calories >= 4000 ? 15 : 0;
  const fr = (totals.fat * 9) / Math.max(totals.calories, 1);
  score += fr < 0.35 ? 30 : fr < 0.45 ? 15 : 0;
  if (score >= 85) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B+';
  if (score >= 40) return 'B';
  if (score >= 25) return 'C';
  return 'D';
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

function macroMatchScore(items, totals) {
  const cats = new Set(items.map(i => (i.category || 'other').toLowerCase()));
  let score = 30;
  if (totals.protein >= 400) score += 25; else if (totals.protein >= 200) score += 15; else if (totals.protein >= 100) score += 8;
  if (cats.has('vegetables')) score += 15;
  if (cats.has('fruit')) score += 10;
  if (cats.has('grains') || cats.has('pantry')) score += 8;
  if (cats.has('meat') || cats.has('dairy') || cats.has('supplement')) score += 8;
  if (items.length >= 6) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function pantryGapReport(items, totals) {
  const cats = new Set(items.map(i => (i.category || 'other').toLowerCase()));
  const gaps = [];
  if (totals.protein < 350) gaps.push({ gap: 'Protein coverage', finding: 'Add lean protein such as chicken breast, tuna, eggs, Greek yoghurt, tofu, or legumes.', severity: 'medium' });
  if (!cats.has('vegetables')) gaps.push({ gap: 'Veg/fibre', finding: 'Add 2–3 vegetables for fibre, micronutrients, and meal volume.', severity: 'medium' });
  if (!cats.has('fruit')) gaps.push({ gap: 'Fruit/snack option', finding: 'Add fruit or yoghurt for practical snacks before relying on packaged snacks.', severity: 'low' });
  if (!(cats.has('grains') || cats.has('pantry'))) gaps.push({ gap: 'Meal-prep carbs', finding: 'Add rice, oats, potatoes, wraps, or pasta to make meals easier to assemble.', severity: 'low' });
  if (!gaps.length) gaps.push({ gap: 'Balance check', finding: 'Basket covers protein, produce, and base carbs. Next shop can focus on variety and budget swaps.', severity: 'low' });
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

function enrichItems(rawItems, confidence) {
  return rawItems.map(item => ({
    ...item,
    confidence: item.confidence || confidence,
    nutrition: estimateNutrition(item.name, item.quantity, item.unit),
  }));
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

function parseVisionItems(text) {
  const match = String(text || '').match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in vision response');
  const rawItems = JSON.parse(match[0]);
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Vision returned no grocery items');
  }
  return rawItems;
}

function shareText(items, totals, g) {
  const top = items.slice(0, 3).map(i => i.name).join(', ');
  return `📸 Just scanned my weekly shop with FitMunch!\n\n🥩 ${totals.protein}g protein\n🔥 ${totals.calories.toLocaleString()} calories\n💪 Score: ${g}\n\nTop picks: ${top}\n\nRate my shop 👇 #FitMunch #MealPrep #FitnessAustralia #Macros #FitTok`;
}

function buildScanPayload(rawItems, opts = {}) {
  const guest = !!opts.guest;
  const scannerProvider = opts.scannerProvider || 'gemini';
  const items = enrichItems(rawItems, scannerProvider === 'fallback' ? 'sample-fallback' : 'ai-extracted');
  const weeklyTotals = totalsFrom(items);
  const g = grade(weeklyTotals);
  const score = macroMatchScore(items, weeklyTotals);
  const dinner = tonightDinner(items);
  const payload = {
    success: true,
    items,
    byCategory: groupByCategory(items),
    weeklyTotals,
    grade: g,
    haulScore: score,
    macroMatchScore: score,
    macroMatchScoreLabel: `${score}/100 estimated match`,
    pantryGapReport: pantryGapReport(items, weeklyTotals),
    partialMealPlan: partialMealPlan(items),
    tonightDinner: dinner,
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
  grade,
  fallbackReceiptItems,
  macroMatchScore,
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
