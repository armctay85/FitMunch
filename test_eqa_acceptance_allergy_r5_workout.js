'use strict';
/**
 * EQA acceptance list, FitMunch allergy safety, PR 224 r5 + PR 223 r4 as one fix. File 2 of 2.
 * Path here: workout text with the kill switch OFF (workoutBreaksFilters over plan name, summary, workout name
 * and notes), plus S0 across all four paths (builder, shopping generate, typed list, workout OFF).
 * Committed on the 223 branch; runs on 2d360b4 and every later head.
 * Owned by Elite QA. Source list: acceptance-allergy-r5.md (FINAL 20 Nov 2026).
 * The builder commits this file unchanged and adds it to jest.config.js testMatch.
 * All fixtures are in this file. No network, no AI calls, no DB.
 * Every test name starts with its line ID. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');

const PREV_SWITCH = process.env.FILTERED_USERS_CHECKED_BUILDER;
process.env.FILTERED_USERS_CHECKED_BUILDER = 'off';
const dg = require('./lib/diet-guard');
const ms = require('./lib/meal-safety');
const wp = require('./lib/workout-program');
afterAll(() => { if (PREV_SWITCH === undefined) delete process.env.FILTERED_USERS_CHECKED_BUILDER; else process.env.FILTERED_USERS_CHECKED_BUILDER = PREV_SWITCH; });
const PATHS = ['workoutOFF'];

// ---------- Fixtures ----------
const F = {
  NUT: ['Peanut butter toast', 'Satay chicken', 'Peanut butter'],
  SHL: ['Garlic prawns', 'Prawn stir fry', 'Surimi salad', 'Fish sauce noodles'],
  FSH: ['Salmon fillet', 'Tuna in springwater', 'Fish sauce noodles'],
  MUS: ['Dijon mustard', 'Honey mustard chicken'],
  CEL: ['Celery sticks', 'Celery soup'],
  LUP: ['Lupin flour pancakes'],
  SUL: ['White wine', 'Red wine', 'Dried apricots', 'Pork sausages', 'Beef sausages', 'Sultanas', 'Raisins'],
  KIW: ['Kiwi fruit'],
  ZOR: ['Zorbleberry jam'],
};
const MAJOR = ['NUT', 'SHL', 'FSH', 'MUS', 'CEL', 'LUP', 'SUL'];
const SU_FOODS = [
  ['SU1', ['White wine']], ['SU2', ['Red wine']], ['SU3', ['Dried apricots']], ['SU4', ['Sultanas']], ['SU5', ['Raisins']],
  ['SU6', ['Pork sausages']], ['SU7', ['Beef sausages']], ['SU8', ['Dried mango']], ['SU9', ['Dried apple rings']],
  ['SU10', ['Fruit cordial']], ['SU11', ['Apple cider']], ['SU12', ['Pickled onions']], ['SU13', ['Sausage rolls']],
  ['SU14', ['Beef snags']], ['SU15', ['Pork chipolatas']], ['SU16', ['Sausage meat']], ['SU17', ['Dried peach', 'Dried pear']],
];
const ALL_SU = [].concat(...SU_FOODS.map((r) => r[1]));
const SU_TERMS = ['sulphites', 'sulfites', 'sulphite', 'sulfite', 'preservative 220', '220', 'E220', 'sulphur dioxide', 'Sulphites', 'SULFITES'];
// SU18: FSANZ Food Standards Code Schedule 8, numerical listing (Authorised Version F2025C00967, in force 16 Sep 2025),
// https://www.legislation.gov.au/F2015L00478/2025-09-16/2025-09-16/text/original/pdf, retrieved 20 Nov 2026 2:31pm AEDT.
const FSANZ_SULPHITES = [
  [220, 'Sulphur dioxide'], [221, 'Sodium sulphite'], [222, 'Sodium bisulphite'], [223, 'Sodium metabisulphite'],
  [224, 'Potassium metabisulphite'], [225, 'Potassium sulphite'], [228, 'Potassium bisulphite'],
];
const NOT_ON_SCHEDULE_8 = [226, 227];
const CONTROLS = ['Brown rice', 'Banana', 'Chicken breast', 'Broccoli'];
const CO7_FOODS = ['Grape fruit juice', 'Pink grape fruit', 'Grapefruit salad', 'Buck wheat noodles', 'Buckwheat pancakes', 'Soba buckwheat noodles'];
const PL_FOODS = ['Banana smoothie', 'Tomato salad', 'Tomatoes on toast', 'Mushroom risotto', 'Avocado toast', 'Peach yoghurt', 'Strawberry smoothie', 'Strawberries and cream'];
const ALLFOODS = [...new Set([].concat(...Object.values(F), ALL_SU, CO7_FOODS, PL_FOODS, CONTROLS))];
const WORKOUT_FIELDS = ['planName', 'summary', 'name', 'notes'];

// ---------- One evaluation per saved term, every food, every path in this file ----------
const meal = (n) => ({ name: n, ingredients: [{ item: n, qty: '100g' }] });
function workoutPlan(food, field) {
  const d = { planName: 'Strength week', summary: 'Four sessions.', workouts: [{ day: 1, name: 'Back squat', sets: 3, reps: '8', notes: 'Brace.' }] };
  const t = `Refuel with ${food.toLowerCase()}`;
  if (field === 'planName') d.planName = t; else if (field === 'summary') d.summary = t;
  else if (field === 'name') d.workouts[0].name = t; else d.workouts[0].notes = t;
  return d;
}
function workoutBlocked(food, field, filters) {
  if (!filters.length) return false;
  return !!wp.workoutBreaksFilters(wp.normaliseWorkout(workoutPlan(food, field), { level: 'intermediate', daysPerWeek: 3 }), filters);
}
function workoutRow(food, filters) { const o = {}; for (const f of WORKOUT_FIELDS) o[f] = workoutBlocked(food, f, filters); return o; }
const CACHE = new Map();
function evaluate(term) {
  if (CACHE.has(term)) return CACHE.get(term);
  const prof = { dietaryPreferences: [], allergies: [term] };
  const stored = ms.profileFilters(prof);
  const merged = ms.mergeFilters(stored, { dietary: [] });
  const X = { dietary: dg.planFilters(dg.combineFilters(prof, [])), allergies: merged.allergies, overCap: !!(stored && stored.overCap) };
  const ex = ms.excludedFlags(X); const ct = ms.customTerms(X);
  const shopF = ms.profileFilters(prof);
  const kept = new Set(ms.groceryItemsSafe(ALLFOODS.map((n) => ({ name: n })), shopF).map((i) => i.name));
  const marked = ms.markGroceryItems(ALLFOODS.map((n) => ({ name: n })), shopF);
  const markedBy = new Map(marked.map((i) => [i.name, i]));
  const wpFilters = dg.combineFilters(prof, []);
  const rows = {};
  for (const food of ALLFOODS) {
    const typed = markedBy.get(food);
    rows[food] = {
      builder: !!ms.mealProblems(meal(food), ex, ct),
      shopGen: !kept.has(food),
      typedKept: !!typed,
      typed: !!(typed && typed.allergyWarning),
      workout: workoutRow(food, wpFilters),
    };
  }
  const out = { term, rows, typedCount: marked.length, notice: !!dg.unknownAllergyFlag(prof.allergies) };
  CACHE.set(term, out);
  return out;
}
/** Every path in this file that lets a food through, as "path:food" strings. */
function leaks(term, foods) {
  const e = evaluate(term); const bad = [];
  for (const food of foods) {
    const r = e.rows[food];
    if (!r) { bad.push(`missing-fixture:${food}`); continue; }
    if (PATHS.includes('builder') && !r.builder) bad.push(`builder:${food}`);
    if (PATHS.includes('shopGen') && !r.shopGen) bad.push(`shopGen:${food}`);
    if (PATHS.includes('typed')) { if (!r.typedKept) bad.push(`typedDeleted:${food}`); else if (!r.typed) bad.push(`typedUnflagged:${food}`); }
    if (PATHS.includes('workoutOFF')) for (const f of WORKOUT_FIELDS) if (!r.workout[f]) bad.push(`workoutOFF.${f}:${food}`);
  }
  if (PATHS.includes('typed') && e.typedCount !== ALLFOODS.length) bad.push(`typedListLength:${e.typedCount}/${ALLFOODS.length}`);
  return bad;
}
/** Every path in this file that wrongly refuses a control food. */
function overBlocks(term, foods) {
  const e = evaluate(term); const bad = [];
  for (const food of foods) {
    const r = e.rows[food];
    if (PATHS.includes('builder') && r.builder) bad.push(`builder:${food}`);
    if (PATHS.includes('shopGen') && r.shopGen) bad.push(`shopGen:${food}`);
    if (PATHS.includes('typed')) { if (!r.typedKept) bad.push(`typedDeleted:${food}`); else if (r.typed) bad.push(`typedFlagged:${food}`); }
    if (PATHS.includes('workoutOFF')) for (const f of WORKOUT_FIELDS) if (r.workout[f]) bad.push(`workoutOFF.${f}:${food}`);
  }
  return bad;
}
const q = (t) => JSON.stringify(t);
const ON = 'on the workout OFF path (plan name, summary, workout name, notes)';
// S0 compares paths on the foods each term is tested on (its row foods and controls). A path that also refuses an
// unrelated food is on the safe side and is not an S0 disagreement.
const TERM_FOODS = new Map();
function scope(term, foods) { if (!TERM_FOODS.has(term)) TERM_FOODS.set(term, new Set()); for (const f of foods) TERM_FOODS.get(term).add(f); }
function blockRow(id, term, foods, controls = CONTROLS) {
  scope(term, foods); if (controls) scope(term, controls);
  test(`${id} saved ${q(term)} blocks ${foods.join(', ')} ${ON}`, () => {
    expect(leaks(term, foods)).toEqual([]);
  });
  if (controls && controls.length) {
    test(`${id} controls: saved ${q(term)} keeps ${controls.join(', ')} served ${ON}`, () => {
      expect(overBlocks(term, controls)).toEqual([]);
    });
  }
}
const ALL_TERMS = new Set();
const use = (t) => { ALL_TERMS.add(t); return t; };

