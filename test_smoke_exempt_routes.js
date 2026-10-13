/**
 * SMOKE_ACCOUNT_IDS exemption on both AI routes: /api/ai/chat and /api/receipt/scan.
 * The user has used all 10 free monthly actions; smoke accounts must still get through
 * (on their daily cap), non-smoke accounts must get the monthly 429.
 */
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  grokModel: jest.fn(() => 'grok'), openaiModel: jest.fn(() => 'o'), anthropicModel: jest.fn(() => 'a'),
  chat: jest.fn(async () => ({ ok: true, provider: 'xai', model: 'grok', text: 'Eggs on toast.', usage: { promptTokens: 1, completionTokens: 1 } })),
  vision: jest.fn(async () => ({ ok: true, provider: 'xai', text: '[]' })),
  chatJson: jest.fn(async () => ({ ok: true, provider: 'xai', model: 'grok', data: {} })),
}));

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({ id: 'u-smoke-1', subscriptionTier: 'free', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => null),
    trackEvent: jest.fn(),
  };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiUsage = require('./lib/ai-usage');
const receiptRouter = require('./receipt-scanner');
const app = require('./server.js');

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const HAUL = [{ name: 'Eggs 12', quantity: 1, unit: 'pack', price: 6, category: 'dairy' }];
const SECRET = process.env.JWT_SECRET || process.env.JEST_JWT_SECRET;
const ORIG = process.env.SMOKE_ACCOUNT_IDS;
let smokeUsed; let smokeFail; let refunds;

function tokenFor(email, userId = 'u-smoke-1') {
  process.env.JWT_SECRET = SECRET;
  return jwt.sign({ userId, name: 'Smoke', email }, SECRET);
}

beforeEach(() => {
  smokeUsed = 0; smokeFail = false; refunds = 0;
  // Monthly total is at the free cap (10); smoke daily counter starts at smokeUsed.
  aiUsage._setQueryForTests(async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/SUM\(count\)/.test(sql)) return { rows: [{ total: 10 }] };
    if (/^\s*UPDATE ai_usage_monthly SET count = count - 1/.test(sql)) {
      if (smokeUsed <= 0) return { rows: [] };
      smokeUsed -= 1; refunds += 1;
      return { rows: [{ count: smokeUsed }] };
    }
    if (/WHERE ai_usage_monthly.count < \$4/.test(sql)) {
      if (smokeFail) throw new Error('db down');
      return smokeUsed >= params[3] ? { rows: [] } : { rows: [{ count: ++smokeUsed }] };
    }
    if (/SELECT/.test(sql) && params[2] === 'smoke_calls') return { rows: [{ total: smokeUsed }] };
    if (/SELECT/.test(sql)) return { rows: [{ total: 10 }] };
    return { rows: [{ count: 1 }] };
  });
  receiptRouter._setVisionForTests(async () => ({ ok: true, text: JSON.stringify(HAUL) }));
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  aiUsage._setQueryForTests(null);
  receiptRouter._setVisionForTests(null);
  jest.restoreAllMocks();
  if (ORIG === undefined) delete process.env.SMOKE_ACCOUNT_IDS; else process.env.SMOKE_ACCOUNT_IDS = ORIG;
});

const chat = (t) => request(app).post('/api/ai/chat').set('Authorization', `Bearer ${t}`).send({ intent: 'general', messages: [{ role: 'user', content: 'hi' }] });
const scan = (t) => request(app).post('/api/receipt/scan').set('Authorization', `Bearer ${t}`).attach('receipt', TINY_PNG, { filename: 'r.png', contentType: 'image/png' });

const ID = 'u-smoke-1';
const EXEMPT = [
  ['exact id', ID, ID],
  ['list spaces', '  other-id ,  u-smoke-1  ', ID],
  ['user id with spaces', ID, '  u-smoke-1 '],
];

