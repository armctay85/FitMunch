/**
 * EQA acceptance list, FitMunch Round A (AI actions: FM-35, FM-01, FM-71, FM-37, FM-11).
 * Brief: /workspace/desk/fitmunch/briefs/round-a-ai-actions-brief-2026-11-25.md section 4, tests 1-11.
 * Owned by Elite QA. LOCKED 2026-11-25 AEDT, written and proved red against main af82efb.
 * EQA also runs a hidden set the builder never sees. Every test name starts with its line ID.
 * Commit unchanged (with eqa_round_a_support.js and test_eqa_round_a_timeout.js), add both test files
 * to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 *
 * How the counter works: the REAL lib/ai-usage.js runs on an in-memory table (eqa_round_a_support.js),
 * so "counter unchanged" means the customer's monthly AI count really is unchanged after the response.
 * Interfaces these tests rely on (none may be removed, see brief section 3 and Drew's no-feature-loss rule):
 *  - app.html keeps loadPortalHome() as the Home loader and keeps API('<literal path>', {...}) calls.
 *  - meal-planner.js keeps planEngine.generatePlan / planEngine.buildPlan.
 *  - Profile storage keeps the server/storage.js columns (height, weight, age, gender, ...).
 */

const state = {
  ai: 'ok',            // 'ok' | 'fail' | 'bad-shape'
  chatJsonCalls: [],
  chatCalls: [],
  users: {},           // userId -> user row overrides
  profiles: {},        // userId -> profile (null = no profile row)
  saved: {},           // userId -> stored profile columns (createOrUpdateProfile fake)
  genThrow: false,
  buildThrow: false,
};
const CHAIN_FAIL = { ok: false, error: 'provider_error', status: 400, provider: 'anthropic', errorMessage: 'EQA: xAI timeout, OpenAI 429, Anthropic 400' };
const PLAN = {
  planName: 'EQA Program', summary: 'EQA test program', level: 'intermediate', frequency: 3,
  workouts: [{ day: 1, name: 'Bench Press', sets: 4, reps: '8-10', rest: 90 }, { day: 2, name: 'Squat', sets: 4, reps: '6-8', rest: 120 }],
};

jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  grokModel: jest.fn(() => 'grok-4.3'),
  openaiModel: jest.fn(() => 'gpt-4o-mini'),
  anthropicModel: jest.fn(() => 'claude-haiku-4-5'),
  availableProviders: jest.fn(() => ['xai', 'openai', 'anthropic']),
  REQUEST_TIMEOUT_MS: 20000,
  chat: jest.fn(async (opts) => {
    state.chatCalls.push(opts);
    if (state.ai !== 'ok') return CHAIN_FAIL;
    return { ok: true, provider: 'xai', model: 'grok-4.3', text: 'Add a palm of chicken at dinner to close the protein gap.', usage: { promptTokens: 40, completionTokens: 14 } };
  }),
  chatJson: jest.fn(async (opts) => {
    state.chatJsonCalls.push(opts);
    if (state.ai === 'fail') return CHAIN_FAIL;
    if (state.ai === 'bad-shape') return { ok: true, provider: 'xai', model: 'grok-4.3', text: '{}', data: { planName: 'x' } };
    return { ok: true, provider: 'xai', model: 'grok-4.3', text: JSON.stringify(PLAN), data: JSON.parse(JSON.stringify(PLAN)) };
  }),
  vision: jest.fn(async () => ({ ok: false, code: 'unavailable' })),
}));

jest.mock('./lib/meal-plan-engine', () => {
  const actual = jest.requireActual('./lib/meal-plan-engine');
  return {
    ...actual,
    generatePlan: (...a) => { if (state.genThrow) return Promise.reject(new Error('EQA: generatePlan failed')); return actual.generatePlan(...a); },
    buildPlan: (...a) => { if (state.buildThrow) throw new Error('EQA: buildPlan failed'); return actual.buildPlan(...a); },
  };
});

