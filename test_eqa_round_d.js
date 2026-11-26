/**
 * EQA acceptance list, FitMunch Round D (morning meals on Home and in Coach: FM-13 reopen, FM-07).
 * Brief: /workspace/desk/fitmunch/briefs/round-d-morning-meals-brief-2026-11-26.md section 5, tests 1-6.
 * Owned by Elite QA. LOCKED 2026-11-26 AEDT, written and proved red against main a5c01d2c.
 * EQA also runs a hidden set the builder never sees. Every test name starts with its line ID.
 * Commit unchanged at the repo root, add this file to jest.config.js testMatch.
 * Do not edit, skip, loosen or retry.
 *
 * How it works:
 *  - This process runs TZ=UTC (Production runs UTC). The clock is frozen per test by swapping global Date.
 *  - Meals are stored the PR 242 way: the customer's local date label at T00:00:00Z.
 *  - The REAL routes run: GET /api/portal/me, POST /api/ai/chat (Coach context), GET /api/ai/weekly-review,
 *    GET /api/clients/:clientId. Storage is faked, but getMealLogsForPeriod keeps the exact inclusive
 *    window of server/storage.js:355-366 on a5c01d2c (date >= start AND date <= end). The fix must stay on
 *    that read (no new storage read); only the end bound the callers pass may change.
 *  - Home "Meals today" runs the REAL public/js/fm-home-week.js through eqa_round_c_client.js (Round C, locked).
 */
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RealDate = Date;
let FROZEN = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0 && FROZEN != null) super(FROZEN); else super(...a); }
  static now() { return FROZEN != null ? FROZEN : RealDate.now(); }
}
function freeze(iso) { FROZEN = RealDate.parse(iso); global.Date = FakeDate; }
function thaw() { FROZEN = null; global.Date = RealDate; }

const PT = '11111111-1111-4111-8111-111111111111';
const db = { meals: [] };
jest.mock('pg', () => ({
  Pool: class {
    query(sql) {
      const text = typeof sql === 'string' ? sql : (sql && sql.text) || '';
      if (/SELECT role FROM users/i.test(text)) return Promise.resolve({ rows: [{ role: 'pt' }] });
      if (/SELECT 1 FROM pt_clients/i.test(text)) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      return Promise.resolve({ rows: [] });
    }
    end() { return Promise.resolve(); }
  },
}));
jest.mock('./lib/ai-client', () => ({
  hasProvider: () => true,
  chat: async (opts) => { (global.__eqaChatCalls = global.__eqaChatCalls || []).push(opts); return { ok: true, text: 'Keep going.', provider: 'xai' }; },
  chatJson: async (opts) => { (global.__eqaChatCalls = global.__eqaChatCalls || []).push(opts); return { ok: false, error: 'eqa stub' }; },
  providerName: () => 'xai',
}));
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return { ...actual, checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 5, used: 0, limit: 10 })), isSmokeAccount: () => false, refundSmokeOnFailure: () => {} };
});
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, name: 'EQA', email: 'eqa@example.com', role: 'client', subscriptionTier: 'premium', createdAt: '2026-10-01', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => ({ age: 34, weight: 85, height: 180, fitnessGoal: 'lose_weight', targetCalories: 2100, targetProtein: 170, dietaryPreferences: [], allergies: '[]' })),
    // Exact window logic of server/storage.js:355-366 on a5c01d2c: inclusive start and end, newest first.
    getMealLogsForPeriod: jest.fn(async (userId, startDate, endDate) => db.meals
      .filter((m) => m.userId === userId && new RealDate(m.date) >= new RealDate(startDate) && new RealDate(m.date) <= new RealDate(endDate))
      .sort((a, b) => new RealDate(b.date) - new RealDate(a.date))),
    getMealLogsByDate: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const tokenFor = (id) => jwt.sign({ userId: id, name: 'EQA' }, JWT_SECRET);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', require('./api_server'));

