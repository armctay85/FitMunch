'use strict';
/**
 * Server-side allergen and diet check for every AI-written meal before it reaches a user or the database.
 *
 * Structured meals (AI meal plans, saved plans) are checked from their ingredient names plus the meal name,
 * using the same whole-word matcher as the builder (meal-plan-engine allergensOf) and a list of dishes and
 * sauces that hide allergens (pesto, satay, mayo, teriyaki...). A meal that breaks the user's filters, or
 * whose ingredient list is missing, empty or unreadable while the user has filters, is replaced with a
 * safe template meal for the same slot at close calories and protein, and the day totals are recomputed.
 *
 * Free text (Coach chat, insights, weekly review) is checked line by line: a line that names an excluded
 * ingredient or dish is removed, with a short note and a safe alternative. Conservative on purpose.
 */
const engine = require('./meal-plan-engine');

// Dishes, sauces and products whose allergens aren't in the name of an ingredient.
const HIDDEN = Object.freeze([
  ['nuts', /\b(?:pesto|satay|praline|marzipan|frangipane|nutella|gianduja|baklava|nougat|dukkah|romesco|korma|pad thai|trail mix|muesli bars?)\b/i],
  ['dairy', /\b(?:pesto|paneer|labneh|kefir|custard|ice cream|gelato|tzatziki|raita|bechamel|béchamel|alfredo|carbonara|quiche|queso|ghee|curd|skyr|quark|mascarpone|brie|camembert|gouda|halloumi|parmigiana|lassi|milkshake|latte|cappuccino|flat white|whipped)\b/i],
  ['eggs', /\b(?:mayo|mayonnaise|aioli|aïoli|meringue|custard|carbonara|quiche|frittata|omelette|omelet|hollandaise|bearnaise|béarnaise|brioche|pavlova|egg noodles?|fried rice|shakshuka|tamagoyaki|caesar)\b/i],
  ['soy', /\b(?:teriyaki|hoisin|edamame|natto|shoyu|kecap manis|soy|soya|tofu|tempeh|miso|tamari|vegan mince|tvp|textured vegetable protein|pad thai)\b/i],
  ['gluten', /\b(?:teriyaki|hoisin|kecap manis|pizza|burger|buns?|pastry|pastries|pie|crumbed|breaded|battered|schnitzel|crackers?|biscuits?|cookies?|cake|muffins?|pancakes?|waffles?|crumpets?|bagels?|croissants?|granola|muesli|cereal|weet-?bix|bran|semolina|bulgur|freekeh|farro|spelt|gnocchi|dumplings?|ramen|udon|lasagne|lasagna|gravy|beer|panko|pita|naan|roti|chapati|focaccia|ciabatta|toast|sandwich|wrap|burrito|quesadilla)\b/i],
  ['sesame', /\b(?:tahini|hummus|houmous|halva|halvah|baba ganoush|za'?atar|dukkah|gomashio|furikake)\b/i],
  ['shellfish', /\b(?:paella|prawn|seafood|surimi|bisque|scampi|marinara mix|tom yum)\b/i],
  ['fish', /\b(?:fish sauce|worcestershire|caesar|anchovy|anchovies|nuoc mam|bonito|dashi|sushi|sashimi|seafood|paella|tom yum)\b/i],
  ['meat', /\b(?:chorizo|pancetta|prosciutto|salami|pepperoni|gelatine|gelatin|lard|bone broth|chicken stock|beef stock|meatballs?|bolognese|burger|kebab|jerky|bacon|ham|sausages?|veal|venison|kangaroo|duck|goat|mince)\b/i],
]);

// Free-text allergies -> the flags they exclude. A fish allergy also excludes shellfish (prawns are tagged fish).
const ALLERGY_WORDS = Object.freeze([
  ['gluten', /gluten|wheat|coeliac|celiac|barley|rye|oat/i],
  ['dairy', /dairy|lactose|milk|casein|whey|cheese/i],
  ['nuts', /nut|peanut|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia/i],
  ['eggs', /egg/i],
  ['soy', /soy|soya|tofu/i],
  ['sesame', /sesame|tahini/i],
  ['shellfish', /shellfish|crustacean|prawn|shrimp|crab|lobster|mollus|oyster|mussel|scallop|squid/i],
  ['fish', /\bfish\b|seafood/i],
]);

const FLAG_WORDS = Object.freeze({
  gluten: 'gluten (wheat, oats, barley, rye, malt, soy sauce, bread, pasta, couscous)',
  dairy: 'dairy (milk, yoghurt, cheese, butter, cream, whey, casein)',
  nuts: 'nuts and peanuts (almond milk, nut butters, pesto, satay)',
  eggs: 'eggs (including mayo, aioli, custard, egg noodles)',
  soy: 'soy (soy sauce, tofu, tempeh, edamame, miso, soy milk)',
  sesame: 'sesame (sesame oil, tahini, hummus)',
  shellfish: 'shellfish (prawns, crab, lobster, mussels, squid)',
  fish: 'fish and seafood',
  meat: 'meat and poultry',
});

const FILTER_NAME = { nuts: 'nut free', eggs: 'egg free', meat: 'no meat', fish: 'no fish' };

const listOf = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch (_) { /* plain text */ } return v.split(/[,;]/); }
  return [];
};

