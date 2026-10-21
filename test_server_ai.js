/**
 * HTTP-level checks for the new AI routes in api_server.js.
 * The ai-client is mocked so tests stay offline and deterministic.
 */

jest.mock('./lib/ai-client', () => {
  return {
    hasProvider: jest.fn(() => true),
    providerName: jest.fn(() => 'openai'),
    grokModel: jest.fn(() => 'grok-4.3'),
    openaiModel: jest.fn(() => 'gpt-4o-mini'),
    anthropicModel: jest.fn(() => 'claude-haiku-4-5'),
    chat: jest.fn(async () => ({
      ok: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'Solid effort today — aim for one more protein hit before bed.',
      usage: { promptTokens: 50, completionTokens: 15 },
    })),
    chatJson: jest.fn(async () => ({
      ok: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      data: {
        planName: 'Test Program',
        summary: 'A test program',
        level: 'intermediate',
        frequency: 3,
        workouts: [
          { day: 1, name: 'Bench Press', sets: 4, reps: '8-10', rest: 90 },
          { day: 2, name: 'Squat', sets: 4, reps: '6-8', rest: 120 },
        ],
        headline: 'Solid week of logging',
        wins: ['Logged 5 days'],
        focus: ['Hit protein target daily'],
        score: 7,
      },
    })),
    vision: jest.fn(async () => ({ ok: true, provider: 'gemini', text: '[]' })),
  };
});

