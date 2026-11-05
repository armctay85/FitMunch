/** Coach uses the account's own profile, targets and latest plan; smaller context; time budget. */
const pgCalls = [];
let planRows = null; // optional per-test: (sql, params) => rows
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      pgCalls.push({ sql, params });
      if (planRows) return Promise.resolve({ rows: planRows(sql, params) || [] });
      if (/FROM meal_plans/.test(sql) && !/plan_assignments pa JOIN/.test(sql)) {
        return Promise.resolve({ rows: [{ name: 'Christmas cut', meals: { days: [{ meals: { breakfast: { name: 'Greek yoghurt oats', ingredients: ['Greek yoghurt', 'Rolled oats'] }, lunch: { name: 'Chicken rice bowl', ingredients: ['Chicken breast', 'White rice'] } } }, {}, {}, {}, {}, {}, {}] } }] });
      }
      return Promise.resolve({ rows: [] });
    }
  },
}));
jest.mock('./lib/ai-client', () => ({
  hasProvider: () => true,
  chat: jest.fn(async () => ({ ok: true, text: 'ok', provider: 'xai' })),
  chatJson: jest.fn(),
  providerName: () => 'xai',
}));
jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 5 })),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
}));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({ id: 'u1', email: 'me@example.com', subscriptionTier: 'premium', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => ({ age: 34, weight: 85, height: 180, fitnessGoal: 'lose_weight', targetCalories: 2100, targetProtein: 170, dietaryPreferences: [], allergies: '[]' })),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const token = jwt.sign({ userId: 'u1' }, JWT_SECRET);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', require('./api_server'));

describe('Coach context', () => {
  it('system prompt carries the user\u2019s own numbers and plan, no email; options are tuned for speed', async () => {
    aiClient.chat.mockClear();
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2000) }));
    // A peanut-allergy user's food questions are answered from checked recipes (#127a), so this asks a non-food one.
    history.push({ role: 'user', content: 'How should I warm up for squats?' });
    const r = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${token}`)
      .send({ messages: history, context: { todayCalories: 1200, todayProtein: 80, targetCalories: 9999 } });
    expect(r.status).toBe(200);
    const opts = aiClient.chat.mock.calls[0][0];
    expect(opts.system).toContain('Body: 34 y, 85 kg, 180 cm');
    expect(opts.system).toContain('Goal: lose fat');
    expect(opts.system).toContain('Daily targets: 2100 kcal, 170 g protein');
    expect(opts.system).not.toContain('9999');
    // Diet and allergy lines aren't asserted here: users with filters never reach the AI (#127a).
    expect(opts.system).toContain('Today so far: 1200 kcal, 80 g protein');
    expect(opts.system).toContain('Latest plan: Christmas cut, 7 days (day 1: Greek yoghurt oats; Chicken rice bowl)');
    expect(opts.system).not.toMatch(/me@example\.com|u1/);
    expect(opts.messages.length).toBeLessThanOrEqual(16);
    for (const m of opts.messages.slice(0, -1)) expect(m.content.length).toBeLessThanOrEqual(1200);
    expect(opts.messages[opts.messages.length - 1].content).toBe('How should I warm up for squats?');
    expect(opts.maxTokens).toBe(350);
    expect(opts.budgetMs).toBe(12000);
  });
});

describe('ai-client time budget', () => {
  const { _withDeadlineForTests: withDeadline, MIN_ATTEMPT_MS } = jest.requireActual('./lib/ai-client');
  it('a slow provider resolves as a 504 timeout at the deadline', async () => {
    const slow = new Promise((r) => setTimeout(() => r({ ok: true, text: 'late' }), 500));
    const t0 = Date.now();
    const r = await withDeadline(slow, 50, 'xai');
    expect(Date.now() - t0).toBeLessThan(400);
    expect(r).toMatchObject({ ok: false, error: 'timeout', status: 504, provider: 'xai' });
  });
  it('a fast provider wins', async () => {
    expect(await withDeadline(Promise.resolve({ ok: true, text: 'hi' }), 1000, 'xai')).toEqual({ ok: true, text: 'hi' });
  });
  it('a thrown provider becomes a provider_error result', async () => {
    expect(await withDeadline(Promise.reject(new Error('boom')), 1000, 'openai')).toMatchObject({ ok: false, error: 'provider_error' });
  });
  it('keeps a floor for starting a fallback', () => {
    expect(MIN_ATTEMPT_MS).toBeGreaterThanOrEqual(2000);
  });
});

const chatAs = (userId, body) => request(app).post('/api/ai/chat')
  .set('Authorization', `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`).send(body);

describe('Coach QA r1', () => {
  afterEach(() => { planRows = null; });

  it('M1: the newest message keeps up to 4,000 chars; earlier turns are cut to 1,200', async () => {
    aiClient.chat.mockClear();
    // Training questions: this profile has filters, so food questions get checked recipes instead (#127a).
    const long = `squats ${'q'.repeat(3000)} END-OF-QUESTION`;
    const r = await chatAs('u1', { messages: [{ role: 'user', content: 'a'.repeat(3000) }, { role: 'assistant', content: 'b'.repeat(3000) }, { role: 'user', content: long }] });
    expect(r.status).toBe(200);
    const msgs = aiClient.chat.mock.calls[0][0].messages;
    expect(msgs[2].content).toBe(long);
    expect(msgs[0].content).toHaveLength(1200);
    expect(msgs[1].content).toHaveLength(1200);
    aiClient.chat.mockClear();
    await chatAs('u1', { messages: [{ role: 'user', content: `squats ${'z'.repeat(9000)}` }] });
    expect(aiClient.chat.mock.calls[0][0].messages[0].content).toHaveLength(4000);
  });

  it('S1: blanks are dropped before the cut, and 8 full exchanges (16 messages) are kept in order', async () => {
    aiClient.chat.mockClear();
    const history = [];
    for (let i = 0; i < 20; i += 1) {
      history.push({ role: 'user', content: `u${i}` }, { role: 'assistant', content: `a${i}` }, { role: 'user', content: '   ' });
    }
    history.push({ role: 'user', content: 'last squats set' });
    await chatAs('u1', { messages: history });
    const msgs = aiClient.chat.mock.calls[0][0].messages;
    expect(msgs).toHaveLength(16);
    expect(msgs.every((m) => m.content.trim())).toBe(true);
    expect(msgs[msgs.length - 1].content).toBe('last squats set');
    expect(msgs[0].content).toBe('a12');
  });

  it('M2: two users never see each other\u2019s plan or profile; every plan query is keyed on the JWT user', async () => {
    const storage = require('./server/storage.js');
    const profiles = {
      'user-a': { age: 31, weight: 70 },
      'user-b': { age: 52, weight: 99 },
    };
    storage.getProfile.mockImplementation(async (id) => profiles[id]);
    const plans = { 'user-a': 'A-PLAN', 'user-b': 'B-PLAN' };
    planRows = (sql, params) => (/FROM meal_plans|plan_assignments/.test(sql) && /mp\.user_id = \$1|pa\.client_id = \$1/.test(sql) && plans[params[0]] && /mp\.user_id/.test(sql)
      ? [{ name: plans[params[0]], meals: {} }] : []);
    try {
      for (const [me, other] of [['user-a', 'user-b'], ['user-b', 'user-a']]) {
        aiClient.chat.mockClear();
        pgCalls.length = 0;
        const r = await chatAs(me, { messages: [{ role: 'user', content: 'squats?' }], context: { userId: other } });
        expect(r.status).toBe(200);
        const sys = aiClient.chat.mock.calls[0][0].system;
        expect(sys).toContain(`Latest plan: ${plans[me]}`);
        expect(sys).not.toContain(plans[other]);
        expect(sys).not.toMatch(other === 'user-b' ? /52 y/ : /31 y/);
        const planQs = pgCalls.filter((q) => /meal_plans/.test(q.sql));
        expect(planQs.length).toBeGreaterThan(0);
        for (const q of planQs) expect(q.params).toEqual([me]);
      }
    } finally {
      storage.getProfile.mockImplementation(async () => ({ age: 34, weight: 85, height: 180, fitnessGoal: 'lose_weight', targetCalories: 2100, targetProtein: 170, dietaryPreferences: [], allergies: '[]' }));
    }
  });

  it('S2: a trainer-assigned active plan wins; a PT\u2019s plans built for clients are skipped', async () => {
    planRows = (sql) => (/plan_assignments pa JOIN meal_plans/.test(sql) ? [{ name: 'PT-ASSIGNED', meals: {} }] : [{ name: 'OWN', meals: {} }]);
    aiClient.chat.mockClear();
    await chatAs('client-1', { messages: [{ role: 'user', content: 'squats?' }] });
    expect(aiClient.chat.mock.calls[0][0].system).toContain('Latest plan: PT-ASSIGNED');
    planRows = (sql) => (/plan_assignments pa JOIN meal_plans/.test(sql) ? [] : [{ name: 'OWN', meals: {} }]);
    aiClient.chat.mockClear(); pgCalls.length = 0;
    await chatAs('pt-1', { messages: [{ role: 'user', content: 'squats?' }] });
    expect(aiClient.chat.mock.calls[0][0].system).toContain('Latest plan: OWN');
    const own = pgCalls.find((q) => /FROM meal_plans mp WHERE mp\.user_id = \$1/.test(q.sql));
    expect(own.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM plan_assignments pa WHERE pa\.plan_id = mp\.id AND pa\.pt_id = \$1/);
    expect(own.sql).toMatch(/ORDER BY mp\.is_active DESC NULLS LAST, mp\.created_at DESC/);
  });
});

describe('ai-client budget aborts the losing request (S3, L1)', () => {
  it('provider 1 hangs: its request is aborted at the deadline and provider 2 is not started', async () => {
    const destroyed = [];
    const openaiCreate = jest.fn();
    let real;
    jest.isolateModules(() => {
      jest.doMock('https', () => {
        const { EventEmitter } = require('events');
        return {
          request: () => {
            const req = new EventEmitter();
            req.write = () => {}; req.end = () => {};
            req.destroy = (err) => { destroyed.push(err && err.code); };
            return req; // never answers
          },
        };
      });
      jest.doMock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: openaiCreate } } })));
      real = jest.requireActual('./lib/ai-client');
    });
    const saved = { x: process.env.XAI_API_KEY, o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY };
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const t0 = Date.now();
      const r = await real.chat({ messages: [{ role: 'user', content: 'squats?' }], budgetMs: real.MIN_ATTEMPT_MS + 300, route: '/ai/chat' });
      expect(Date.now() - t0).toBeLessThan(real.MIN_ATTEMPT_MS + 2000);
      expect(r).toMatchObject({ ok: false, error: 'timeout' });
      expect(destroyed).toEqual(['ABORT_ERR']);
      expect(openaiCreate).not.toHaveBeenCalled();
    } finally {
      for (const [k, v] of [['XAI_API_KEY', saved.x], ['OPENAI_API_KEY', saved.o], ['ANTHROPIC_API_KEY', saved.a]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  }, 15000);

  it('withDeadline aborts the controller it is given', async () => {
    const { _withDeadlineForTests: withDeadline } = jest.requireActual('./lib/ai-client');
    const ctrl = new AbortController();
    await withDeadline(new Promise(() => {}), 20, 'xai', ctrl);
    expect(ctrl.signal.aborted).toBe(true);
  });
});