const OATS = { foodName: 'Overnight oats', mealType: 'breakfast', calories: 348, protein: 16.7, carbs: 52, fat: 8 };
let seq = 0;
function uid() { seq += 1; return `${String(seq).padStart(8, '0')}-2222-4222-8222-222222222222`; }
function meal(user, label, extra = {}) {
  const row = { id: db.meals.length + 1, userId: user, ...OATS, ...extra, date: new RealDate(`${label}T00:00:00.000Z`), createdAt: new RealDate() };
  db.meals.push(row);
  return row;
}
function homeCount(meals, nowIso) {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'eqa_round_c_client.js')], {
    env: { ...process.env, TZ: 'Australia/Melbourne', EQA_REPO: __dirname, EQA_NOW: nowIso, EQA_MODE: 'home', EQA_MEALS: JSON.stringify(meals) },
    encoding: 'utf8', timeout: 30000,
  });
  const r = JSON.parse(out);
  if (r.fatal) throw new Error('client harness: ' + r.fatal);
  return r.homeToday;
}
async function portal(user, nowIso) {
  freeze(nowIso);
  try {
    const r = await request(app).get('/api/portal/me').set('Authorization', `Bearer ${tokenFor(user)}`);
    return r;
  } finally { thaw(); }
}
async function homeJourney(nowIso, label) {
  const u = uid();
  meal(u, label, { foodName: 'EQA oats ' + nowIso });
  const r = await portal(u, nowIso);
  const listed = r.status === 200 ? (r.body.recentMeals || []).filter((m) => m.foodName === 'EQA oats ' + nowIso).length : -1;
  const recent = r.status === 200 ? JSON.parse(JSON.stringify(r.body.recentMeals || [])) : [];
  return { status: r.status, listed, homeMealsToday: homeCount(recent, nowIso) };
}
async function coach(user, nowIso, context) {
  global.__eqaChatCalls = [];
  freeze(nowIso);
  try {
    const r = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ messages: [{ role: 'user', content: 'What have I logged so far today, and how much protein do I still need?' }], context });
    const call = (global.__eqaChatCalls || [])[0];
    return { status: r.status, system: call ? String(call.system || '') : '' };
  } finally { thaw(); }
}

afterEach(() => thaw());