// ---------- Class 1. Sulphites ----------
for (const term of SU_TERMS) {
  use(term);
  for (const [id, foods] of SU_FOODS) blockRow(id, term, foods, null);
  scope(term, CONTROLS);
  test(`SU0 controls: saved ${q(term)} keeps ${CONTROLS.join(', ')} served ${ON}`, () => {
    expect(overBlocks(term, CONTROLS)).toEqual([]);
  });
}
// SU18: every FSANZ name, bare number and E-form for 220 to 228 blocks SU1 to SU17.
for (const [code, name] of FSANZ_SULPHITES) {
  for (const term of [name, name.toLowerCase(), String(code), `E${code}`, `preservative ${code}`]) {
    use(term); scope(term, ALL_SU);
    test(`SU18 code ${code} (${name}) saved ${q(term)} blocks SU1 to SU17 ${ON}`, () => {
      expect(leaks(term, ALL_SU)).toEqual([]);
    });
  }
}
// 226 and 227 are not on Schedule 8. They still fail closed: sulphite foods blocked, or the confirm notice shows.
for (const code of NOT_ON_SCHEDULE_8) {
  for (const term of [String(code), `E${code}`]) {
    use(term); scope(term, ALL_SU);
    test(`SU18 code ${code} (not on FSANZ Schedule 8) saved ${q(term)} fails closed: blocks SU1 to SU17 ${ON} or shows the confirm notice`, () => {
      const e = evaluate(term);
      expect({ notice: e.notice, leaks: e.notice ? [] : leaks(term, ALL_SU) }).toEqual({ notice: e.notice, leaks: [] });
    });
  }
}