/** Flags to exclude for a user's diet filters and free-text allergies. */
function excludedFlags({ dietary = [], allergies = [] } = {}) {
  const out = new Set();
  for (const d of engine.normaliseDiet(listOf(dietary))) for (const f of engine.DIET_EXCLUDES[d] || []) out.add(f);
  for (const a of listOf(allergies)) {
    const s = String(a || '').trim();
    if (!s) continue;
    for (const [flag, re] of ALLERGY_WORDS) if (re.test(s)) out.add(flag);
    if (out.has('fish')) out.add('shellfish');
  }
  return out;
}

/** Every flag a piece of text names: ingredient words (the builder's matcher) plus hidden-allergen dishes. */
function flagsInText(text) {
  // "egg-free", "nut free" name the filter, not the food; the rest of the phrase is still checked.
  const s = String(text == null ? '' : text).replace(/\b[a-z]+(?:[\s-]+free)\b/gi, ' ');
  const out = new Set(engine.allergensOf([[s]]));
  for (const [flag, re] of HIDDEN) if (re.test(s)) out.add(flag);
  return out;
}

/** Names of a meal's ingredients, or null if the list is missing, empty or unreadable. */
function ingredientNames(meal) {
  const ings = meal && meal.ingredients;
  if (!Array.isArray(ings) || !ings.length) return null;
  const names = [];
  for (const i of ings) {
    const n = typeof i === 'string' ? i : i && typeof i === 'object' ? (i.item ?? i.name ?? i.food) : null;
    if (typeof n !== 'string' || !n.trim()) return null;
    names.push(n);
  }
  return names;
}

// A builder template meal (same name, exactly its ingredients) is judged by its derived flags, so dish words
// in its name ("Lentil and tempeh bolognese") don't trip the hidden-allergen list.
const TEMPLATE_BY_NAME = new Map(engine.TEMPLATES.map((t) => [t.name, t]));
function templateFlags(meal, names) {
  const t = TEMPLATE_BY_NAME.get(meal.name);
  if (!t) return null;
  const want = t.items.map(([f]) => engine.displayName(f)).sort();
  const got = [...names].sort();
  return want.length === got.length && want.every((n, i) => n === got[i]) ? engine.flagsOf(t) : null;
}

/** Why a structured meal is unsafe for these excluded flags, or null when it's fine. */
function mealProblems(meal, excluded) {
  if (!excluded || !excluded.size) return null;
  if (!meal || typeof meal !== 'object') return ['unreadable meal'];
  const names = ingredientNames(meal);
  if (!names) return ['no readable ingredient list'];
  const known = templateFlags(meal, names);
  if (known) { const hit = known.filter((f) => excluded.has(f)); return hit.length ? hit : null; }
  const text = [meal.name, meal.title, meal.description, meal.notes, meal.instructions, ...names].filter((x) => typeof x === 'string').join(' \n ');
  const hit = [...flagsInText(text)].filter((f) => excluded.has(f));
  for (const n of names) for (const f of engine.allergensOf([[n]])) if (excluded.has(f) && !hit.includes(f)) hit.push(f);
  return hit.length ? hit : null;
}

const SLOT_SHARE = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

/**
 * Replace every unsafe meal in a plan ({ days: [{ meals: { slot: meal } }] }) with a safe template meal,
 * recompute each day's totals and the plan averages. Returns { plan, replaced, dropped }.
 */
function enforcePlan(plan, { dietary = [], allergies = [], calories, protein } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  if (!plan || !Array.isArray(plan.days) || !excluded.size) return { plan, replaced: [], dropped: [] };
  const replaced = []; const dropped = [];
  const days = plan.days.map((d, di) => {
    if (!d || typeof d !== 'object' || !d.meals || typeof d.meals !== 'object' || Array.isArray(d.meals)) {
      dropped.push({ day: di, slot: '*', reasons: ['unreadable day'] });
      return { ...(d && typeof d === 'object' ? d : {}), meals: {}, dailyTotals: engine.totalsOf({}) };
    }
    const meals = {};
    for (const [slot, meal] of Object.entries(d.meals)) {
      const problems = mealProblems(meal, excluded);
      if (!problems) { meals[slot] = meal; continue; }
      const kcal = Number(meal && meal.calories) > 0 ? Number(meal.calories) : (Number(calories) || 2000) * (SLOT_SHARE[slot] || 0.25);
      const prot = Number(meal && meal.protein) > 0 ? Number(meal.protein) : (Number(protein) || 0) * (SLOT_SHARE[slot] || 0.25);
      const safe = engine.SLOTS.includes(slot) ? engine.safeMealFor(slot, { kcal, protein: prot, excluded: [...excluded] }) : null;
      if (safe) { meals[slot] = { ...safe, replacedForFilters: true }; replaced.push({ day: di, slot, from: String((meal && meal.name) || '').slice(0, 80), reasons: problems }); }
      else dropped.push({ day: di, slot, reasons: problems });
    }
    return { ...d, meals, dailyTotals: engine.totalsOf(meals) };
  });
  let out = { ...plan, days };
  if (out.avgDailyCalories !== undefined || out.avgDailyProtein !== undefined) out = engine.finishPlan(out, { protein: plan.targetProtein ?? protein });
  if (replaced.length || dropped.length) {
    const note = `${replaced.length + dropped.length} meal${replaced.length + dropped.length === 1 ? '' : 's'} didn't fit your filters and ${replaced.length + dropped.length === 1 ? 'was' : 'were'} ${dropped.length ? 'replaced or removed' : 'replaced with a safe meal'}.`;
    out.notes = [...(Array.isArray(plan.notes) ? plan.notes : []), note];
  }
  return { plan: out, replaced, dropped };
}

