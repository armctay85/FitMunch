'use strict';
/**
 * Stopgap for AI meals and diet filters (#127a).
 *
 * A user's filters are their SAVED diet and allergy filters (user profile)
 * plus anything sent with the request. Saved filters are only ever read here,
 * never written. Any user with any filter gets meals from the ingredient-checked
 * template builder only, never AI-written meals.
 */
const planEngine = require('./meal-plan-engine');

const SAFE_NOTICE = "To keep your allergies and diet safe, I've built these meals from FitMunch's checked recipes.";
const PLAN_NOTICE = "To keep your allergies and diet safe, this plan was built from FitMunch's checked recipes. It didn't use an AI credit.";

/** Free-text allergy -> the builder's diet filter. Unrecognised text is kept as-is (still a filter). */
const ALLERGY_TO_DIET = [
  [/peanut|tree ?nut|\bnuts?\b|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia/i, 'nut free'],
  [/gluten|wheat|coeliac|celiac|barley|\brye\b|\boats?\b/i, 'gluten free'],
  [/dairy|milk|lactose|casein|whey|cheese/i, 'dairy free'],
  [/\beggs?\b/i, 'egg free'],
  [/\bsoy|soya/i, 'soy free'],
  [/sesame|tahini/i, 'sesame free'],
  [/shellfish|crustacean|prawn|shrimp|crab|lobster|mollus/i, 'shellfish free'],
  [/\bfish\b|seafood|salmon|tuna/i, 'fish free'],
];

const EMPTY = new Set(['', 'null', 'undefined', 'none', 'false', '[]', '{}']);
/** Strings from an array, a JSON or comma string, or an object's truthy keys ({ peanut: true }). Drops null-ish values. */
function listOf(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { x = x.split(','); } }
  if (typeof x === 'string') x = [x];
  if (x && typeof x === 'object' && !Array.isArray(x)) x = Object.keys(x).filter((k) => x[k]);
  return Array.isArray(x)
    ? x.filter((s) => typeof s === 'string' || typeof s === 'number').map((s) => String(s).trim()).filter((s) => !EMPTY.has(s.toLowerCase()))
    : [];
}

function allergyDiets(allergies) {
  const out = [];
  for (const a of listOf(allergies)) {
    const hits = ALLERGY_TO_DIET.filter(([re]) => re.test(a)).map(([, d]) => d);
    out.push(...(hits.length ? hits : [a]));
  }
  return out;
}

/** Saved profile filters, normalised (diet + allergies). */
function savedFilters(profile) {
  const p = profile || {};
  return planEngine.normaliseDiet([...listOf(p.dietaryPreferences), ...allergyDiets(p.allergies)]);
}

/** Saved filters plus sent ones. Never smaller than the saved list. */
function combineFilters(profile, sent) {
  return planEngine.normaliseDiet([...savedFilters(profile), ...listOf(sent).flatMap((s) => allergyDiets([s]))]);
}

/** A fixed tip for filtered users: no foods named. */
const SAFE_TIP = 'Your meals are checked against your allergies and diet. Open Meal Plans for a week built from FitMunch\'s checked recipes.';

/** Weekly review for a filtered user: drop lines that name a food they can't have. */
function safeReview(review, filters) {
  const r = review && typeof review === 'object' ? { ...review } : {};
  const ok = (x) => typeof x === 'string' && !textBreaksFilters(x, filters);
  if (typeof r.headline === 'string' && !ok(r.headline)) r.headline = 'Here is your week at a glance.';
  for (const k of ['wins', 'focus']) r[k] = (Array.isArray(r[k]) ? r[k] : []).filter(ok);
  if (!r.focus.length) r.focus = [SAFE_TIP];
  for (const k of Object.keys(r)) if (!['headline', 'wins', 'focus', 'score'].includes(k) && !ok(JSON.stringify(r[k]))) delete r[k];
  return r;
}

const lexicon = require('./food-lexicon-127a');