describe.each([['chat', chat], ['scan', scan]])('%s route', (_name, call) => {
  it.each(EXEMPT)('smoke id is exempt from the monthly cap (%s)', async (_l, env, uid) => {
    process.env.SMOKE_ACCOUNT_IDS = env;
    const r = await call(tokenFor('x@example.com', uid));
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
  it('email on the list does not exempt (no email matching)', async () => {
    process.env.SMOKE_ACCOUNT_IDS = 'smoke+a@fitmunch.com.au';
    expect((await call(tokenFor('smoke+a@fitmunch.com.au', 'u-other'))).status).toBe(429);
  });
  it('id match is exact, not case-folded', async () => {
    process.env.SMOKE_ACCOUNT_IDS = 'U-SMOKE-1';
    expect((await call(tokenFor('x@example.com', ID))).status).toBe(429);
  });
  it('non-smoke account gets the monthly 429', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    const r = await call(tokenFor('x@example.com', 'u-other'));
    expect(r.status).toBe(429);
    expect(r.body.upgrade).toBe(true);
  });
  it('no list means no exemption', async () => {
    delete process.env.SMOKE_ACCOUNT_IDS;
    expect((await call(tokenFor('x@example.com', ID))).status).toBe(429);
  });
  it('smoke account at its daily cap gets a smoke 429, not the upgrade message', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    smokeUsed = 30;
    const r = await call(tokenFor('x@example.com', ID));
    expect(r.status).toBe(429);
    expect(r.body.upgrade).toBe(false);
    expect(r.body.error).toBe('Smoke account daily AI cap reached.');
  });
  it('fails closed with 503 when the usage store errors', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    smokeFail = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(tokenFor('x@example.com', ID))).status).toBe(503);
  });
});

describe('chat validation before charge', () => {
  it('no user message returns 400 and charges nothing', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    const r = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`)
      .send({ messages: [{ role: 'assistant', content: 'hello' }, { role: 'user', content: [{ type: 'image', source: {} }] }] });
    expect(r.status).toBe(400);
    expect(smokeUsed).toBe(0);
  });
});

describe('/api/ai/usage', () => {
  it('shows the smoke daily cap for smoke accounts', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    smokeUsed = 3;
    const r = await request(app).get('/api/ai/usage').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`);
    expect(r.body).toMatchObject({ success: true, used: 3, limit: 30, remaining: 27, tier: 'smoke', period: 'day' });
  });
  it('shows the monthly cap for others', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    const r = await request(app).get('/api/ai/usage').set('Authorization', `Bearer ${tokenFor('x@example.com', 'u-other')}`);
    expect(r.body).toMatchObject({ used: 10, limit: 10, remaining: 0 });
  });
});

describe('other AI routes fail closed on a smoke usage-store error', () => {
  const routes = [
    ['insight', (t) => request(app).post('/api/ai/insight').set('Authorization', `Bearer ${t}`).send({ todayCalories: 1000, targetCalories: 2000 })],
    ['workout plan', (t) => request(app).post('/api/ai/workout-plan').set('Authorization', `Bearer ${t}`).send({ goal: 'strength' })],
    ['weekly review', (t) => request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${t}`)],
    ['meal plan', (t) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${t}`).send({})],
  ];
  it.each(routes)('%s returns 503 when the gate is unavailable', async (_n, call) => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    smokeFail = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(tokenFor('x@example.com', ID));
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("We couldn't check your AI usage. Please try again.");
  });
  it.each(routes)('%s returns the smoke 429 at the daily cap', async (_n, call) => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    smokeUsed = 30;
    const r = await call(tokenFor('x@example.com', ID));
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('Smoke account daily AI cap reached.');
  });
});

