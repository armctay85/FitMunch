'use strict';
/**
 * Readable diet and allergy filters get a real Coach answer, then a fail-closed food check.
 * An unsafe or unverified reply is regenerated once. If that still fails, the builder answers
 * the question. A week with fewer than 3 logged days is never scored.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'coach-filtered-ai-secret';

let logs = [];
jest.mock('pg', () => ({
  Pool: class {
    query(sql) {
      if (/FROM meal_plans/.test(sql) && !/plan_assignments pa JOIN/.test(sql)) {
        return Promise.resolve({ rows: [{ name: 'Cut week', meals: { days: [{ meals: { lunch: { name: 'Chicken rice bowl', ingredients: ['Chicken breast', 'White rice'] } } }] } }] });
      }
      return Promise.resolve({ rows: [] });
    }
  },
}));
jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  chat: jest.fn(async () => ({ ok: true, text: 'Try a MOCKAI peanut butter and satay pasta bowl.', provider: 'mock', model: 'm' })),
  chatJson: jest.fn(async () => ({ ok: true, provider: 'mock', data: { headline: 'Showed up for a weekly review', wins: ['Showed up for a weekly review'], focus: ['peanut butter toast'], score: 1 } })),
  providerName: () => 'mock',
}));
jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 8 })),
  refundAiCall: jest.fn(async () => true),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
}));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({ id: 'u1', email: 'me@example.com', name: 'Pat', subscriptionTier: 'premium', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(),
    getMealLogsForPeriod: jest.fn(async () => logs),
    getRecentWorkouts: jest.fn(async () => [{ workoutType: 'squats', date: new Date() }]),
    getProgressHistory: jest.fn(async () => []),
    createOrUpdateProfile: jest.fn(),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');

const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const token = `Bearer ${jwt.sign({ userId: 'u-filtered' }, process.env.JWT_SECRET)}`;
const SAFE = 'At 2,100 kcal and 150 g protein, have chicken, rice and broccoli after training.';
const base = {
  age: 34, gender: 'male', weight: 82, height: 178, fitnessGoal: 'muscle_gain',
  targetCalories: 2100, targetProtein: 150, dietaryPreferences: ['dairy free'], allergies: [],
};

function profile(over = {}) {
  storage.getProfile.mockImplementation(async () => ({ ...base, ...over }));
}
const chat = (text, extra = {}) => request(app).post('/api/ai/chat').set('Authorization', token)
  .send({ intent: 'general', messages: [{ role: 'user', content: text }], ...extra });
const say = (...texts) => {
  const left = texts.slice();
  aiClient.chat.mockImplementation(async () => ({ ok: true, text: left.length ? left.shift() : texts[texts.length - 1], provider: 'mock', model: 'm' }));
};

beforeEach(() => {
  logs = [];
  aiClient.chat.mockReset();
  aiClient.chatJson.mockReset();
  aiClient.chat.mockResolvedValue({ ok: true, text: 'Try a MOCKAI peanut butter and satay pasta bowl.', provider: 'mock', model: 'm' });
  aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: { headline: 'Showed up for a weekly review', wins: ['Showed up for a weekly review'], focus: ['peanut butter toast'], score: 1 } });
  aiClient.hasProvider.mockReturnValue(true);
  aiUsage.checkAndConsume.mockClear();
  aiUsage.checkAndConsume.mockResolvedValue({ allowed: true, remaining: 8 });
  profile();
});

describe('filtered Coach prompt and a verified answer', () => {
  it('puts profile, targets, goal, diet, allergies, plan and recent logs in the prompt, and cites them', async () => {
    logs = [{ mealType: 'lunch', foodName: 'Chicken and rice', calories: 640, protein: 48, date: new Date() }];
    profile({ allergies: ['kiwi'] });
    say(SAFE);
    const r = await chat('What should I eat after training?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('ai');
    expect(r.body.reply).toMatch(/2,100 kcal/);
    expect(r.body.reply).toMatch(/150 g protein/);
    expect(aiClient.chat).toHaveBeenCalledTimes(1);
    const system = aiClient.chat.mock.calls[0][0].system;
    expect(system).toContain('Body: 34 y, male, 82 kg, 178 cm');
    expect(system).toContain('Goal: build muscle');
    expect(system).toContain('Daily targets: 2100 kcal, 150 g protein');
    expect(system).toContain('Diet: dairy free');
    expect(system).toContain('Allergies: kiwi');
    expect(system).toContain('Active diet and allergy filters:');
    expect(system).toContain('Latest plan: Cut week');
    expect(system).toContain('Recent logs:');
    expect(system).toContain('Chicken and rice');
    expect(system).toContain('Recent training: squats');
    expect(system).not.toMatch(/me@example\.com/);
    expect(aiUsage.checkAndConsume).toHaveBeenCalledTimes(1);
  });

  it('serves a verified reply on the first call', async () => {
    say(SAFE);
    const r = await chat('Snack idea?');
    expect(r.body.source).toBe('ai');
    expect(r.body.reply).toBe(SAFE);
    expect(aiClient.chat).toHaveBeenCalledTimes(1);
    expect(dietGuard.replyIssues(r.body.reply, ['dairy free'])).toEqual([]);
  });
});

describe('regenerate once, then a builder answer that still addresses the question', () => {
  it('dairy free: Musashi, Up&Go, Milo and Chobani are dropped and the second reply is served', async () => {
    say('Have a Musashi shake, Up & Go, Milo and Chobani.', SAFE);
    const r = await chat('What should I drink after training?');
    expect(aiClient.chat).toHaveBeenCalledTimes(2);
    expect(aiClient.chat.mock.calls[1][0].system).toMatch(/cannot be verified as safe/);
    expect(r.body.source).toBe('ai');
    expect(r.body.reply).toBe(SAFE);
    expect(r.body.reply).not.toMatch(/Musashi|Up ?& ?Go|Milo|Chobani/i);
    expect(aiUsage.checkAndConsume).toHaveBeenCalledTimes(1);
  });

  it('gluten free: Coco Pops and KFC are dropped and the second reply is served', async () => {
    profile({ dietaryPreferences: ['gluten free'], allergies: [] });
    say('Grab Coco Pops or a KFC zinger.', SAFE);
    const r = await chat('Brekkie idea?');
    expect(aiClient.chat).toHaveBeenCalledTimes(2);
    expect(r.body.reply).toBe(SAFE);
    expect(r.body.reply).not.toMatch(/Coco Pops|KFC/i);
    expect(dietGuard.textBreaksFilters(r.body.reply, ['gluten free'])).toBe(false);
  });

  it('a snack that still fails closes onto a checked snack that cites the targets', async () => {
    say('Have a Musashi shake and a Milo.', 'Chobani and Up & Go.');
    const r = await chat('Quick high-protein snack for the arvo?');
    expect(aiClient.chat).toHaveBeenCalledTimes(2);
    expect(r.body.source).toBe('builder');
    expect(r.body.provider).toBeNull();
    expect(r.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(r.body.reply).toMatch(/At 2,100 kcal and 150 g protein/);
    expect(r.body.reply).toMatch(/snack/i);
    expect(r.body.reply).not.toMatch(/Musashi|Milo|Chobani|Up ?& ?Go|coming soon/i);
    expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), ['dairy free'])).toBe(false);
  });

  it('a training question that still fails stays food-free and cites the targets', async () => {
    say('Have a Milo.', 'Have a Chobani.');
    const r = await chat('How many sets for squats?', { intent: 'workout' });
    expect(r.body.source).toBe('fixed');
    expect(r.body.reply.split('\n\n')[0]).toMatch(/sets/);
    expect(r.body.reply).toMatch(/2,100 kcal and 150 g protein/);
    expect(r.body.reply).not.toMatch(/Milo|Chobani|coming soon/i);
    expect(dietGuard.textBreaksFilters(r.body.reply.split('\n\n')[0], ['dairy free'])).toBe(false);
  });

  it('an unknown food fails closed into the builder', async () => {
    say('Try zymbar with rice.', 'Another zymbar bowl.');
    const r = await chat('Dinner idea?');
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toMatch(/zymbar/i);
    expect(r.body.reply).toMatch(/2,100 kcal/);
  });

  it('a kiwi allergy rejects a reply that names kiwi', async () => {
    profile({ dietaryPreferences: [], allergies: ['kiwi'] });
    say('Slice some kiwi on rice.', 'Kiwi again with chicken.');
    const r = await chat('Snack idea?');
    expect(r.body.reply).not.toMatch(/kiwi/i);
    expect(r.body.source).toBe('builder');
    expect(dietGuard.replyIssues('Slice some kiwi on rice.', dietGuard.combineFilters({ allergies: ['kiwi'] }))).toEqual(expect.arrayContaining(['allergy:kiwi']));
  });
});

describe('training-framed asks for a dairy-free user', () => {
  it.each([
    'Best thing to smash after the gym?',
    'What do I grab before training?',
    'what should I neck after squats',
    'What helps recovery after a run?',
  ])('"%s" names no dairy brand', async (q) => {
    say('Have a Milo and a Musashi shake.', 'Up & Go and Chobani.');
    const r = await chat(q, { intent: 'workout' });
    expect(r.status).toBe(200);
    expect(r.body.reply).not.toMatch(/Milo|Musashi|Chobani|Up ?& ?Go|MOCKAI/i);
    expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), ['dairy free'])).toBe(false);
    expect(r.body.reply).toMatch(/2,100 kcal/);
  });
});

describe('weekly review', () => {
  const review = () => request(app).get('/api/ai/weekly-review').set('Authorization', token);

  it('a new user gets no score and no filler win, and the model is not asked', async () => {
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(r.body.review.score).toBeNull();
    expect(r.body.review.wins).toEqual([]);
    expect(r.body.review.headline).toMatch(/Log 3 days/);
    expect(r.body.review.headline).toMatch(/2,100 kcal and 150 g protein/);
    expect(JSON.stringify(r.body.review)).not.toMatch(/showed up|coming soon/i);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('three logged days: an unsafe review is regenerated, then a real score that is never 1', async () => {
    profile({ dietaryPreferences: ['nut free'], allergies: ['peanut'] });
    logs = [0, 1, 2].map((n) => ({ date: new Date(Date.now() - n * 86400000), mealType: 'lunch', foodName: 'Chicken and rice', calories: 600, protein: 40 }));
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data: { headline: 'Peanut week', wins: ['peanut butter toast'], focus: ['satay'], score: 1 } });
    const r = await review();
    expect(aiClient.chatJson).toHaveBeenCalledTimes(2);
    expect(aiUsage.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(r.body.source).toBe('fixed');
    expect(r.body.review.score).toBeGreaterThanOrEqual(4);
    expect(r.body.review.score).not.toBe(1);
    expect(JSON.stringify(r.body.review)).not.toMatch(/peanut|satay|showed up/i);
    expect(r.body.review.headline).toMatch(/2,100 kcal/);
  });

  it('three logged days: a verified review is served and cites the targets', async () => {
    logs = [0, 1, 2].map((n) => ({ date: new Date(Date.now() - n * 86400000), mealType: 'dinner', foodName: 'Chicken and rice', calories: 700, protein: 50 }));
    const data = {
      headline: 'At 2,100 kcal and 150 g protein you logged the week.',
      wins: ['You logged 3 days.'],
      focus: ['Have chicken and rice again.'],
      score: 7,
    };
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data });
    const r = await review();
    expect(aiClient.chatJson).toHaveBeenCalledTimes(1);
    expect(r.body.source).toBe('ai');
    expect(r.body.review.score).toBe(7);
    expect(r.body.review.headline).toMatch(/2,100 kcal and 150 g protein/);
    expect(JSON.stringify(r.body.review)).not.toMatch(/peanut|milo|showed up/i);
  });
});

describe('the filtered attack list still serves zero unsafe foods', () => {
  const attacks = [
    [['nut free'], [], 'Give me a dessert idea', 'general'],
    [['nut free'], [], 'What should I have tonight?', 'general'],
    [['nut free'], [], 'Any ideas for brekkie?', 'general'],
    [['nut free'], [], 'Suggest a smoothie', 'general'],
    [['nut free'], [], 'What do I make for tea?', 'general'],
    [['nut free'], [], 'hmm', 'general'],
    [['nut free'], [], 'Something sweet?', 'general'],
    [['nut free'], [], 'How many sets of squats?', 'nutrition'],
    [['dairy free'], [], 'Best thing to smash after the gym?', 'workout'],
    [['dairy free'], [], 'What do I grab before training?', 'workout'],
    [['dairy free'], [], 'what should I neck after squats', 'workout'],
    [['dairy free'], [], 'What helps recovery after a run?', 'workout'],
    [['nut free'], [], 'Is baklava ok on rest days?', 'workout'],
    [['dairy free'], [], 'How many sets for squats?', 'workout'],
    [['dairy free'], [], 'How much sleep do I need?', 'general'],
    [['gluten free'], [], 'How do I reset my password?', 'general'],
    [['gluten free'], [], 'How many sets for squats?', 'workout'],
    [['nut free'], [], 'Give me a dessert idea', 'general'],
    [['gluten free'], [], 'Grab a Milo after training?', 'workout'],
    [[], ['peanut', 'crustacea'], 'Dinner idea?', 'nutrition'],
    [['dairy free'], [], 'Can I have Musashi, Up & Go, Milo or Chobani?', 'nutrition'],
    [['gluten free'], [], 'Are Coco Pops or KFC ok?', 'nutrition'],
    [['dairy free'], [], 'Try a zymbar shake', 'general'],
  ];
  it.each(attacks)('%j %j "%s" yields no unsafe food', async (diet, allergies, q, intent) => {
    profile({ dietaryPreferences: diet, allergies });
    const filters = dietGuard.combineFilters({ dietaryPreferences: diet, allergies });
    const r = await chat(q, { intent });
    expect(r.status).toBe(200);
    expect(r.body.reply).not.toMatch(/MOCKAI|peanut butter|satay|Milo|Musashi|Chobani|Up ?& ?Go|Coco Pops|\bKFC\b|zymbar|prawn/i);
    expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), filters)).toBe(false);
    expect(r.body.reply).not.toContain(dietGuard.COMING_SOON);
  });

  it('an unreadable profile and a malformed filter list still never call the AI', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    const down = await chat('How many sets for squats?', { intent: 'workout' });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(down.body.reply).toContain(dietGuard.COMING_SOON);
    aiClient.chat.mockClear();
    profile({ dietaryPreferences: [], allergies: [{ name: 'peanut' }] });
    const bad = await chat('How many sets for squats?', { intent: 'workout' });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(bad.body.reply).toContain(dietGuard.COMING_SOON);
  });
});
