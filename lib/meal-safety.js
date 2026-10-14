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
const ALLERGY_WORDS = Object.freeze([
  ['gluten', /\b(?:gluten|wheat|coeliac|celiac|barley|rye|oats?|spelt)\b/],
  ['dairy', /\b(?:dairy|lactose|milk|casein|whey|cheese|cow s milk)\b/],
  ['nuts', /\b(?:nuts?|tree ?nuts?|peanuts?|almonds?|cashews?|walnuts?|pecans?|hazelnuts?|pistachios?|macadamias?|brazil nuts?|pine nuts?)\b/],
  ['eggs', /\beggs?\b/],
  ['soy', /\b(?:soy|soya|soybeans?|tofu)\b/],
  ['sesame', /\b(?:sesame|tahini)\b/],
  ['shellfish', /\b(?:shellfish|crustaceans?|molluscs?|mollusks?|prawns?|shrimps?|crabs?|lobsters?|oysters?|mussels?|scallops?|squid|clams?)\b/],
  ['fish', /\b(?:fish|seafood)\b/],
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

/** Flags to exclude for a user's diet filters and free-text allergies. */
function excludedFlags({ dietary = [], allergies = [] } = {}) {
  const out = new Set();
  for (const d of engine.normaliseDiet(listOf(dietary))) for (const f of engine.DIET_EXCLUDES[d] || []) out.add(f);
  for (const a of listOf(allergies)) {
    const s = lexicon.normalise(a);
    if (!s) continue;
    for (const [flag, re] of ALLERGY_WORDS) if (re.test(s)) out.add(flag);
    for (const f of lexicon.scan(s).flags) out.add(f);
  }
  if (out.has('fish')) out.add('shellfish');
  return out;
}

/** Allergy words that map to no flag ("lupin", "mustard"): a meal naming one of them is unsafe. */
function customTerms({ allergies = [] } = {}) {
  const out = new Set();
  for (const a of listOf(allergies)) {
    const s = lexicon.normalise(a);
    if (!s || ALLERGY_WORDS.some(([, re]) => re.test(s)) || lexicon.scan(s).flags.size) continue;
    for (const t of lexicon.tokensOf(s)) if (t.length > 2 && !ALLERGY_FILLER.has(t)) out.add(t);
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

/** Why a structured meal is unsafe for these excluded flags, or null when it's fine. Fails closed. */
function mealProblems(meal, excluded, terms) {
  if (!excluded || !excluded.size) { if (!terms || !terms.size) return null; excluded = new Set(); }
  if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return ['unreadable meal'];
  const names = ingredientNames(meal);
  if (!names) return ['no readable ingredient list'];
  const hit = new Set(); const unknown = new Set();
  const known = templateFlags(meal);
  if (known) for (const f of known) hit.add(f);
  const check = (text, { meta = false, declared = false, templated = false } = {}) => {
    if (typeof text !== 'string' || !text.trim()) return;
    for (const f of flagsInText(text)) if (!templated) hit.add(f);
    const n = lexicon.normalise(text);
    if (declared) { for (const [flag, re] of ALLERGY_WORDS) if (re.test(n)) hit.add(flag); if (re0.test(n)) return; }
    if (terms && terms.size) for (const t of lexicon.tokensOf(n)) if (terms.has(t)) hit.add(`allergy: ${t}`);
    if (meta || templated) return;
    for (const u of lexicon.scan(text).unknown) unknown.add(u);
    for (const v of vagueWords(n)) unknown.add(v);
  };
  const re0 = /^(?:none|nil|no|n a|na|free|none listed)$/;
  // Every string in the meal, at any depth (name, description, qty, method, notes, nested item/name fields).
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
        if (known && depth === 0 && (k === 'name' || k === 'ingredients')) c.templated = true;
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
      const safe = safeReplacement(slot, kcal, prot, excluded, terms);
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
function safeReplacement(slot, kcal, prot, excluded, terms) {
  if (!engine.SLOTS.includes(slot)) return null;
  const key = [slot, Math.round(kcal), Math.round(prot), [...excluded].sort().join('+'), [...(terms || [])].sort().join('+')].join('|');
  if (REPLACEMENT_CACHE.has(key)) { const c = REPLACEMENT_CACHE.get(key); return c && JSON.parse(c); }
  const protOff = (m) => (prot > 0 ? Math.abs(m.protein - prot) / prot : 0);
  let best = null;
  for (const s of [slot, ...engine.SLOTS.filter((x) => x !== slot)]) {
    // Another slot's template only when this slot's best is more than 20% off on protein.
    if (s !== slot && best && protOff(best.m) <= 0.2) break;
    for (const pw of [1, 2, 4]) {
      const m = engine.safeMealFor(s, { kcal, protein: prot, excluded: [...excluded], proteinWeight: pw, avoid: terms });
      if (!m || mealProblems(m, excluded, terms)) continue;
      const cost = Math.abs(m.calories - kcal) / kcal + 2 * protOff(m) + (s === slot ? 0 : 0.3);
      if (!best || cost < best.cost) best = { m, cost };
    }
  }
  if (REPLACEMENT_CACHE.size > 5000) REPLACEMENT_CACHE.clear();
  REPLACEMENT_CACHE.set(key, best ? JSON.stringify(best.m) : null);
  return best ? best.m : null;
}

/** Allergy text for a prompt: no control, line-break or invisible characters, no quotes or brackets. */
function promptSafe(a) {
  return String(a == null ? '' : a).normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/[`"{}<>[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

const isMealLike = (m) => m && typeof m === 'object' && !Array.isArray(m) && ['name', 'title', 'ingredients', 'foods', 'items'].some((k) => k in m);

/**
 * Saved, manual and edited plans in any stored shape go through the same check: { days: [...] }, day form
 * with meals as an object or a list, or a flat list of meals (manual plans with foods). Unsafe meals are
 * replaced with a safe template meal (or removed when none fits); anything unreadable is removed.
 * Returns { meals, replaced, dropped }.
 */
function enforceSavedMeals(meals, filters = {}) {
  const excluded = excludedFlags(filters);
  const terms = customTerms(filters);
  if (!excluded.size && !terms.size) return { meals, replaced: [], dropped: [] };
  let value = meals;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return { meals: [], replaced: [], dropped: [{ reasons: ['unreadable plan'] }] }; } }
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.days)) {
    const r = enforcePlan(value, filters);
    return { meals: r.plan, replaced: r.replaced, dropped: r.dropped };
  }
  if (!Array.isArray(value)) return { meals: value == null ? value : [], replaced: [], dropped: value == null ? [] : [{ reasons: ['unreadable plan'] }] };
  const replaced = []; const dropped = [];
  const fix = (meal, slot, where) => {
    const problems = mealProblems(meal, excluded, terms);
    if (!problems) return safeSwapList(meal, excluded, terms);
    const s = engine.SLOTS.includes(slot) ? slot : 'lunch';
    const kcal = Number(meal && meal.calories) > 0 ? Number(meal.calories) : 2000 * (SLOT_SHARE[s] || 0.25);
    const prot = Number(meal && meal.protein) > 0 ? Number(meal.protein) : 0;
    const safe = safeReplacement(s, kcal, prot, excluded, terms);
    if (!safe) { dropped.push({ ...where, reasons: problems }); return null; }
    replaced.push({ ...where, from: String((meal && (meal.name || meal.title)) || '').slice(0, 80), reasons: problems });
    const keep = {}; for (const k of ['slot', 'type', 'mealType', 'time', 'day']) if (meal && typeof meal[k] === 'string' && !mealProblems({ name: 'x', ingredients: ['rice'], [k]: meal[k] }, excluded, terms)) keep[k] = meal[k];
    return { ...safe, ...keep, replacedForFilters: true };
  };
  const out = value.map((d, i) => {
    if (d && typeof d === 'object' && !Array.isArray(d) && d.meals && typeof d.meals === 'object') {
      if (!Array.isArray(d.meals)) { const r = enforcePlan({ days: [d] }, filters); replaced.push(...r.replaced.map((x) => ({ ...x, day: i }))); dropped.push(...r.dropped.map((x) => ({ ...x, day: i }))); return r.plan.days[0]; }
      return { ...d, meals: d.meals.map((m, j) => fix(m, m && (m.slot || m.type || m.mealType), { day: i, slot: j })).filter(Boolean) };
    }
    if (isMealLike(d)) return fix(d, d.slot || d.type || d.mealType, { day: '*', slot: i });
    dropped.push({ day: i, slot: '*', reasons: ['unreadable entry'] });
    return null;
  }).filter((x) => x !== null);
  return { meals: out, replaced, dropped };
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
  HIDDEN, excludedFlags, customTerms, safeReplacement, flagsInText, ingredientNames, mealProblems, enforcePlan, enforceText, enforceJsonText,
  enforceSavedMeals, promptRules, promptSafe, profileFilters, mergeFilters,
};