describe('smoke cap is only charged for answered calls', () => {
  const aiClient = require('./lib/ai-client');
  const flush = () => new Promise((r) => setTimeout(r, 20));
  beforeEach(() => { process.env.SMOKE_ACCOUNT_IDS = ID; });

  it('chat success keeps the charge', async () => {
    expect((await chat(tokenFor('x@example.com', ID))).status).toBe(200);
    await flush();
    expect(smokeUsed).toBe(1);
    expect(refunds).toBe(0);
  });
  it('chat provider failure (502) refunds', async () => {
    aiClient.chat.mockResolvedValueOnce({ ok: false, error: 'provider_error', provider: 'xai', status: 403 });
    expect((await chat(tokenFor('x@example.com', ID))).status).toBe(502);
    await flush();
    expect(smokeUsed).toBe(0);
    expect(refunds).toBe(1);
  });
  it('chat app error (5xx from a throw) refunds', async () => {
    aiClient.chat.mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await chat(tokenFor('x@example.com', ID));
    expect(r.status).toBeGreaterThanOrEqual(500);
    await flush();
    expect(smokeUsed).toBe(0);
  });
  it('insight fallback after a provider failure refunds even though it is a 200', async () => {
    aiClient.chat.mockResolvedValueOnce({ ok: false, error: 'provider_error', provider: 'xai', status: 500 });
    const r = await request(app).post('/api/ai/insight').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`).send({ todayCalories: 1000, targetCalories: 2000 });
    expect(r.status).toBe(200);
    await flush();
    expect(smokeUsed).toBe(0);
  });
  it('workout plan with an invalid AI result (502) refunds', async () => {
    aiClient.chatJson.mockResolvedValueOnce({ ok: false, error: 'provider_error', provider: 'xai' });
    const r = await request(app).post('/api/ai/workout-plan').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`).send({ goal: 'strength' });
    expect(r.status).toBe(502);
    await flush();
    expect(smokeUsed).toBe(0);
  });
  it('scan success keeps the charge; scan provider failure never charges', async () => {
    expect((await scan(tokenFor('x@example.com', ID))).status).toBe(200);
    await flush();
    expect(smokeUsed).toBe(1);
    receiptRouter._setVisionForTests(async () => ({ ok: false, code: 'unavailable', error: 'down' }));
    expect((await scan(tokenFor('x@example.com', ID))).status).toBe(503);
    await flush();
    expect(smokeUsed).toBe(1);
  });
  it('ten failed chats leave the cap untouched, so the next call is allowed', async () => {
    for (let i = 0; i < 10; i += 1) {
      aiClient.chat.mockResolvedValueOnce({ ok: false, error: 'provider_error', provider: 'xai', status: 429 });
      await chat(tokenFor('x@example.com', ID));
      await flush();
    }
    expect(smokeUsed).toBe(0);
    expect((await chat(tokenFor('x@example.com', ID))).status).toBe(200);
  });
  it('customers are not refunded (free-tier counting unchanged)', async () => {
    const spy = jest.spyOn(aiUsage, 'refundSmokeCall');
    aiClient.chat.mockResolvedValueOnce({ ok: false, error: 'provider_error', provider: 'xai', status: 500 });
    await chat(tokenFor('x@example.com', 'u-other'));
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('chat intent is validated against own keys', () => {
  const aiClient = require('./lib/ai-client');
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 123, null, ['workout']])('intent %p falls back to general', async (intent) => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    aiClient.chat.mockClear();
    await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`)
      .send({ intent, messages: [{ role: 'user', content: 'hi' }] });
    const sys = aiClient.chat.mock.calls[0][0].system;
    expect(sys.startsWith('You are FitMunch, an Australian fitness and nutrition coach.')).toBe(true);
    expect(sys).not.toMatch(/function|native code|\[object/);
  });
  it('known intent still selects its prompt', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    aiClient.chat.mockClear();
    await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${tokenFor('x@example.com', ID)}`)
      .send({ intent: 'workout', messages: [{ role: 'user', content: 'hi' }] });
    expect(aiClient.chat.mock.calls[0][0].system).toMatch(/strength and conditioning coach/);
  });
});
