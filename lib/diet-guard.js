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
// The typed-food sentence is only true once the read stopped early (EQA #127 r11 S3).
const UNREADABLE_NOTICE = "We couldn't read part of your allergy list, so all 8 common allergen filters are on. Please update your profile.";
const PAST_BUDGET_NOTE = "Some foods you typed weren't checked.";
// Coach, insight, weekly and training: the list stopped early, so name no meal and make no
// checked, fits, or safe claim. Separate from an unreadable profile that was fully read (EQA #182 M1).
const PAST_BUDGET_HOLD = `${UNREADABLE_NOTICE} Please shorten your allergy list so every food you typed can be read.`;
function unreadableNotice(pastBudget) {
  return pastBudget ? `${UNREADABLE_NOTICE} ${PAST_BUDGET_NOTE}` : UNREADABLE_NOTICE;
}
function pastBudgetHoldText() { return PAST_BUDGET_HOLD; }
function pastBudgetHoldReview() {
  return { headline: PAST_BUDGET_HOLD, wins: [], focus: [], score: null };
}
function unreadableLead(filters, pastBudget, sep) {
  return unreadable(filters) ? `${unreadableNotice(!!pastBudget)}${sep}` : '';
}
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
      if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
      // Every key visited costs 1, including falsy values, so a huge object of
      // empty flags stops at the budget instead of scanning every key (EQA #144 L2).
      budget -= 1;
      if (budget < 0) { keys.push(UNREADABLE); break; }
      if (!x[k]) continue;
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
    // Equivalent to reading it as an ordinary item (the string itself triggers ALL_FREE in finish());
    // kept so a re-read list stops at the marker instead of scanning on (EQA #140 r2 S1b).
    if (s === UNREADABLE) { out.push(UNREADABLE); break; }
    // Every entry visited costs 1, including null and false, so a long run of empty
    // slots stops at the budget instead of reading a food after them (EQA #182 L2).
    if (s == null || s === false) {
      budget -= 1;
      if (budget < 0) { out.push(UNREADABLE); break; }
      continue;
    }
    // An unreadable entry fails closed once, and the readable entries beside it still count
    // (a ticked filter appended to an odd saved list must apply; EQA #142 M1). It costs 1 from the budget.
    if (typeof s !== 'string') {
      if (!out.includes(UNREADABLE)) out.push(UNREADABLE);
      budget -= 1;
      if (budget < 0) break;
      continue;
    }
    // An empty string still costs one, the same as null or false (EQA #182 L2).
    budget -= Math.max(s.length, 1);
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
/** A filter the builder applies: a diet style or any "... free" filter (EQA #140 r2 M1). */
const isKnown = (d) => planEngine.DIET_FILTERS.includes(d) || ALL_FREE.includes(d);
/**
 * The filters the plan builder gets: known filters only, then the cut. Unknown text is dropped BEFORE
 * the cut, so junk can never push a real filter out (EQA #140 r2 M1). The user is still guarded by the
 * full list; this only shapes the builder input.
 */
