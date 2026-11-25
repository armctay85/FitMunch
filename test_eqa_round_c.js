/**
 * EQA acceptance list, FitMunch Round C (logging dates and data export: FM-13, FM-39, FM-12 log half, FM-45).
 * Brief: /workspace/desk/fitmunch/briefs/round-c-dates-export-brief-2026-11-25.md section 4, tests 1-7.
 * Owned by Elite QA. LOCKED 2026-11-25 AEDT, written and proved red against main 4a058c72.
 * EQA also runs a hidden set the builder never sees. Every test name starts with its line ID.
 * Commit unchanged (with eqa_round_c_client.js), add this file to jest.config.js testMatch.
 * Do not edit, skip, loosen or retry.
 *
 * How it works:
 *  - The client half runs the REAL app.html meal-date functions and the REAL /js/*.js files app.html
 *    loads, in a child process with TZ=Australia/Melbourne and a frozen clock (eqa_round_c_client.js).
 *  - The server half runs the REAL POST /api/meals/log and GET /api/meals/daily routes with this
 *    process on TZ=UTC (Production runs UTC). Storage is faked, but getMealLogsByDate keeps the
 *    exact day-window logic of server/storage.js:338-353 on 4a058c72 (storage.js is not an allowed file).
 *  - Export runs the REAL GET /api/auth/export on a pg fake that knows each table's real columns
 *    (frozen from api_server.js and lib/db-migrate.js on 4a058c72) and rejects ORDER BY a missing column,
 *    the way Postgres does. No schema change is allowed (brief section 1).
 */
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const db = { meals: [], nextId: 1 };
// Real columns on 4a058c72 (CREATE TABLE + ALTER ... ADD COLUMN). Every other export table has an id column.
const COLUMNS = {
  pt_clients: ['pt_id', 'client_id', 'status', 'created_at', 'phase', 'notes', 'joined_at'],
  client_invitations: ['token', 'pt_id', 'email', 'accepted', 'expires_at', 'created_at'],
  plan_assignments: ['id', 'pt_id', 'client_id', 'plan_type', 'plan_id', 'assigned_at', 'active'],
  ai_usage_monthly: ['user_id', 'month', 'feature', 'count', 'updated_at'],
};
const pgState = { failTable: null, queries: [] };
function rowsFor(table, uid) {
  const PT = 'u-pt'; const CLIENT = 'u-client';
  if (table === 'pt_clients') {
    if (uid === PT) return [{ pt_id: PT, client_id: CLIENT, status: 'active', created_at: '2026-11-01T00:00:00Z', phase: null, notes: null, joined_at: null }];
    if (uid === CLIENT) return [{ pt_id: PT, client_id: CLIENT, status: 'active', created_at: '2026-11-01T00:00:00Z', phase: null, notes: null, joined_at: null }];
    return [];
  }
  if (table === 'client_invitations') return uid === PT ? [{ token: 'EQA-SECRET-INVITE-TOKEN', pt_id: PT, email: 'new@example.com', accepted: false, expires_at: '2026-12-01T00:00:00Z', created_at: '2026-11-20T00:00:00Z' }] : [];
  if (table === 'plan_assignments') return (uid === PT || uid === CLIENT) ? [{ id: 1, pt_id: PT, client_id: CLIENT, plan_type: 'meal', plan_id: 7, assigned_at: '2026-11-02T00:00:00Z', active: true }] : [];
  if (table === 'ai_usage_monthly') return [{ user_id: uid, month: '2026-11', feature: 'meal_plan', count: 1, updated_at: '2026-11-20T00:00:00Z' }];
  return [{ id: 1, user_id: uid, note: 'eqa ' + table }];
}
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      const text = typeof sql === 'string' ? sql : (sql && sql.text) || '';
      pgState.queries.push(text);
      const m = /FROM\s+(\w+)/i.exec(text);
      const table = m && m[1];
      if (!table || !/ORDER BY/i.test(text)) return Promise.resolve({ rows: [] });
      if (table === pgState.failTable) return Promise.reject(Object.assign(new Error('EQA: read failed'), { code: '57014' }));
      const order = (/ORDER BY\s+(.+?)\s+LIMIT/i.exec(text) || [])[1] || '';
      const cols = COLUMNS[table];
      if (cols) {
        for (const part of order.split(',')) {
          const col = part.trim().split(/\s+/)[0].replace(/"/g, '');
          if (col && !cols.includes(col)) return Promise.reject(Object.assign(new Error(`column "${col}" does not exist`), { code: '42703' }));
        }
      }
      const offset = Number(params && params[1]) || 0;
      if (offset > 0) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: rowsFor(table, params && params[0]) });
    }
    end() { return Promise.resolve(); }
  },
}));
jest.mock('./lib/ai-client', () => ({ hasProvider: () => true, chat: jest.fn(), chatJson: jest.fn(), providerName: () => 'xai' }));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, name: 'EQA', email: `${id}@example.com`, subscriptionTier: 'free', createdAt: '2026-10-01', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => ({ weight: 80 })),
    logMeal: jest.fn(async (userId, mealData) => { const row = { id: db.nextId++, userId, ...mealData, createdAt: new Date() }; db.meals.push(row); return row; }),
    // Exact window logic of server/storage.js:338-353 on 4a058c72 (not an allowed file).
    getMealLogsByDate: jest.fn(async (userId, date) => {
      const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
      return db.meals.filter((m) => m.userId === userId && new Date(m.date) >= startOfDay && new Date(m.date) <= endOfDay);
    }),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const tokenFor = (id) => jwt.sign({ userId: id, name: 'EQA' }, JWT_SECRET);
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const counters = require('./lib/shared-counters');

