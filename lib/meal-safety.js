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

const lexicon = require('./food-lexicon');
// Every template and food-database name is recognised food.
for (const t of engine.TEMPLATES) { lexicon.addSafe(t.name); for (const [f] of t.items) lexicon.addSafe(f); }
try { for (const f of require('../food-db').FOODS) lexicon.addSafe(f.name); } catch (_) { /* optional */ }

// Free-text allergies -> the flags they exclude (whole words on normalised text, so "coconut", "nutmeg",
// "butternut" and "eggplant" exclude nothing). A fish allergy also excludes shellfish (prawns are tagged fish).
// Typed allergy words, including every FSANZ PEAL label term, each mapped to its group. Crustacea and molluscs
// (bivalves, cephalopods, gastropods) share the shellfish group: the lexicon flags every one of those foods shellfish.
const ALLERGY_WORDS = Object.freeze([
  ['gluten', /\b(?:gluten|glutens|wheat|coeliac|celiac|barley|rye|oats?|spelt|triticale|kamut|durum|semolina|cereals? containing gluten|gluten cereals?|gluten containing cereals?)\b/],
  ['dairy', /\b(?:dairy|lactose|milk|milks|casein|whey|cheese|cow s milk|cows milk|milk products?|milk protein)\b/],
  ['nuts', /\b(?:nuts?|tree ?nuts?|peanuts?|groundnuts?|almonds?|cashews?|walnuts?|pecans?|hazelnuts?|pistachios?|macadamias?|brazil ?nuts?|pine ?nuts?)\b/],
  ['eggs', /\b(?:eggs?|egg products?)\b/],
  ['soy', /\b(?:soy|soya|soybeans?|soy ?beans?|soya ?beans?|tofu|edamame)\b/],
  ['sesame', /\b(?:sesame|sesame seeds?|tahini)\b/],
  ['shellfish', /\b(?:shell ?fish|crustacea|crustaceans?|molluscs?|mollusks?|mollusca|bivalves?|cephalopods?|gastropods?|prawns?|shrimps?|crabs?|lobsters?|crayfish|yabb(?:y|ies)|marron|bugs?|moreton bay bugs?|balmain bugs?|scampi|langoustines?|oysters?|mussels?|scallops?|squid|calamari|octopus|octopi|cuttlefish|clams?|pipis?|cockles?|abalone|snails?|escargots?|whelks?)\b/],
  ['fish', /\b(?:fish|finfish|seafood)\b/],
]);
// Words in an allergy note that name no food ("severe allergy to ...").
const ALLERGY_FILLER = new Set(lexicon.tokensOf('allergy allergies allergic intolerance intolerant intolerances sensitive sensitivity severe mild anaphylaxis anaphylactic reaction to and or of the a no none nil n a not any all free diet coeliac celiac disease avoid'));

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
  if (typeof v === 'string') { try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch (_) { /* plain text */ } return v.split(/[,;\n]/); }
  return [];
};

// One typed allergy's lexicon reading, cached by its text (the lexicon is fixed once the module has loaded).
// The near-miss scan costs about 1 ms an item, and each check reads the same few allergies many times.
const ALLERGY_CACHE = new Map();
let ALLERGY_SCANS = 0; // lexicon readings actually run (tests pin the cache and the de-duplication)
// A stored list can hold thousands of distinct words inside the character budget. The lexicon
// near-miss is the slow part, so one check runs it on the first few only. Later words still
// become exact typed terms. The result is cached only when the lexicon actually ran (EQA #127 r11 S4).
const TYPED_LEXICON_SCANS = 40;
let scansLeft = TYPED_LEXICON_SCANS;
function beginTypedScan() { scansLeft = TYPED_LEXICON_SCANS; }
function allergyInfo(a) {
  const s = lexicon.normalise(a);
  if (!s) return null;
  let info = ALLERGY_CACHE.get(s);
  if (info) return info;
  const words = ALLERGY_WORDS.filter(([, re]) => re.test(s)).map(([f]) => f);
  let scanned = new Set();
  let full = false;
  if (scansLeft > 0) {
    scansLeft -= 1;
    ALLERGY_SCANS += 1;
    scanned = lexicon.scan(s).flags;
    full = true;
  }
  const flags = new Set(words);
  // "shellfish" or "prawns" alone is not a fish allergy.
  for (const f of scanned) if (f !== 'fish' || words.includes('fish')) flags.add(f);
  const terms = new Set();
  if (!words.length && !scanned.size) for (const t of lexicon.tokensOf(s)) if (t.length > 2 && !ALLERGY_FILLER.has(t)) terms.add(t);
  info = { flags, terms };
  if (full) {
    if (ALLERGY_CACHE.size >= 20000) ALLERGY_CACHE.clear(); // a budget-capped list holds well under this
    ALLERGY_CACHE.set(s, info);
  }
  return info;
}