// Mirrors server/storage.js PROFILE_COLUMNS on af82efb: storage.js is not in the brief's allowed files.
const PROFILE_KEYS = ['height', 'weight', 'age', 'gender', 'activityLevel', 'fitnessGoal', 'dietaryPreferences', 'allergies', 'targetCalories', 'targetSteps', 'targetProtein', 'targetCarbs', 'targetFat'];
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  const DEFAULT_PROFILE = { age: 41, weight: 93.4, height: 187, gender: 'male', activityLevel: 'moderate', fitnessGoal: 'muscle_gain', targetCalories: 2675, targetProtein: 168, dietaryPreferences: [], allergies: [] };
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, name: 'EQA', email: `${id}@example.com`, subscriptionTier: 'free', settings: { aiDataConsent: true }, ...(state.users[id] || {}) })),
    getProfile: jest.fn(async (id) => {
      if (Object.prototype.hasOwnProperty.call(state.saved, id)) return { userId: id, ...state.saved[id] };
      if (Object.prototype.hasOwnProperty.call(state.profiles, id)) return state.profiles[id] === null ? undefined : JSON.parse(JSON.stringify(state.profiles[id]));
      return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    }),
    createOrUpdateProfile: jest.fn(async (id, data) => {
      const row = { ...(state.saved[id] || {}) };
      for (const k of Object.keys(data || {})) if (PROFILE_KEYS.includes(k) && data[k] !== undefined) row[k] = data[k];
      state.saved[id] = row;
    }),
    mergeProfileFilters: jest.fn(async () => true),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    trackEvent: jest.fn(),
  };
});