const MEL = 'Australia/Melbourne';
function client(env) {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'eqa_round_c_client.js')], {
    env: { ...process.env, EQA_REPO: __dirname, ...env }, encoding: 'utf8', timeout: 30000,
  });
  const r = JSON.parse(out);
  if (r.fatal) throw new Error('client harness: ' + r.fatal);
  return r;
}
// One customer journey: open Meals, log a meal, reload Meals (server), reload Home (client).
async function journey(nowIso, tz = MEL, food = 'EQA eggs ' + nowIso) {
  const c = client({ TZ: tz, EQA_NOW: nowIso, EQA_FOOD: food });
  expect(c.body).toBeTruthy();
  const uid = 'u-day-' + crypto.createHash('md5').update(nowIso + tz + food).digest('hex').slice(0, 8);
  const posted = await request(app).post('/api/meals/log').set('Authorization', `Bearer ${tokenFor(uid)}`).send(c.body);
  expect(posted.status).toBe(200);
  const saved = posted.body.meal;
  const day = c.dailyParams[c.dailyParams.length - 1];
  const reload = await request(app).get(`/api/meals/daily/${uid}/${day}`).set('Authorization', `Bearer ${tokenFor(uid)}`);
  expect(reload.status).toBe(200);
  const listed = (reload.body.meals || []).filter((m) => (m.foodName || m.food_name) === food).length;
  const savedJson = JSON.parse(JSON.stringify(saved));
  const home = client({ TZ: tz, EQA_NOW: nowIso, EQA_MODE: 'home', EQA_MEALS: JSON.stringify([savedJson]) });
  return { c, day, listed, home: home.homeToday, savedDate: savedJson.date };
}
function expectLocalDay(j, want) {
  expect({ localToday: j.c.localToday, picker: j.c.picker, savedLocalDay: j.c.savedLocalDay, reloadDay: j.day, listedOnReload: j.listed, homeToday: j.home })
    .toEqual({ localToday: want, picker: want, savedLocalDay: want, reloadDay: want, listedOnReload: 1, homeToday: 1 });
}

beforeEach(() => {
  pgState.failTable = null; pgState.queries.length = 0;
  counters.resetSharedCountersForTests();
  const hits = new Map();
  counters.setSharedCounterQueryForTests(async (sql, params) => {
    if (!/INSERT INTO rate_limit_counters/.test(sql)) return { rows: [] };
    const k = params.slice(0, 3).join('|'); hits.set(k, (hits.get(k) || 0) + 1);
    return { rows: [{ hits: hits.get(k) }] };
  });
});
afterAll(() => counters.resetSharedCountersForTests());

