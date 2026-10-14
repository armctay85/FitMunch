'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stopgap-127a-secret';
/**
 * #127a stopgap: any user with a diet or allergy filter (saved or sent) gets the
 * ingredient-checked template builder only, never AI-written meals, in meal plan
 * generation and Coach chat. Saved filters are read, never written. The AI is
 * mocked to return unsafe meals; none of it may reach a filtered user.
 */
const UNSAFE_PLAN = {
  planName: 'MOCKAI week',
  summary: 'MOCKAI',
  days: ['Monday'].map((day) => ({
    day,
    meals: {
      breakfast: { name: 'MOCKAI peanut butter toast', ingredients: [{ item: 'Peanut butter', qty: '40g' }, { item: 'White bread', qty: '2 slices' }], calories: 500, protein: 20, carbs: 50, fat: 20 },
      lunch: { name: 'MOCKAI satay noodles', ingredients: [{ item: 'Hokkien noodles', qty: '200g' }, { item: 'Satay sauce', qty: '60g' }], calories: 500, protein: 30, carbs: 60, fat: 15 },
      dinner: { name: 'MOCKAI ricotta pasta', ingredients: [{ item: 'Pasta', qty: '150g' }, { item: 'Ricotta', qty: '100g' }], calories: 600, protein: 40, carbs: 70, fat: 15 },
      snack: { name: 'MOCKAI almond muesli bar', ingredients: [{ item: 'Muesli bar', qty: '1' }], calories: 400, protein: 60, carbs: 40, fat: 10 },
    },
  })),
};
const UNSAFE_CHAT = 'Try a MOCKAI peanut butter and satay pasta bowl after training.';

jest.mock('./lib/ai-client', () => {
  const actual = jest.requireActual('./lib/ai-client');
  return {
    ...actual,
    hasProvider: jest.fn(() => true),
    chat: jest.fn(async () => ({ ok: true, text: 'Try a MOCKAI peanut butter and satay pasta bowl after training.', provider: 'mock', model: 'm' })),
    chatJson: jest.fn(async () => ({ ok: true, json: null, text: '', provider: 'mock' })),
  };
});
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return {
    ...actual,
    checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
    refundAiCall: jest.fn(async () => true),
  };
});
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return { ...actual, getUserById: jest.fn(), getProfile: jest.fn(), createOrUpdateProfile: jest.fn() };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');
const engine = require('./lib/meal-plan-engine');

const app = express();
app.use(express.json());
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));
const token = `Bearer ${jwt.sign({ userId: '00000000-0000-4000-8000-0000000127a1' }, process.env.JWT_SECRET)}`;

const generate = (body = {}) => request(app).post('/api/meal-plan/generate').set('Authorization', token)
  .send({ calories: 2000, protein: 150, days: 7, ...body });
const chat = (text, extra = {}) => request(app).post('/api/ai/chat').set('Authorization', token)
  .send({ intent: 'general', messages: [{ role: 'user', content: text }], ...extra });

function account(profile) {
  storage.getUserById.mockResolvedValue({ id: 'u', name: 'U', email: 'u@example.com', subscriptionTier: 'free', settings: { aiDataConsent: true } });
  if (profile instanceof Error) storage.getProfile.mockRejectedValue(profile);
  else storage.getProfile.mockResolvedValue(profile);
}
beforeEach(() => {
  jest.clearAllMocks();
  aiClient.chatJson.mockResolvedValue({ ok: true, json: UNSAFE_PLAN, text: JSON.stringify(UNSAFE_PLAN), provider: 'mock' });
});

/** Every ingredient in a served plan, checked with the engine's own allergen rules. */
function servedGroups(plan) {
  const items = [];
  for (const d of plan.days) for (const m of Object.values(d.meals)) {
    for (const i of m.ingredients || []) items.push([i.item || i.name]);
    for (const s of m.swaps || []) for (const i of s.ingredients || []) items.push([i.item || i.name]);
  }
  return engine.allergensOf(items);
}