function planFilters(filters, max = 16) {
  return (Array.isArray(filters) ? filters : []).filter(isKnown).slice(0, max);
}
function finish(list) {
  let f = planEngine.normaliseDiet(list);
  if (f.includes(UNREADABLE)) f = planEngine.normaliseDiet([...ALL_FREE, ...f]);
  const known = (d) => (isKnown(d) ? 0 : 1);
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
// Plain foods the lexicon didn't list. They carry no allergen flag, so a reply may name them.
lexicon.addSafe('fruit fruits vegetable vegetables veggie veggies');

// Non-food phrases that share a word with a food ("foam roll", "go nuts"). Removed before the check.
const IDIOMS = /\b(?:foam[- ]roll(?:er|ing)?|roll(?:ing)? (?:out|up|over|it|your|the|back|down)|wrap(?:ping)? (?:up|it)|that'?s a wrap|go(?:ing)? nuts|nuts about|bun up|hair bun|man bun|pie chart|egg[- ]?timer|stomach bug|bug bite|dead bugs?|fish(?:ing)? for|sun ?cream|sunscreen(?: cream)?|cream of the crop|break bread|bread and butter|butter(?:ed)? up|nutshell|toast to)\b/gi;

const GLUED_BRANDS = /(arnott'?s?|maccas|mcdonald'?s?|subway|oporto|caramello|dominos|freddo|yoplait|chobani|musashi|milo|cocopops|kfc|upandgo)(?=[a-z])/gi;
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
/** Same cleaning the allergen scan uses: emoji, idioms, glued brands, plant-milk exceptions. */
function prepareFoodText(text) {
  let t = String(text == null ? '' : text);
  for (const [re, w] of EMOJI) t = t.replace(re, w);
  t = t.replace(IDIOMS, ' ').replace(/(\d)([A-Za-z])/g, '$1 $2');
  // Brand names glued to other words ("arnottstimtam", "maccasbrekkie", "miloshake"; EQA #140 r1 L1).
  t = t.replace(GLUED_BRANDS, ' $1 ');
  if (PLANT_MILK.test(t)) t = t.replace(/\bsmoothies?\b/gi, ' ');
  if (/\btofu\b/i.test(t)) t = t.replace(/\bscramble[ds]?\b/gi, ' ');
  return t;
}
/** A letter outside the Latin script. Checked on the raw string: normalise() drops these letters. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{Letter}/u;
function hasNonLatinLetter(text) {
  return NON_LATIN_LETTER.test(String(text == null ? '' : text));
}
// Allergen names in scripts normalise() strips. Longer phrases are listed first. Matched on the raw string.
const FOREIGN_ALLERGENS = [
  ['nuts', /花生酱|花生醬|花生|ピーナッツバター|ピーナッツ|落花生|땅콩버터|땅콩|मूंगफली|मूँगफली|زبدة\s*الفول(?:\s*السوداني)?|فول\s*سوداني|เนยถั่ว|ถั่วลิสง|חמאת\s*בוטנים|בוטנים/u],
  ['dairy', /牛奶|牛乳|奶酪|芝士|ミルク|우유|दूध|حليب|لبن|นม|חלב/u],
  ['eggs', /鸡蛋|雞蛋|たまご|卵|계란|달걀|अंडा|अण्डा|بيض|ไข่|ביצה/u],
  ['gluten', /面包|麵包|パン|빵|ब्रेड|रोटी|خبز|ขนมปัง|לחם/u],
];
function foreignFlags(text) {
  const raw = String(text == null ? '' : text);
  const flags = new Set();
  for (const [flag, re] of FOREIGN_ALLERGENS) if (re.test(raw)) flags.add(flag);
  return flags;
}
/** The food groups (gluten, nuts, ...) a text names that the filters exclude. */
function brokenGroups(text, filters) {
  const groups = new Set(planEngine.normaliseDiet(filters).flatMap((d) => DIET_GROUPS[d] || []));
  if (!groups.size) return [];
  const { flags } = lexicon.scan(prepareFoodText(text));
  for (const f of foreignFlags(text)) flags.add(f);
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
function safeCoachReply({ filters, calories, protein, pastBudget }) {
  if (pastBudget) return { reply: pastBudgetHoldText(), plan: null, source: 'fixed' };
  const { kcal, prot } = targetsOf(calories, protein);
  const plan = planEngine.buildPlan({ calories: kcal, protein: prot, days: 1, dietary: filters, goal: 'general_fitness' });
  const day = plan.days[0] || { meals: {} };
  const lines = planEngine.SLOTS.filter((x) => day.meals[x]).map((x) => `- ${mealLine(x, day.meals[x])}`);
  const notes = notesForReply(plan, filters);
  return { reply: `${unreadableLead(filters, pastBudget, ' ')}${SAFE_NOTICE}\n\n${lines.join('\n')}${notes}\n\n${COMING_SOON}`, plan };
}

/** Coach answer for a filtered user's non-food question: food-free training guidance, one checked meal, coming soon. No AI. */
function safeTrainingReply(opts) {
  if (opts && opts.pastBudget) return pastBudgetHoldText();
  const m = safeMeal(opts);
  return `${unreadableLead(opts.filters, opts.pastBudget, '\n\n')}${TRAINING_GUIDANCE}\n\nWhen you're hungry, here's a meal from FitMunch's checked recipes that fits your filters and targets. ${m ? m.text : ''}\n\n${COMING_SOON}`;
}

/** Insight tip for a filtered user. No AI. */
function safeInsight(opts) {
  if (opts && opts.pastBudget) return pastBudgetHoldText();
  const m = safeMeal(opts);
  return `${SAFE_TIP} ${m ? m.text : ''}`.replace(/\s+/g, ' ').trim();
}

/** Weekly review for a filtered user. No AI. */
function safeWeeklyReview(opts) {
  if (opts && opts.pastBudget) return pastBudgetHoldReview();
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

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/**
 * Coaching English, not food. An unknown token outside this set is an unverified food and the reply fails
 * closed. Food words stay out of here on purpose: they have to be in the lexicon (or they are rejected).
 */
const PROSE = new Set(lexicon.tokensOf(`
  i id ill im ive you youre your youll we they them their theyre thats whats heres theres
  dont cant wont isnt arent wasnt werent didnt doesnt havent hasnt hadnt wouldnt couldnt shouldnt lets
  a an the and or but if so then than as of to for from with without into onto over under through
  at by up off out in on about around above across again against ago ahead also always am
  be been being do does did doing done have has had having get got getting
  this that these those here there it its
  not no nor yes ok okay oh
  can could should would will may might must shall
  just only even still already yet also too very really quite
  more most less least much many few some any every each both
  good great better best solid nice fine well
  try trying tried keep keeping kept make making made
  want need like prefer
  now right left soon later early late next last first second
  today tonight tomorrow yesterday morning evening afternoon arvo week weekly day days
  because while when where what which who how why
  please thanks thank
  aim aiming hit hitting close closing gap rest remaining
  log logging logged score scoring streak
  target targets goal goals number numbers
  plan planned planning
  quick easy simple practical honest specific
  before after during around
  training workout gym train exercise exercises set sets rep reps squat squats deadlift bench press
  lunge lunges plank lift lifting run running jog jogging cardio hiit stretch stretching mobility yoga
  pilates sleep recovery form warm cool sore soreness sharp leg legs
  fitmunch checked recipe recipes allergy allergies filter filters diet diets safe safer safely
  built build building open guidance general while keep
  hungry full room fills fit land lands cover covers piece spoon spoons
  show showed showing review reviews
  one two three four five six seven eight nine ten hour hours minute minutes
  eat eating ate grab grabbing smash neck fuel refuel take taken taking
  fill fills filling what left moving move moves stay stays
  far under which
  start starting started
  breakfast lunch dinner snack snacks meal meals brekkie brekky
  answer answers answered question questions asked ask
  tonight tonights today todays
  your you are is was were been
  protein proteins calorie calories kcal gram grams
  so lot lots thing things way ways
  add adding added skip skipping
  still fine later
  about an hour
  advice suggest suggestion idea ideas option options
  body weight weights heavy light lighter heavier
  session sessions minute rest resting
  progress consistent consistency habit habits
  logged logging average avg total totals
  missing rhythm same
  open week one
  ill score
  real
  that is not a score yet
  aim
  days you log
  checked meal
  when you eat use
  here is how to train
  something sweet drink around
  high
  personal personalised
  directly kind short
  australian aussie
  supermarket shop shopping
  tonight dinner from
  have room
  plate vegetables
  if you are
  lets go
  front loading tends reduce evening
  on track dialled dialed energy going
  push line perfect
  fresh nothing stress momentum
  results follow seeing know
  solid numbers
  boost path
  won
  dont mention
  greeting name
  little short huge portion went within sit inside tin simpler simplest useful bigger matter product
  look looking repeat once twice else closer strong working strength muscle between failure
  stop stopping see gp physio hurt hurts hurting sharply
  almost enough nearly roughly plenty couple half behind ahead pretty actually probably maybe
  bit bits slightly mostly often sometimes never another others own different
  hard careful carefully gently firmly properly correctly safely simply basically generally
  typically especially particularly including across among throughout toward towards upon
  feel feeling felt think thinking thought know knowing sure true exactly
  ready able let help finish end begin continue recover recovering
  warm whatever whoever someone anything nothing everything somewhere somehow anyway anywhere
  several various certain overall whole entire lower higher smaller largest smallest
  longer longest quickly slowly faster tight loose smoother weaker easier harder
  back forward hmm hey hi hello me my mine our us him his she he her
  count instead rather choose choice swap swapped works suggest
  shortfall behind under over average
`));

/** Why an AI reply cannot be served, or [] when every food term is verified safe for these filters. */
function replyIssues(text, filters, aiFilters) {
  const issues = [];
  // Any non-Latin letter fails closed, even when the word is not an allergen term.
  if (hasNonLatinLetter(text)) issues.push('unverified:nonlatin');
  for (const g of brokenGroups(text, filters)) issues.push(`excluded:${g}`);
  const prepared = prepareFoodText(text);
  // A typed allergy that is not a "... free" filter ("kiwi", "kiwifruit") still has to be absent.
  // Prefix matches only for terms of 4+ characters, so "nut" does not catch "coconut".
  const n = lexicon.normalise(prepared);
  const toks = lexicon.tokensOf(n);
  const termHit = (t) => toks.some((x) => x === t || (t.length >= 4 && (x.startsWith(t) || x.endsWith(t))) || (x.length >= 4 && t.length >= 4 && t.startsWith(x)));
  const allergyFilters = new Set(Array.isArray(filters) ? filters : []);
  if (aiFilters && Array.isArray(aiFilters.allergies)) for (const a of aiFilters.allergies) allergyFilters.add(a);
  for (const f of allergyFilters) {
    if (!f || isKnown(f) || f === UNREADABLE) continue;
    const ft = lexicon.tokensOf(f).filter((t) => t.length > 2 && !PROSE.has(t));
    if (ft.some(termHit)) issues.push(`allergy:${f}`);
  }
  const unknown = lexicon.scan(prepared).unknown.filter((t) => !PROSE.has(t));
  for (const u of [...new Set(unknown)]) issues.push(`unverified:${u}`);
  return issues;
}

/** True when the reply names nothing excluded and nothing the lexicon cannot verify. */
function replyVerified(text, filters, aiFilters) {
  return replyIssues(text, filters, aiFilters).length === 0;
}

function askedAbout(question) {
  const q = String(question || '');
  if (/\b(snack|arvo)\b/i.test(q)) return { slot: 'snack', label: 'a snack' };
  if (/\b(dessert|sweet|treat)\b/i.test(q)) return { slot: 'snack', label: 'something sweet' };
  if (/\b(breakfast|brekkie|brekky)\b/i.test(q)) return { slot: 'breakfast', label: 'breakfast' };
  if (/\blunch\b/i.test(q)) return { slot: 'lunch', label: 'lunch' };
  if (/\b(dinner|tonight|supper)\b/i.test(q)) return { slot: 'dinner', label: 'dinner' };
  if (/\btea\b/i.test(q) && /\b(what|make|have|for|ideas)\b/i.test(q)) return { slot: 'dinner', label: 'dinner' };
  if (/\b(smash|neck|grab|recovery|refuel|fuel|pre[- ]?workout|post[- ]?workout|before training|after training|after the gym|before the gym|after squats|after a run|before my run)\b/i.test(q)) {
    return { slot: 'snack', label: 'something to eat around training' };
  }
  if (/\b(smoothie|shake)\b/i.test(q)) return { slot: 'snack', label: 'a drink' };
  if (/\b(plan|week|tomorrow|ideas)\b/i.test(q)) return { slot: null, label: 'a day of meals' };
  return { slot: null, label: 'what you asked' };
}

/**
 * A question we cannot check word for word (unknown words, or letters outside the Latin script)
 * but that does not name an excluded food. Those get the day plan, not a filter refusal.
 */
function questionUnread(question, filters) {
  const raw = String(question || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  const issues = replyIssues(raw, filters);
  return issues.length > 0 && !issues.some((i) => i.startsWith('excluded:') || i.startsWith('allergy:'));
}

/** Quote a question only when it names nothing unsafe. An excluded food is refused. An unreadable question is not quoted. */
function questionNote(question, filters) {
  const raw = String(question || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const issues = replyIssues(raw, filters);
  if (issues.some((i) => i.startsWith('excluded:') || i.startsWith('allergy:'))) return 'That does not fit your filters.';
  if (issues.length) return "I can't read that question.";
  const clip = raw.length > 140 ? `${raw.slice(0, 137).trim()}...` : raw;
  return `You asked: ${clip}`;
}

/**
 * Builder answer that still answers the question, citing targets. Used when the model cannot be verified.
 * No "coming soon". Food questions open with SAFE_NOTICE so the checked-recipe line stays first.
 */
/** Name plus ingredients, so a fit check reads the meal and not the day's calorie target. */
function mealFoodText(meal) {
  const ings = Array.isArray(meal && meal.ingredients) ? meal.ingredients : [];
  const names = ings.map((i) => (i && typeof i === 'object' ? (i.item || i.name || '') : i));
  return [meal && meal.name, ...names].filter(Boolean).join(' ');
}

/** A gap note may name tofu, eggs, yoghurt or fish. Only append text that passes the same filter check. */
const SAFE_PROTEIN_LINE = "Add a protein you've saved as OK.";
function notesForReply(plan, filters) {
  const raw = Array.isArray(plan && plan.notes) ? plan.notes : [];
  const out = [];
  let generic = false;
  const genericOk = lexicon.scan(prepareFoodText(SAFE_PROTEIN_LINE)).flags.size === 0 && !textBreaksFilters(SAFE_PROTEIN_LINE, filters);
  for (const note of raw) {
    const text = String(note || '').trim();
    if (!text || /not applied/i.test(text)) continue;
    if (!textBreaksFilters(text, filters)) { out.push(text); continue; }
    if (!generic && genericOk) { out.push(SAFE_PROTEIN_LINE); generic = true; }
  }
  return out.length ? `\n\n${out.join(' ')}` : '';
}

function addressedCoachReply({ filters, calories, protein, question, intent, pastBudget } = {}) {
  if (pastBudget) return { reply: pastBudgetHoldText(), source: 'fixed' };
  const { kcal, prot } = targetsOf(calories, protein);
  const cite = `At ${fmt(kcal)} kcal and ${prot} g protein`;
  const head = unreadableLead(filters, pastBudget, ' ');
  const note = questionNote(question, filters);
  const asked = note ? ` ${note}` : '';
  const qIssues = replyIssues(String(question || ''), filters);
  const questionExcluded = qIssues.some((i) => i.startsWith('excluded:') || i.startsWith('allergy:'));
  // Unknown or non-Latin wording, and a profile we could not read, still gets the day plan.
  if (!isFoodTalk(intent, question) && !questionUnread(question, filters) && !unreadable(filters)) {
    const m = safeMeal({ filters, calories: kcal, protein: prot });
    const reply = `${unreadableLead(filters, pastBudget, '\n\n')}${TRAINING_GUIDANCE}\n\n${cite}, here is how to train.${asked} When you eat, use a checked recipe. ${m ? m.text : ''}`.trim();
    return { reply, source: 'fixed' };
  }
  const dietary = planFilters(filters);
  const plan = planEngine.buildPlan({ calories: kcal, protein: prot, days: 1, dietary, goal: 'general_fitness' });
  const day = plan.days[0] || { meals: {} };
  const notes = notesForReply(plan, filters);
  // A named slot (lunch, dinner) is answered with that one meal even when the question
  // has words we cannot verify ("buy", a shop name). An unreadable profile, or a question
  // with no slot, still gets the whole day. The day's calorie target is never called the meal.
  const specific = askedAbout(question);
  const forceDay = unreadable(filters) || (questionUnread(question, filters) && !specific.slot);
  const about = forceDay ? { slot: null, label: 'a day of meals' } : specific;
  const slot = about.slot && day.meals[about.slot] ? about.slot : null;
  if (slot) {
    const meal = day.meals[slot];
    const mealFails = brokenGroups(mealFoodText(meal), filters);
    // The builder meal itself fails the saved diet or allergies: refuse it, and do not name it.
    if (mealFails.length) {
      return {
        reply: `${head}${SAFE_NOTICE} ${cite}. That does not fit your filters.${notes}`,
        source: 'builder',
        plan,
      };
    }
    // The question named an excluded food. Refuse that, and still offer the one meal that passes.
    if (questionExcluded) {
      return {
        reply: `${head}${SAFE_NOTICE} ${cite}. That does not fit your filters.\n\n- ${mealLine(slot, meal)}${notes}`,
        source: 'builder',
        plan,
      };
    }
    // A meal that passes is said to fit. Unverified shop words are not a refusal.
    // The nut line is only for a shop question, so other replies do not name peanuts.
    const quote = qIssues.length ? '' : asked;
    const shopAsk = /\b(buy|shop|shopping|grocer)/i.test(String(question || ''));
    const nutFree = (Array.isArray(filters) ? filters : []).some((f) => String(f).toLowerCase() === 'nut free');
    const freeLine = nutFree && shopAsk ? '\nIt is peanut free and nut free.' : '';
    return {
      reply: `${head}${SAFE_NOTICE} ${cite}. This fits your filters.${quote}\n\n- ${mealLine(slot, meal)}${freeLine}${notes}`,
      source: 'builder',
      plan,
    };
  }
  const lines = planEngine.SLOTS.filter((x) => day.meals[x]).map((x) => `- ${mealLine(x, day.meals[x])}`);
  return {
    reply: `${head}${SAFE_NOTICE} ${cite}, here is ${about.label}.${asked}\n\n${lines.join('\n')}${notes}`,
    source: 'builder',
    plan,
  };
}

/** Insight that cites today's numbers and one checked meal. No coming-soon line. */
function addressedInsight({ filters, calories, protein, todayCalories, todayProtein } = {}) {
  const { kcal, prot } = targetsOf(calories, protein);
  const m = safeMeal({ filters, calories, protein });
  const todayK = Number.isFinite(Number(todayCalories)) ? Math.round(Number(todayCalories)) : 0;
  const todayP = Number.isFinite(Number(todayProtein)) ? Math.round(Number(todayProtein)) : 0;
  return `${SAFE_TIP} At ${fmt(kcal)} kcal and ${prot} g protein, you are at ${todayK} kcal and ${todayP} g protein so far today. ${m ? m.text : ''}`.replace(/\s+/g, ' ').trim();
}

const FILLER_WIN = /showed up|weekly review|opened the app|just asking|checking in|for asking/i;

/** New users: no score, no filler wins. An honest first week that names the target. */
function firstWeekReview({ filters, calories, protein, daysLogged } = {}) {
  const { kcal, prot } = targetsOf(calories, protein);
  const n = Math.max(0, parseInt(daysLogged, 10) || 0);
  const cite = `${fmt(kcal)} kcal and ${prot} g protein`;
  const m = safeMeal({ filters: filters || [], calories: kcal, protein: prot });
  const headline = n === 0
    ? `Week one is open. Log 3 days and I'll score it. Your target is ${cite}.`
    : `You logged ${n} day${n === 1 ? '' : 's'}. Log ${3 - n} more and I'll score the week. Your target is ${cite}.`;
  const wins = n === 0 ? [] : [`You logged ${n} day${n === 1 ? '' : 's'}. That is a real start, and it is not a score yet.`];
  const focus = [
    'Log breakfast, lunch and dinner on 3 days this week.',
    `On the days you log, aim at ${cite}.`,
    m ? m.text : SAFE_TIP,
  ];
  return { headline, wins, focus, score: null };
}

/** Checked review for a week that has logs, when the model cannot be verified. Score is never 1. */
function addressedWeeklyReview({ filters, calories, protein, daysLogged, workouts } = {}) {
  const { kcal, prot } = targetsOf(calories, protein);
  const days = Math.max(0, parseInt(daysLogged, 10) || 0);
  const m = safeMeal({ filters: filters || [], calories: kcal, protein: prot });
  const trained = Math.max(0, parseInt(workouts, 10) || 0);
  const score = Math.min(9, Math.max(4, days + (trained ? 1 : 0)));
  return {
    headline: `You logged ${days} days. At ${fmt(kcal)} kcal and ${prot} g protein, that is the number to read.`,
    wins: [`You logged ${days} days this week.`],
    focus: [
      days < 7 ? 'Log the missing days so the average is real.' : 'Keep the same rhythm next week.',
      trained ? `You trained ${trained} time${trained === 1 ? '' : 's'}. Keep one session you can repeat.` : 'Add one training session you can repeat next week.',
      m ? m.text : SAFE_TIP,
    ],
    score,
  };
}

/** Drop filler wins. A score of 1 with nothing real behind it is withheld. */
function polishReview(review, stats = {}) {
  const days = Math.max(0, parseInt(stats.daysLogged, 10) || 0);
  if (days < 3) return firstWeekReview({ ...stats, daysLogged: days });
  const src = review && typeof review === 'object' ? review : {};
  const wins = (Array.isArray(src.wins) ? src.wins : []).map((w) => String(w)).filter((w) => w.trim() && !FILLER_WIN.test(w));
  let score = parseInt(src.score, 10);
  if (!Number.isFinite(score)) score = null;
  else score = Math.min(10, Math.max(1, score));
  if (score === 1 && !wins.length) score = null;
  return {
    headline: src.headline || `You logged ${days} days.`,
    wins: wins.length ? wins : [`You logged ${days} days this week.`],
    focus: Array.isArray(src.focus) && src.focus.length ? src.focus : ['Pick one meal and one session to repeat next week.'],
    score,
  };
}

/** Every string in a weekly-review JSON value, for the food check. */
function reviewText(value) {
  const parts = [];
  const walk = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return parts.join('\n');
}

module.exports = {
  SAFE_NOTICE, PLAN_NOTICE, SAFE_TIP, COMING_SOON, PAST_BUDGET_HOLD, pastBudgetHoldText, pastBudgetHoldReview, brokenGroups, listOf, allergyDiets, savedFilters, combineFilters, textBreaksFilters, isFoodTalk,
  safeMeal, safeCoachReply, safeTrainingReply, safeInsight, safeWeeklyReview, safeWorkoutPlan, UNREADABLE, wellFormedFilters, MAX_FILTERS, MAX_FILTER_LEN, MAX_FILTER_SCAN, UNREADABLE_NOTICE, PAST_BUDGET_NOTE, unreadableNotice, ALL_FREE, unreadable, filterSaveError, CAP_ERROR, planFilters,
  prepareFoodText, replyIssues, replyVerified, addressedCoachReply, addressedInsight, addressedWeeklyReview, firstWeekReview, polishReview, reviewText, targetsOf, fmt, FILLER_WIN, notesForReply, SAFE_PROTEIN_LINE,
};