/** Flags to exclude for a user's diet filters and free-text allergies. */
function excludedFlags({ dietary = [], allergies = [] } = {}) {
  beginTypedScan();
  const out = new Set();
  for (const d of engine.normaliseDiet(listOf(dietary))) for (const f of engine.DIET_EXCLUDES[d] || []) out.add(f);
  for (const a of listOf(allergies)) {
    const info = allergyInfo(a);
    if (info) for (const f of info.flags) out.add(f);
  }
  if (out.has('fish')) out.add('shellfish');
  return out;
}

/** Groups a typed allergy names by the label-word list alone (no lexicon or near-miss spelling). */
function allergyWordGroups(text) {
  const s = lexicon.normalise(text);
  return new Set(ALLERGY_WORDS.filter(([, re]) => re.test(s)).map(([f]) => f));
}

/** Allergy words that map to no flag ("lupin", "mustard"): a meal naming one of them is unsafe. */
function customTerms({ allergies = [] } = {}) {
  beginTypedScan();
  const out = new Set();
  for (const a of listOf(allergies)) {
    const info = allergyInfo(a);
    if (info) for (const t of info.terms) out.add(t);
  }
  return out;
}

/** Every flag a piece of text names: the food lexicon, the builder's matcher and hidden-allergen dishes. */
function flagsInText(text) {
  const scanned = lexicon.scan(text);
  const out = new Set(scanned.flags);
  // "egg free", "nut free" name the filter, not the food; the rest of the phrase is still checked. Known-safe
  // phrases ("butter beans", "coconut milk") are gone from scanned.rest.
  const s = scanned.rest.replace(/\b(?:gluten|wheat|dairy|lactose|nut|peanut|egg|soy|sesame|shellfish|fish|meat)\s+free\b/g, ' ');
  for (const f of engine.allergensOf([[s]])) out.add(f);
  for (const [flag, re] of HIDDEN) if (re.test(s)) out.add(flag);
  return out;
}

/** Ingredient names (strings at any depth), or null if the list is missing, empty or unreadable. */
function ingredientNames(meal) {
  const ings = meal && (meal.ingredients ?? meal.foods ?? meal.items);
  const names = [];
  const pick = (i) => {
    if (typeof i === 'string') { if (i.trim()) names.push(i); return true; }
    if (Array.isArray(i)) return i.every(pick);
    if (i && typeof i === 'object') {
      const n = i.item ?? i.name ?? i.food ?? i.ingredient;
      if (typeof n === 'string' && n.trim()) { names.push(n); return true; }
      const vals = Object.values(i).filter((v) => typeof v === 'string' && v.trim());
      if (!vals.length) return false;
      names.push(...vals); return true;
    }
    return false;
  };
  if (typeof ings === 'string') { for (const x of ings.split(/[,;\n]/)) if (x.trim()) names.push(x); }
  else if (Array.isArray(ings)) { if (!ings.every(pick)) return null; }
  else if (ings && typeof ings === 'object') { if (!pick(Object.values(ings))) return null; }
  return names.length ? names : null;
}

// A builder template meal (same name, exactly its ingredients) is judged by its derived flags, so dish words
// in its name ("Lentil and tempeh bolognese") don't trip the hidden-allergen list.
const TEMPLATE_BY_NAME = new Map(engine.TEMPLATES.map((t) => [t.name, t]));
function templateFlags(meal) {
  const t = TEMPLATE_BY_NAME.get(meal.name);
  if (!t || !Array.isArray(meal.ingredients)) return null;
  const want = t.items.map(([f]) => engine.displayName(f)).sort();
  const got = meal.ingredients.map((i) => (i && typeof i === 'object' && !Array.isArray(i) && Object.keys(i).every((k) => k === 'item' || k === 'qty') && typeof i.item === 'string' ? i.item : null)).sort();
  return want.length === got.length && want.every((n, i) => n === got[i]) ? engine.flagsOf(t) : null;
}

// Keys whose values are declarations of what a meal contains: anything listed there is final.
const DECLARED = /^(?:contains|allergens?|allergy|allergies|containsallergens|maycontain|traces|warnings?|dietflags|flags)$/i;
// Keys that hold no food words (ids, links, images): checked for allergens but not for unrecognised words.
const META = /^(?:id|uuid|_id|image|imageurl|img|photo|thumbnail|url|link|href|emoji|icon|createdat|updatedat|date|day|slot|time|source|provider|model|replacedforfilters|cuisine|difficulty|unit|units)$/i;
// Vague carriers: "sauce" or "dressing" with nothing saying what it is.
const VAGUE = new Set(lexicon.tokensOf('sauce dressing marinade paste spread glaze dip condiment seasoning rub mix blend topping stock'));
const STYLE = new Set(lexicon.tokensOf('a an and or of the with without in on to for your any some extra optional side house secret special signature favourite favorite homemade home made asian thai indian mexican italian greek japanese korean chinese vietnamese mediterranean middle eastern american classic creamy spicy sweet sticky smoky tangy zesty rich mild hot easy quick simple healthy light lite low reduced little lots plus then style'));

