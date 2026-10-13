'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'consent-test-secret';
/**
 * Consent gates on the AI routes outside api_server.js: the signed-in receipt
 * scan, meal plan generation, and the no-account first scan. A missing or
 * refused choice must stop the request before any provider or usage call.
 */
jest.mock('./lib/ai-client', () => {
  const actual = jest.requireActual('./lib/ai-client');
  return {
    ...actual,
    hasProvider: jest.fn(() => true),
    visionProviders: jest.fn(() => ['test']),
    chat: jest.fn(async () => ({ ok: false })),
    chatJson: jest.fn(async () => ({ ok: false })),
    vision: jest.fn(async () => ({ ok: false })),
  };
});
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return {
    ...actual,
    getUsed: jest.fn(async () => 0),
    increment: jest.fn(async () => {}),
    checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
  };
});
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return { ...actual, getUserById: jest.fn() };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server.js');
const receiptRouter = require('./receipt-scanner');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const storage = require('./server/storage.js');

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const token = jwt.sign({ userId: 'u-c', name: 'C' }, SECRET);
let visionCalls = 0;

beforeEach(() => {
  visionCalls = 0;
  receiptRouter._setVisionForTests(async () => { visionCalls += 1; return { ok: true, text: '[]' }; });
  for (const f of [aiClient.chat, aiClient.chatJson, aiClient.vision, aiUsage.getUsed, aiUsage.increment, aiUsage.checkAndConsume]) f.mockClear();
});
afterAll(() => receiptRouter._setVisionForTests(null));

function account(settings) {
  storage.getUserById.mockResolvedValue({ id: 'u-c', name: 'C', email: 'c@example.com', subscriptionTier: 'free', settings });
}
function expectNoAiWork() {
  expect(visionCalls).toBe(0);
  expect(aiClient.chat).not.toHaveBeenCalled();
  expect(aiClient.chatJson).not.toHaveBeenCalled();
  expect(aiClient.vision).not.toHaveBeenCalled();
  expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  expect(aiUsage.getUsed).not.toHaveBeenCalled();
  expect(aiUsage.increment).not.toHaveBeenCalled();
}

const scan = () => request(app).post('/api/receipt/scan').set('Authorization', `Bearer ${token}`)
  .attach('receipt', TINY_PNG, { filename: 'r.png', contentType: 'image/png' });
const generate = () => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${token}`)
  .send({ calories: 2000, protein: 150, days: 7 });

describe.each([
  ['POST /api/receipt/scan', scan],
  ['POST /api/meal-plan/generate', generate],
])('%s consent gate', (_name, send) => {
  it.each([
    ['not answered', {}, 'ai_consent_required'],
    ['no settings', undefined, 'ai_consent_required'],
    ['refused', { aiDataConsent: false }, 'ai_consent_off'],
  ])('%s -> 403 %s before any AI or usage call', async (_label, settings, code) => {
    account(settings);
    const r = await send();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(code);
    expectNoAiWork();
  });

  it('allowed -> passes the gate', async () => {
    account({ aiDataConsent: true });
    const r = await send();
    expect(r.status).not.toBe(403);
    expect(r.body.code).toBeUndefined();
  });
});

describe('POST /api/receipt/first-scan (no account) consent', () => {
  it.each([
    ['no consent field', (r) => r],
    ['aiConsent false', (r) => r.field('aiConsent', 'false')],
    ['aiConsent junk', (r) => r.field('aiConsent', 'yes please')],
  ])('%s -> 403 ai_consent_required, photo never sent', async (_l, withField) => {
    const r = await withField(request(app).post('/api/receipt/first-scan'))
      .attach('receipt', TINY_PNG, { filename: 'r.png', contentType: 'image/png' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ai_consent_required');
    expectNoAiWork();
  });

  it('aiConsent true -> reaches the scanner', async () => {
    const r = await request(app).post('/api/receipt/first-scan').field('aiConsent', 'true')
      .attach('receipt', TINY_PNG, { filename: 'r.png', contentType: 'image/png' });
    expect(r.status).not.toBe(403);
    expect(visionCalls).toBe(1);
  });

  it('the website sends consent only from the "Allow and scan" button and says where the photo goes', () => {
    const fs = require('fs');
    const js = fs.readFileSync('public/js/fm-first-scan.js', 'utf8');
    const html = fs.readFileSync('public/index.html', 'utf8');
    expect(js).toContain("fd.append('aiConsent', 'true')");
    expect(html).toMatch(/data-fs-scan>Allow and scan</);
    expect(html).toContain('Your receipt photo is sent to an AI provider (xAI or OpenAI) to read the items, then discarded.');
  });
});