/** Plain-English list for prompts: "Never use: nuts and peanuts (...); sesame (...)." */
function promptRules({ dietary = [], allergies = [] } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  const diet = engine.normaliseDiet(listOf(dietary));
  const allergyText = listOf(allergies).map((a) => String(a || '').trim()).filter(Boolean).map((a) => a.slice(0, 40)).slice(0, 10);
  if (!excluded.size && !diet.length && !allergyText.length) return '';
  const lines = [];
  if (diet.length) lines.push(`Dietary filters (must follow): ${diet.join(', ')}.`);
  if (allergyText.length) lines.push(`Allergies (must follow): ${allergyText.join(', ')}.`);
  if (excluded.size) lines.push(`Never include, even as a sauce, oil, milk, topping or hidden ingredient: ${[...excluded].map((f) => FLAG_WORDS[f] || f).join('; ')}.`);
  lines.push('List every ingredient, including sauces, oils and milks. If unsure an ingredient fits, leave it out.');
  return lines.join('\n');
}

/**
 * Check free text (chat replies, tips). Lines naming an excluded ingredient or dish are removed; if any are,
 * a short note and a safe alternative are appended. Returns { text, removed }.
 */
function enforceText(text, { dietary = [], allergies = [], slot = 'lunch', kcal = 500, protein = 30, alternative = true } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  const s = String(text == null ? '' : text);
  if (!excluded.size || !s) return { text: s, removed: [] };
  const removed = [];
  const parts = s.split(/(\n+)/);
  const kept = parts.map((part) => {
    if (/^\n+$/.test(part)) return part;
    // Within a line, drop only the sentences that name something excluded.
    const sentences = part.split(/(?<=[.!?])\s+/);
    const ok = sentences.filter((x) => { const bad = [...flagsInText(x)].filter((f) => excluded.has(f)); if (bad.length) removed.push(bad); return !bad.length; });
    return ok.join(' ');
  }).join('').replace(/\n{3,}/g, '\n\n').trim();
  if (!removed.length) return { text: s, removed };
  const flags = [...new Set(removed.flat())];
  const safe = alternative ? engine.safeMealFor(slot, { kcal, protein, excluded: [...excluded] }) : null;
  const alt = safe ? ` A safe option: ${safe.name} (${safe.ingredients.map((i) => i.item.replace(/, cooked$/, '').toLowerCase()).join(', ')}).` : '';
  const note = `I removed a suggestion that didn't fit your filters (${flags.map((f) => FILTER_NAME[f] || `${f} free`).join(', ')}).${alt}`;
  return { text: kept ? `${kept}\n\n${note}` : note, removed };
}

/** Apply enforceText to every string inside a JSON value (weekly review, workout plan). */
function enforceJsonText(value, filters) {
  let removed = 0;
  const walk = (v) => {
    if (typeof v === 'string') { const r = enforceText(v, { ...filters, alternative: false }); if (r.removed.length) removed += 1; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), removed };
}

/** The user's stored diet filters and allergies from their profile row (dietaryPreferences, allergies). */
function profileFilters(profile) {
  const p = profile || {};
  return { dietary: listOf(p.dietaryPreferences ?? p.dietary_preferences), allergies: listOf(p.allergies) };
}

/** Union of filters: profile plus whatever the request sent. */
function mergeFilters(...sets) {
  const dietary = []; const allergies = [];
  for (const f of sets) { if (!f) continue; dietary.push(...listOf(f.dietary)); allergies.push(...listOf(f.allergies)); }
  return { dietary: engine.normaliseDiet(dietary), allergies: [...new Set(allergies.map((a) => String(a || '').trim()).filter(Boolean))] };
}

module.exports = {
  HIDDEN, excludedFlags, flagsInText, ingredientNames, mealProblems, enforcePlan, enforceText, enforceJsonText,
  promptRules, profileFilters, mergeFilters,
};
