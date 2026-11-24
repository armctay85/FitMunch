'use strict';
/**
 * EQA acceptance list, FitMunch allergy round 6 (PR 224 + PR 223). Owned by Elite QA. FINAL 21 Nov 2026 9:10am AEDT.
 * Source: EQA allergy r5 verdict (FAIL 7.0, M1-M3) and its fresh cases. Commit unchanged, add to jest.config.js testMatch.
 * Paths: builder (mealProblems), shopping generate (groceryItemsSafe), typed list (markGroceryItems keeps the line, sets allergyWarning).
 * No network, no AI, no DB. Every test name starts with its line ID. Do not edit, skip, loosen or retry.
 */
const dg = require('./lib/diet-guard');
const ms = require('./lib/meal-safety');

// M1: common AU sulphite foods (FSANZ Std 1.3.1 permits 220-228 in sausages, dried fruit, cordials, wine/cider, pickles, dehydrated potato).
const M1_SUL = ['Lemon cordial', 'Orange cordial', 'Gherkins', 'Pickled cucumbers', 'Chorizo', 'Cabanossi', 'Kabana', 'Frankfurts',
  'Hot dogs', 'Salami', 'Ginger beer', 'Instant mashed potato', 'Dried cranberries', 'Chicken sausages', 'Pickles', 'Dill pickles'];
// M2: foods the builder already blocks for sulphites; every path must block them too.
const M2_SUL = ['Bacon rashers', 'Glace cherries', 'Prosecco', 'Champagne', 'Dehydrated potato flakes', 'Prawns (cooked, preserved)'];
// Fresh-case sulphite foods already blocked on all paths at r5: regression.
const SUL_REG = ['Sparkling wine', 'Wine vinegar', 'Dried apricot', 'Sultana', 'Raisin', 'Pork sausage', 'Pear cider',
  'White wine', 'Red wine', 'Dried apricots', 'Pork sausages', 'Beef sausages', 'Sultanas', 'Raisins', 'Dried mango',
  'Dried apple rings', 'Fruit cordial', 'Apple cider', 'Pickled onions', 'Sausage rolls', 'Beef snags', 'Pork chipolatas', 'Sausage meat'];
// Uncertain sulphite status: no hard block demanded, but all three paths must agree (P1 parity).
const SUL_UNSURE = ['Prosciutto', 'Ham slices', 'Dried figs', 'Dried dates', 'Beer', 'Vinegar', 'Sauerkraut', 'Dried coconut', 'Golden syrup', 'Jam'];
const KIWI_FOODS = ['Kiwi', 'Kiwi fruit', 'Kiwifruit', 'Gold kiwifruit', 'Kiwifruit salad', 'kiwi'];
const BLOCK_REG = [
  ['preservative 223', ['White wine', 'Pork sausages', 'Dried apricots']],
  ['sodium metabisulphite', ['White wine', 'Pork sausages']],
  ['E 220', ['White wine', 'Dried apricots']], ['e220', ['White wine']], ['220-228', ['White wine', 'Pork sausages']],
  ['peanuts', ['Peanut butter', 'Peanuts', 'Satay chicken', 'Peanut oil']],
  ['tree nuts', ['Almonds', 'Cashews', 'Walnut salad', 'Almond milk', 'Pesto', 'Nutella']],
  ['sesame', ['Tahini', 'Hummus', 'Sesame seeds', 'Sesame oil']],
  ['soy', ['Tofu', 'Soy sauce', 'Edamame', 'Tempeh', 'Miso soup']],
  ['gluten', ['Bread', 'Pasta', 'Barley', 'Rye bread', 'Couscous', 'Soy sauce']],
  ['egg', ['Eggs', 'Mayonnaise', 'Scrambled eggs', 'Egg noodles']],
  ['milk', ['Cheese', 'Yoghurt', 'Butter', 'Cream', 'Whey protein']],
  ['fish', ['Anchovies', 'Salmon', 'Fish sauce', 'Worcestershire sauce', 'Swordfish']],
];
const CONTROLS = [
  ['sulphites', ['Chicken breast', 'Brown rice', 'Banana', 'Broccoli', 'Fresh apricots', 'Grapes', 'Apple', 'Fresh pork chops', 'Potato', 'Oats', 'Eggs',
    'Cucumber', 'Lemon', 'Ginger', 'Orange', 'Cranberries', 'Fresh figs', 'Beef mince', 'Chicken thigh']],
  ['peanuts', ['Chicken breast', 'Brown rice', 'Banana', 'Broccoli', 'Peas', 'Chickpeas']],
  ['buck wheat', ['Chicken breast', 'Wheat bread', 'Brown rice']],
  ['egg', ['Eggplant', 'Chicken breast', 'Nutmeg']],
  ['kiwi', ['Chicken breast', 'Banana']], ['kiwifruit', ['Chicken breast', 'Banana', 'Kiwano']],
  ['fish', ['Chicken breast', 'Banana']],
];
const SUL_TERMS = ['sulphites', 'sulfites', 'Sulphite', 'preservative 220', 'E220', 'sulphur dioxide'];
const PARITY_TERMS = ['sulphites', 'kiwifruit', 'kiwi', 'peanuts', 'tree nuts', 'sesame', 'soy', 'gluten', 'egg', 'milk', 'fish', 'shellfish', 'mustard', 'celery', 'lupin', 'buck wheat'];
const ALLFOODS = [...new Set([].concat(M1_SUL, M2_SUL, SUL_REG, SUL_UNSURE, KIWI_FOODS, ...BLOCK_REG.map((r) => r[1]), ...CONTROLS.map((r) => r[1])))];

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
  const out = { rows, typedCount: marked.length };
  CACHE.set(term, out); return out;
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

