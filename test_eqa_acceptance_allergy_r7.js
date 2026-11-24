'use strict';
/**
 * EQA acceptance list, FitMunch allergy round 7 (PR 224 + PR 223). Owned by Elite QA. LOCKED 24 Nov 2026 AEDT.
 * Source: EQA allergy r6 verdict (FAIL 7.0): M1 sulphite leaks, M2 builder vs shopping vs typed split. r6 file stays committed and must stay green.
 * Paths: builder (mealProblems), shopping generate (groceryItemsSafe), typed list (markGroceryItems keeps the line, sets allergyWarning).
 * One shared matcher: every answer must be identical on all three paths. EQA also runs a hidden set the builder never sees.
 * No network, no AI, no DB. Every test name starts with its line ID. Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const dg = require('./lib/diet-guard');
const ms = require('./lib/meal-safety');

// R7-M1: Wilson's named leaks (FSANZ Std 1.3.1: 220-228 permitted in crustacea, beer, processed meat, dried/semi-dried vegetables, molasses/sugar syrups).
const M1_NAMED = ['Prawns', 'Raw prawns', 'Cooked prawns', 'King prawns', 'Lager', 'Molasses', 'Pepperoni', 'Sun-dried tomatoes', 'Sundried tomatoes'];
// R7-M1b: the other r6 fresh-case LEAK rows (blocked nowhere at 589fa86).
const M1_R6LEAK = ['Instant mash', 'Mashed potato mix', 'Ginger ale', 'Fruit mince'];
// R7-M2: r6 MISMATCH rows (builder blocked, shopping and typed did not).
const M2_SPLIT_SUL = ['Balsamic glaze', 'Craisins', 'Maraschino cherries', 'Kabanos', 'Moscato', 'Mirin', 'Port', 'Sherry', 'Candied peel'];
const M2_SPLIT_KIWI = ['Kiwiberry'];
const SUL_TERMS = ['sulphites', 'Sulfites', 'sulphite', 'preservative 220', 'E220', 'sulphur dioxide', 'metabisulphite'];
const CONTROLS = [
  ['sulphites', ['Chicken breast', 'Tomato', 'Cherry tomatoes', 'Fresh cherries', 'Potato', 'Mashed potato', 'Sweet potato', 'Kale',
    'Pork chops', 'Portobello mushrooms', 'Capsicum', 'Black pepper', 'Fresh mango', 'Cucumber', 'Lemon juice', 'Salmon fillet', 'Apple']],
  ['kiwi', ['Kiwano', 'Chicken breast', 'Banana']],
];
const PARITY_TERMS = ['sulphites', 'Sulfites', 'kiwi', 'kiwifruit', 'shellfish', 'crustacean', 'peanuts', 'tree nuts', 'sesame', 'soy', 'gluten', 'egg', 'milk', 'fish'];
const ALLFOODS = [...new Set([].concat(M1_NAMED, M1_R6LEAK, M2_SPLIT_SUL, M2_SPLIT_KIWI, ...CONTROLS.map((r) => r[1])))];

const meal = (n) => ({ name: n, ingredients: [{ item: n, qty: '100g' }] });
const CACHE = new Map();
function evaluate(term) {
  if (CACHE.has(term)) return CACHE.get(term);
  const prof = { dietaryPreferences: [], allergies: [term] };
  const stored = ms.profileFilters(prof);
  const merged = ms.mergeFilters(stored, { dietary: [] });
  const X = { dietary: dg.planFilters(dg.combineFilters(prof, [])), allergies: merged.allergies, overCap: !!(stored && stored.overCap) };
  const ex = ms.excludedFlags(X); const ct = ms.customTerms(X);
  const kept = new Set(ms.groceryItemsSafe(ALLFOODS.map((n) => ({ name: n })), stored).map((i) => i.name));
  const marked = ms.markGroceryItems(ALLFOODS.map((n) => ({ name: n })), stored);
  const by = new Map(marked.map((i) => [i.name, i]));
  const rows = {};
  for (const f of ALLFOODS) {
    const t = by.get(f);
    rows[f] = { builder: !!ms.mealProblems(meal(f), ex, ct), shopGen: !kept.has(f), typedKept: !!t, typed: !!(t && t.allergyWarning) };
  }
  const out = { rows, typedCount: marked.length }; CACHE.set(term, out); return out;
}
function leaks(term, foods) {
  const e = evaluate(term); const bad = [];
  for (const f of foods) {
    const r = e.rows[f];
    if (!r.builder) bad.push(`builder:${f}`);
    if (!r.shopGen) bad.push(`shopGen:${f}`);
    if (!r.typedKept) bad.push(`typedDeleted:${f}`); else if (!r.typed) bad.push(`typedUnflagged:${f}`);
  }
  if (e.typedCount !== ALLFOODS.length) bad.push(`typedListLength:${e.typedCount}/${ALLFOODS.length}`);
  return bad;
}
function overBlocks(term, foods) {
  const e = evaluate(term); const bad = [];
  for (const f of foods) {
    const r = e.rows[f];
    if (r.builder) bad.push(`builder:${f}`);
    if (r.shopGen) bad.push(`shopGen:${f}`);
    if (!r.typedKept) bad.push(`typedDeleted:${f}`); else if (r.typed) bad.push(`typedFlagged:${f}`);
  }
  return bad;
}

describe('EQA allergy r7, M1 named sulphite leaks on every path', () => {
  for (const term of SUL_TERMS) {
    test(`R7-M1 saved "${term}" blocks prawns, lager, molasses, pepperoni and sun-dried tomatoes on builder, shopping generate and typed list`, () => {
      expect(leaks(term, M1_NAMED)).toEqual([]);
    });
    test(`R7-M1b saved "${term}" blocks the r6 leak rows (instant mash, potato mix, ginger ale, fruit mince) on all three paths`, () => {
      expect(leaks(term, M1_R6LEAK)).toEqual([]);
    });
  }
});
describe('EQA allergy r7, M2 one shared matcher', () => {
  for (const term of ['sulphites', 'Sulfites']) {
    test(`R7-M2 saved "${term}": every r6 builder-only food is blocked on shopping generate and typed list too`, () => {
      expect(leaks(term, M2_SPLIT_SUL)).toEqual([]);
    });
  }
  for (const term of ['kiwi', 'kiwifruit']) {
    test(`R7-M2k saved "${term}": Kiwiberry is blocked on all three paths`, () => {
      expect(leaks(term, M2_SPLIT_KIWI)).toEqual([]);
    });
  }
  test('R7-M2p for every saved term and every r7 fixture food, builder, shopping generate and typed list give the same answer', () => {
    const mismatch = [];
    for (const term of PARITY_TERMS) {
      const e = evaluate(term);
      for (const f of ALLFOODS) {
        const r = e.rows[f];
        if (!r.typedKept) { mismatch.push(`${term}|${f}|typedDeleted`); continue; }
        if (!(r.builder === r.shopGen && r.shopGen === r.typed)) mismatch.push(`${term}|${f}|b=${r.builder} s=${r.shopGen} t=${r.typed}`);
      }
    }
    expect(mismatch).toEqual([]);
  });
});
describe('EQA allergy r7, controls are never refused', () => {
  for (const [term, foods] of CONTROLS) {
    test(`R7-CT saved "${term}" refuses none of ${foods.join(', ')} on any path`, () => {
      expect(overBlocks(term, foods)).toEqual([]);
    });
  }
});
describe('EQA allergy r7, Shoulds', () => {
  test.todo('R7-S4 Should: typed "bacon" or "wine" should not expand to the whole sulphite family unless the term names the additive (220-228, sulphite, metabisulphite) or the customer confirms');
});
