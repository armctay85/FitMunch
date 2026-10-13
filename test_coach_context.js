/** Coach uses the account's own profile, targets and latest plan; smaller context; time budget. */
jest.mock('pg', () => ({
  Pool: class {
    query(sql) {
      if (/FROM meal_plans/.test(sql)) {
        return Promise.resolve({ rows: [{ name: 'Christmas cut', meals: { days: [{ meals: { breakfast: { name: 'Greek yoghurt oats' }, lunch: { name: 'Chicken rice bowl' } } }, {}, {}, {}, {}, {}, {}] } }] });
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
    getProfile: jest.fn(async () => ({ age: 34, weight: 85, height: 180, fitnessGoal: 'lose_weight', targetCalories: 2100, targetProtein: 170, dietaryPreferences: ['no pork'], allergies: '["peanuts"]' })),
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
    history.push({ role: 'user', content: 'What should I eat tonight?' });
    const r = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${token}`)
      .send({ messages: history, context: { todayCalories: 1200, todayProtein: 80, targetCalories: 9999 } });
    expect(r.status).toBe(200);
    const opts = aiClient.chat.mock.calls[0][0];
    expect(opts.system).toContain('Body: 34 y, 85 kg, 180 cm');
    expect(opts.system).toContain('Goal: lose fat');
    expect(opts.system).toContain('Daily targets: 2100 kcal, 170 g protein');
    expect(opts.system).not.toContain('9999');
    expect(opts.system).toContain('Diet: no pork');
    expect(opts.system).toContain('Allergies: peanuts');
    expect(opts.system).toContain('Today so far: 1200 kcal, 80 g protein');
    expect(opts.system).toContain('Latest plan: Christmas cut, 7 days (day 1: Greek yoghurt oats; Chicken rice bowl)');
    expect(opts.system).not.toMatch(/me@example\.com|u1/);
    expect(opts.messages.length).toBeLessThanOrEqual(8);
    for (const m of opts.messages) expect(m.content.length).toBeLessThanOrEqual(1200);
    expect(opts.messages[opts.messages.length - 1].content).toBe('What should I eat tonight?');
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