describe('EQA Round C acceptance (locked)', () => {
  // Test 1
  it('RC1 meal logged 6:25am AEDT (19:25Z the UTC day before) saves on the local day, lists on reload and shows in Home Meals today', async () => {
    expectLocalDay(await journey('2026-11-24T19:25:00Z'), '2026-11-25');
  });
  // Test 2
  it('RC2a meal logged 11:30pm AEDT stays on the local day, not tomorrow (control)', async () => {
    expectLocalDay(await journey('2026-11-25T12:30:00Z'), '2026-11-25');
  });
  it('RC2b DST start (Sun 4 Oct 2026): 6:25am AEDT logs on 4 Oct', async () => {
    expectLocalDay(await journey('2026-10-03T19:25:00Z'), '2026-10-04');
  });
  it('RC2c DST start eve: 11:30pm AEST Sat 3 Oct logs on 3 Oct (control)', async () => {
    expectLocalDay(await journey('2026-10-03T13:30:00Z'), '2026-10-03');
  });
  it('RC2d DST end (Sun 4 Apr 2027): 6:25am AEST logs on 4 Apr', async () => {
    expectLocalDay(await journey('2027-04-03T20:25:00Z'), '2027-04-04');
  });
  it('RC2e DST end day: 11:30pm AEST Sun 4 Apr logs on 4 Apr (control)', async () => {
    expectLocalDay(await journey('2027-04-04T13:30:00Z'), '2027-04-04');
  });
  // Test 3
  it('RC3 the Meals date picker and its label open on the local date at 6:25am AEDT', () => {
    const c = client({ TZ: MEL, EQA_NOW: '2026-11-24T19:25:00Z' });
    expect({ picker: c.picker, label: c.label }).toEqual({ picker: '2026-11-25', label: c.expectedLabel });
  });
  // Test 4
  it('RC4 overnight oats 1 jar (~300g) is built from per-100g values: not 960 kcal / 45 g protein, and 250-500 kcal', () => {
    const { searchFoods } = require('./food-db.js');
    const hit = searchFoods('overnight oats', 8).find((f) => /^overnight oats$/i.test(f.name));
    expect(hit).toBeTruthy();
    expect({ jarKcal: hit.calories, not960: hit.calories !== 960, jarKcal250to500: hit.calories >= 250 && hit.calories <= 500, jarProteinMax25: hit.protein <= 25, per100gKcalMax170: hit.per100g.cal <= 170 })
      .toEqual({ jarKcal: hit.calories, not960: true, jarKcal250to500: true, jarProteinMax25: true, per100gKcalMax170: true });
  });
  // Test 5
  it('RC5 test_workout_log_date, test_api_json_dates (+ _pg) and test_privacy_export are unchanged and still in testMatch', () => {
    const LOCK = {
      'test_workout_log_date.js': '4667b7092ce70ec49d2d4f52ae4b4391956c39602ff8a4201ad8b8f307428038',
      'test_api_json_dates.js': '995e0fe4bf592f692deca7d74a9c3b76a14c1df44d6750455de5136bba226ecc',
      'test_api_json_dates_pg.js': '5919d7b004ad0817c7657ae84e42b4f828c61d7b7e49a151138e810517c6c330',
      'test_privacy_export.js': 'e4ee3d7a51cd1bb52822834460020324fb62d89065e51358520779db3e7d85e0',
    };
    const cfg = require('./jest.config.js');
    const got = {};
    for (const f of Object.keys(LOCK)) {
      got[f] = { sha: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex'), inTestMatch: (cfg.testMatch || []).includes('**/' + f) };
    }
    const want = {}; for (const [f, sha] of Object.entries(LOCK)) want[f] = { sha, inTestMatch: true };
    expect(got).toEqual(want);
    expect((cfg.testMatch || []).includes('**/test_eqa_round_c.js')).toBe(true);
  });
  // Test 6
  const SECTIONS = ['exportedAt', 'account', 'profile', 'meal_logs', 'workout_logs', 'progress_logs', 'meal_plans', 'workout_plans', 'shopping_lists', 'favourites', 'achievements', 'analytics_events', 'activation_events', 'ai_usage', 'pt_clients', 'plan_assignments', 'client_invitations'];
  async function exportFor(uid) {
    const r = await request(app).get('/api/auth/export').set('Authorization', `Bearer ${tokenFor(uid)}`);
    let body = null; try { body = typeof r.body === 'object' && r.body && Object.keys(r.body).length ? r.body : JSON.parse(r.text); } catch (_) { body = null; }
    return { r, body };
  }
  for (const [label, uid] of [['free user', 'u-free'], ['PT user', 'u-pt'], ['client user', 'u-client']]) it(`RC6 GET /api/auth/export returns 200 with every section for a ${label}`, async () => {
    const { r, body } = await exportFor(uid);
    expect(r.status).toBe(200);
    expect(SECTIONS.filter((k) => !(body && k in body))).toEqual([]);
    if (uid === 'u-pt') {
      expect(body.pt_clients.length).toBe(1);
      expect(body.client_invitations.length).toBe(1);
      expect(r.text.includes('EQA-SECRET-INVITE-TOKEN')).toBe(false);
    }
    if (uid === 'u-client') expect(body.pt_clients.length).toBe(1);
    if (uid === 'u-free') expect(body.pt_clients).toEqual([]);
  });
  // Test 7
  for (const table of ['meal_logs', 'pt_clients', 'client_invitations', 'ai_usage_monthly']) it(`RC7 export returns 500 and no file when the ${table} read truly fails`, async () => {
    pgState.failTable = table;
    const { r } = await exportFor('u-pt');
    expect(r.status).toBe(500);
    expect(String(r.headers['content-disposition'] || '')).not.toMatch(/attachment/);
    expect(r.text).not.toMatch(/"meal_logs"\s*:/);
  });
});