// Non-food phrases that share a word with a food ("foam roll", "go nuts"). Removed before the check.
const IDIOMS = /\b(?:foam[- ]roll(?:er|ing)?|roll(?:ing)? (?:out|up|over|it|your|the|back|down)|wrap(?:ping)? (?:up|it)|that'?s a wrap|go(?:ing)? nuts|nuts about|bun up|hair bun|man bun|pie chart|egg[- ]?timer|stomach bug|bug bite|fish(?:ing)? for|sun ?cream|sunscreen(?: cream)?|cream of the crop|break bread|bread and butter|butter(?:ed)? up|nutshell|toast to)\b/gi;

const DIET_GROUPS = {
  vegetarian: ['meat', 'fish', 'shellfish'],
  vegan: ['meat', 'fish', 'shellfish', 'dairy', 'eggs'],
  pescatarian: ['meat'],
  'gluten free': ['gluten'],
  'dairy free': ['dairy'],
  'nut free': ['nuts'],
  'egg free': ['eggs'],
  'soy free': ['soy'],
  'sesame free': ['sesame'],
  'shellfish free': ['shellfish'],
  'fish free': ['fish', 'shellfish'],
};
/** The food groups (gluten, nuts, ...) a text names that the filters exclude. */
function brokenGroups(text, filters) {
  const groups = new Set(planEngine.normaliseDiet(filters).flatMap((d) => DIET_GROUPS[d] || []));
  if (!groups.size) return [];
  const { flags } = lexicon.scan(String(text == null ? '' : text).replace(IDIOMS, ' '));
  return [...flags].filter((f) => groups.has(f));
}
/** True when the text names a food the filters exclude. */
function textBreaksFilters(text, filters) {
  return brokenGroups(text, filters).length > 0;
}

// For a filtered user, every Coach question counts as food UNLESS it is clearly about training, sleep or the account.
const NON_FOOD = /\b(?:workouts?|training|train|exercises?|sets?|reps?|squats?|deadlifts?|bench|press|lunges?|push ?ups?|pull ?ups?|plank|gym|lift(?:ing)?|run(?:ning)?|jog(?:ging)?|cardio|hiit|stretch(?:ing|es)?|warm ?ups?|cool ?downs?|mobility|yoga|pilates|injur(?:y|ies)|sore(?:ness)?|knee|back pain|form|steps|walk(?:ing)?|cycling|swim(?:ming)?|sleep(?:ing)?|rest days?|recovery|password|account|login|log in|subscription|billing|cancel|upgrade|email|privacy|app|streak|weigh[- ]?ins?|scale|measurements?)\b/i;
const FOOD_HINT = /\b(?:eat|eating|ate|food|foods|meal|meals|recipe|recipes|breakfast|brekkie|brekky|lunch|dinner|tea|supper|snack|snacks|dessert|desserts|sweet|treat|smoothie|shake|drink|cook|cooking|bake|baking|make|have|hungry|craving|cravings|menu|dish|dishes|ingredient|ingredients|plan|plans|diet|macro|macros|protein|carbs?|fat|calorie|calories|kcal|shopping|grocer(?:y|ies)|tonight|fuel|pre[- ]?workout|post[- ]?workout)\b/i;
function isFoodTalk(intent, text) {
  const t = String(text || '');
  if (intent === 'nutrition') return true;
  if (FOOD_HINT.test(t) || lexicon.scan(t.replace(IDIOMS, ' ')).flags.size) return true;
  return !NON_FOOD.test(t);
}

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
/** A Coach reply built from the template builder only. */
function safeCoachReply({ filters, calories, protein }) {
  const kcal = Number(calories) >= 1200 && Number(calories) <= 4500 ? Math.round(Number(calories)) : 2000;
  const prot = Number(protein) >= 30 && Number(protein) <= 350 ? Math.round(Number(protein)) : 120;
  const plan = planEngine.buildPlan({ calories: kcal, protein: prot, days: 1, dietary: filters, goal: 'general_fitness' });
  const day = plan.days[0] || { meals: {} };
  const lines = planEngine.SLOTS.filter((s) => day.meals[s]).map((s) => {
    const m = day.meals[s];
    return `- ${SLOT_LABEL[s] || s}: ${m.name} (${Math.round(m.calories)} kcal, ${Math.round(m.protein)} g protein)`;
  });
  const notes = Array.isArray(plan.notes) && plan.notes.length ? `\n\n${plan.notes.join(' ')}` : '';
  return { reply: `${SAFE_NOTICE}\n\n${lines.join('\n')}${notes}`, plan };
}

module.exports = {
  SAFE_NOTICE, PLAN_NOTICE, SAFE_TIP, safeReview, brokenGroups, listOf, allergyDiets, savedFilters, combineFilters, textBreaksFilters, isFoodTalk, safeCoachReply,
};
