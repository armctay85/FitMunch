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
  // FSANZ PEAL terms and every named shellfish food (EQA #135 r4 M1).
  [/shellfish|crustacea|bivalve|mollus|cephalopod|gastropod|prawn|shrimp|crab|lobster|\bbugs?\b|yabb(?:y|ies)|marron|crayfish|oyster|mussel|scallop|clam|pipi|squid|calamari|octopus|cuttlefish|snail|abalone|escargot/i, 'shellfish free'],
  [/\bfish\b|seafood|salmon|tuna/i, 'fish free'],
];

const EMPTY = new Set(['', 'null', 'undefined', 'none', 'false', '[]', '{}']);
/**
 * Stands in for a filter that can't be read. It fails closed: the user is guarded from the AI, every
 * "... free" filter applies to meals, and warnings say the list couldn't be read (EQA #140 r1 M1).
 */
const UNREADABLE = 'unreadable filter';
const UNREADABLE_NOTICE = "We couldn't read all your allergies, so every allergen filter is on. Check your profile.";
const ALL_FREE = ['gluten free', 'dairy free', 'nut free', 'egg free', 'soy free', 'sesame free', 'shellfish free', 'fish free'];
/** Filter-list caps (EQA #135 r5 S1): at most 50 items of at most 100 characters (code points). */
const MAX_FILTERS = 50;
const MAX_FILTER_LEN = 100;
/** Past item 50, the rest of a list is still scanned for allergens, within this total character budget. */
const MAX_FILTER_SCAN = 20000;
/** Character count by code points, so an emoji counts as 1 (EQA #140 r1 L2). */
const charLen = (str) => { let n = 0; for (const _ of str) { n += 1; if (n > MAX_FILTER_SCAN) break; } return n; };
const clip = (str) => (str.length <= MAX_FILTER_LEN ? str : Array.from(str.slice(0, MAX_FILTER_LEN * 2)).slice(0, MAX_FILTER_LEN).join(''));
/**
 * Strings from an array, a JSON or comma string, or an object's truthy keys ({ peanut: true }). Drops null-ish
 * values. Any other shape ([{name:'peanut'}], [['peanut']], a number, true) yields UNREADABLE (EQA #135 r4 S1).
 * Every item is read as a filter; only the cost is capped: past a MAX_FILTER_SCAN character budget the
 * list is UNREADABLE, which applies every "... free" filter with a note (EQA #140 r1 M1).
 */
function listOf(v) {
  let x = v;
  if (x == null || x === false) return [];
  if (typeof x === 'string' && x.length > MAX_FILTER_SCAN) return [UNREADABLE];
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { x = x.split(','); } }
  if (x == null || x === false) return [];
  if (typeof x === 'string') x = [x];
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const keys = [];
    let budget = MAX_FILTER_SCAN;
    for (const k in x) {
      if (!Object.prototype.hasOwnProperty.call(x, k) || !x[k]) continue;
      if (typeof x[k] === 'object') return [UNREADABLE];
      budget -= k.length;
      if (budget < 0) { keys.push(UNREADABLE); break; }
      keys.push(k);
    }
    x = keys;
  }
  if (!Array.isArray(x)) return [UNREADABLE];
  const out = [];
  let budget = MAX_FILTER_SCAN;
  for (let i = 0; i < x.length; i += 1) {
    const s = x[i];
    if (s === UNREADABLE) { out.push(UNREADABLE); break; }
    if (s == null || s === false) continue;
    if (typeof s !== 'string') return [UNREADABLE];
    budget -= s.length;
    if (budget < 0) { out.push(UNREADABLE); break; }
    const t = clip(s.trim());
    if (EMPTY.has(t.toLowerCase())) continue;
    out.push(t); // every item is kept for filtering, never cut at 50 (EQA #140 r1 M1)
  }
  return out;
}
/**
 * A saveable filter list: absent, or a string, or an array of strings (EQA #135 r4 S1), with at most
 * MAX_FILTERS items of at most MAX_FILTER_LEN characters (EQA #135 r5 S1). A text list of objects or
 * nested lists is rejected too (EQA #140 r1 L4).
 */