function vagueWords(text) {
  const t = lexicon.tokensOf(text);
  return t.filter((w, i) => VAGUE.has(w) && (i === 0 || STYLE.has(t[i - 1]) || VAGUE.has(t[i - 1]))).map((w) => `${w} (unspecified)`);
}

const INGREDIENT_KEYS = /^(?:ingredients|foods|items)$/;
// Keys of an ingredient object that hold its parts, not a food ({ item, qty }); any other key is read as food.
const STRUCT_KEYS = /^(?:item|name|food|ingredient|title|qty|quantity|amount|unit|units|measure|grams|g|ml|weight|serving|servings|size|notes?|prep|preparation|optional|calories|kcal|protein|carbs|fat|fibre|fiber|sugar|sodium|id|type|category|brand|description|a|b|c|d|\d+)$/i;

// Typed allergies with no flag match whole tokens, compounds and close forms: "kiwi" catches "kiwifruit".
const TERM_SYNONYMS = { mustard: ['dijon'], celery: ['celeriac'], lupin: ['lupini', 'lupine'], kiwi: ['kiwifruit'], sulphite: ['sulfite', 'sulphites', 'sulfites'], banana: ['plantain'], tomato: ['passata', 'ketchup'] };
function termHits(normalised, terms) {
  const out = new Set();
  if (!terms || !terms.size) return out;
  const toks = lexicon.tokensOf(normalised);
  // Near-miss ("Strawbery" for strawberry) on a normal list. A huge stored list stays on exact tokens (EQA #127 r11 L2, S4).
  const near = terms.size <= 80;
  for (const term of terms) {
    const forms = [term, ...(TERM_SYNONYMS[term] || [])];
    if (toks.some((t) => forms.some((f) => t === f || (f.length >= 4 && (t.startsWith(f) || t.endsWith(f))) || (near && lexicon.nearWord(t, f))))) out.add(term);
  }
  return out;
}

// Dish words in a meal name that usually imply an allergen ("scramble" is eggs, "bolognese" is meat). The flag is
// lifted only when the name says nothing else that carries it and the ingredient list names the stand-in
// ("Tofu scramble" with tofu, "Lentil and tempeh bolognese" with lentils). The ingredients are still checked.
const GF_FLOUR = /\b(?:almond flour|almond meal|coconut flour|rice flour|buckwheat flour|gluten free flour|gf flour|chickpea flour|besan|tapioca flour|sorghum flour)\b/;
const DISH_OVERRIDES = Object.freeze([
  { flag: 'eggs', dish: /\bscrambled?\b/g, need: /\b(?:tofu|chickpea|besan)\b/ },
  { flag: 'meat', dish: /\b(?:bolognese|bolognaise|ragu|mince|meatballs?|burgers?|sausages?|chilli con carne)\b/g, need: /\b(?:lentils?|tempeh|tofu|tvp|textured vegetable protein|mushrooms?|beans?|chickpeas?|vegan mince|plant mince)\b/ },
  { flag: 'dairy', dish: /\bsmoothies?\b/g, need: /\b(?:soy milk|soya milk|oat milk|almond milk|rice milk|coconut milk|tofu)\b/ },
  // Fried rice and muffins usually contain egg and wheat flour: a missing ingredient doesn't make them safe.
  // Only a stated stand-in does (tofu or "egg free"; a named gluten-free flour).
  // r7: fried rice is handled by friedRiceEggFree below (the whole name must be the egg-free dish).
  { flag: 'gluten', dish: /\bmuffins?\b/g, need: GF_FLOUR, unless: /\b(?:english|eng|engl|engl?sh|e)\b/ }, // 'Eng. muffin', 'Engl muffins', 'E. muffin'
  { flag: 'gluten', dish: /(?<!english )\b(?:pancakes?|pikelets?)\b/g, need: GF_FLOUR },
]);
// r7: fried rice loses its egg flag only when the whole name is the egg-free dish: "tofu fried rice" (and tofu is in
// the ingredients), or an egg-free claim on fried rice with at most one other word that carries no egg
// ("no egg fried rice", "without egg chicken fried rice", "fried rice (egg free)"). "Tofu-style", "tofu chicken" or
// "tofu special" fried rice, and tofu beside the dish, keep it.
const EGG_FREE = '(?:egg free|eggless|egg less|no egg|without egg)';
const FR_TOFU = /^tofu fried rice$/;
const FR_EGG_FREE = new RegExp(`^(?:${EGG_FREE} (?:([a-z]+) )?fried rice|(?:([a-z]+) )?fried rice ${EGG_FREE})$`);
function friedRiceEggFree(n, ingredientText) {
  if (FR_TOFU.test(n)) return /\btofu\b/.test(ingredientText);
  const m = FR_EGG_FREE.exec(n);
  if (!m) return false;
  const extra = m[1] || m[2];
  return !extra || !flagsInText(extra).has('eggs');
}
function nameFlags(name, ingredientText) {
  const flags = flagsInText(name);
  const n = lexicon.normalise(name).trim();
  if (flags.has('eggs') && friedRiceEggFree(n, ingredientText)) flags.delete('eggs');
  for (const o of DISH_OVERRIDES) {
    if (!flags.has(o.flag) || (o.unless && o.unless.test(n)) || !o.need.test(ingredientText)) continue;
    o.dish.lastIndex = 0;
    if (!o.dish.test(n)) continue;
    o.dish.lastIndex = 0;
    if (!flagsInText(n.replace(o.dish, ' ')).has(o.flag)) flags.delete(o.flag);
  }
  return flags;
}

