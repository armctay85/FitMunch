/**
 * HTTP-level checks for the new AI routes in api_server.js.
 * The ai-client is mocked so tests stay offline and deterministic.
 */

jest.mock('./lib/ai-client', () => {
  return {
    hasProvider: jest.fn(() => true),
    providerName: jest.fn(() => 'openai'),
    openaiModel: jest.fn(() => 'gpt-4o-mini'),
    anthropicModel: jest.fn(() => 'claude-haiku-4-5'),
    chat: jest.fn(async () => ({
      ok: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'Solid effort today — aim for one more protein hit before bed.',
      usage: { promptTokens: 50, completionTokens: 15 },
    })),
  };
});

jest.mock('./lib/ai-usage', () => {
  return {
    monthKey: () => '2026-04',
    freeMonthlyLimit: () => 10,
    getUsed: jest.fn(async () => 0),
    increment: jest.fn(async () => {}),
    checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
  };
});

jest.mock('./server/storage.js', () => {
  const actual = {
    createUser: jest.fn(),
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(async () => ({
      id: 'u-test',
      name: 'Tester',
      email: 't@example.com',
      subscriptionTier: 'free',
    })),
    updateUserSubscription: jest.fn(),
    createOrUpdateProfile: jest.fn(),
    getProfile: jest.fn(async () => ({ age: 30, weight: 80, height: 180, goal: 'muscle_gain' })),
    logMeal: jest.fn(),
    getMealLogsByDate: jest.fn(),
    getMealLogsForPeriod: jest.fn(async () => []),
    logWorkout: jest.fn(),
    getWorkoutLogsByDate: jest.fn(),
    getRecentWorkouts: jest.fn(async () => []),
    logProgress: jest.fn(),
    getProgressHistory: jest.fn(async () => []),
    trackEvent: jest.fn(),
    db: {},
    schema: {},
  };
  return actual;
});

jest.mock('pg', () => ({ Pool: class { query() { return Promise.resolve({ rows: [] }); } } }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const token = jwt.sign({ userId: 'u-test', name: 'Tester' }, JWT_SECRET);

function makeApp() {
  const app = express();
  app.use(express.json());
  const apiRouter = require('./api_server');
  app.use('/api', apiRouter);
  return app;
}

describe('AI routes', () => {
  const app = makeApp();

  it('POST /api/ai/chat rejects missing auth', async () => {
    const r = await request(app).post('/api/ai/chat').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(401);
  });

  it('POST /api/ai/chat rejects empty messages', async () => {
    const r = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one/i);
  });

  it('POST /api/ai/chat returns reply from mocked provider', async () => {
    const r = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ intent: 'nutrition', messages: [{ role: 'user', content: 'Why am I always hungry at 9pm?' }] });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.reply).toMatch(/protein/);
    expect(r.body.provider).toBe('openai');
  });

  it('POST /api/ai/insight returns LLM text when provider is available', async () => {
    const r = await request(app)
      .post('/api/ai/insight')
      .set('Authorization', `Bearer ${token}`)
      .send({ todayCalories: 1200, todayProtein: 60, streak: 3, goal: 'muscle_gain', targetCalories: 2500, targetProtein: 180 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.provider).toBe('openai');
    expect(r.body.insight.length).toBeGreaterThan(10);
  });

  it('GET /api/ai/usage reports limit and remaining', async () => {
    const r = await request(app)
      .get('/api/ai/usage')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.limit).toBe(10);
    expect(r.body.provider).toBe('openai');
  });
});
