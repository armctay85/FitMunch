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

/** Weekly review for a filtered user: drop every line, at any depth, that names a food they can't have or can't be checked. */
function safeReview(review, filters) {
  const ok = (x) => typeof x === 'string' && !replyUnsafe(x, filters);
  const clean = (v, depth) => {
    if (typeof v === 'string') return ok(v) ? v : undefined;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (depth > 6) return undefined;
    if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1)).filter((x) => x !== undefined);
    if (typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) { const c = clean(x, depth + 1); if (c !== undefined) out[k] = c; }
      return out;
    }
    return undefined;
  };
  const src = review && typeof review === 'object' && !Array.isArray(review) ? review : {};
  const r = clean(src, 0);
  if (typeof src.headline === 'string' && r.headline === undefined) r.headline = 'Here is your week at a glance.';
  r.wins = Array.isArray(r.wins) ? r.wins : [];
  r.focus = Array.isArray(r.focus) && r.focus.length ? r.focus : [SAFE_TIP];
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
// Fail closed for filtered users: a word the lexicon doesn't know, right after an eating or drinking
// word, or a capitalised brand-like name in a sentence with one, could be a food we can't check.
const EAT_CONTEXT = new Set(['eat', 'eating', 'ate', 'drink', 'drinking', 'have', 'having', 'grab', 'snack', 'shake', 'bar', 'smash', 'neck', 'try', 'sip', 'munch', 'chew', 'fuel', 'refuel', 'some', 'serve', 'enjoy']);
const NOT_FOOD = new Set(lexicon.tokensOf(`a an the some your you it this that one two three few couple quick small big good great more less
  rest day days break go look chat think session set sets rep reps minute minutes second seconds hour hours walk stretch nap sleep
  shower sauna bath swim run jog breather breath deep water glass glasses electrolyte go at least lot bit time plan plans think
  look crack read listen recovery cooldown cool down warm up foam roller roll massage ice pack word coach trainer physio gp dietitian
  doctor question goal target targets week weekend morning night evening afternoon today tomorrow tonight before after during
  training workout gym squat squats lift lifts again same different new easy hard light heavy just also then and or but if with
  without of to for from in on by up down out over not no don t is are be been can could should would will may might
  plenty enough lots deadlift romanian press bench lunge plank row curl pushup push pullup pull split bulgarian hip thrust
  glute bridge sprint interval hill stair step steps tempo pause rep range form technique mobility drill drills cardio
  hiit yoga pilates class program programme routine variation progression deload pace distance km kms`));
function unknownFoodish(text) {
  const raw = String(text == null ? '' : text).replace(IDIOMS, ' ');
  const known = (t) => NOT_FOOD.has(t) || lexicon.SAFE.has(t) || lexicon.DENY_WORDS.has(t) || /^\d/.test(t);
  for (const part of raw.split(/[.!?\n;:]+/)) {
    const words = part.split(/[^A-Za-z0-9'&’-]+/).filter(Boolean);
    const toks = words.map((w) => lexicon.tokensOf(w)[0] || '');
    const eating = toks.some((t) => EAT_CONTEXT.has(t));
    if (!eating) continue;
    for (let i = 0; i < toks.length; i += 1) {
      if (!EAT_CONTEXT.has(toks[i])) continue;
      for (let j = i + 1; j <= Math.min(i + 4, toks.length - 1); j += 1) {
        if (toks[j] && !EAT_CONTEXT.has(toks[j]) && !known(toks[j])) return true;
      }
    }
    for (let j = 1; j < words.length; j += 1) {
      if (/^[A-Z]/.test(words[j]) && toks[j] && !known(toks[j])) return true;
    }
  }
  return false;
}
/** For a filtered user's AI text: unsafe if it names an excluded food or an unrecognised food-like term. */
function replyUnsafe(text, filters) {
  return textBreaksFilters(text, filters) || unknownFoodish(text);
}

/** True when the text names a food the filters exclude. */
function textBreaksFilters(text, filters) {
  return brokenGroups(text, filters).length > 0;
}

// For a filtered user, every Coach question counts as food UNLESS it is clearly about training, sleep or the account.
const NON_FOOD = /\b(?:workouts?|training|train|exercises?|sets?|reps?|squats?|deadlifts?|bench|press|lunges?|push ?ups?|pull ?ups?|plank|gym|lift(?:ing)?|run(?:ning)?|jog(?:ging)?|cardio|hiit|stretch(?:ing|es)?|warm ?ups?|cool ?downs?|mobility|yoga|pilates|injur(?:y|ies)|sore(?:ness)?|knee|back pain|form|steps|walk(?:ing)?|cycling|swim(?:ming)?|sleep(?:ing)?|rest days?|recovery|password|account|login|log in|subscription|billing|cancel|upgrade|email|privacy|app|streak|weigh[- ]?ins?|scale|measurements?)\b/i;
const FOOD_HINT = /\b(?:eat|eating|ate|food|foods|meal|meals|recipe|recipes|breakfast|brekkie|brekky|lunch|dinner|tea|supper|snack|snacks|dessert|desserts|sweet|treat|smoothie|shake|drink|cook|cooking|bake|baking|make|have|hungry|craving|cravings|menu|dish|dishes|ingredient|ingredients|plan|plans|diet|macro|macros|protein|carbs?|fat|calorie|calories|kcal|shopping|grocer(?:y|ies)|tonight|fuel|fuel ?up|refuel|smash|grab|neck|recovery|energy|pre[- ]?(?:workout|gym|run|training|session)|post[- ]?(?:workout|gym|run|training|session)|(?:before|after|during) (?:my |the |a |your )?(?:training|gym|run|squats?|workout|session|leg day|game|match|ride))\b/i;
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
  SAFE_NOTICE, PLAN_NOTICE, SAFE_TIP, safeReview, brokenGroups, replyUnsafe, unknownFoodish, listOf, allergyDiets, savedFilters, combineFilters, textBreaksFilters, isFoodTalk, safeCoachReply,
};
