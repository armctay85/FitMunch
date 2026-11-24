'use strict';
/**
 * EQA acceptance list, FitMunch allergy safety, PR 224 r5 + PR 223 r4 as one fix. File 1 of 2.
 * Paths here: builder (mealProblems), shopping generate (groceryItemsSafe), typed list (markGroceryItems keeps
 * the line and sets allergyWarning), and S0 across those three. The workout OFF path is in
 * test_eqa_acceptance_allergy_r5_workout.js (lib/workout-program.js exists only from PR 223).
 * Committed on the 224 branch; must run on ebc677b and on every later head.
 * Owned by Elite QA. Source list: acceptance-allergy-r5.md (FINAL 20 Nov 2026).
 * The builder commits this file unchanged and adds it to jest.config.js testMatch
 * (test_jest_testmatch_guard.js requires every root test_*.js to be listed).
 * All fixtures are in this file. No network, no AI calls, no DB.
 * Every test name starts with its line ID. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');

const dg = require('./lib/diet-guard');
const ms = require('./lib/meal-safety');
const PATHS = ['builder', 'shopGen', 'typed'];

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
// The workout OFF path is in test_eqa_acceptance_allergy_r5_workout.js.
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
  const rows = {};
  for (const food of ALLFOODS) {
    const typed = markedBy.get(food);
    rows[food] = {
      builder: !!ms.mealProblems(meal(food), ex, ct),
      shopGen: !kept.has(food),
      typedKept: !!typed,
      typed: !!(typed && typed.allergyWarning),
      workout: null,
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
const ON = 'on builder, shopping generate and typed list';
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
  test(`UN1 saved ${q(term)} shows the "Please confirm" notice`, () => { expect(evaluate(term).notice).toBe(true); });
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
  test(`S0 saved ${q(term)}: builder, shopping and typed list agree on every food this term is tested on`, () => {
    const e = evaluate(term); const disagree = [];
    for (const food of [...TERM_FOODS.get(term)].sort()) {
      const r = e.rows[food];
      const ans = { builder: r.builder, shopGen: r.shopGen, typed: r.typed };

      if (new Set(Object.values(ans)).size > 1) disagree.push(`${food} ${JSON.stringify(ans)}`);
    }
    expect(disagree).toEqual([]);
  });
}

// ---------- Structure and no-regression ----------
test('S1 timing tests unchanged: test_ai_allergen_stopgap_r6.js line 230 < 100 ms, lines 411 and 418 < 500 ms, no 2000 ms bound', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'test_ai_allergen_stopgap_r6.js'), 'utf8').split('\n');
  expect(lines[229]).toMatch(/toBeLessThan\(100\)/);
  expect(lines[410]).toMatch(/toBeLessThan\(500\)/);
  expect(lines[417]).toMatch(/toBeLessThan\(500\)/);
  for (const f of ['test_ai_allergen_stopgap_r6.js', 'test_ai_allergen_stopgap_r6_pg.js']) {
    expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).not.toMatch(/toBeLessThan\(\s*2000\s*\)/);
  }
});
test('S2 one fail-closed path and a single lib/meal-safety.js', () => {
  const libDir = path.join(__dirname, 'lib');
  const libs = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
  const src = libs.map((f) => fs.readFileSync(path.join(libDir, f), 'utf8')).join('\n');
  for (const fn of ['failsClosed', 'unknownAllergyFlag', 'textBreaksFilters']) {
    expect([fn, (src.match(new RegExp(`function\\s+${fn}\\s*\\(`, 'g')) || []).length]).toEqual([fn, 1]);
  }
  expect(libs.filter((f) => /meal-?safety/i.test(f))).toEqual(['meal-safety.js']);
});

// ---------- S3. Roles (from EQA probe-roles.js) ----------
function grab(src, sig) {
  const i = src.indexOf(sig); if (i < 0) return null;
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return null;
}
const API_SRC = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const CHECKOUT_SRC = fs.readFileSync(path.join(__dirname, 'lib', 'fitmunch-checkout.js'), 'utf8');
const CUST = '11111111-1111-4111-8111-111111111111';
const PT = '22222222-2222-4222-8222-222222222222';
const QA = '33333333-3333-4333-8333-333333333333';
async function trainerGate(user, dbRole, env) {
  const rtSrc = grab(API_SRC, 'async function requireTrainer(');
  if (!rtSrc) throw new Error('requireTrainer not found in api_server.js');
  const m = API_SRC.match(/const UUID_RE\s*=\s*(\/.+\/[a-z]*);/);
  const UUID_RE = m ? new Function(`return ${m[1]}`)() : /^$/;
  const qaFile = path.join(__dirname, 'lib', 'qa-trainer.js');
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const qaTrainer = fs.existsSync(qaFile) ? require('./lib/qa-trainer') : { isQaTrainerAccount: () => false };
    const _pool = { query: async () => ({ rows: dbRole == null ? [] : [{ role: dbRole }] }) };
    const sendApiError = (res) => res.status(500).json({});
    // Production preview state: COACH_PREVIEW unset, NODE_ENV and VERCEL_ENV production.
    const req2 = (p) => (/coach-store$/.test(p) ? { previewEnabled: () => false } : require(p));
    const fn = new Function('UUID_RE', 'qaTrainer', '_pool', 'sendApiError', 'require', `return (${rtSrc})`)(UUID_RE, qaTrainer, _pool, sendApiError, req2);
    let status = 'next';
    const res = { status(c) { status = c; return this; }, json() { return this; } };
    await fn({ user }, res, () => {});
    return status;
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const PROD = { NODE_ENV: 'production', VERCEL_ENV: 'production' };
const GATE = [
  ['S3.1 customer token, DB role client: trainer gate refuses', { userId: CUST }, 'client', PROD, 403],
  ['S3.2 forged role pt claim, DB role client: trainer gate refuses', { userId: CUST, role: 'pt' }, 'client', PROD, 403],
  ['S3.3 real trainer, DB role pt: trainer gate admits', { userId: PT }, 'pt', PROD, 'next'],
  ['S3.4 customer with no QA allowlist env: trainer gate refuses', { userId: CUST }, 'client', PROD, 403],
  ['S3.6 customer not on a set QA allowlist: trainer gate refuses', { userId: CUST }, 'client', Object.assign({ QA_TRAINER_ACCOUNT_IDS: QA }, PROD), 403],
  ['S3.7 allowlist prefix trick: refused', { userId: QA.slice(0, 20) }, 'client', Object.assign({ QA_TRAINER_ACCOUNT_IDS: QA }, PROD), 401],
  ['S3.8 forged preview claim with preview off: refused', { userId: CUST, preview: true }, 'client', PROD, 401],
  ['S3.10 non-uuid id: refused', { userId: 'abc' }, 'pt', PROD, 401],
];
for (const [name, user, role, env, want] of GATE) {
  test(name, async () => { expect(await trainerGate(user, role, env)).toBe(want); });
}
test.todo('S3.5 Should (combined S3): an id on QA_TRAINER_ACCOUNT_IDS passes requireTrainer with DB role client; refuse it in Production');
test.todo('S3.9 Should (combined S5): preview tokens report role pt whenever previewEnabled(); default it off when VERCEL_ENV=production');
function checkoutOutcome(requested, role) {
  const ncSrc = grab(CHECKOUT_SRC, 'function normalizeCheckoutPlan(');
  if (!ncSrc) throw new Error('normalizeCheckoutPlan not found');
  const plan = new Function(`return (${ncSrc})`)()(requested, role);
  const am = CHECKOUT_SRC.match(/const ALLOWED_PLANS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  const allowed = new Set(am ? am[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []);
  if ((requested === 'starter' || requested === 'pro') && plan === 'premium') return 403;
  return allowed.has(plan) ? `ok:${plan}` : 400;
}
const CHECKOUT = [
  ['S3.11 checkout starter, DB role client', 'starter', 'client', 403],
  ['S3.12 checkout starter, DB role pt', 'starter', 'pt', 400],
  ['S3.13 checkout starter, DB role unreadable', 'starter', null, 403],
  ['S3.14 checkout pro, DB role client', 'pro', 'client', 403],
  ['S3.15 checkout premium, DB role client', 'premium', 'client', 'ok:premium'],
  ['S3.16 checkout pt-starter, DB role client', 'pt-starter', 'client', 400],
  ['S3.17 checkout pt-pro, DB role client', 'pt-pro', 'client', 400],
  ['S3.18 checkout premium-annual, DB role pt', 'premium-annual', 'pt', 'ok:premium-annual'],
];
for (const [name, plan, role, want] of CHECKOUT) {
  test(`${name}: forged token cannot rewrite or buy a trainer plan (outcome ${want})`, () => { expect(checkoutOutcome(plan, role)).toBe(want); });
}
test('S3.19 checkout route keeps the 403 for a starter or pro request rewritten to premium, role from the DB', () => {
  expect(SERVER_SRC).toMatch(/accountRole\(user\)/);
  expect(SERVER_SRC).toMatch(/\(requestedPlan === 'starter' \|\| requestedPlan === 'pro'\) && plan === 'premium'\)\s*\{\s*return res\.status\(403\)/);
});
test('S3.20 billing portal uses only the Stripe customer id stored on the signed-in user', () => {
  const block = grab(SERVER_SRC, "app.post('/api/billing-portal'");
  expect(block).toBeTruthy();
  expect(block).toMatch(/customerId = user\.stripeCustomerId/);
  expect(block).not.toMatch(/req\.(body|query|params)\s*(\.|\[)\s*['"]?(customer|customerId|stripeCustomerId)/);
});

// ---------- Permanent rows: combined-round Shoulds (not blockers this round) ----------
test.todo('CR-S1 Should: en dash in "Usually 10 to 20 seconds" copy (public/app.html:892, :1012, :4914); copy rules apply');
test.todo('CR-S2 Should: feature-restore-list rows 131-132 have owner but date n/a');
test.todo('CR-S4 Should: requirePt ignores the QA allowlist while requireTrainer honours it; use one trainer gate');
test.todo('CR-S6 Should: PR body notes the filtered invalid-AI-result 502 to 200 checked-template change');
test.todo('CR-S7 Should: merge order with PR 225 (lib/support-confirm.js, server/email.js); rerun its list after rebase');
test.todo('CR-S8 Should: env-gated describe.skip in test_pt_clients_legacy_pg.js must keep running in CI');
test.todo('CR-S9 Should: billing portal with no stored customer returns 400, not 403');