describe('EQA allergy r6, M1 sulphite families on every path', () => {
  for (const term of SUL_TERMS) {
    test(`M1 saved "${term}" blocks every M1 food on builder, shopping generate and typed list`, () => {
      expect(leaks(term, M1_SUL)).toEqual([]);
    });
  }
});
describe('EQA allergy r6, M2 builder-blocked foods are blocked everywhere', () => {
  test('M2 saved "sulphites" blocks every M2 food on all three paths', () => {
    expect(leaks('sulphites', M2_SUL)).toEqual([]);
  });
});
describe('EQA allergy r6, M3 kiwi family both ways', () => {
  for (const term of ['kiwifruit', 'kiwi', 'Kiwi fruit', 'kiwi-fruit']) {
    test(`M3 saved "${term}" blocks every kiwi line on all three paths`, () => {
      expect(leaks(term, KIWI_FOODS)).toEqual([]);
    });
  }
});
describe('EQA allergy r6, fresh-case regression', () => {
  test('R1 saved "sulphites" still blocks every sulphite food that was blocked at r5', () => {
    expect(leaks('sulphites', SUL_REG)).toEqual([]);
  });
  for (const [term, foods] of BLOCK_REG) {
    test(`R2 saved "${term}" blocks ${foods.join(', ')} on all three paths`, () => {
      expect(leaks(term, foods)).toEqual([]);
    });
  }
});
describe('EQA allergy r6, controls are never refused', () => {
  for (const [term, foods] of CONTROLS) {
    test(`CT saved "${term}" refuses none of ${foods.join(', ')} on any path`, () => {
      expect(overBlocks(term, foods)).toEqual([]);
    });
  }
});
describe('EQA allergy r6, P1 parity', () => {
  test('P1 for every saved term and every fixture food, builder, shopping generate and typed list give the same answer', () => {
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
  test('P2 uncertain sulphite foods: all three paths agree for each (block or allow, never split)', () => {
    const e = evaluate('sulphites'); const split = [];
    for (const f of SUL_UNSURE) { const r = e.rows[f]; if (!(r.builder === r.shopGen && r.shopGen === r.typed)) split.push(f); }
    expect(split).toEqual([]);
  });
  test.todo('P3 Should: decide block or allow for each uncertain sulphite food (prosciutto, ham, figs, dates, beer, vinegar, sauerkraut, coconut, golden syrup, jam) with a cited source; record in the PR body');
});