// ---------- Class 2. Unknown words fail closed ----------
const UNKNOWN = ['zorbleberry', 'xylophone-berry', 'zzqx', 'Zorbleberries', 'ZORBLEBERRY', '  zorbleberry  ', 'zörbleberry'];
const ZOR_FAMILY = ['zorbleberry', 'Zorbleberries', 'ZORBLEBERRY', '  zorbleberry  ', 'zörbleberry'];
const MAJOR_FOODS = [...new Set([].concat(...MAJOR.map((g) => F[g])))];
for (const term of UNKNOWN) {
  use(term); scope(term, MAJOR_FOODS); scope(term, CONTROLS); if (ZOR_FAMILY.includes(term)) scope(term, F.ZOR);

  test(`UN2 saved ${q(term)} blocks every major-allergen food (incl. Pork and Beef sausages) ${ON}`, () => {
    expect(leaks(term, MAJOR_FOODS)).toEqual([]);
  });
  if (ZOR_FAMILY.includes(term)) {
    test(`UN3 saved ${q(term)} blocks Zorbleberry jam ${ON}`, () => { expect(leaks(term, F.ZOR)).toEqual([]); });
  }
  test(`UN0 controls: saved ${q(term)} keeps ${CONTROLS.join(', ')} served ${ON}`, () => {
    expect(overBlocks(term, CONTROLS)).toEqual([]);
  });
}

