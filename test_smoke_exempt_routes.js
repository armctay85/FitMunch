/**
 * SMOKE_ACCOUNT_EMAILS exemption on both AI routes: /api/ai/chat and /api/receipt/scan.
 * The user has used all 10 free monthly actions; smoke accounts must still get through
 * (on their daily cap), non-smoke accounts must get the monthly 429.
 */
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  grokModel: jest.fn(() => 'grok'), openaiModel: jest.fn(() => 'o'), anthropicModel: jest.fn(() => 'a'),
  chat: jest.fn(async () => ({ ok: true, provider: 'xai', model: 'grok', text: 'Eggs on toast.', usage: { promptTokens: 1, completionTokens: 1 } })),
  vision: jest.fn(async () => ({ ok: true, provider: 'xai', text: '[]' })),
}));

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({ id: 'u-smoke-1', subscriptionTier: 'free', settings: {} })),
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
const SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const ORIG = process.env.SMOKE_ACCOUNT_IDS;
let smokeUsed; let smokeFail;

function tokenFor(email, userId = 'u-smoke-1') {
  process.env.JWT_SECRET = SECRET;
  return jwt.sign({ userId, name: 'Smoke', email }, SECRET);
}

beforeEach(() => {
  smokeUsed = 0; smokeFail = false;
  // Monthly total is at the free cap (10); smoke daily counter starts at smokeUsed.
  aiUsage._setQueryForTests(async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/SUM\(count\)/.test(sql)) return { rows: [{ total: 10 }] };
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
    smokeUsed = 10;
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
    expect(r.body).toMatchObject({ success: true, used: 3, limit: 10, remaining: 7, tier: 'smoke', period: 'day' });
  });
  it('shows the monthly cap for others', async () => {
    process.env.SMOKE_ACCOUNT_IDS = ID;
    const r = await request(app).get('/api/ai/usage').set('Authorization', `Bearer ${tokenFor('x@example.com', 'u-other')}`);
    expect(r.body).toMatchObject({ used: 10, limit: 10, remaining: 0 });
  });
});
