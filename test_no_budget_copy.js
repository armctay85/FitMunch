'use strict';
/**
 * FitMunch doesn't plan to a price. The meal-plan modal had a "Weekly budget ($)"
 * field and the API took a budget param it never used. This guards that:
 * - the API drops any budget param, so sending one changes nothing;
 * - "budget" (any case) and cost or saving promises never appear in served copy;
 * - the trainer dashboard has no "$0 subscription revenue" placeholder.
 */
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  chatJson: jest.fn(),
}));
jest.mock('./lib/ai-usage', () => ({
  refundSmokeOnFailure: () => {},
  refundAiCall: jest.fn(async () => true),
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
}));
jest.mock('./server/storage.js', () => ({
  getUserById: jest.fn(async () => ({ id: 'u1', settings: { aiDataConsent: true } })),
  getProfile: jest.fn(async () => ({ dietaryPreferences: [], allergies: [] })), // no saved filters (#127a)
  effectiveTier: () => 'free',
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const mealPlanner = require('./meal-planner');

describe('meal-plan API ignores budget', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', mealPlanner);
  const post = (body) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${token}`).send(body);
  const base = { goal: 'lose_weight', calories: 2100, protein: 150, days: 7, dietary: ['vegetarian'] };

  afterEach(() => aiClient.chatJson.mockReset());

  it('planInput drops budget', () => {
    expect(mealPlanner.planInput({ ...base, budget: 80 })).toEqual(mealPlanner.planInput(base));
    expect(mealPlanner.planInput({ ...base, budget: 80 })).not.toHaveProperty('budget');
  });

  it('builder plan is identical with or without budget, and never mentions it', async () => {
    const a = await post({ ...base, builderOnly: true });
    const b = await post({ ...base, builderOnly: true, budget: 50 });
    const c = await post({ ...base, builderOnly: true, budget: 'abc', weeklyBudget: 300 });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(JSON.stringify(b.body)).not.toMatch(/budget/i);
  });

  it('the AI prompt is identical with or without budget', async () => {
    const prompts = [];
    aiClient.chatJson.mockImplementation(async (o) => { prompts.push(o.messages[0].content); return { ok: false, error: 'x' }; });
    // No diet filters: filtered users get the checked builder and never an AI prompt (#127a).
    const noFilters = { ...base, dietary: [] };
    await post(noFilters);
    const n = prompts.length;
    await post({ ...noFilters, budget: 50 });
    expect(n).toBeGreaterThan(0);
    expect(prompts.slice(n)).toEqual(prompts.slice(0, n));
    for (const p of prompts) expect(p).not.toMatch(/budget/i);
  });

  it('an invalid budget is not a 400 (it is ignored, not validated)', async () => {
    const r = await post({ ...base, builderOnly: true, budget: -5 });
    expect(r.status).toBe(200);
  });
});

// No allowlist: the old /budget-meal-plan and /budget-meal-planner landers were deleted
// and 301 to /high-protein-staples-meal-plan (Wilson, PR 121), so "budget" appears nowhere.
// FitMunch makes no cost or saving promise in served copy either. Plain price disclaimers
// ("Prices vary by store and week", "does not show supermarket prices") and the A$19.99
// subscription price are not promises and stay allowed.
const COST_PROMISES = [
  ['budget', /budget/i],
  ['cheap', /\bcheap(?:er|est|ly)?\b/i],
  ['save money / save $', /\bsav(?:e|es|ed|ing|ings)\b[^.<]{0,20}(?:\$|\bmoney\b|\bdollars?\b|\bcash\b|on (?:your )?(?:groceries|grocery|food|shop|shopping))/i],
  ['save on groceries', /\bsav(?:e|es|ing)\b[^.<]{0,10}\bgrocer/i],
  ['savings', /\bsavings\b/i],
  ['cost less / costs less', /\bcosts? less\b/i],
  ['spend less', /\bspend(?:ing)? less\b/i],
  ['lower bill', /\b(?:lower|cut|cuts|reduce|reduces|slash)\b[^.<]{0,20}\b(?:grocery|food|shopping|weekly)\s+(?:bill|spend|costs?)\b/i],
  ['$ per week', /\$\s?\d[\d.,]*\s*(?:a|per|\/)\s*(?:week|wk|day|meal|serve|serving)\b/i],
  ['per week $', /\bper (?:week|day|meal|serve)\b[^.<]{0,6}\$\s?\d/i],
  ['$ per gram of protein', /\$\s?\/\s?\d*\s?g\b|\$\d[\d.]*\s*(?:per|\/)\s*\d*\s?g(?:rams?)?\s+(?:of\s+)?protein/i],
  ['affordable / bargain / frugal', /\b(?:affordable|bargains?|frugal|economical|value for money|price[- ]conscious|low[- ]cost|inexpensive)\b/i],
  ['save heaps / save big', /\bsav(?:e|es|ing)\s+(?:heaps|big|lots|a lot|a bundle|a fortune|more)\b/i],
  ['half the cost', /\b(?:half|a fraction|a third|a quarter)\s+(?:of\s+)?(?:the\s+)?(?:cost|price)\b/i],
  ['pay less', /\bpay(?:s|ing)?\s+less\b/i],
  ['best value', /\b(?:best|great|good|better|top)\s+value\b/i],
  ['costs under / from', /\bcosts?\s+(?:under|from|just|only|about|around)\b/i],
  // EQA #121 r3 S1 phrasings.
  ['saving phrases', /\bfor less\b|\bwallet\b|\bgrocery dollar|\bcut(?:s|ting)? costs?\b|\bcosts? a fraction\b|\ba fraction of the (?:cost|price)\b|\bprice[- ]?match|\bcompare prices\b|\bpocket the difference\b|\bthrifty\b|\bpenny\b|\bpenny[- ]pinch|\bmoney[- ]saving\b|\bdiscount|\bon sale\b|\bclearance\b|\bunit pric|\bprice per\b/i],
];

// Every $ or AUD amount is banned except the exact plan prices (Free $0, Premium A$19.99 a month or
// A$149.99 a year, Coach A$39 and A$79). EQA #121 r2 S1.
const PLAN_PRICES = new Set(['$0', 'A$19.99', 'A$149.99', 'A$39', 'A$79']);
// EQA #121 r3 S1: AU$/NZ$/US$, HTML-entity and fullwidth dollars, per-kg prices, spelled-out dollars, tenners.
// EQA #137 r1 S: cents, euro and pound signs, currency codes either side, &#x24;/&#036;, a trailing $,
// "per kilogram", and teens/tens number words.
const NUM_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const DOLLAR = '(?:\\$|&#0*36;|&#x0*24;|&dollar;|＄)';
const CODE = '(?:AUD|USD|NZD|EUR|GBP)';
const MONEY = new RegExp([
  `(?:\\b[A-Z]{1,3})?${DOLLAR}\\s?\\d[\\d,]*(?:\\.\\d+)?`,
  '&#0*36;|&#x0*24;|&dollar;|＄|[€£¢]|&euro;|&pound;|&cent;',
  `\\b${CODE}\\s?\\d[\\d,]*(?:\\.\\d+)?`,
  `\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${CODE}|dollars?|bucks|cents?|per kg|per kilo(?:gram)?s?|\\/kg)\\b`,
  '(?<![#\\w.])\\d+(?:\\.\\d+)?c\\b',
  '\\b\\d[\\d,]*(?:\\.\\d+)?\\s?\\$(?![{\\w])',
  `\\b${NUM_WORD}(?:[\\s-]+${NUM_WORD})*[\\s-]+(?:dollars?|bucks|cents?)\\b`,
  '\\bper kilo(?:gram)?s?\\b',
  '\\btenners?\\b',
].join('|'), 'gi');
// Only two $N shapes are code, and each is skipped only where it is code (EQA #137 r1 M):
// - a single-digit back-reference inside the replacement argument of a .replace( call: x.replace(/a/, '<b>$1</b>');
// - an =$N placeholder inside a string that starts with a SQL keyword: SELECT ... WHERE id=$1.
// Anything else, like 'Chicken <b>$9</b> a week.', 'price = $7 tub' or a bare '$9', is scanned.
const REPLACE_ARG = /\.replace\(\s*(?:\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|[\w.]+)\s*,\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const SQL_LED = /^\s*['"`(]*\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER)\s/i;
// A where-clause fragment handed to a query builder ('user_id=$1', '(pt_id=$1 OR client_id=$1)') is SQL
// only when the whole string is column=$N terms joined by OR/AND, with no other words, and every column
// is id-style (id, or a name ending in _id). EQA #137 r2 M1: 'price=$9 OR x=$1' and '(cost=$5)' are copy.
const SQL_TERM = '\\(?\\s*(?:[a-z_][a-z0-9_]*\\.)?(?:id|[a-z0-9_]*_id)\\s?=\\s?\\$\\d+(?:::[a-z]+)?\\s*\\)?';
const SQL_PREDICATE = new RegExp(`^${SQL_TERM}(?:\\s+(?:OR|AND)\\s+${SQL_TERM})*$`, 'i');
function stripCode(line) {
  let out = line.replace(REPLACE_ARG, (m, q, arg) => m.slice(0, m.length - arg.length - 1) + arg.replace(/\$\d(?![\d.,])/g, '') + q);
  if (SQL_LED.test(out) || SQL_PREDICATE.test(out)) out = out.replace(/=\s?\$\d(?![\d.,])/g, '=');
  return out;
}
function moneyHits(line) {
  return [...stripCode(line).matchAll(MONEY)].map((m) => m[0].replace(/,$/, '')).filter((x) => !PLAN_PRICES.has(x));
}

// Server-side customer text: receipt scan findings, coach tips and chat, emails, AI prompts.
// Only string literals are scanned (comments and identifiers like budgetMs are code).
const SERVER_TEXT = [
  'lib/receipt-scan-core.js', 'lib/sample-receipt-demo.js', 'lib/coach-plan.js', 'lib/coach-pdf.js',
  'lib/coach-png.js', 'lib/meal-plan-engine.js', 'lib/password-reset.js', 'lib/email-verify.js',
  'server/email.js', 'api_server.js', 'meal-planner.js', 'coach-api.js',
  'receipt-scanner.js', 'lib/coach-share.js', 'server.js',
];
// Exact literals that are not customer copy: the 301 sources for the deleted budget landers, and
// the receipt model's instruction (it tells the model to skip discount lines and read line totals).
const NOT_COPY = new Set([
  'server.js|/budget-meal-plan', 'server.js|/budget-meal-planner',
]);
// The receipt model instruction is matched exactly (by hash), not by prefix, so any edit to it or any
// other string sharing its opening is scanned again (EQA #137 r1 S).
const NOT_COPY_EXACT = [['receipt-scanner.js', 'efa82209e52b9493901aaef788edc80caf823a4116c52d51e3bc3b0e250ca7dc']];
const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
const isCopy = (rel, text) => !NOT_COPY.has(`${rel}|${text}`) && !NOT_COPY_EXACT.some(([r, h]) => r === rel && sha(text) === h);
function stringLiterals(src) {
  const out = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const m of src.matchAll(re)) {
    if (m[0].startsWith('/')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const text = m[0].slice(1, -1);
    // SQL with $1-style placeholders is not copy: only skip a literal that starts with a SQL keyword
    // and uses placeholders (EQA #121 r3 S1: 'UPDATE: save $40 a week' is copy).
    if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER)\s/.test(text) && /\$\d/.test(text)) continue;
    out.push({ line, text });
  }
  return out;
}

function servedFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) servedFiles(p, out);
    else if (/\.(html|js|json|webmanifest|txt|xml)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no budget, cost or saving promises in served customer copy', () => {
  const root = path.join(__dirname, 'public');
  const files = servedFiles(root);

  it('scans the served pages, including the staples lander', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of ['app.html', 'index.html', 'high-protein-staples-meal-plan.html']) {
      expect(files.some((x) => x.endsWith(`${path.sep}${f}`))).toBe(true);
    }
  });

  for (const [label, re] of COST_PROMISES) {
    it(`no served file says ${label}`, () => {
      const hits = [];
      for (const f of files) {
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const m = line.match(re);
          if (m) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.slice(Math.max(0, m.index - 40), m.index + 60).trim()}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }

  it('no served file shows a $ or AUD amount other than the plan prices', () => {
    const hits = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const h of moneyHits(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${h}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the patterns catch the copy they are meant to', () => {
    const caught = (s) => COST_PROMISES.some(([, re]) => re.test(s));
    for (const s of ['Budget meal plan', 'cheap protein', 'Save $40 a week', 'save money on groceries', 'Costs less than takeaway',
      'Spend less each shop', 'cut your grocery bill', '$45 a week', 'per week $60', '$/25g protein', 'Affordable high protein',
      'big savings', 'Costs under $50', 'Save heaps', 'Half the cost of meal kits', 'Pay less at the checkout',
      'Best value', 'Groceries for less', 'Easy on the wallet', 'Wallet-friendly', 'Stretch your grocery dollar', 'Cut costs on food',
      'Costs a fraction', 'Price-match', 'Compare prices', 'Pocket the difference', 'Thrifty', 'Penny-pinching', 'Money-saving',
      'Shop smarter for less', 'Discounted', 'On sale', 'Clearance', 'Price per kg', 'Unit pricing']) expect([s, caught(s)]).toEqual([s, true]);
    for (const s of ['Chicken breast 1kg $12', 'Costs under $50', 'From $5', 'AUD 60 weekly shop', 'A$12.50 tub', '60 AUD',
      'A$20 a month', 'AU$12 for chicken', 'NZ$9 tub', 'US$5 tub', '&#36;12 per kilo', '&dollar;12 per kilo', '＄12 per kilo',
      '12.99 per kg', 'Twelve dollars a week', 'Under a tenner a day', 'x.replace(/a/, "<b>$1</b>"); Chicken $12.']) expect([s, moneyHits(s).length > 0]).toEqual([s, true]);
    for (const s of ['14-day trial, then A$19.99 a month', 'A$149.99 a year', 'Coach A$39', 'A$79 a month', '$0 forever',
      '1kg chicken breast', 'Pack sizes vary by store.']) expect([s, moneyHits(s)]).toEqual([s, []]);
    for (const s of ['Prices vary by store and week.', '14-day trial, then A$19.99 a month', 'FitMunch does not show supermarket prices',
      '3 days per week', 'Save your plan', 'Saved to your lists']) expect([s, caught(s)]).toEqual([s, false]);
  });

  // EQA #137 r1 M: the old $N skip let these through; each must be caught again.
  for (const s of ['Chicken <b>$9</b> a week.', 'Only <strong>$5</strong> a meal.', 'price = $7 tub', '$9',
    "'Chicken <b>$9</b> a week.'", "where: 'price=$7 tub'", "x.replace(/a/, 'b'); y = '<b>$9</b>';"]) {
    it(`catches the old bypass: ${s}`, () => expect(moneyHits(s).length).toBeGreaterThan(0));
  }
  it('still skips real code: .replace( back-references and SQL-led placeholders', () => {
    for (const s of ["s.replace(/x/g, '<code>$1</code>');", 'x.replace(/(a)(b)/, "$2-$1")', "t.replace(re, '$1')",
      "'SELECT * FROM t WHERE id=$1'", "UPDATE users SET name=$2 WHERE id=$1"]) expect([s, moneyHits(s)]).toEqual([s, []]);
  });
  // EQA #137 r1 S: one test each.
  for (const s of ['fourteen dollars', 'sixty bucks', '50 cents', '12c', '€', '£', 'USD 12', '12 NZD', '&#x24;', '&#036;', '12$', 'per kilogram']) {
    it(`catches ${s}`, () => {
      expect(moneyHits(s).length).toBeGreaterThan(0);
      expect(moneyHits(`Chicken thighs, ${s} this week.`).length).toBeGreaterThan(0);
    });
  }
  // EQA #137 r2 M1: only id-style columns count as a where-clause fragment.
  for (const s of ['price=$9 OR x=$1', '(cost=$5)', '(price=$9)', 'total=$9 AND user_id=$1', 'cost = $5 OR id=$2']) {
    it(`catches the non-id SQL-shaped amount: ${s}`, () => expect(moneyHits(s).length).toBeGreaterThan(0));
  }
  it('still skips id-style where-clause fragments', () => {
    for (const s of ['(pt_id=$1 OR client_id=$1)', 'id=$1', 'user_id=$1::text', 'm.user_id=$1 AND id=$2']) expect([s, moneyHits(s)]).toEqual([s, []]);
  });
  // EQA #137 r2 S1: in a .replace( argument only a lone $N back-reference is skipped, not the start of a price.
  it('catches a price inside a .replace( argument', () => {
    expect(moneyHits("x.replace(/a/, 'Chicken $12.50')")).toEqual(['$12.50']);
    expect(moneyHits("x.replace(/a/, '$1 for $1.50')")).toEqual(['$1.50']);
    expect(moneyHits("x.replace(/a/, '$1 now 12c')")).toEqual(['12c']);
  });
  // EQA #137 r2 S2, S3, L.
  for (const s of ['50¢', '¢50', '12.50c', '&#36;9', '&cent;50', 'five-dollar meals']) {
    it(`catches ${s}`, () => {
      expect(moneyHits(s).length).toBeGreaterThan(0);
      expect(moneyHits(`Chicken thighs, ${s} this week.`).length).toBeGreaterThan(0);
    });
  }
  it('&#36;9 is detected as one amount', () => expect(moneyHits('&#36;9')).toEqual(['&#36;9']));

  it('the receipt model instruction is an exact exception, not a prefix', () => {
    const src = fs.readFileSync(path.join(__dirname, 'receipt-scanner.js'), 'utf8');
    const prompt = stringLiterals(src).find((l) => l.text.startsWith('This is a supermarket receipt photo.')).text;
    expect(isCopy('receipt-scanner.js', prompt)).toBe(false);
    expect(isCopy('receipt-scanner.js', `${prompt} Save $40 a week.`)).toBe(true);
    expect(isCopy('receipt-scanner.js', 'This is a supermarket receipt photo. Save $40 a week.')).toBe(true);
    expect(isCopy('lib/coach-share.js', prompt)).toBe(true);
  });

  it('the meal-plan modal has no budget field', () => {
    const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
    expect(app).not.toMatch(/mp-budget-sel/);
    expect(app).not.toMatch(/Weekly budget/i);
  });
});

describe('no $0 revenue placeholder in app.html', () => {
  const app = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
  it('has no subscription-revenue metric', () => {
    expect(app).not.toMatch(/subscription revenue/i);
    expect(app).not.toMatch(/id="m-month"/);
  });
  it('the only $0 left is the Free plan price', () => {
    const zeros = [...app.matchAll(/\$0(?![\d.,])/g)].map((m) => app.slice(m.index, m.index + 120));
    expect(zeros).toHaveLength(1);
    expect(zeros[0]).toMatch(/^\$0<span[^>]*> forever<\/span>/);
  });
});

describe('no budget, cost or saving promises in server-side customer text', () => {
  const texts = SERVER_TEXT.map((rel) => ({ rel, lits: stringLiterals(fs.readFileSync(path.join(__dirname, rel), 'utf8')).filter((l) => isCopy(rel, l.text)) }));

  it('reads every server source and finds its strings', () => {
    for (const { rel, lits } of texts) expect([rel, lits.length > 0]).toEqual([rel, true]);
  });

  it('the scan finding for a balanced basket names no budget swap', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib/receipt-scan-core.js'), 'utf8');
    expect(src).toContain("Next shop can focus on variety.'");
  });

  for (const [label, re] of COST_PROMISES) {
    it(`no server string says ${label}`, () => {
      const hits = [];
      for (const { rel, lits } of texts) for (const l of lits) if (re.test(l.text)) hits.push(`${rel}:${l.line}: ${l.text.slice(0, 100)}`);
      expect(hits).toEqual([]);
    });
  }

  it('no server string shows a $ or AUD amount other than the plan prices', () => {
    const hits = [];
    for (const { rel, lits } of texts) for (const l of lits) for (const h of moneyHits(l.text)) hits.push(`${rel}:${l.line}: ${h}`);
    expect(hits).toEqual([]);
  });

  it('the literal scanner sees strings, not comments or identifiers', () => {
    const lits = stringLiterals("// budget comment\nconst budgetMs = 5; /* cheap */ const t = 'Save heaps'; const u = `From $5`; q('SELECT * FROM t WHERE id=$1'); const v = 'UPDATE: save $40 a week on groceries';");
    expect(lits.map((l) => l.text)).toEqual(['Save heaps', 'From $5', 'UPDATE: save $40 a week on groceries']);
    expect(moneyHits('UPDATE: save $40 a week on groceries')).toEqual(['$40']);
    expect(moneyHits("'SELECT * FROM t WHERE (pt_id=$1 OR client_id=$1)'")).toEqual([]);
    expect(moneyHits('(pt_id=$1 OR client_id=$1)')).toEqual([]);
    expect(moneyHits('user_id=$1::text')).toEqual([]);
    expect(moneyHits('price = $7 tub')).toEqual(['$7']);
    expect(moneyHits("where: '(pt_id=$1 OR client_id=$1)'")).toEqual(['$1', '$1']);
    expect(moneyHits("s.replace(/x/g, '<code>$1</code>');")).toEqual([]);
  });
});

describe('layout after the budget field and revenue metric were removed (EQA #121 r2 S3, S5)', () => {
  const app = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
  it('Meal Planner calories and protein sit in a 2-column grid', () => {
    const i = app.indexOf('id="mp-cals-sel"');
    const grid = app.lastIndexOf('<div style="display:grid', i);
    expect(app.slice(grid, i)).toMatch(/^<div style="display:grid;grid-template-columns:1fr 1fr;gap/);
    expect(app.slice(grid, app.indexOf('id="mp-prot-sel"'))).not.toMatch(/<\/div>\s*<\/div>\s*<\/div>/);
  });
  it('the trainer dashboard metrics row is 3 columns for its 3 metrics', () => {
    const row = app.match(/<div class="metrics-row metrics-row-3">([\s\S]*?)\n <\/div>/)[1];
    expect(row.match(/class="metric"/g)).toHaveLength(3);
    expect(row).toContain('id="m-clients"');
    expect(app).toMatch(/\.metrics-row\.metrics-row-3\{grid-template-columns:repeat\(3,1fr\) !important\}/);
  });
  it('the coach tip says calorie target, not calorie budget', () => {
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(api).not.toMatch(/calorie budget/i);
    expect(api).toContain('without going over your calorie target.');
  });
});
