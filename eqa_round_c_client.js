'use strict';
/**
 * EQA Round C client harness (LOCKED, owned by Elite QA; commit unchanged, do not edit).
 * Runs the REAL app.html meal-date code and the REAL /js/*.js scripts app.html loads, in a child
 * process whose TZ is the customer's zone and whose clock is frozen at EQA_NOW.
 * Modes (EQA_MODE): "log" (picker, label, save body, reload request) and "home" (Home "Meals today").
 * Interfaces relied on (keep them, brief section 3): app.html keeps S.mealsDate, initMealDate(),
 * updateMealDateLabel(), loadTodayMeals(), logMealEntry(), API('<path>', {...}), ids meals-date,
 * meals-date-label, lm-food, lm-search, lm-meal, lm-cals, lm-protein, lm-carbs, lm-fat, lm-serving-g,
 * and FMHomeWeek.loggedTodayMeals. Any shared date helper must live in a /js/ file app.html loads.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.EQA_REPO || __dirname;
const NOW = Date.parse(process.env.EQA_NOW);
const TZ = process.env.TZ;
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
global.Date = FakeDate;

// ---- browser-ish globals ------------------------------------------------------------------
function deep(name) {
  const f = function () { return deep(name + '()'); };
  return new Proxy(f, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : deep(name + '.' + String(k))),
    apply: () => deep(name + '()'),
    construct: () => deep('new ' + name),
  });
}
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = new Proxy({ id, value: '', textContent: '', innerHTML: '', disabled: false, checked: false, dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
      appendChild(x) { return x; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, blur() {}, closest() { return null; } }, {
      get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : deep('el.' + String(k)))),
    });
  }
  return els[id];
}
const store = {};
global.window = global; global.self = global;
global.document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: (t) => el('new-' + t + Math.random()),
  addEventListener() {}, removeEventListener() {}, body: el('body'), documentElement: el('html'), readyState: 'complete', cookie: '' };
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.sessionStorage = global.localStorage;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'eqa', language: 'en-AU', languages: ['en-AU'] }, configurable: true }); } catch (_) {}
global.location = { href: 'https://fitmunch.com.au/app.html', pathname: '/app.html', search: '', hash: '', origin: 'https://fitmunch.com.au' };
global.addEventListener = () => {}; global.removeEventListener = () => {};
global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
global.requestAnimationFrame = (f) => setTimeout(f, 0);

// ---- load app.html's own /js scripts in order ---------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const loadErrors = [];
for (const m of html.matchAll(/<script[^>]*\ssrc="\/js\/([\w.-]+\.js)(?:\?[^"]*)?"[^>]*><\/script>/g)) {
  if (/chart|\.min\.js$/.test(m[1])) continue;
  const file = path.join(ROOT, 'public/js', m[1]);
  if (!fs.existsSync(file)) continue;
  try { vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file }); } catch (e) { loadErrors.push(m[1] + ': ' + e.message); }
}

// ---- extract functions and the S.mealsDate initialiser from app.html inline script ---------
function skipString(s, i) { // s[i] is a quote; returns index after closing quote
  const q = s[i]; i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (q === '`' && c === '$' && s[i + 1] === '{') { i = matchClose(s, i + 1) + 1; continue; }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}
function matchClose(s, open) { // s[open] is { ( or [ ; returns index of its match
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [pairs[s[open]]];
  let i = open + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); i = n < 0 ? s.length : n; continue; }
    if (c === '/' && s[i + 1] === '*') { const n = s.indexOf('*/', i + 2); i = n < 0 ? s.length : n + 2; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
    i++;
  }
  throw new Error('unbalanced from ' + open);
}
function fnSource(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('app.html has no function ' + name);
  const paramsOpen = m.index + m[0].length - 1;
  const bodyOpen = html.indexOf('{', matchClose(html, paramsOpen));
  return html.slice(m.index, matchClose(html, bodyOpen) + 1);
}
function mealsDateInit() {
  const m = /\bmealsDate\s*:\s*/.exec(html);
  if (!m) throw new Error('app.html has no S.mealsDate initialiser');
  let i = m.index + m[0].length; const start = i;
  while (i < html.length) {
    const c = html[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(html, i); continue; }
    if (c === '(' || c === '[' || c === '{') { i = matchClose(html, i) + 1; continue; }
    if (c === ',' || c === '}' || c === '\n') break;
    i++;
  }
  return html.slice(start, i).trim();
}