/** Why a structured meal is unsafe for these excluded flags, or null when it's fine. Fails closed. */
function mealProblems(meal, excluded, terms) {
  if (!excluded || !excluded.size) { if (!terms || !terms.size) return null; excluded = new Set(); }
  if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return ['unreadable meal'];
  const names = ingredientNames(meal);
  if (!names) {
    // No ingredient list (a typed meal is often just a name): report what the name itself names, so the user sees
    // "Contains shellfish", and fail closed as unrecognised only when the name names nothing excluded.
    const label = [meal.name, meal.mealName, meal.title, meal.description].filter((x) => typeof x === 'string').join(', ');
    // r8: a name that is exactly one of our checked builder meals ("Tofu scramble on wholegrain toast") is judged
    // by that meal's derived flags (gluten, soy), not by its dish words (scramble is not eggs here).
    const tpl = typeof meal.name === 'string' && TEMPLATE_BY_NAME.get(meal.name.trim());
    const rest = [meal.mealName, meal.title, meal.description].filter((x) => typeof x === 'string').join(', ');
    const nameSet = tpl ? new Set([...engine.flagsOf(tpl), ...flagsInText(rest)]) : flagsInText(label);
    const named = [...nameSet].filter((f) => excluded.has(f));
    for (const t of termHits(lexicon.normalise(label), terms)) named.push(`allergy: ${t}`);
    if (tpl && !named.length) return null; // one of our checked meals, and it fits
    return named.length ? named : ['no readable ingredient list'];
  }
  const hit = new Set(); const unknown = new Set();
  const known = templateFlags(meal);
  if (known) for (const f of known) hit.add(f);
  // Fail closed on the ingredient list only (unknown words, unnamed sauces, symbols). Every other string
  // (name, description, method, notes) is scanned for known allergens and typed allergies, so ordinary
  // AI prose ("a quick, filling lunch") doesn't reject a safe meal.
  const ingredientText = lexicon.normalise(names.join(', '));
  const check = (text, { meta = false, declared = false, templated = false, ingredient = false, mealName = false } = {}) => {
    if (typeof text !== 'string' || !text.trim()) return;
    for (const f of (mealName ? nameFlags(text, ingredientText) : flagsInText(text))) if (!templated) hit.add(f);
    const n = lexicon.normalise(text);
    if (declared) { for (const [flag, re] of ALLERGY_WORDS) if (re.test(n)) hit.add(flag); if (re0.test(n)) return; }
    for (const t of termHits(n, terms)) hit.add(`allergy: ${t}`);
    if (meta || templated || !ingredient) return;
    for (const u of lexicon.scan(text).unknown) unknown.add(u);
    for (const v of vagueWords(n)) unknown.add(v);
  };
  const re0 = /^(?:none|nil|no|n a|na|free|none listed)$/;
  // Every string in the meal, at any depth, and every key of an ingredient object ({ peanuts: '40g' }).
  const walk = (v, key, ctx, depth) => {
    if (depth > 12) { unknown.add('too deeply nested'); return; }
    if (typeof v === 'string') return check(v, ctx);
    if (typeof v === 'number' || typeof v === 'boolean' || v == null) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, key, ctx, depth + 1); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (depth === 0 && k === 'swaps') continue; // swap options are checked on their own
        const c = { ...ctx };
        if (DECLARED.test(k)) c.declared = true;
        if (META.test(k)) c.meta = true;
        if (depth === 0 && INGREDIENT_KEYS.test(k)) c.ingredient = true;
        if (depth === 0 && k === 'name') c.mealName = true;
        if (known && depth === 0 && (k === 'name' || k === 'ingredients')) c.templated = true;
        if (ctx.ingredient && !STRUCT_KEYS.test(k)) check(k, { ...ctx, meta: false });
        walk(x, k, c, depth + 1);
      }
    }
  };
  walk(meal, '', {}, 0);
  const problems = [...hit].filter((f) => excluded.has(f) || f.startsWith('allergy: '));
  if (unknown.size) problems.push(...[...unknown].slice(0, 5).map((u) => `unrecognised: ${u}`));
  return problems.length ? problems : null;
}

const SLOT_SHARE = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

/**
 * Replace every unsafe meal in a plan ({ days: [{ meals: { slot: meal } }] }) with a safe template meal,
 * recompute each day's totals and the plan averages. Returns { plan, replaced, dropped }.
 */