function wellFormedFilters(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.length <= MAX_FILTER_SCAN && rawItemsOk(v);
  return Array.isArray(v) && v.length <= MAX_FILTERS && v.every((s) => typeof s === 'string' && charLen(s) <= MAX_FILTER_LEN);
}
const CAP_ERROR = 'You can save up to 50 allergies and diet filters, each up to 100 characters. Please shorten the list.';
const SHAPE_ERROR = 'Allergies and diet filters must be a list of words, like ["peanut"].';
/** null when the list can be saved, else the 400 message: a cap message for long lists of words, a shape message otherwise. */
function filterSaveError(v) {
  if (wellFormedFilters(v)) return null;
  const words = Array.isArray(v) ? v.every((x) => typeof x === 'string') : typeof v === 'string' && (() => {
    if (v.length > MAX_FILTER_SCAN) return true;
    let x; try { x = JSON.parse(v); } catch (_) { return true; }
    return typeof x === 'string' || (Array.isArray(x) && x.every((i) => i == null || typeof i === 'string'));
  })();
  return words ? CAP_ERROR : SHAPE_ERROR;
}
function rawItemsOk(str) {
  let x;
  try { x = JSON.parse(str); } catch (_) { x = str.split(','); }
  if (x == null || x === false || typeof x === 'string') return x == null || x === false || charLen(x) <= MAX_FILTER_LEN;
  if (Array.isArray(x)) return x.length <= MAX_FILTERS && x.every((s) => s == null || (typeof s === 'string' && charLen(s) <= MAX_FILTER_LEN));
  if (typeof x === 'object') {
    const keys = Object.keys(x);
    return keys.length <= MAX_FILTERS && keys.every((k) => charLen(k) <= MAX_FILTER_LEN && (x[k] == null || typeof x[k] !== 'object'));
  }
  return false;
}
/** Normalised filters, with every "... free" filter added when part of the list couldn't be read. Known filters first. */
function finish(list) {
  let f = planEngine.normaliseDiet(list);
  if (f.includes(UNREADABLE)) f = planEngine.normaliseDiet([...ALL_FREE, ...f]);
  const known = (d) => (planEngine.DIET_FILTERS.includes(d) ? 0 : 1);
  return f.map((d, i) => [d, i]).sort((a, b) => known(a[0]) - known(b[0]) || a[1] - b[1]).map(([d]) => d);
}
const unreadable = (filters) => Array.isArray(filters) && filters.includes(UNREADABLE);

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
  return finish([...listOf(p.dietaryPreferences), ...allergyDiets(p.allergies)]);
}

/** Saved filters plus sent ones. Never smaller than the saved list. */
function combineFilters(profile, sent) {
  return finish([...savedFilters(profile), ...allergyDiets(sent)]);
}

/** A fixed tip for filtered users: no foods named. */
const SAFE_TIP = 'Your meals are checked against your allergies and diet. Open Meal Plans for a week built from FitMunch\'s checked recipes.';

const lexicon = require('./food-lexicon-127a');
// FitMunch's own checked meals carry exactly their checked flags, so a saved template never warns for a
// filter it fits ("Vegetable fried rice with corn" has no egg; EQA #135 r4 S3).
for (const t of planEngine.TEMPLATES) lexicon.addKnown(t.name, planEngine.flagsOf(t));

