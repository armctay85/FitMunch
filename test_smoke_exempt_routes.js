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
const ORIG = process.env.SMOKE_ACCOUNT_EMAILS;
let smokeUsed;

function tokenFor(email, userId = 'u-smoke-1') {
  process.env.JWT_SECRET = SECRET;
  return jwt.sign({ userId, name: 'Smoke', email }, SECRET);
}

beforeEach(() => {
  smokeUsed = 0;
  // Monthly total is at the free cap (10); smoke daily counter starts at smokeUsed.
  aiUsage._setQueryForTests(async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/SUM\(count\)/.test(sql)) return { rows: [{ total: 10 }] };
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
  if (ORIG === undefined) delete process.env.SMOKE_ACCOUNT_EMAILS; else process.env.SMOKE_ACCOUNT_EMAILS = ORIG;
});

const chat = (t) => request(app).post('/api/ai/chat').set('Authorization', `Bearer ${t}`).send({ intent: 'general', messages: [{ role: 'user', content: 'hi' }] });
const scan = (t) => request(app).post('/api/receipt/scan').set('Authorization', `Bearer ${t}`).attach('receipt', TINY_PNG, { filename: 'r.png', contentType: 'image/png' });

const EXEMPT = [
  ['exact', 'smoke+a@fitmunch.com.au', 'smoke+a@fitmunch.com.au'],
  ['env case and spaces', '  SMOKE+A@FitMunch.com.au , other@x.com ', 'smoke+a@fitmunch.com.au'],
  ['token email case and spaces', 'smoke+a@fitmunch.com.au', ' Smoke+A@FITMUNCH.com.au '],
  ['by user id', 'other@x.com, U-SMOKE-1 ', 'nobody@x.com'],
];

describe.each([['chat', chat], ['scan', scan]])('%s route', (_name, call) => {
  it.each(EXEMPT)('smoke account is exempt from the monthly cap (%s)', async (_l, env, email) => {
    process.env.SMOKE_ACCOUNT_EMAILS = env;
    const r = await call(tokenFor(email));
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
  it('non-smoke account gets the monthly 429', async () => {
    process.env.SMOKE_ACCOUNT_EMAILS = 'smoke+a@fitmunch.com.au';
    const r = await call(tokenFor('smoke+b@fitmunch.com.au', 'u-other'));
    expect(r.status).toBe(429);
    expect(r.body.upgrade).toBe(true);
  });
  it('no list means no exemption', async () => {
    delete process.env.SMOKE_ACCOUNT_EMAILS;
    expect((await call(tokenFor('smoke+a@fitmunch.com.au'))).status).toBe(429);
  });
  it('smoke account at its daily cap gets a smoke 429, not the upgrade message', async () => {
    process.env.SMOKE_ACCOUNT_EMAILS = 'smoke+a@fitmunch.com.au';
    smokeUsed = 10;
    const r = await call(tokenFor('smoke+a@fitmunch.com.au'));
    expect(r.status).toBe(429);
    expect(r.body.upgrade).toBe(false);
    expect(r.body.error).toBe('Smoke account daily AI cap reached.');
  });
});

describe('normalizeIdentity', () => {
  it('trims and lowercases, empty for nullish', () => {
    expect(aiUsage.normalizeIdentity('  A@B.Com ')).toBe('a@b.com');
    expect(aiUsage.normalizeIdentity(null)).toBe('');
  });
});