// ---------- Class 3. Spacing and compound words ----------
blockRow('CO1', use('kiwifruit'), ['Kiwi fruit']);
blockRow('CO2', use('kiwifruits'), ['Kiwi fruit']);
blockRow('CO3', use('kiwi fruit'), ['Kiwi fruit']);
blockRow('CO4', use('kiwi'), ['Kiwi fruit']);
blockRow('CO5', use('peanutbutter'), F.NUT);
blockRow('CO5', use('peanut-butter'), F.NUT);
blockRow('CO6', use('fishsauce'), ['Fish sauce noodles']);
blockRow('CO6', use('fish-sauce'), ['Fish sauce noodles']);
blockRow('CO7a', use('grapefruit'), ['Grape fruit juice', 'Pink grape fruit']);
blockRow('CO7b', use('grape fruit'), ['Grapefruit salad']);
blockRow('CO7c', use('grape-fruit'), ['Grapefruit salad']);
blockRow('CO7d', use('buckwheat'), ['Buck wheat noodles']);
blockRow('CO7e', use('buck wheat'), ['Buckwheat pancakes', 'Soba buckwheat noodles']);
blockRow('CO7f', use('buck-wheat'), ['Buckwheat pancakes', 'Soba buckwheat noodles']);
// Allowed, not required: saved "grape" may also refuse grapefruit foods (safe side). No row asserts either way.

// ---------- Class 4. Plurals ----------
const NO_BANANA = CONTROLS.filter((c) => c !== 'Banana');
blockRow('PL1', use('kiwi'), ['Kiwi fruit']);
blockRow('PL2', use('kiwis'), ['Kiwi fruit']);
blockRow('PL3', use('kiwifruit'), ['Kiwi fruit']);
blockRow('PL4', use('kiwi fruit'), ['Kiwi fruit']);
blockRow('PL5', use('kiwifruits'), ['Kiwi fruit']);
blockRow('PL6', use('banana'), ['Banana smoothie'], NO_BANANA);
blockRow('PL7', use('bananas'), ['Banana smoothie'], NO_BANANA);
blockRow('PL8', use('tomatoes'), ['Tomato salad']);
blockRow('PL9', use('tomato'), ['Tomatoes on toast']);
blockRow('PL10', use('mushrooms'), ['Mushroom risotto']);
blockRow('PL11', use('avocados'), ['Avocado toast']);
blockRow('PL12', use('peaches'), ['Peach yoghurt']);
blockRow('PL13', use('strawberries'), ['Strawberry smoothie']);
blockRow('PL14', use('strawberry'), ['Strawberries and cream']);
blockRow('PL15', use('Zorbleberries'), F.ZOR);
blockRow('PL15', use('zörbleberry'), F.ZOR);