jest.mock('pg', () => ({ Pool: class { query() { return Promise.resolve({ rows: [] }); } end() { return Promise.resolve(); } } }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { makeUsageDb, appGraph, replayBody } = require('./eqa_round_a_support');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
delete process.env.DATABASE_URL;
delete process.env.SMOKE_ACCOUNT_IDS;
const aiUsage = require('./lib/ai-usage');
const db = makeUsageDb();
aiUsage._setQueryForTests(db.query);

const tok = (userId) => jwt.sign({ userId, name: 'EQA' }, process.env.JWT_SECRET);
const settle = () => new Promise((r) => setTimeout(r, 150));
const used = (userId) => db.used(userId, aiUsage.monthKey());
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  app.use('/api', require('./api_server'));
  return app;
}
const app = makeApp();
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
const G = appGraph(HTML);
const HOME_FACTS = { todayCalories: 1250, todayProtein: 70, streak: 3, goal: 'muscle_gain', targetCalories: 2675, targetProtein: 168 };

async function call(method, p, userId, body) {
  let r = request(app)[method.toLowerCase()](p).set('Authorization', `Bearer ${tok(userId)}`);
  if (body !== undefined && method !== 'GET') r = r.send(body);
  const res = await r;
  await settle();
  return res;
}
function homeAiCalls() {
  const run = G.reach(['loadPortalHome']);
  const out = [];
  for (const n of run) for (const a of G.fns.get(n).api) if (!a.wired && /^\/(ai\/|meal-plan)/.test(a.path)) out.push({ fn: n, ...a });
  return out;
}
function tapInsightCalls() {
  const run = G.reach(G.tapRoots());
  const out = [];
  for (const n of run) for (const a of G.fns.get(n).api) if (/^\/ai\/insight/.test(a.path)) out.push({ fn: n, ...a });
  return out;
}

describe('EQA Round A acceptance (locked)', () => {
  // ── Test 1 / 2: FM-35 Home insight ──────────────────────────────────────────
  it('RA1 Home loaded 3 times leaves the free AI counter unchanged (no charged AI call on Home load)', async () => {
    expect(G.fns.has('loadPortalHome')).toBe(true);
    const calls = homeAiCalls();
    const uid = 'u-ra1';
    const before = used(uid);
    const statuses = [];
    for (let load = 0; load < 3; load += 1) {
      for (const c of calls) {
        const res = await call(c.method, '/api' + c.path, uid, replayBody(c.text, HOME_FACTS));
        statuses.push(`${c.method} ${c.path} -> ${res.status}`);
        // A Home-load AI request must still work for the customer (no 404/500 to hide behind).
        expect(res.status < 300 ? 'ok' : statuses.join('; ')).toBe('ok');
      }
    }
    expect(`counter delta ${used(uid) - before} after 3 Home loads (${statuses.join('; ') || 'no AI call on load'})`)
      .toBe(`counter delta 0 after 3 Home loads (${statuses.join('; ') || 'no AI call on load'})`);
  });

  it('RA2 a tapped insight charges exactly 1 and returns a tip', async () => {
    const calls = tapInsightCalls();
    expect(calls.length > 0 ? 'tap path found' : 'no tap control reaches /ai/insight').toBe('tap path found');
    const c = calls[0];
    const uid = 'u-ra2';
    const before = used(uid);
    state.ai = 'ok';
    const res = await call(c.method, '/api' + c.path, uid, replayBody(c.text, HOME_FACTS));
    expect(res.status).toBe(200);
    expect(typeof res.body.insight === 'string' && res.body.insight.trim().length > 0).toBe(true);
    expect(used(uid) - before).toBe(1);
  });

  // ── Test 3: refund on failure, every user ──────────────────────────────────
  for (const tier of ['free', 'premium']) {
    it(`RA3 /ai/workout-plan with every provider failing leaves the counter unchanged (${tier} user)`, async () => {
      const uid = `u-ra3-${tier}`;
      state.users[uid] = { subscriptionTier: tier };
      state.ai = 'fail';
      const before = used(uid);
      const res = await call('POST', '/api/ai/workout-plan', uid, { goal: 'muscle_gain', daysPerWeek: 3 });
      state.ai = 'ok';
      const servedPlan = res.status === 200 && res.body && res.body.plan && Array.isArray(res.body.plan.workouts) && res.body.plan.workouts.length > 0;
      const honestError = res.status >= 400 && res.body && res.body.success === false;
      expect(servedPlan || honestError).toBe(true);
      expect(used(uid) - before).toBe(0);
    });
  }

  // ── Test 4: same rule on /meal-plan/generate ───────────────────────────────
  it('RA4a meal plan: AI fails and the builder plan is served, counter unchanged', async () => {
    const uid = 'u-ra4a'; state.ai = 'fail';
    const before = used(uid);
    const res = await call('POST', '/api/meal-plan/generate', uid, { goal: 'maintain', days: 7, calories: 2400, protein: 150 });
    state.ai = 'ok';
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    expect(used(uid) - before).toBe(0);
  });

  it('RA4b meal plan: AI path throws, built plan served from the fallback, counter unchanged', async () => {
    const uid = 'u-ra4b'; state.genThrow = true;
    const before = used(uid);
    const res = await call('POST', '/api/meal-plan/generate', uid, { goal: 'maintain', days: 7, calories: 2400, protein: 150 });
    state.genThrow = false;
    expect(res.status).toBe(200);
    expect(used(uid) - before).toBe(0);
  });

  for (const tier of ['free', 'premium']) {
    it(`RA4c meal plan: AI and builder both fail, error returned and counter unchanged (${tier} user)`, async () => {
      const uid = `u-ra4c-${tier}`; state.users[uid] = { subscriptionTier: tier };
      state.genThrow = true; state.buildThrow = true;
      const before = used(uid);
      const res = await call('POST', '/api/meal-plan/generate', uid, { goal: 'maintain', days: 7, calories: 2400, protein: 150 });
      state.genThrow = false; state.buildThrow = false;
      expect(res.status >= 400).toBe(true);
      expect(used(uid) - before).toBe(0);
    });
  }

  // ── Test 6: FM-71 workout prompt uses the profile ──────────────────────────
  it('RA6 the workout prompt includes weight, height, age, sex and calorie target from the profile', async () => {
    const uid = 'u-ra6'; state.ai = 'ok';
    state.profiles[uid] = { age: 37, weight: 104.6, height: 191, gender: 'female', activityLevel: 'active', fitnessGoal: 'lose_weight', targetCalories: 2315, targetProtein: 160, dietaryPreferences: [], allergies: [] };
    state.chatJsonCalls = [];
    const res = await call('POST', '/api/ai/workout-plan', uid, { goal: 'lose_weight', daysPerWeek: 4 });
    expect(state.chatJsonCalls.length > 0 || state.chatCalls.length > 0).toBe(true);
    const opts = state.chatJsonCalls[state.chatJsonCalls.length - 1] || {};
    const text = [opts.system || '', ...(opts.messages || []).map((m) => String(m.content))].join('\n');
    expect(text).toMatch(/104\.6/);
    expect(text).toMatch(/191/);
    expect(text).toMatch(/\b37\b/);
    expect(text).toMatch(/female/i);
    expect(text).toMatch(/2,?315/);
    expect(res.status).toBe(200);
  });

  // ── Test 7: onboarding saves age, height, weight ───────────────────────────
  it('RA7a onboarding POST /user/profile sends age, height and weight', () => {
    const posts = [];
    for (const f of G.fns.values()) {
      if (!/\bOB\./.test(f.body)) continue;
      for (const a of f.api) if (a.path === '/user/profile' && a.method === 'POST') posts.push(a.text);
    }
    expect(posts.length > 0).toBe(true);
    const hasAll = posts.some((t) => /(^|[^A-Za-z])age\b/.test(t) && /(^|[^A-Za-z])(height|heightCm)\b/.test(t) && /(^|[^A-Za-z])(weight|weightKg)\b/.test(t));
    expect(hasAll ? 'age, height and weight sent' : posts.join('\n---\n')).toBe('age, height and weight sent');
  });

  it('RA7b a profile saved as {age, heightCm, weightKg} reloads with age, height and weight non-null', async () => {
    const uid = 'u-ra7b';
    const save = await call('POST', '/api/user/profile', uid, { fitnessGoal: 'muscle_gain', targetCalories: 2675, targetProtein: 168, targetCarbs: 300, targetFat: 74, age: 41, heightCm: 187, weightKg: 93.4 });
    expect(save.status).toBe(200);
    const res = await call('GET', `/api/user/profile/${uid}`, uid);
    expect(res.status).toBe(200);
    const p = res.body.profile || {};
    expect(Number(p.age)).toBe(41);
    expect(Number(p.height != null ? p.height : p.heightCm)).toBe(187);
    expect(Number(p.weight != null ? p.weight : p.weightKg)).toBe(93.4);
  });

  // ── Test 8: missing profile and filtered users ─────────────────────────────
  it('RA8a a user with no profile row still gets a workout plan (no 500)', async () => {
    const uid = 'u-ra8a'; state.profiles[uid] = null; state.ai = 'ok';
    const res = await call('POST', '/api/ai/workout-plan', uid, { goal: 'general_fitness', daysPerWeek: 3 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plan && res.body.plan.workouts) && res.body.plan.workouts.length > 0).toBe(true);
  });

  it('RA8b a filtered user keeps the fixed program with no AI call and no credit (#127a)', async () => {
    const uid = 'u-ra8b';
    state.profiles[uid] = { age: 30, weight: 70, height: 170, gender: 'female', dietaryPreferences: ['vegan'], allergies: [] };
    state.chatJsonCalls = [];
    const before = used(uid);
    const res = await call('POST', '/api/ai/workout-plan', uid, { goal: 'general_fitness', daysPerWeek: 3 });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fixed');
    expect(state.chatJsonCalls.length).toBe(0);
    expect(used(uid) - before).toBe(0);
  });

  // ── Test 9: FM-37 calorie ceiling ──────────────────────────────────────────
  it('RA9 300 kg, 230 cm, very active, build muscle gets a capped target the app can build a week for', () => {
    const T = require('./public/js/fm-targets.js');
    const t = T.computeTargets({ age: 30, sex: 'male', heightCm: 230, weightKg: 300, activity: 'very_active', goal: 'muscle_gain' });
    // 4500 is the most POST /api/meal-plan/generate accepts (meal-planner.js planInput), so a higher target cannot get a week.
    expect(t.calories < 4501).toBe(true);
    expect(t.calories > 1199).toBe(true);
    expect(t.protein > 39 && t.protein < 351).toBe(true);
    expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.calories) < 20).toBe(true);
  });

  it('RA9 control: an ordinary profile is not changed by the cap (80 kg, 180 cm, 30, moderate, maintain = 2760)', () => {
    const T = require('./public/js/fm-targets.js');
    expect(T.computeTargets({ age: 30, sex: 'male', heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' }).calories).toBe(2760);
  });

  // ── Test 10: FM-11 swaps on every builder meal ─────────────────────────────
  function mealsOf(plan) {
    const out = [];
    for (const d of (plan && plan.days) || []) for (const m of Object.values(d.meals || {})) if (m && typeof m === 'object') out.push(m);
    return out;
  }
  it('RA10a builder week served after an AI failure carries swaps (a list, maybe empty) on every meal', async () => {
    const uid = 'u-ra10a'; state.ai = 'fail';
    const res = await call('POST', '/api/meal-plan/generate', uid, { goal: 'maintain', days: 7, calories: 2400, protein: 150 });
    state.ai = 'ok';
    expect(res.status).toBe(200);
    const meals = mealsOf(res.body.plan);
    expect(meals.length > 0).toBe(true);
    const missing = meals.filter((m) => !Array.isArray(m.swaps)).length;
    expect(`${missing} of ${meals.length} meals without a swaps list`).toBe(`0 of ${meals.length} meals without a swaps list`);
  });

  it('RA10b builderOnly week (onboarding) carries swaps on every meal', async () => {
    const res = await call('POST', '/api/meal-plan/generate', 'u-ra10b', { builderOnly: true, goal: 'maintain', days: 7, calories: 2400, protein: 150 });
    expect(res.status).toBe(200);
    const meals = mealsOf(res.body.plan);
    expect(meals.length > 0).toBe(true);
    expect(meals.filter((m) => !Array.isArray(m.swaps)).length).toBe(0);
  });

  it('RA10c every app.html renderer that makes a Swap button also says "No swap fits" for an empty list', () => {
    const renderers = [...G.fns.values()].filter((f) => /textContent\s*=\s*['"]Swap['"]/.test(f.body));
    expect(renderers.length > 0).toBe(true);
    for (const f of renderers) expect(`${f.name}: ${/No swap fits/.test(f.body)}`).toBe(`${f.name}: true`);
  });

  // ── Test 11: existing suites stay, nothing removed ─────────────────────────
  it('RA11 existing AI suites stay in testMatch with no fewer tests and no skips; AI features still present', () => {
    const cfg = fs.readFileSync(path.join(__dirname, 'jest.config.js'), 'utf8');
    const base = { 'test_ai_credit_check.js': 20, 'test_server_ai.js': 30, 'test_ai_client.js': 33 };
    for (const [f, n] of Object.entries(base)) {
      expect(cfg.includes(`'**/${f}'`)).toBe(true);
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const count = (src.match(/^\s*(it|test)\(/gm) || []).length;
      expect(`${f} tests ${count >= n ? 'kept' : count}`).toBe(`${f} tests kept`);
      expect(/\b(it|test|describe)\.skip\(|\bx(it|test|describe)\(|\.only\(/.test(src)).toBe(false);
    }
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(api).toMatch(/router\.post\('\/ai\/insight'/);
    expect(api).toMatch(/router\.post\('\/ai\/workout-plan'/);
    expect(fs.readFileSync(path.join(__dirname, 'meal-planner.js'), 'utf8')).toMatch(/router\.post\('\/generate'/);
    expect(HTML).toMatch(/id="ai-coach-card"/);
    expect(HTML).toMatch(/No swap fits/);
    expect(cfg.includes("'**/test_eqa_round_a.js'")).toBe(true);
    expect(cfg.includes("'**/test_eqa_round_a_timeout.js'")).toBe(true);
  });
});