describe('meal plan generation', () => {
  it('saved gluten free + nothing ticked -> builder only, no gluten, no AI call, no credit', async () => {
    account({ dietaryPreferences: ['gluten free'], allergies: [] });
    const r = await generate({ dietary: [] });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.notice).toBe(dietGuard.PLAN_NOTICE);
    expect(r.body.dietary).toContain('gluten free');
    expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|pasta|spaghetti|\bbread\b|\boats?\b/i);
    expect(servedGroups(r.body.plan)).not.toContain('gluten');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });

  it('peanut allergy (free text) -> no peanut, satay or nuts anywhere', async () => {
    account({ dietaryPreferences: [], allergies: ['Peanuts'] });
    const r = await generate();
    expect(r.body.source).toBe('builder');
    expect(JSON.stringify(r.body)).not.toMatch(/MOCKAI|peanut|satay|almond|cashew/i);
    expect(servedGroups(r.body.plan)).not.toContain('nuts');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });

  it('sent filters with no saved ones -> builder only; saved + sent combine', async () => {
    account({ dietaryPreferences: ['dairy free'], allergies: [] });
    const r = await generate({ dietary: ['nut free'] });
    expect(r.body.source).toBe('builder');
    expect(r.body.dietary).toEqual(expect.arrayContaining(['dairy free', 'nut free']));
    expect(servedGroups(r.body.plan)).not.toEqual(expect.arrayContaining(['dairy']));
    expect(servedGroups(r.body.plan)).not.toContain('nuts');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });

  it('builderOnly (onboarding) also applies saved filters', async () => {
    account({ dietaryPreferences: ['gluten free'], allergies: ['peanut'] });
    const r = await generate({ builderOnly: true });
    expect(servedGroups(r.body.plan)).not.toContain('gluten');
    expect(servedGroups(r.body.plan)).not.toContain('nuts');
  });

  it('profile unreadable -> fails closed to the builder', async () => {
    account(new Error('db down'));
    const r = await generate();
    expect(r.body.source).toBe('builder');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('consent is still checked before the profile is read for an unfiltered request', async () => {
    storage.getUserById.mockResolvedValue({ id: 'u', settings: { aiDataConsent: false } });
    storage.getProfile.mockResolvedValue({ dietaryPreferences: [] });
    const r = await generate();
    expect(r.status).toBe(403);
    expect(storage.getProfile).not.toHaveBeenCalled();
  });

  it('no filters -> unchanged: the AI is asked', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    await generate();
    expect(aiClient.chatJson).toHaveBeenCalled();
  });
});

describe('Coach chat', () => {
  it('peanut allergy + meal question -> checked recipes, safe line, no AI, no credit', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'], targetCalories: 2100, targetProtein: 140 });
    const r = await chat('What should I eat for dinner tonight?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(r.body.reply).not.toMatch(/MOCKAI|peanut|satay/i);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('saved gluten free + nutrition intent -> no gluten in the reply', async () => {
    account({ dietaryPreferences: ['gluten free'], allergies: [] });
    const r = await chat('Give me a meal plan', { intent: 'nutrition' });
    expect(r.body.source).toBe('builder');
    expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), ['gluten free'])).toBe(false);
    expect(aiClient.chat).not.toHaveBeenCalled();
  });

  it('filtered user, non-food question, AI names an unsafe food -> replaced and refunded', async () => {
    account({ dietaryPreferences: [], allergies: ['peanuts'] });
    const r = await chat('How many sets of squats should I do?', { intent: 'workout' });
    expect(aiClient.chat).toHaveBeenCalled();
    expect(r.body.reply).not.toMatch(/MOCKAI|peanut|satay/i);
    expect(r.body.source).toBe('builder');
    expect(aiUsage.refundAiCall).toHaveBeenCalled();
  });

  it('sent context filters count too', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const r = await chat('lunch ideas?', { context: { allergies: ['peanut'] } });
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toMatch(/MOCKAI|peanut|satay/i);
  });

  it('no filters -> unchanged: the AI reply is served', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const r = await chat('What should I eat for dinner tonight?');
    expect(r.body.reply).toBe(UNSAFE_CHAT);
  });
});

describe('diet-guard', () => {
  it('combineFilters never shrinks the saved list', () => {
    const saved = { dietaryPreferences: ['Gluten-Free', 'vegan'], allergies: ['peanuts', 'sesame'] };
    expect(dietGuard.combineFilters(saved, [])).toEqual(expect.arrayContaining(['gluten free', 'vegan', 'nut free', 'sesame free']));
    expect(dietGuard.combineFilters(saved, ['dairy free'])).toEqual(expect.arrayContaining(['gluten free', 'vegan', 'nut free', 'sesame free', 'dairy free']));
    expect(dietGuard.combineFilters(null, undefined)).toEqual([]);
  });
  it('unknown allergy text is kept as a filter (fails closed)', () => {
    expect(dietGuard.combineFilters({ allergies: ['kiwifruit'] }, [])).toEqual(['kiwifruit']);
  });
  it('textBreaksFilters catches unsafe foods in free text', () => {
    expect(dietGuard.textBreaksFilters(UNSAFE_CHAT, ['nut free'])).toBe(true);
    expect(dietGuard.textBreaksFilters('chicken satay', ['nut free'])).toBe(true);
    expect(dietGuard.textBreaksFilters('penne with tomato', ['gluten free'])).toBe(true);
    expect(dietGuard.textBreaksFilters('Grilled chicken with rice', ['gluten free', 'nut free'])).toBe(false);
  });
});