function enforcePlan(plan, { dietary = [], allergies = [], calories, protein } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  const terms = customTerms({ allergies });
  if (!plan || !Array.isArray(plan.days) || (!excluded.size && !terms.size)) return { plan, replaced: [], dropped: [] };
  const replaced = []; const dropped = [];
  const days = plan.days.map((d, di) => {
    if (!d || typeof d !== 'object' || !d.meals || typeof d.meals !== 'object' || Array.isArray(d.meals)) {
      dropped.push({ day: di, slot: '*', reasons: ['unreadable day'] });
      return { ...(d && typeof d === 'object' ? d : {}), meals: {}, dailyTotals: engine.totalsOf({}) };
    }
    const meals = {};
    for (const [slot, meal] of Object.entries(d.meals)) {
      const problems = mealProblems(meal, excluded, terms);
      if (!problems) { meals[slot] = safeSwapList(meal, excluded, terms); continue; }
      const kcal = Number(meal && meal.calories) > 0 ? Number(meal.calories) : (Number(calories) || 2000) * (SLOT_SHARE[slot] || 0.25);
      const prot = Number(meal && meal.protein) > 0 ? Number(meal.protein) : (Number(protein) || 0) * (SLOT_SHARE[slot] || 0.25);
      const safe = safeReplacement(slot, kcal, prot, excluded, terms, replaced.length + di);
      if (safe) { meals[slot] = { ...safe, replacedForFilters: true }; replaced.push({ day: di, slot, from: String((meal && meal.name) || '').slice(0, 80), reasons: problems }); }
      else dropped.push({ day: di, slot, reasons: problems });
    }
    return { ...d, meals, dailyTotals: engine.totalsOf(meals) };
  });
  let out = { ...plan, days };
  if (out.avgDailyCalories !== undefined || out.avgDailyProtein !== undefined) out = engine.finishPlan(out, { protein: plan.targetProtein ?? protein });
  if (replaced.length || dropped.length) {
    const n = replaced.length + dropped.length;
    const all = [...replaced, ...dropped];
    const unknownOnly = all.every((r) => (r.reasons || []).every((x) => !FLAG_WORDS[x] && !String(x).startsWith('allergy: ')));
    const some = all.some((r) => (r.reasons || []).some((x) => !FLAG_WORDS[x] && !String(x).startsWith('allergy: ')));
    const why = unknownOnly ? "had ingredients we couldn't check against your filters" : some ? "didn't fit your filters or had ingredients we couldn't check" : "didn't fit your filters";
    const note = `${n} meal${n === 1 ? '' : 's'} ${why} and ${n === 1 ? 'was' : 'were'} ${dropped.length ? 'replaced or removed' : 'replaced with a safe meal'}.`;
    out.notes = [...(Array.isArray(plan.notes) ? plan.notes : []), note];
  }
  return { plan: out, replaced, dropped };
}

/** A meal's swap options without the ones that fail the check. */
function safeSwapList(meal, excluded, terms) {
  if (!meal || !Array.isArray(meal.swaps)) return meal;
  return { ...meal, swaps: meal.swaps.filter((x) => !mealProblems(x, excluded, terms)) };
}

/**
 * The template meal for the slot that passes the same check (flags, allergy words) closest to the meal's
 * calories and protein. Protein counts double, so a high-protein meal is replaced by a high-protein one.
 */
const REPLACEMENT_CACHE = new Map();
// Safe meals whose cost is within this of the closest one count as equally good, and are rotated through.
const REPLACEMENT_SLACK = 0.12;
function safeReplacement(slot, kcal, prot, excluded, terms, seed = 0) {
  if (!engine.SLOTS.includes(slot)) return null;
  const key = [slot, Math.round(kcal), Math.round(prot), [...excluded].sort().join('+'), [...(terms || [])].sort().join('+')].join('|');
  let list = REPLACEMENT_CACHE.get(key);
  if (list === undefined) {
    const protOff = (m) => (prot > 0 ? Math.abs(m.protein - prot) / prot : 0);
    const found = new Map();
    let best = null;
    for (const s of [slot, ...engine.SLOTS.filter((x) => x !== slot)]) {
      // Another slot's template only when this slot's best is more than 20% off on protein.
      if (s !== slot && best && protOff(best.m) <= 0.2) break;
      for (const pw of [1, 2, 4]) {
        for (const m of engine.safeMealsFor(s, { kcal, protein: prot, excluded: [...excluded], proteinWeight: pw, avoid: terms }, 6)) {
          if (found.has(m.name) || mealProblems(m, excluded, terms)) continue;
          const cost = Math.abs(m.calories - kcal) / kcal + 2 * protOff(m) + (s === slot ? 0 : 0.3);
          found.set(m.name, { m, cost });
          if (!best || cost < best.cost) best = { m, cost };
        }
      }
    }
    list = best ? [...found.values()].filter((x) => x.cost <= best.cost + REPLACEMENT_SLACK).sort((x, y) => x.cost - y.cost || (x.m.name < y.m.name ? -1 : 1)).slice(0, 4).map((x) => JSON.stringify(x.m)) : [];
    if (REPLACEMENT_CACHE.size > 5000) REPLACEMENT_CACHE.clear();
    REPLACEMENT_CACHE.set(key, list);
  }
  if (!list.length) return null;
  const i = ((Math.floor(Number(seed)) || 0) % list.length + list.length) % list.length;
  return JSON.parse(list[i]);
}
const seedOf = (text) => { let h = 0; for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0; return h; };