// Non-food phrases that share a word with a food ("foam roll", "go nuts"). Removed before the check.
const IDIOMS = /\b(?:foam[- ]roll(?:er|ing)?|roll(?:ing)? (?:out|up|over|it|your|the|back|down)|wrap(?:ping)? (?:up|it)|that'?s a wrap|go(?:ing)? nuts|nuts about|bun up|hair bun|man bun|pie chart|egg[- ]?timer|stomach bug|bug bite|dead bugs?|fish(?:ing)? for|sun ?cream|sunscreen(?: cream)?|cream of the crop|break bread|bread and butter|butter(?:ed)? up|nutshell|toast to)\b/gi;

const GLUED_BRANDS = /(arnott'?s?|maccas|mcdonald'?s?|subway|oporto|caramello|dominos|freddo|yoplait|chobani)(?=[a-z])/gi;
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
const EMOJI = [[/\u{1F95C}/gu, ' peanut '], [/\u{1F330}/gu, ' chestnut '], [/[\u{1F990}\u{1F99E}\u{1F980}\u{1F991}\u{1F419}\u{1F9AA}]/gu, ' prawn '],
  [/[\u{1F41F}\u{1F420}\u{1F363}]/gu, ' fish '], [/\u{1F95B}/gu, ' milk '], [/\u{1F9C0}/gu, ' cheese '], [/[\u{1F95A}\u{1F373}]/gu, ' egg '],
  [/[\u{1F35E}\u{1F956}\u{1F950}\u{1F96F}\u{1F355}\u{1F35D}]/gu, ' bread ']];
// A plant milk or tofu means "smoothie" isn't dairy and "scramble" isn't eggs (EQA #135 r4 S3).
const PLANT_MILK = /\b(?:soy|soya|almond|oat|rice|coconut|cashew|macadamia|hazelnut|pea|plant)[\s-]?milk\b|\btofu\b/i;
/** The food groups (gluten, nuts, ...) a text names that the filters exclude. */
function brokenGroups(text, filters) {
  const groups = new Set(planEngine.normaliseDiet(filters).flatMap((d) => DIET_GROUPS[d] || []));
  if (!groups.size) return [];
  let t = String(text == null ? '' : text);
  for (const [re, w] of EMOJI) t = t.replace(re, w);
  t = t.replace(IDIOMS, ' ').replace(/(\d)([A-Za-z])/g, '$1 $2');
  // Brand names glued to other words ("arnottstimtam", "maccasbrekkie", "subwaysub"; EQA #140 r1 L1).
  t = t.replace(GLUED_BRANDS, ' $1 ');
  if (PLANT_MILK.test(t)) t = t.replace(/\bsmoothies?\b/gi, ' ');
  if (/\btofu\b/i.test(t)) t = t.replace(/\bscramble[ds]?\b/gi, ' ');
  const { flags } = lexicon.scan(t);
  return [...flags].filter((f) => groups.has(f));
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
const COMING_SOON = 'A personalised Coach answer that works around your allergies and diet is coming soon.';
const TRAINING_GUIDANCE = [
  "Here's some general training guidance while I keep your allergies and diet safe:",
  '- Warm up for 5 to 10 minutes, then build up to your working sets.',
  '- For strength, 3 to 5 sets of 5 to 8 reps; for muscle, 3 to 4 sets of 8 to 12, stopping 1 to 2 reps short of failure.',
  '- Add a little weight or a rep each week while your form stays solid.',
  '- Rest 1 to 3 minutes between sets, sleep 7 to 9 hours, and take at least one easy day a week.',
  '- Stop and see a GP or physio if something hurts sharply or keeps hurting.',
].join('\n');

function targetsOf(calories, protein) {
  return {
    kcal: Number(calories) >= 1200 && Number(calories) <= 4500 ? Math.round(Number(calories)) : 2000,
    prot: Number(protein) >= 30 && Number(protein) <= 350 ? Math.round(Number(protein)) : 120,
  };
}
const mealLine = (slot, m) => `${SLOT_LABEL[slot] || slot}: ${m.name} (${Math.round(m.calories)} kcal, ${Math.round(m.protein)} g protein)`;

/** One checked template meal for these filters and targets. */
function safeMeal({ filters, calories, protein }) {
  const { kcal, prot } = targetsOf(calories, protein);
  const plan = planEngine.buildPlan({ calories: kcal, protein: prot, days: 1, dietary: filters, goal: 'general_fitness' });
  const day = plan.days[0] || { meals: {} };
  const slot = ['lunch', 'dinner', 'breakfast', 'snack'].find((x) => day.meals[x]);
  return slot ? { slot, meal: day.meals[slot], text: `Try this checked meal: ${mealLine(slot, day.meals[slot])}.` } : null;
}

/** Coach food answer for a filtered user: a checked day of meals, plus the coming-soon line. No AI. */
function safeCoachReply({ filters, calories, protein }) {
  const { kcal, prot } = targetsOf(calories, protein);
  const plan = planEngine.buildPlan({ calories: kcal, protein: prot, days: 1, dietary: filters, goal: 'general_fitness' });
  const day = plan.days[0] || { meals: {} };
  const lines = planEngine.SLOTS.filter((x) => day.meals[x]).map((x) => `- ${mealLine(x, day.meals[x])}`);
  const notes = Array.isArray(plan.notes) && plan.notes.length ? `\n\n${plan.notes.join(' ')}` : '';
  return { reply: `${unreadable(filters) ? `${UNREADABLE_NOTICE} ` : ''}${SAFE_NOTICE}\n\n${lines.join('\n')}${notes}\n\n${COMING_SOON}`, plan };
}

/** Coach answer for a filtered user's non-food question: food-free training guidance, one checked meal, coming soon. No AI. */
function safeTrainingReply(opts) {
  const m = safeMeal(opts);
  return `${unreadable(opts.filters) ? `${UNREADABLE_NOTICE}\n\n` : ''}${TRAINING_GUIDANCE}\n\nWhen you're hungry, here's a meal from FitMunch's checked recipes that fits your filters and targets. ${m ? m.text : ''}\n\n${COMING_SOON}`;
}

/** Insight tip for a filtered user. No AI. */
function safeInsight(opts) {
  const m = safeMeal(opts);
  return `${SAFE_TIP} ${m ? m.text : ''}`.replace(/\s+/g, ' ').trim();
}

/** Weekly review for a filtered user. No AI. */
function safeWeeklyReview(opts) {
  const m = safeMeal(opts);
  return {
    headline: "Here's your week, with your allergies and diet kept safe.",
    wins: ['You set up your allergy and diet filters, so every plan is checked against them.'],
    focus: ['Log your meals and training on most days this week so your numbers are easy to read.', m ? m.text : SAFE_TIP, COMING_SOON],
    // No score: a fixed review can't judge the week (EQA #135 r4 L2). The UI hides it when null.
    score: null,
  };
}

/** Workout plan for a filtered user: a fixed, food-free full-body program. No AI, no credit (EQA #135 r4 S2). */
const WORKOUT_DAYS = [
  ['Full body A', [['Goblet squat', 3, '8-10'], ['Push-up or bench press', 3, '8-10'], ['Dumbbell row', 3, '10-12'], ['Romanian deadlift', 3, '8-10'], ['Plank', 3, '30-45 s']]],
  ['Full body B', [['Split squat', 3, '8-10 each leg'], ['Overhead press', 3, '8-10'], ['Lat pulldown or band pull-down', 3, '10-12'], ['Glute bridge', 3, '10-12'], ['Side plank', 3, '20-30 s each side']]],
  ['Full body C', [['Leg press or step-up', 3, '10-12'], ['Incline push-up or dumbbell press', 3, '8-12'], ['Seated cable row or band row', 3, '10-12'], ['Hip hinge with kettlebell', 3, '10-12'], ['Bird dog', 3, '8-10 each side']]],
];
function safeWorkoutPlan({ daysPerWeek, level } = {}) {
  const days = Math.min(Math.max(parseInt(daysPerWeek, 10) || 3, 1), 7);
  const lvl = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate';
  const workouts = [];
  for (let d = 1; d <= days; d += 1) {
    const [name, list] = WORKOUT_DAYS[(d - 1) % WORKOUT_DAYS.length];
    list.forEach(([ex, sets, reps], i) => workouts.push({ day: d, name: ex, sets, reps, rest: 90, notes: i === 0 ? `${name}: warm up for 5 to 10 minutes first.` : '' }));
  }
  return {
    planName: `${days}-day full body program`,
    summary: 'A balanced full-body program from FitMunch. Add a little weight or a rep each week while your form stays solid.',
    level: lvl,
    frequency: days,
    workouts,
  };
}

module.exports = {
  SAFE_NOTICE, PLAN_NOTICE, SAFE_TIP, COMING_SOON, brokenGroups, listOf, allergyDiets, savedFilters, combineFilters, textBreaksFilters, isFoodTalk,
  safeMeal, safeCoachReply, safeTrainingReply, safeInsight, safeWeeklyReview, safeWorkoutPlan, UNREADABLE, wellFormedFilters, MAX_FILTERS, MAX_FILTER_LEN, MAX_FILTER_SCAN, UNREADABLE_NOTICE, ALL_FREE, unreadable, filterSaveError, CAP_ERROR,
};