const apiCalls = [];
const S = { user: { id: 'u-eqa', name: 'EQA' }, portalData: null, goals: {} };
const sb = {
  S, document: global.document,
  API: async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    apiCalls.push({ url, method: (opts && opts.method) || 'GET', body });
    if (String(url).startsWith('/meals/daily')) return { success: true, meals: [] };
    if (url === '/meals/log') return { success: true, meal: { id: 1, ...body } };
    return { success: true };
  },
};
const scope = new Proxy(sb, {
  has(t, k) {
    if (k in t) return true;
    if (typeof k !== 'string' || k === 'undefined' || k === 'NaN' || k === 'Infinity') return false;
    try { if (vm.runInThisContext('typeof ' + k) !== 'undefined') return false; } catch (_) { /* TDZ: let it resolve */ return false; }
    return true; // unknown app global: inert stand-in
  },
  get(t, k) { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; return deep(String(k)); },
});
function build(src, ret) { return new Function('__s', 'with (__s) { ' + src + '\n return ' + ret + '; }')(scope); }

function dayIn(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new RealDate(ms));
}

async function main() {
  const out = { tz: TZ, now: new RealDate(NOW).toISOString(), localToday: dayIn(NOW), loadErrors };
  const mode = process.env.EQA_MODE || 'log';
  if (mode === 'home') {
    const meals = JSON.parse(process.env.EQA_MEALS || '[]');
    if (!global.FMHomeWeek || typeof global.FMHomeWeek.loggedTodayMeals !== 'function') throw new Error('FMHomeWeek.loggedTodayMeals missing');
    out.homeToday = global.FMHomeWeek.loggedTodayMeals(meals).length;
    process.stdout.write(JSON.stringify(out));
    return;
  }
  S.mealsDate = build('', mealsDateInit());
  out.initial = S.mealsDate;
  build(fnSource('updateMealDateLabel'), 'updateMealDateLabel');
  const initMealDate = build(fnSource('updateMealDateLabel') + '\n' + fnSource('initMealDate'), 'initMealDate');
  initMealDate();
  out.picker = el('meals-date').value;
  out.label = el('meals-date-label').textContent;
  out.expectedLabel = new RealDate(NOW).toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  if (process.env.EQA_PICK) { el('meals-date').value = process.env.EQA_PICK; }
  const loadTodayMeals = build(fnSource('updateMealDateLabel') + '\n' + fnSource('loadTodayMeals'), 'loadTodayMeals');
  await loadTodayMeals().catch((e) => { out.loadError = e.message; });
  const food = process.env.EQA_FOOD || 'EQA eggs on toast';
  for (const [id, v] of [['lm-food', food], ['lm-search', food], ['lm-meal', 'breakfast'], ['lm-cals', '300'], ['lm-protein', '20'], ['lm-carbs', '25'], ['lm-fat', '10'], ['lm-serving-g', '']]) el(id).value = v;
  const logMealEntry = build(fnSource('logMealEntry'), 'logMealEntry');
  await logMealEntry().catch((e) => { out.logError = e.message; });
  const post = apiCalls.find((c) => c.url === '/meals/log');
  out.body = post ? post.body : null;
  out.savedLocalDay = post && post.body && post.body.date ? dayIn(RealDate.parse(post.body.date)) : null;
  const daily = apiCalls.filter((c) => String(c.url).startsWith('/meals/daily/')).map((c) => String(c.url).split('/').pop());
  out.dailyParams = daily;
  process.stdout.write(JSON.stringify(out));
}
main().catch((e) => { process.stdout.write(JSON.stringify({ fatal: e.message })); });
