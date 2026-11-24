/**
 * EQA acceptance list, FitMunch Round A, real provider chain (brief section 4 tests 3 and 5).
 * Owned by Elite QA. LOCKED 2026-11-25 AEDT, written and proved red against main af82efb.
 * EQA also runs a hidden set the builder never sees. Every test name starts with its line ID.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 *
 * The REAL lib/ai-client.js and lib/ai-usage.js run here. Only the network is faked: https (xAI and
 * Anthropic) and the openai SDK. No real key is used and nothing leaves the test.
 */
const EventEmitter = require('events');

const net = {
  mode: 'ok',       // 'ok': xAI answers with a plan | 'all-fail': xAI timeout, OpenAI 429, Anthropic 400
  xaiTimeouts: [],  // the timeout each xAI request was given (ms)
};
const PLAN = {
  planName: 'EQA Program', summary: 'EQA test program', level: 'intermediate', frequency: 3,
  workouts: [{ day: 1, name: 'Bench Press', sets: 4, reps: '8-10', rest: 90 }, { day: 2, name: 'Squat', sets: 4, reps: '6-8', rest: 120 }],
};

jest.mock('https', () => {
  const actual = jest.requireActual('https');
  const EE = require('events');
  function request(opts, cb) {
    const req = new EE();
    req.write = () => true;
    req.destroy = () => {};
    req.setTimeout = () => req;
    req.end = () => {
      setImmediate(() => {
        const host = (opts && (opts.hostname || opts.host)) || '';
        const reply = (status, obj) => {
          const res = new EE(); res.statusCode = status; res.headers = { 'content-type': 'application/json' };
          if (cb) cb(res);
          res.emit('data', Buffer.from(JSON.stringify(obj))); res.emit('end');
        };
        if (/x\.ai$/.test(host)) {
          net.xaiTimeouts.push(opts.timeout);
          if (net.mode === 'all-fail') { const e = new Error('timeout'); e.code = 'ETIMEDOUT'; req.emit('error', e); return; }
          return reply(200, { choices: [{ message: { content: JSON.stringify(PLAN) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
        }
        if (/anthropic\.com$/.test(host)) return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'EQA bad request' } });
        const e = new Error('EQA: unexpected host ' + host); e.code = 'ECONNREFUSED'; req.emit('error', e);
      });
    };
    return req;
  }
  return { ...actual, request };
});

jest.mock('openai', () => {
  return class OpenAI {
    constructor() { this.chat = { completions: { create: async () => { const e = new Error('Rate limit reached'); e.status = 429; throw e; } } }; }
  };
}, { virtual: true });

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, name: 'EQA', email: `${id}@example.com`, subscriptionTier: /premium/.test(id) ? 'premium' : 'free', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => ({ age: 41, weight: 93.4, height: 187, gender: 'male', activityLevel: 'moderate', fitnessGoal: 'muscle_gain', targetCalories: 2675, targetProtein: 168, dietaryPreferences: [], allergies: [] })),
    trackEvent: jest.fn(),
  };
});

jest.mock('pg', () => ({ Pool: class { query() { return Promise.resolve({ rows: [] }); } end() { return Promise.resolve(); } } }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { makeUsageDb } = require('./eqa_round_a_support');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
delete process.env.DATABASE_URL;
delete process.env.SMOKE_ACCOUNT_IDS;
const aiUsage = require('./lib/ai-usage');
const db = makeUsageDb();
aiUsage._setQueryForTests(db.query);
const used = (u) => db.used(u, aiUsage.monthKey());
const tok = (userId) => jwt.sign({ userId, name: 'EQA' }, process.env.JWT_SECRET);
const settle = () => new Promise((r) => setTimeout(r, 150));

function keys(which) {
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  for (const k of which) process.env[k] = 'eqa-not-a-real-key';
}
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));

async function workout(uid) {
  const res = await request(app).post('/api/ai/workout-plan').set('Authorization', `Bearer ${tok(uid)}`).send({ goal: 'muscle_gain', daysPerWeek: 3 });
  await settle();
  return res;
}

describe('EQA Round A real provider chain (locked)', () => {
  afterAll(() => keys([]));

  for (const uid of ['u-ra3r-free', 'u-ra3r-premium']) {
    it(`RA3r real chain (xAI timeout, OpenAI 429, Anthropic 400): counter unchanged for ${uid.slice(7)} user`, async () => {
      keys(['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']); net.mode = 'all-fail';
      const before = used(uid);
      const res = await workout(uid);
      const servedPlan = res.status === 200 && res.body.plan && Array.isArray(res.body.plan.workouts) && res.body.plan.workouts.length > 0;
      const honestError = res.status >= 400 && res.body.success === false;
      expect(servedPlan || honestError).toBe(true);
      expect(used(uid) - before).toBe(0);
    });
  }

  it('RA5 the workout plan completes: (a) a 25s xAI reply is not cut off, or (b) a built plan with a notice is served when every provider fails', async () => {
    // (a) xAI only, answering: the request must be allowed to run past 25s.
    keys(['XAI_API_KEY']); net.mode = 'ok'; net.xaiTimeouts = [];
    const a = await workout('u-ra5a');
    const longEnough = net.xaiTimeouts.length > 0 && net.xaiTimeouts.every((t) => t === undefined || t === 0 || Number(t) > 25000);
    const optionA = longEnough && a.status === 200 && Array.isArray(a.body.plan && a.body.plan.workouts);
    // (b) every provider fails: a deterministic plan with a notice, no 502.
    keys(['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']); net.mode = 'all-fail';
    const b = await workout('u-ra5b');
    const optionB = b.status === 200 && Array.isArray(b.body.plan && b.body.plan.workouts) && b.body.plan.workouts.length > 0
      && typeof b.body.notice === 'string' && b.body.notice.trim().length > 0;
    const seen = `a: xAI timeouts ${JSON.stringify(net.xaiTimeouts.length ? net.xaiTimeouts : 'none')} status ${a.status}; b: status ${b.status} notice ${JSON.stringify(b.body.notice || null)}`;
    expect(optionA || optionB ? 'plan completes' : seen).toBe('plan completes');
  });
});