/** Allergy text for a prompt: no control, line-break or invisible characters, no quotes or brackets. */
function promptSafe(a) {
  return String(a == null ? '' : a).normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/[`"{}<>[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

const isMealLike = (m) => m && typeof m === 'object' && !Array.isArray(m) && ['name', 'title', 'ingredients', 'foods', 'items'].some((k) => k in m);

const FLAG_LABEL = { gluten: 'gluten', dairy: 'dairy', nuts: 'nuts', eggs: 'eggs', soy: 'soy', sesame: 'sesame', shellfish: 'shellfish', fish: 'fish', meat: 'meat' };

/** The warning for a meal's problems: the matched allergens, or 'unrecognised ingredients'. */
function warningFor(problems) {
  const allergens = []; let unrecognised = false;
  for (const p of problems) {
    if (FLAG_LABEL[p]) allergens.push(FLAG_LABEL[p]);
    else if (p.startsWith('allergy: ')) allergens.push(p.slice(9));
    else unrecognised = true;
  }
  const uniq = [...new Set(allergens)];
  const parts = [];
  if (uniq.length) parts.push(`Contains ${uniq.join(', ')}`);
  if (unrecognised) parts.push(uniq.length ? 'and unrecognised ingredients' : 'Unrecognised ingredients');
  return { allergens: uniq, unrecognised, message: `${parts.join(' ')}: this meal may not fit your filters or allergies.` };
}

const withoutWarning = (m) => { if (!m || typeof m !== 'object' || Array.isArray(m)) return m; const { allergenWarning, ...rest } = m; return rest; };

/**
 * Meals the user typed or edited (saved, manual and edited plans in any stored shape: { days }, day form with
 * meals as an object or a list, a flat list of manual meals) are never replaced or removed. Each meal is kept
 * exactly as entered; one that fails the check gets allergenWarning { allergens, unrecognised, message }, and
 * a stale warning is recomputed. Returns { meals, warned }.
 */
function enforceSavedMeals(meals, filters = {}) {
  const excluded = excludedFlags(filters);
  const terms = customTerms(filters);
  let value = meals;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return { meals, warned: [] }; } }
  const on = excluded.size || terms.size;
  const warned = [];
  const mark = (meal, where) => {
    if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return meal;
    const clean = withoutWarning(meal);
    if (!on) return clean;
    const problems = mealProblems(clean, excluded, terms);
    if (!problems) return clean;
    const w = warningFor(problems);
    warned.push({ ...where, name: String(clean.name || clean.title || '').slice(0, 80), ...w });
    return { ...clean, allergenWarning: w };
  };
  const day = (d, i) => {
    if (!d || typeof d !== 'object' || Array.isArray(d) || !d.meals || typeof d.meals !== 'object') return null;
    const out = Array.isArray(d.meals)
      ? d.meals.map((m, j) => mark(m, { day: i, slot: j }))
      : Object.fromEntries(Object.entries(d.meals).map(([k, m]) => [k, mark(m, { day: i, slot: k })]));
    return { ...d, meals: out };
  };
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.days)) {
    return { meals: { ...value, days: value.days.map((d, i) => day(d, i) || d) }, warned };
  }
  if (!Array.isArray(value)) return { meals, warned };
  return { meals: value.map((d, i) => day(d, i) || (isMealLike(d) ? mark(d, { day: '*', slot: i }) : d)), warned };
}

/** Plain-English list for prompts: "Never use: nuts and peanuts (...); sesame (...)." */
function promptRules({ dietary = [], allergies = [] } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  const diet = engine.normaliseDiet(listOf(dietary)).filter((d) => engine.DIET_FILTERS.includes(d));
  // One line per rule: line breaks, control and invisible characters are removed from allergy text so it
  // can't start a new instruction in the prompt.
  const allergyText = listOf(allergies).map(promptSafe).filter(Boolean).map((a) => a.slice(0, 40).trim()).slice(0, 10);
  if (!excluded.size && !diet.length && !allergyText.length) return '';
  const lines = [];
  if (diet.length) lines.push(`Dietary filters (must follow): ${diet.join(', ')}.`);
  if (allergyText.length) lines.push(`Allergies (must follow): ${allergyText.join(', ')}.`);
  if (excluded.size) lines.push(`Never include, even as a sauce, oil, milk, topping or hidden ingredient: ${[...excluded].map((f) => FLAG_WORDS[f] || f).join('; ')}.`);
  lines.push('List every ingredient, including sauces, oils and milks. If unsure an ingredient fits, leave it out.');
  return lines.join('\n');
}

const ABBREV = /\b(?:approx|e\.g|i\.e|etc|vs|incl|tbsp|tsp|min|mins|hr|hrs|no|approx|est|dr|mr|mrs|ms|st|ave|qty|pkt|pk|cal|kcal|g|kg|ml)\.$/i;
/** Sentences of a line, not split after abbreviations ("approx.", "e.g.", "tbsp.") or decimals. */
function sentencesOf(line) {
  const raw = line.split(/(?<=[.!?])\s+/);
  const out = [];
  for (const piece of raw) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
const LIST_ITEM = /^(\s*)(?:(\d+)([.)])|([-*•]))\s+/;
// A sentence that only makes sense after the one before it: a reference ("It has...", "Pair it with...") or a
// conjunction offering an alternative to it ("Or rice.").
const DANGLING = /^(?:it|its|it's|this|that|these|those|they|their|them|which|also|plus|or|and|but|alternatively|otherwise|instead|either)\b|^(?:pair|serve|top|add|have|enjoy|try|mix|stir|eat|combine|swap|use)\s+(?:it|them|this|that|these|those)\b/i;
// Inline numbered lists ("Ideas: 1. x. 2. y.") become one item per line, so items are cut and renumbered whole.
const INLINE_ITEM = /(^|\s)(\d{1,2})[.)]\s+(?=\S)/g;
function splitInlineList(line) {
  if (LIST_ITEM.test(line)) {
    const rest = line.replace(LIST_ITEM, '');
    if (!/\s2[.)]\s/.test(rest)) return [line];
  }
  const marks = [];
  for (const m of line.matchAll(INLINE_ITEM)) marks.push({ at: m.index + m[1].length, num: Number(m[2]) });
  // Only a real run: 1, 2, 3... in order, at least two items.
  const run = [];
  for (const m of marks) if (m.num === run.length + 1) run.push(m);
  if (run.length < 2) return [line];
  const parts = [];
  const head = line.slice(0, run[0].at).trim();
  if (head) parts.push(head);
  run.forEach((m, i) => parts.push(line.slice(m.at, i + 1 < run.length ? run[i + 1].at : undefined).trim()));
  return parts;
}
const SLOT_WORDS = [['breakfast', /\b(?:breakfast|brekkie|morning)\b/i], ['snack', /\bsnacks?\b/i], ['dinner', /\b(?:dinner|tea|evening)\b/i], ['lunch', /\blunch\b/i]];

/** What a sentence names that the user must avoid: flags, typed allergies (with compounds), near-miss spellings. */
function badIn(text, excluded, terms) {
  const bad = [...flagsInText(text)].filter((f) => excluded.has(f));
  for (const t of termHits(lexicon.normalise(text), terms)) bad.push(`allergy: ${t}`);
  return bad;
}

/**
 * Check free text (chat replies, tips). List items that name something excluded are removed whole and the
 * rest renumbered ("Here are 3 ideas" is corrected); in prose, the sentence is removed along with a
 * follow-on sentence that only makes sense with it ("It also has 8g of protein."). Abbreviations don't
 * split sentences. If anything is removed, a short note and a safe option for the meal the text is about
 * are appended. Returns { text, removed }.
 */
function enforceText(text, { dietary = [], allergies = [], slot, kcal = 500, protein = 30, alternative = true } = {}) {
  const excluded = excludedFlags({ dietary, allergies });
  const terms = customTerms({ allergies });
  const s = String(text == null ? '' : text);
  if ((!excluded.size && !terms.size) || !s) return { text: s, removed: [] };
  const removed = [];
  const lines = s.split('\n').flatMap(splitInlineList);
  const keptLines = [];
  let listDropped = 0;
  for (const line of lines) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      const bad = badIn(line, excluded, terms);
      if (bad.length) { removed.push(bad); listDropped += 1; continue; }
      keptLines.push(line);
      continue;
    }
    const kept = []; let dropNext = false;
    for (const sentence of sentencesOf(line)) {
      const bad = badIn(sentence, excluded, terms);
      if (bad.length) { removed.push(bad); dropNext = true; continue; }
      if (dropNext && DANGLING.test(sentence.trim())) continue;
      dropNext = false;
      kept.push(sentence);
    }
    keptLines.push(kept.join(' '));
  }
  if (!removed.length) return { text: s, removed };
  // Renumber numbered list items, fix "Here are N ideas", and drop a heading left with no items under it.
  let n = 0; const items = keptLines.filter((l) => LIST_ITEM.exec(l)).length;
  let out = keptLines.map((l) => {
    const m = LIST_ITEM.exec(l);
    if (m && m[2]) { n += 1; return l.replace(LIST_ITEM, `${m[1]}${n}${m[3]} `); }
    return l;
  });
  if (listDropped) {
    out = out.map((l) => (LIST_ITEM.test(l) ? l : l.replace(/\b(\d+|two|three|four|five|six)(\s+(?:quick\s+|easy\s+|simple\s+|healthy\s+)?(?:ideas?|options?|meals?|snacks?|suggestions?|swaps?|recipes?))\b/i, (all, num, rest) => (items ? `${items}${items === 1 ? rest.replace(/s\b/, '') : rest}` : all))));
    if (items === 1) out = out.map((l) => (LIST_ITEM.test(l) ? l : l.replace(/\b(here|there) are 1\b/i, (all, w) => `${w} is 1`)));
    if (!items) out = out.filter((l) => !/:\s*$/.test(l.trim()));
  }
  const kept = out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const flags = [...new Set(removed.flat())];
  const about = slot || (SLOT_WORDS.find(([, re]) => re.test(s)) || ['lunch'])[0];
  const safe = alternative ? safeReplacement(about, kcal, protein, excluded, terms, seedOf(s)) : null;
  const alt = safe ? ` A safe ${about} option: ${safe.name} (${safe.ingredients.map((i) => i.item.replace(/, cooked$/, '').toLowerCase()).join(', ')}).` : '';
  const names = flags.map((f) => (f.startsWith('allergy: ') ? `${f.slice(9)} allergy` : FILTER_NAME[f] || `${f} free`));
  const note = `I removed a suggestion that didn't fit your filters (${[...new Set(names)].join(', ')}).${alt}`;
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
/**
 * True when a stored list runs past main's read budget (MAX_FILTER_SCAN characters), so items after it are
 * never read. A list that is unreadable only because of an odd entry ([{x:1}, 'banana']) is not past it:
 * every string in it is still read and checked.
 */
function pastBudget(v, dg) {
  let x = v;
  if (typeof x === 'string') {
    if (x.length > dg.MAX_FILTER_SCAN) return true;
    try { x = JSON.parse(x); } catch (_) { return false; }
  }
  if (!x || typeof x !== 'object') return false;
  if (Array.isArray(x)) {
    let budget = dg.MAX_FILTER_SCAN;
    for (let i = 0; i < x.length; i += 1) {
      const s = x[i];
      if (s === dg.UNREADABLE) return true;
      budget -= typeof s === 'string' ? Math.max(s.length, 1) : 1;
      if (budget < 0) return true;
    }
    return false;
  }
  let seen = 0;
  for (const k in x) {
    if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
    // Falsy keys still count, matching listOf, so this walk stops with the character budget.
    seen += 1;
    if (x[k] && typeof x[k] !== 'object') seen += k.length;
    if (seen > dg.MAX_FILTER_SCAN) return true;
  }
  return false;
}

function profileFilters(profile) {
  const p = profile || {};
  // Read with main's listOf (#140/#142): an entry it can't read is never silently dropped; it fails
  // closed, so every "... free" filter applies and the warnings carry the notice.
  const dg = require('./diet-guard');
  const rawDiet = p.dietaryPreferences ?? p.dietary_preferences;
  const dietary = dg.listOf(rawDiet);
  const allergies = dg.listOf(p.allergies);
  const unreadable = dietary.includes(dg.UNREADABLE) || allergies.includes(dg.UNREADABLE);
  // Duplicates are dropped (a stored 1M-item list of one word is one allergy to check).
  const known = (l) => [...new Set(l.filter((x) => x !== dg.UNREADABLE))];
  if (!unreadable) return { dietary, allergies: known(allergies) };
  // Every "... free" filter applies and every distinct readable typed item is checked (EQA #127 r10 M2).
  // Past the read budget some typed foods were never read, so meals that aren't flagged are only "unchecked".
  const out = { dietary: [...known(dietary), ...dg.ALL_FREE], allergies: known(allergies), unreadable: true };
  if (pastBudget(p.allergies, dg) || pastBudget(rawDiet, dg)) out.pastBudget = true;
  return out;
}

/** Union of filters: profile plus whatever the request sent. */
function mergeFilters(...sets) {
  const dietary = []; const allergies = [];
  for (const f of sets) { if (!f) continue; dietary.push(...listOf(f.dietary)); allergies.push(...listOf(f.allergies)); }
  return { dietary: engine.normaliseDiet(dietary), allergies: [...new Set(allergies.map((a) => String(a || '').trim()).filter(Boolean))] };
}

// Warm the lexicon and matchers once at load, so a user's first list read isn't the slow one (EQA #127 r10 S3).
try {
  const warm = { dietary: ['gluten free'], allergies: ['qwarmx kiwi', 'peanuts'] };
  enforceSavedMeals([{ name: 'Homemade warm-up dish with sauce', foods: [{ name: 'Pasta' }] }], warm);
} catch (_) { /* warm-up only */ }
ALLERGY_CACHE.clear(); ALLERGY_SCANS = 0;

module.exports = {
  HIDDEN, excludedFlags, customTerms, safeReplacement, flagsInText, ingredientNames, mealProblems, enforcePlan, enforceText, enforceJsonText,
  enforceSavedMeals, warningFor, allergyWordGroups, GF_FLOUR, promptRules, promptSafe, profileFilters, mergeFilters, allergyScans: () => ALLERGY_SCANS,
};