// ---------- Class 5. Named terms and typing variants (must stay green) ----------
const C5 = [
  ['peanut butter', F.NUT], ['Peanut Butter', F.NUT], ['PEANUT BUTTER', F.NUT], ['peanut butters', F.NUT],
  ['  peanut    butter  ', F.NUT], ['peanut-butter', F.NUT], ['peanutbutter', F.NUT], ['penut butter', F.NUT],
  ['peanut buter', F.NUT], ['ｐｅａｎｕｔ ｂｕｔｔｅｒ', F.NUT], ['peanut\u00a0butter', F.NUT], ['花生酱', F.NUT],
  ['prawns', F.SHL], ['Prawns', F.SHL], ['PRAWN', F.SHL], ['king prawns', F.SHL], ['prawnz', F.SHL], ['prawn\u200b', F.SHL], ['虾仁', F.SHL],
  ['fish sauce', [...F.FSH, ...F.SHL]], ['Fish Sauce', [...F.FSH, ...F.SHL]], ['fish-sauce', [...F.FSH, ...F.SHL]], ['fishsauce', [...F.FSH, ...F.SHL]],
  ['fsh sauce', [...F.FSH, ...F.SHL]], ['nam pla', [...F.FSH, ...F.SHL]], ['鱼露', [...F.FSH, ...F.SHL]],
  ['salmon', F.FSH], ['tuna', F.FSH], ['Salmon', F.FSH], ['tinned tuna', F.FSH],
  ['mustard', F.MUS], ['celery', F.CEL], ['lupin', F.LUP], ['kiwi', F.KIW],
];
C5.forEach(([term, foods], i) => blockRow(`C5.${i + 1}`, use(term), [...new Set(foods)]));

// ---------- Class 6. Two allergies in one entry (must stay green) ----------
const C6 = ['kiwi and peanut', 'kiwi, peanut', 'kiwi & peanut', 'kiwi/peanut', 'peanut and kiwi', 'Kiwi AND Peanut',
  'kiwi and/or peanut', 'kiwi;peanut', 'kiwi + peanut', 'kiwi，peanut'];
C6.forEach((term, i) => blockRow(`C6.${i + 1}`, use(term), [...F.KIW, ...F.NUT]));
blockRow('C6.11', use('kiwi and prawns'), [...F.KIW, ...F.SHL]);

// ---------- S0. Paths agree for every term ----------
for (const term of ALL_TERMS) {
  test(`S0 saved ${q(term)}: builder, shopping, typed list and workout OFF agree on every food this term is tested on`, () => {
    const e = evaluate(term); const disagree = [];
    for (const food of [...TERM_FOODS.get(term)].sort()) {
      const r = e.rows[food];
      const ans = { builder: r.builder, shopGen: r.shopGen, typed: r.typed };
      const w = WORKOUT_FIELDS.map((f) => r.workout[f]);
      ans.workoutOFF = w.every(Boolean) ? true : (w.some(Boolean) ? 'mixed' : false);
      if (new Set(Object.values(ans)).size > 1) disagree.push(`${food} ${JSON.stringify(ans)}`);
    }
    expect(disagree).toEqual([]);
  });
}

// ---------- Structure (workout path) ----------
test('S2 kill switch kept: FILTERED_USERS_CHECKED_BUILDER off or 0 turns the checked builder off, unset keeps it on', () => {
  expect(typeof dg.filteredUsersCheckedBuilder).toBe('function');
  expect(dg.filteredUsersCheckedBuilder({ FILTERED_USERS_CHECKED_BUILDER: 'off' })).toBe(false);
  expect(dg.filteredUsersCheckedBuilder({ FILTERED_USERS_CHECKED_BUILDER: '0' })).toBe(false);
  expect(dg.filteredUsersCheckedBuilder({})).toBe(true);
  expect(dg.filteredUsersCheckedBuilder()).toBe(false);
});
test('S2.1 the workout route checks the saved program with workoutBreaksFilters', () => {
  const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
  expect(typeof wp.workoutBreaksFilters).toBe('function');
  expect(api).toMatch(/workoutBreaksFilters\(/);
});