describe('EQA Round D acceptance (locked)', () => {
  // Test 1
  it('RD1 6:13am AEDT (19:13Z the UTC day before): a meal logged for today is in /portal/me recentMeals and Home Meals today counts it', async () => {
    expect(await homeJourney('2026-11-25T19:13:00Z', '2026-11-26')).toEqual({ status: 200, listed: 1, homeMealsToday: 1 });
  });
  // Test 2
  for (const [id, nowIso, label, what] of [
    ['RD2a', '2026-11-25T23:59:00Z', '2026-11-26', '10:59am AEDT'],
    ['RD2b', '2026-11-26T00:01:00Z', '2026-11-26', '11:01am AEDT (control)'],
    ['RD2c', '2026-11-26T12:30:00Z', '2026-11-26', '11:30pm AEDT (control)'],
    ['RD2d', '2026-10-03T19:13:00Z', '2026-10-04', 'DST start Sun 4 Oct 2026, 6:13am AEDT'],
    ['RD2e', '2026-10-03T13:30:00Z', '2026-10-03', 'DST start eve, 11:30pm AEST Sat 3 Oct (control)'],
    ['RD2f', '2027-04-03T20:13:00Z', '2027-04-04', 'DST end Sun 4 Apr 2027, 6:13am AEST'],
    ['RD2g', '2027-04-03T12:30:00Z', '2027-04-03', 'DST end eve, 11:30pm AEDT Sat 3 Apr (control)'],
  ]) it(`${id} ${what}: today's meal is in recentMeals and Home Meals today`, async () => {
    expect(await homeJourney(nowIso, label)).toEqual({ status: 200, listed: 1, homeMealsToday: 1 });
  });
  // Test 3
  it('RD3a Coach context at 6:13am AEDT names today\'s meal and the server total 348 kcal, 16.7 g protein', async () => {
    const u = uid();
    meal(u, '2026-11-26');
    const c = await coach(u, '2026-11-25T19:13:00Z', {});
    expect(c.status).toBe(200);
    expect({
      namesMeal: /Overnight oats/i.test(c.system),
      todayTotal: /Today[^\n]*\b348 kcal\b[^\n]*\b(16\.7|17) g protein/i.test(c.system),
    }).toEqual({ namesMeal: true, todayTotal: true });
  });
  it('RD3b Coach never says 0 kcal today when a meal is logged, even when the browser sends todayCalories 0', async () => {
    const u = uid();
    meal(u, '2026-11-26');
    const c = await coach(u, '2026-11-25T19:13:00Z', { todayCalories: 0, todayProtein: 0 });
    expect(c.status).toBe(200);
    expect({
      zeroToday: /Today[^\n]*\b0 kcal/i.test(c.system),
      todayTotal: /Today[^\n]*\b348 kcal\b/i.test(c.system),
    }).toEqual({ zeroToday: false, todayTotal: true });
  });
  // Test 4
  it('RD4a weekly review counts a today-morning meal: 2 earlier days plus today at 6:13am AEDT is 3 days and 1044 kcal, not the empty state', async () => {
    const u = uid();
    meal(u, '2026-11-24'); meal(u, '2026-11-25'); meal(u, '2026-11-26');
    global.__eqaChatCalls = [];
    freeze('2026-11-25T19:13:00Z');
    let r;
    try { r = await request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${tokenFor(u)}`); } finally { thaw(); }
    const sent = JSON.stringify(global.__eqaChatCalls || []);
    expect({ source: r.body.source === 'empty' ? 'empty' : 'not-empty', aiToldThreeDays: /meals logged[^"\\]*?\b3\b/i.test(sent), aiToldTotal1044: /\b1044\b/.test(sent) })
      .toEqual({ source: 'not-empty', aiToldThreeDays: true, aiToldTotal1044: true });
  });
  it('RD4b PT client view at 6:13am AEDT includes the client\'s today-morning meal', async () => {
    const client = uid();
    meal(client, '2026-11-26', { foodName: 'EQA PT view oats' });
    freeze('2026-11-25T19:13:00Z');
    let r;
    try { r = await request(app).get(`/api/clients/${client}`).set('Authorization', `Bearer ${tokenFor(PT)}`); } finally { thaw(); }
    expect({ status: r.status, listed: (r.body.meals || []).filter((m) => m.foodName === 'EQA PT view oats').length }).toEqual({ status: 200, listed: 1 });
  });
  it('RD4c no meal-read caller in api_server.js passes new Date() (server UTC now) as the end bound', () => {
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const bad = api.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /getMealLogsForPeriod\(.*,\s*new Date\(\)\s*\)/.test(l)).map(([n]) => n);
    expect(bad).toEqual([]);
  });
  // Test 5
  for (const [id, nowIso, today, tomorrow] of [
    ['RD5a', '2026-11-25T19:13:00Z', '2026-11-26', '2026-11-27'],
    ['RD5b', '2026-11-26T12:30:00Z', '2026-11-26', '2026-11-27'],
    ['RD5c', '2026-10-03T19:13:00Z', '2026-10-04', '2026-10-05'],
  ]) it(`${id} tomorrow's meal (${tomorrow}) stays out of recentMeals and Home at ${nowIso}`, async () => {
    const u = uid();
    meal(u, today, { foodName: 'EQA today' });
    meal(u, tomorrow, { foodName: 'EQA tomorrow' });
    const r = await portal(u, nowIso);
    const names = (r.body.recentMeals || []).map((m) => m.foodName);
    expect({ status: r.status, today: names.includes('EQA today'), tomorrow: names.includes('EQA tomorrow') }).toEqual({ status: 200, today: true, tomorrow: false });
  });
  // Test 6
  it('RD6a Round C acceptance files and test_workout_log_date are unchanged and in testMatch; this file is in testMatch', () => {
    const LOCK = {
      'test_eqa_round_c.js': 'd7d511a13820a12f8cd306c09ef75c3356f147952580a2fa5e5f4798cb6fae86',
      'eqa_round_c_client.js': '6da12ff36a3b61c55c01fd0493674493e176c21d47e1b94136a9568f8bae317e',
      'test_workout_log_date.js': '4667b7092ce70ec49d2d4f52ae4b4391956c39602ff8a4201ad8b8f307428038',
    };
    const cfg = require('./jest.config.js');
    const got = {};
    for (const f of Object.keys(LOCK)) got[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');
    expect(got).toEqual(LOCK);
    const tm = cfg.testMatch || [];
    expect(['test_eqa_round_c.js', 'test_workout_log_date.js', 'test_eqa_round_d.js'].filter((f) => !tm.includes('**/' + f))).toEqual([]);
  });
  it('RD6b test_audit_p2.js changes only its getMealLogsForPeriod pin (the one allowed re-baseline) and keeps every test', () => {
    const src = fs.readFileSync(path.join(__dirname, 'test_audit_p2.js'), 'utf8');
    const rest = src.split('\n').filter((l) => !/getMealLogsForPeriod/.test(l)).join('\n');
    expect({ restSha: crypto.createHash('sha256').update(rest).digest('hex'), its: (src.match(/\bit\(/g) || []).length })
      .toEqual({ restSha: '7f276a8f0bd302b8977ac85d45dc9a18e2e2cb41708e5bc63e80d8ccb288e3c2', its: 30 });
  });
});