jest.mock('./lib/ai-usage', () => {
  return {
    monthKey: () => '2026-04',
    freeMonthlyLimit: () => 10,
    isSmokeAccount: () => false,
    refundSmokeOnFailure: () => {},
    getUsed: jest.fn(async () => 0),
    increment: jest.fn(async () => {}),
    checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
    refundAiCall: jest.fn(async () => true),
  };
});

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    createUser: jest.fn(),
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(async () => ({
      id: 'u-test',
      name: 'Tester',
      email: 't@example.com',
      subscriptionTier: 'free',
      settings: { aiDataConsent: true },
    })),
    updateUserSubscription: jest.fn(),
    createOrUpdateProfile: jest.fn(),
    getProfile: jest.fn(async () => ({ age: 30, weight: 80, height: 180, goal: 'muscle_gain' })),
    logMeal: jest.fn(),
    getMealLogsByDate: jest.fn(),
    // Three logged days, so the weekly review is past its new-user empty state (launch audit D8).
    getMealLogsForPeriod: jest.fn(async () => [0, 1, 2].map((d) => ({ date: new Date(Date.now() - d * 86400000), calories: 600, protein: 40 }))),
    logWorkout: jest.fn(),
    getWorkoutLogsByDate: jest.fn(),
    getRecentWorkouts: jest.fn(async () => []),
    logProgress: jest.fn(),
    getProgressHistory: jest.fn(async () => []),
    trackEvent: jest.fn(),
  };
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
    expect(r.body.provider).toBeUndefined();
    expect(r.body.model).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/gemini|openai|grok|anthropic/i);
  });

  it('POST /api/ai/insight returns LLM text when provider is available', async () => {
    const r = await request(app)
      .post('/api/ai/insight')
      .set('Authorization', `Bearer ${token}`)
      .send({ todayCalories: 1200, todayProtein: 60, streak: 3, goal: 'muscle_gain', targetCalories: 2500, targetProtein: 180 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.provider).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/gemini|openai|grok|anthropic/i);
    expect(r.body.insight.length).toBeGreaterThan(10);
  });

  it('GET /api/ai/usage reports limit and remaining without a provider or model name', async () => {
    const aiClient = require('./lib/ai-client');
    const forbidden = /gemini|grok|xai|openai|anthropic/i;
    for (const name of ['xai', 'openai']) {
      aiClient.providerName.mockReturnValue(name);
      const r = await request(app)
        .get('/api/ai/usage')
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.limit).toBe(10);
      expect(r.body.provider).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toMatch(forbidden);
    }
    aiClient.providerName.mockReturnValue('openai');
  });

  it('POST /api/ai/workout-plan generates a structured program', async () => {
    const r = await request(app)
      .post('/api/ai/workout-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'muscle_gain', level: 'intermediate', daysPerWeek: 3, equipment: 'gym' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(Array.isArray(r.body.plan.workouts)).toBe(true);
    expect(r.body.plan.workouts.length).toBeGreaterThan(0);
    expect(r.body.plan.frequency).toBe(3);
  });

  it('POST /api/ai/workout-plan rejects missing auth', async () => {
    const r = await request(app).post('/api/ai/workout-plan').send({ goal: 'muscle_gain' });
    expect(r.status).toBe(401);
  });

  it('GET /api/ai/weekly-review returns review + stats', async () => {
    const r = await request(app)
      .get('/api/ai/weekly-review')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.review).toBeDefined();
    expect(r.body.stats).toBeDefined();
    expect(typeof r.body.stats.daysLogged).toBe('number');
  });

  it('deny blocks insight, workout plans, and the weekly review without spending a credit', async () => {
    const storage = require('./server/storage.js');
    const aiUsage = require('./lib/ai-usage');
    storage.getUserById.mockResolvedValue({
      id: 'u-test',
      name: 'Tester',
      email: 't@example.com',
      subscriptionTier: 'free',
      settings: { aiDataConsent: false },
    });
    aiUsage.checkAndConsume.mockClear();
    try {
      const insight = await request(app)
        .post('/api/ai/insight')
        .set('Authorization', `Bearer ${token}`)
        .send({ todayCalories: 1, todayProtein: 1 });
      const plan = await request(app)
        .post('/api/ai/workout-plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ goal: 'muscle_gain' });
      const review = await request(app)
        .get('/api/ai/weekly-review')
        .set('Authorization', `Bearer ${token}`);
      expect(insight.status).toBe(403);
      expect(plan.status).toBe(403);
      expect(review.status).toBe(403);
      expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    } finally {
      storage.getUserById.mockResolvedValue({
        id: 'u-test',
        name: 'Tester',
        email: 't@example.com',
        subscriptionTier: 'free',
        settings: { aiDataConsent: true },
      });
    }
  });

  it('a denied account gets 403 from insight before the no-provider tip', async () => {
    const storage = require('./server/storage.js');
    const aiClient = require('./lib/ai-client');
    storage.getUserById.mockResolvedValue({
      id: 'u-test',
      name: 'Tester',
      email: 't@example.com',
      subscriptionTier: 'free',
      settings: { aiDataConsent: false },
    });
    aiClient.hasProvider.mockReturnValueOnce(false);
    try {
      const r = await request(app)
        .post('/api/ai/insight')
        .set('Authorization', `Bearer ${token}`)
        .send({ todayCalories: 1200, todayProtein: 60, streak: 3 });
      expect(r.status).toBe(403);
      expect(r.body.insight).toBeUndefined();
      expect(r.body.success).toBe(false);
    } finally {
      storage.getUserById.mockResolvedValue({
        id: 'u-test',
        name: 'Tester',
        email: 't@example.com',
        subscriptionTier: 'free',
        settings: { aiDataConsent: true },
      });
      aiClient.hasProvider.mockReturnValue(true);
    }
  });

  it('an account that has not answered gets 403 ai_consent_required before any AI work', async () => {
    const storage = require('./server/storage.js');
    const aiUsage = require('./lib/ai-usage');
    const aiClient = require('./lib/ai-client');
    storage.getUserById.mockResolvedValue({
      id: 'u-test', name: 'Tester', email: 't@example.com', subscriptionTier: 'free', settings: {},
    });
    aiUsage.checkAndConsume.mockClear();
    aiClient.chat.mockClear();
    aiClient.hasProvider.mockReset();
    aiClient.hasProvider.mockReturnValue(true);
    try {
      const routes = [
        request(app).post('/api/ai/insight').set('Authorization', `Bearer ${token}`).send({ todayCalories: 1 }),
        request(app).post('/api/ai/chat').set('Authorization', `Bearer ${token}`).send({ messages: [{ role: 'user', content: 'hi' }] }),
        request(app).post('/api/ai/workout-plan').set('Authorization', `Bearer ${token}`).send({ goal: 'muscle_gain' }),
        request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${token}`),
      ];
      for (const r of await Promise.all(routes)) {
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('ai_consent_required');
      }
      expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
      expect(aiClient.chat).not.toHaveBeenCalled();
    } finally {
      storage.getUserById.mockResolvedValue({
        id: 'u-test', name: 'Tester', email: 't@example.com', subscriptionTier: 'free', settings: { aiDataConsent: true },
      });
    }
  });


  const settingsRetry = "We couldn't check your AI settings. Please try again.";

  async function expectLookupFailure(send) {
    const storage = require('./server/storage.js');
    const aiClient = require('./lib/ai-client');
    const aiUsage = require('./lib/ai-usage');
    storage.getUserById.mockRejectedValue(new Error('account lookup failed'));
    aiClient.chat.mockClear();
    aiClient.chatJson.mockClear();
    aiUsage.checkAndConsume.mockClear();
    try {
      const r = await send();
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ success: false, error: settingsRetry });
      expect(r.body.insight).toBeUndefined();
      expect(r.body.items).toBeUndefined();
      expect(aiClient.chat).not.toHaveBeenCalled();
      expect(aiClient.chatJson).not.toHaveBeenCalled();
      expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
      return r;
    } finally {
      storage.getUserById.mockResolvedValue({
        id: 'u-test',
        name: 'Tester',
        email: 't@example.com',
        subscriptionTier: 'free',
        settings: { aiDataConsent: true },
      });
    }
  }

  it('POST /api/ai/chat returns 503 when the account lookup throws', async () => {
    await expectLookupFailure(() => request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ role: 'user', content: 'hello' }] }));
  });

  it('POST /api/ai/insight returns 503 when the account lookup throws', async () => {
    await expectLookupFailure(() => request(app)
      .post('/api/ai/insight')
      .set('Authorization', `Bearer ${token}`)
      .send({ todayCalories: 100, todayProtein: 20, streak: 2 }));
  });

  it('POST /api/ai/workout-plan returns 503 when the account lookup throws', async () => {
    await expectLookupFailure(() => request(app)
      .post('/api/ai/workout-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'muscle_gain' }));
  });

  it('GET /api/ai/weekly-review returns 503 when the account lookup throws', async () => {
    await expectLookupFailure(() => request(app)
      .get('/api/ai/weekly-review')
      .set('Authorization', `Bearer ${token}`));
  });

  it('POST /api/meals/log returns 400 for a bad name or calories and does not store them', async () => {
    const storage = require('./server/storage.js');
    const api = require('./api_server');
    storage.logMeal.mockClear();
    expect(api.mealLogInputError({ foodName: 'Apple', calories: NaN })).toMatch(/Calories/);
    expect(api.mealLogInputError({ foodName: 'Apple', calories: 1e20 })).toMatch(/Calories/);
    expect(api.mealLogInputError({ foodName: 'Apple', calories: -50 })).toMatch(/Calories/);
    expect(api.mealLogInputError({ calories: 100 })).toMatch(/food name/i);
    expect(api.mealLogInputError({ foodName: ['Apple'], calories: 100 })).toMatch(/food name/i);
    expect(api.mealLogInputError({ foodName: 'Apple', calories: 80 })).toBeNull();
    for (const body of [
      { foodName: 'Apple', calories: null },
      { foodName: 'Apple', calories: 1e20 },
      { foodName: 'Apple', calories: -50 },
      { foodName: 'Apple', calories: 'NaN' },
      { calories: 100 },
      { foodName: ['Apple'], calories: 100 },
      { foodName: '   ', calories: 100 },
    ]) {
      const r = await request(app).post('/api/meals/log').set('Authorization', `Bearer ${token}`).send(body);
      expect(r.status).toBe(400);
      expect(r.body.success).toBe(false);
      expect(String(r.body.error || '')).not.toMatch(/Internal server error/i);
    }
    expect(storage.logMeal).not.toHaveBeenCalled();
  });

  it('POST /api/meals/log dedupes an identical rapid double post', async () => {
    const storage = require('./server/storage.js');
    storage.logMeal.mockReset();
    storage.logMeal.mockResolvedValue({ id: 41, foodName: 'Apple wedge', calories: 80 });
    const body = { foodName: 'Apple wedge', calories: 80, mealType: 'snack', date: new Date().toISOString() };
    const a = await request(app).post('/api/meals/log').set('Authorization', `Bearer ${token}`).send(body);
    const b = await request(app).post('/api/meals/log').set('Authorization', `Bearer ${token}`).send(body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.meal).toEqual({ id: 41, foodName: 'Apple wedge', calories: 80 });
    expect(b.body.meal).toEqual(a.body.meal);
    expect(storage.logMeal).toHaveBeenCalledTimes(1);
  });

  it('GET /api/ai/weekly-review returns 503 when meal logs cannot be read, not an empty week', async () => {
    const storage = require('./server/storage.js');
    const aiClient = require('./lib/ai-client');
    storage.getMealLogsForPeriod.mockRejectedValueOnce(new Error('meal logs down'));
    aiClient.chatJson.mockClear();
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("We couldn't load your meal log. Please try again.");
    expect(r.body.review).toBeUndefined();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it('GET /api/ai/weekly-review empty state does not need AI consent', async () => {
    const storage = require('./server/storage.js');
    storage.getUserById.mockResolvedValueOnce({
      id: 'u-test', name: 'Tester', email: 't@example.com', subscriptionTier: 'free', settings: {},
    });
    storage.getMealLogsForPeriod.mockResolvedValueOnce([]);
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('empty');
    expect(r.body.review.headline).toMatch(/last 7 days/);
    expect(r.body.stats).toEqual({ daysLogged: 0, daysNeeded: 3 });
  });

  it('GET /api/ai/weekly-review refunds the free credit when the model call fails', async () => {
    const aiClient = require('./lib/ai-client');
    const aiUsage = require('./lib/ai-usage');
    aiClient.chatJson.mockResolvedValueOnce({ ok: false, error: 'down', provider: 'mock' });
    aiUsage.refundAiCall.mockClear();
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(502);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.objectContaining({ allowed: true }), { userId: 'u-test', feature: 'weekly_review' });
  });

  it('POST /api/meal-plan/generate returns 503 when the account lookup throws', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    const planToken = jwt.sign({ userId: 'u-test' }, process.env.JWT_SECRET);
    const planApp = express();
    planApp.use(express.json());
    planApp.use('/api/meal-plan', require('./meal-planner'));
    await expectLookupFailure(() => request(planApp)
      .post('/api/meal-plan/generate')
      .set('Authorization', `Bearer ${planToken}`)
      .send({ goal: 'maintain', calories: 2000, protein: 150 }));
  });

  it('AI endpoints return 429 with upgrade flag when free cap is hit', async () => {
    const aiUsage = require('./lib/ai-usage');
    aiUsage.checkAndConsume.mockResolvedValueOnce({ allowed: false, limit: 10, used: 10, upgrade: true });
    const r = await request(app)
      .post('/api/ai/workout-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'muscle_gain' });
    expect(r.status).toBe(429);
    expect(r.body.upgrade).toBe(true);
  });
});
