'use strict';
// An unreadable profile is the notice only on every Coach surface. No food, and no
// checked / fits / safe wording beyond the notice itself. Zero model calls.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unreadable-surfaces-secret';
const PREV_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = PREV_DATABASE_URL || 'postgres://mocked/unreadable-surfaces';
afterAll(() => {
  if (PREV_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = PREV_DATABASE_URL;
});

jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  class Pool {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); }
    connect() { return Promise.resolve({ query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }); }
    end() { return Promise.resolve(); }
    on() { return this; }
  }
  return { ...actual, Pool };
});
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  chat: jest.fn(async () => ({ ok: true, text: 'Try a MOCKAI peanut satay bowl.', provider: 'mock', model: 'm' })),
  chatJson: jest.fn(async () => ({ ok: true, provider: 'mock', data: { headline: 'peanut', wins: ['satay'], focus: ['tofu'], score: 1 } })),
  providerName: () => 'mock',
}));
jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 8 })),
  refundAiCall: jest.fn(async () => true),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
}));
jest.mock('./server/storage.js', () => {
  const noop = () => jest.fn(async () => undefined);
  return {
    getUserById: jest.fn(async () => ({ id: 'u1', email: 'me@example.com', name: 'Pat', subscriptionTier: 'premium', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
    createOrUpdateProfile: jest.fn(async () => ({})),
    mergeProfileFilters: jest.fn(async () => true),
    effectiveTier: () => 'premium',
    createUser: noop(),
    getUserByEmail: noop(),
    updateUserSubscription: noop(),
    setAIDataConsent: noop(),
    logMeal: noop(),
    getMealLogsByDate: noop(),
    logWorkout: noop(),
    getWorkoutLogsByDate: noop(),
    logProgress: noop(),
    trackEvent: noop(),
    getFunnelStats: noop(),
    db: {},
    schema: {},
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');
const engine = require('./lib/meal-plan-engine');
const mainLex = require('./lib/food-lexicon');
const coachLex = require('./lib/food-lexicon-127a');

const app = express();
app.use(express.json());
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));
const token = `Bearer ${jwt.sign({ userId: 'u-unread' }, process.env.JWT_SECRET)}`;
const NOTICE = dietGuard.UNREADABLE_NOTICE;
const FOOD = /\b(chicken|tofu|rice|oats|milk|bread|salmon|banana|quinoa|yoghurt|yogurt|egg|beef|tuna)\b|Breakfast:|Lunch:|Dinner:|Snack:/i;

function assertNoticeOnly(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  expect(raw).toContain(NOTICE);
  const rest = raw.split(NOTICE).join('');
  expect(rest).not.toMatch(/\b(checked|fits|safe)\b/i);
  expect(rest).not.toMatch(FOOD);
  for (const t of engine.TEMPLATES) {
    if (t.name) expect(rest.toLowerCase()).not.toContain(String(t.name).toLowerCase());
  }
}

const SHAPES = [
  ['missing table', null, true],
  ['number', { allergies: 7, dietaryPreferences: [] }, false],
  ['boolean', { allergies: true, dietaryPreferences: [] }, false],
  ['object list', { allergies: [{ name: 'peanut' }], dietaryPreferences: [] }, false],
  ['nested list', { allergies: [['peanut']], dietaryPreferences: [] }, false],
  ['broken json string', { allergies: '{not json', dietaryPreferences: [] }, false],
  ['nested object', { dietaryPreferences: { peanut: { severe: true } }, allergies: [] }, false],
];

function setProfile(row, missing) {
  aiClient.chat.mockClear();
  aiClient.chatJson.mockClear();
  if (missing) storage.getProfile.mockRejectedValue(new Error('relation "user_profiles" does not exist'));
  else storage.getProfile.mockResolvedValue({ targetCalories: 2100, targetProtein: 150, fitnessGoal: 'general_fitness', ...row });
}

describe('unreadable profiles are the notice only', () => {
  it.each(SHAPES)('chat food: %s', async (_name, row, missing) => {
    setProfile(row, missing);
    const r = await request(app).post('/api/ai/chat').set('Authorization', token)
      .send({ intent: 'nutrition', messages: [{ role: 'user', content: 'What should I eat for dinner?' }] });
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe(NOTICE);
    expect(r.body.provider).toBeNull();
    assertNoticeOnly(r.body);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('chat training: %s', async (_name, row, missing) => {
    setProfile(row, missing);
    const r = await request(app).post('/api/ai/chat').set('Authorization', token)
      .send({ intent: 'workout', messages: [{ role: 'user', content: 'How many sets for squats?' }] });
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe(NOTICE);
    assertNoticeOnly(r.body);
    expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('insight: %s', async (_name, row, missing) => {
    setProfile(row, missing);
    const r = await request(app).post('/api/ai/insight').set('Authorization', token)
      .send({ todayCalories: 400, todayProtein: 20 });
    expect(r.status).toBe(200);
    expect(r.body.insight).toBe(NOTICE);
    expect(r.body.provider).toBeNull();
    assertNoticeOnly(r.body);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('weekly: %s', async (_name, row, missing) => {
    setProfile(row, missing);
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.review.headline).toBe(NOTICE);
    expect(r.body.review.wins).toEqual([]);
    expect(r.body.review.focus).toEqual([]);
    assertNoticeOnly(r.body);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('generate: %s', async (_name, row, missing) => {
    for (const builderOnly of [false, true]) {
      setProfile(row, missing);
      const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token)
        .send({ days: 7, calories: 2000, protein: 120, dietary: [], builderOnly });
      expect(r.status).toBe(200);
      expect(r.body.plan).toBeUndefined();
      expect(r.body.notice).toBe(NOTICE);
      expect(r.body.provider).toBeNull();
      expect(r.body.source).toBe('fixed');
      assertNoticeOnly(r.body);
      expect(aiClient.chatJson).not.toHaveBeenCalled();
    }
  });

  it('a plain comma list is still readable, and a broken JSON string is not', () => {
    expect(dietGuard.listOf('{not json')).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf(" 'not json")).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf('["peanut"')).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf('peanut, milk')).toEqual(['peanut', 'milk']);
    expect(dietGuard.wellFormedFilters('peanut, milk')).toBe(true);
    expect(dietGuard.unreadable(dietGuard.savedFilters({ allergies: '{not json' }))).toBe(true);
  });
});

describe('Coach and ingredient checks share one lexicon', () => {
  const names = ['gluten', 'dairy', 'nuts', 'eggs', 'soy', 'sesame', 'shellfish', 'fish', 'meat'];
  const phrases = [];
  for (const [, src] of mainLex.DENY_SRC) for (const p of src.split('|')) phrases.push(p.trim());

  it('scan flags match on every phrase, and allergensOf uses that scan', () => {
    for (const p of new Set(phrases)) {
      const main = [...mainLex.scan(p, { near: false }).flags].sort();
      const coach = [...coachLex.scan(p).flags].sort();
      expect([p, coach]).toEqual([p, main]);
      const fromEngine = engine.allergensOf([p]).slice().sort();
      expect([p, fromEngine]).toEqual([p, main.filter((f) => names.includes(f))]);
    }
  });

  it('named disagreements resolve to the conservative flag, without the flake false positive', () => {
    const flags = (t) => [...mainLex.scan(t, { near: false }).flags].sort();
    expect(flags('bran flakes')).toEqual(['gluten']);
    expect(flags('corn flakes')).toEqual(['gluten']);
    expect(flags('lactose free')).toContain('dairy');
    expect(flags('gluten free flour')).toContain('gluten');
    expect(flags('gf flour')).toContain('gluten');
    expect(flags('cassava flour')).not.toContain('gluten');
    expect(flags('rice flour')).toEqual([]);
    expect(flags('tofu bolognese')).toEqual(['meat', 'soy']);
    expect(flags('cheesecake')).toEqual(['dairy', 'eggs', 'gluten']);
    expect(flags('shoyus')).toEqual(['gluten', 'soy']);
    expect(flags('gluten-free soy sauce')).toEqual(['gluten', 'soy']);
    expect(flags('gluten free soy sauce')).toEqual(['gluten', 'soy']);
    expect(flags('egg-free mayo')).toContain('eggs');
    expect(flags('egg free mayo')).toContain('eggs');
    expect(flags('egg free mayonnaise')).toEqual([]);
    expect(mainLex.scan('fillet', { near: false }).flags.has('nuts')).toBe(false);
  });
});
