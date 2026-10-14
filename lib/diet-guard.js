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
  [/\bfish\b|seafood/i, 'fish free'],
];

function listOf(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { x = x.split(','); } }
  return Array.isArray(x) ? x.map((s) => String(s == null ? '' : s).trim()).filter(Boolean) : [];
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

// Words that mark a food group in free text (Coach replies). Fail closed: over-matching only
// swaps an AI reply for checked recipes.
const GROUP_WORDS = {
  gluten: 'bread|toast|pasta|spaghetti|penne|fettuccine|linguine|lasagne|lasagna|macaroni|orzo|noodle|ramen|udon|wheat|flour|oat|oatmeal|porridge|barley|rye|malt|couscous|seitan|soy sauce|wrap|tortilla|bagel|roll|bun|pizza|(?<!rice )cracker|cereal|weet-?bix|vegemite|muesli|granola|semolina|pastry|pie|(?<!rice )cake|biscuit|cookie|muffin|crumpet|pancake|waffle|beer|crouton|breadcrumb|panko|big mac|pad see ew|nasi goreng',
  nuts: 'peanut|satay|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|nut|nut butter|praline|marzipan|pesto|nutella|snickers|gado gado|almondmilk|peanutbutter',
  dairy: '(?<!(?:coconut|soy|oat|almond|rice) )(?:milk|yoghurt|yogurt|cream)|cheese|(?<!(?:peanut|nut|almond|cashew|apple) )butter|whey|casein|ricotta|cottage|feta|parmesan|mozzarella|haloumi|halloumi|ghee|buttermilk|custard|ice cream|latte|cappuccino|big mac',
  eggs: 'egg|eggwhite|omelette|omelet|frittata|mayo|mayonnaise|quiche|aioli|meringue|custard|nasi goreng',
  soy: 'soy|soya|soybean|tofu|tempeh|edamame|miso|tamari',
  sesame: 'sesame|tahini|hummus|houmous|halva|benne|gomasio|big mac',
  shellfish: 'prawn|shrimp|crab|lobster|mussel|oyster|squid|calamari|octopus|scallop|clam|pipi|yabby|yabbies|marron|bug|scampi|crayfish',
  fish: 'fish|salmon|tuna|barramundi|cod|snapper|flathead|whiting|kingfish|john dory|basa|hoki|ling|anchovy|sardine|mackerel|trout|sushi|prawn|shrimp|crab|lobster|mussel|oyster|squid|calamari|octopus|scallop|fish sauce',
  meat: 'chicken|beef|lamb|pork|turkey|bacon|ham|mince|steak|sausage|salami|prosciutto|veal|kangaroo|duck|rabbit|quail|liver|chorizo|big mac|jerky',
};
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
function groupRegex(groups) {
  const words = [...new Set(groups)].map((g) => GROUP_WORDS[g]).filter(Boolean).join('|');
  return words ? new RegExp(`\\b(?:${words})(?:e?s)?\\b`, 'i') : null;
}
/** True when the text names a food the filters exclude. */
function textBreaksFilters(text, filters) {
  const re = groupRegex(planEngine.normaliseDiet(filters).flatMap((d) => DIET_GROUPS[d] || []));
  return !!(re && re.test(String(text || '')));
}

const FOOD_TALK = /\b(?:meal|meals|food|foods|eat|eating|recipe|recipes|breakfast|lunch|dinner|snack|snacks|menu|cook|cooking|plan|plans|diet|macro|macros|protein|calorie|calories|kcal|shopping|grocer|ingredient|ingredients|dish|dishes|hungry|craving|cravings)\b/i;
function isFoodTalk(intent, text) {
  return intent === 'nutrition' || FOOD_TALK.test(String(text || ''));
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
  SAFE_NOTICE, PLAN_NOTICE, listOf, allergyDiets, savedFilters, combineFilters, textBreaksFilters, isFoodTalk, safeCoachReply,
};
