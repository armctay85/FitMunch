'use strict';
/**
 * Every AI-written meal goes through the ingredient-derived allergen and diet check, server side, before
 * the response or the database: AI meal plans, saved plans, Coach chat, insights, the weekly review, and
 * (not AI, but the same check) Coach plans. Mocked AI outputs hide nuts (almond milk, pesto, satay), oats,
 * soy sauce, sesame oil, prawns, whey in a vegan plan, eggs in mayo, missing ingredient lists and garbage.
 */
const pgCalls = [];
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      pgCalls.push({ sql, params });
      if (/^\s*(INSERT INTO|UPDATE) meal_plans/i.test(sql)) return Promise.resolve({ rows: [{ id: 1, meals: params[sql.match(/^\s*INSERT/i) ? 4 : 3] }] });
      return Promise.resolve({ rows: [] });
    }
  },
}));
jest.mock('./lib/ai-client', () => ({
  hasProvider: () => true,
  chat: jest.fn(),
  chatJson: jest.fn(),
  providerName: () => 'xai',
}));
jest.mock('./lib/ai-usage', () => ({
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 5 })),
  refundAiCall: jest.fn(async () => true),
  isSmokeAccount: () => false,
  refundSmokeOnFailure: () => {},
}));
let profile = {};
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({ id: 'u1', email: 'me@example.com', subscriptionTier: 'premium', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => profile),
    createOrUpdateProfile: jest.fn(async () => {}),
    getMealLogsForPeriod: jest.fn(async () => []),
    getWorkoutLogsForPeriod: jest.fn(async () => []),
  };
});

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const storage = require('./server/storage.js');
const safety = require('./lib/meal-safety');
const engine = require('./lib/meal-plan-engine');

const auth = `Bearer ${jwt.sign({ userId: '00000000-0000-4000-8000-0000000000c1' }, process.env.JWT_SECRET)}`;
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));

// A meal whose macros back up its calories (25% protein, 45% carbs, 30% fat).
const meal = (name, ingredients, kcal) => ({ name, ingredients, calories: kcal, protein: Math.round(kcal * 0.25 / 4), carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.3 / 9) });
const SAFE = {
  breakfast: () => meal('Banana rice porridge', [{ item: 'White rice', qty: '150g' }, { item: 'Banana', qty: '1' }], 500),
  lunch: () => meal('Chickpea and potato bowl', [{ item: 'Chickpeas', qty: '150g' }, { item: 'Potato', qty: '200g' }, { item: 'Spinach', qty: '50g' }], 600),
  dinner: () => meal('Lentil and rice curry', [{ item: 'Lentils', qty: '200g' }, { item: 'Brown rice', qty: '150g' }, { item: 'Tomato', qty: '100g' }], 700),
  snack: () => meal('Apple and rice cakes', [{ item: 'Apple', qty: '1' }, { item: 'Rice cakes', qty: '20g' }], 200),
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** A 7-day AI plan at 2000 kcal with `bad` meals placed into given slots on Monday. */
const aiPlan = (bad) => ({
  planName: 'AI week', summary: 's',
  days: DAYS.map((day, i) => ({ day, meals: Object.fromEntries(Object.entries(SAFE).map(([slot, f]) => [slot, i === 0 && bad[slot] ? bad[slot] : f()])) })),
});

const CASES = [
  { label: 'almond milk (nuts)', dietary: ['nut free'], slot: 'breakfast', bad: meal('Berry smoothie', [{ item: 'Almond milk', qty: '300ml' }, { item: 'Banana', qty: '1' }], 500), words: /almond/i },
  { label: 'pesto (nuts)', dietary: ['nut free'], slot: 'dinner', bad: meal('Pesto chicken pasta', [{ item: 'Chicken breast', qty: '150g' }, { item: 'Basil pesto', qty: '30g' }, { item: 'Pasta', qty: '100g' }], 700), words: /pesto/i },
  { label: 'satay (nuts)', dietary: ['nut free'], slot: 'dinner', bad: meal('Chicken with rice', [{ item: 'Chicken thigh', qty: '150g' }, { item: 'Satay sauce', qty: '40g' }, { item: 'Rice', qty: '150g' }], 700), words: /satay/i },
  { label: 'overnight oats (gluten)', dietary: ['gluten free'], slot: 'breakfast', bad: meal('Breakfast jar', [{ item: 'Overnight oats', qty: '60g' }, { item: 'Berries', qty: '100g' }], 500), words: /oats/i },
  { label: 'soy sauce (gluten)', dietary: ['gluten free'], slot: 'dinner', bad: meal('Beef stir-fry', [{ item: 'Beef strips', qty: '150g' }, { item: 'Light soy sauce', qty: '15ml' }, { item: 'Rice', qty: '150g' }], 700), words: /soy sauce/i },
  { label: 'sesame oil (sesame allergy)', allergies: ['sesame'], slot: 'lunch', bad: meal('Asian slaw', [{ item: 'Cabbage', qty: '150g' }, { item: 'Toasted sesame oil', qty: '10ml' }, { item: 'Chicken', qty: '120g' }], 600), words: /sesame/i },
  { label: 'prawns (shellfish allergy)', allergies: ['shellfish'], slot: 'lunch', bad: meal('Summer bowl', [{ item: 'Prawns', qty: '150g' }, { item: 'Rice noodles', qty: '100g' }], 600), words: /prawn/i },
  { label: 'whey in a vegan plan', dietary: ['vegan'], slot: 'snack', bad: meal('Protein shake', [{ item: 'Whey protein powder', qty: '30g' }, { item: 'Water', qty: '300ml' }], 200), words: /whey/i },
  { label: 'eggs in mayo', dietary: ['egg free'], slot: 'lunch', bad: meal('Tuna salad', [{ item: 'Tuna', qty: '95g' }, { item: 'Mayonnaise', qty: '20g' }, { item: 'Lettuce', qty: '50g' }], 600), words: /mayo/i },
  { label: 'a missing ingredient list', dietary: ['nut free'], slot: 'dinner', bad: { name: 'Chef special', calories: 700, protein: 44, carbs: 79, fat: 23 }, words: /Chef special/ },
  { label: 'an empty ingredient list', dietary: ['dairy free'], slot: 'dinner', bad: meal('Mystery bowl', [], 700), words: /Mystery bowl/ },
  { label: 'an unreadable ingredient list', allergies: ['peanuts'], slot: 'lunch', bad: meal('Noodle box', [{ qty: '100g' }, 42], 600), words: /Noodle box/ },
];

/** Independent check: nothing in the meal names an excluded flag, and the list is readable. */
function assertSafe(days, filters, words) {
  const excluded = safety.excludedFlags(filters);
  for (const d of days) {
    const sum = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const m of Object.values(d.meals)) {
      expect([m.name, safety.mealProblems(m, excluded)]).toEqual([m.name, null]);
      if (words) expect(JSON.stringify(m)).not.toMatch(words);
      for (const k of Object.keys(sum)) sum[k] += Number(m[k]) || 0;
    }
    if (d.dailyTotals) for (const k of Object.keys(sum)) expect(d.dailyTotals[k]).toBe(Math.round(sum[k]));
  }
}

beforeEach(() => { pgCalls.length = 0; profile = {}; aiClient.chat.mockReset(); aiClient.chatJson.mockReset(); });

describe('AI meal plans (POST /api/meal-plan/generate)', () => {
  const gen = (dietary) => request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({ goal: 'maintain', days: 7, calories: 2000, protein: 120, dietary });
  it.each(CASES)('replaces $label with a safe template meal for the same slot, close macros, totals recomputed', async (c) => {
    profile = { allergies: c.allergies || [] };
    aiClient.chatJson.mockResolvedValue({ ok: true, data: aiPlan({ [c.slot]: c.bad }), provider: 'xai' });
    const res = await gen(c.dietary || []);
    expect(res.status).toBe(200);
    expect(res.body.source).toMatch(/^ai/);
    const monday = res.body.plan.days[0].meals[c.slot];
    expect(monday.replacedForFilters).toBe(true);
    expect(engine.TEMPLATES.some((t) => t.name === monday.name && t.slot === c.slot)).toBe(true);
    expect(Math.abs(monday.calories - (c.bad.calories || 0))).toBeLessThanOrEqual((c.bad.calories || 0) * 0.1);
    assertSafe(res.body.plan.days, { dietary: c.dietary, allergies: c.allergies }, c.words);
    expect(res.body.plan.notes.join(' ')).toMatch(/didn't fit your filters/);
    // The other days' safe AI meals are untouched.
    expect(res.body.plan.days[1].meals[c.slot].name).toBe(SAFE[c.slot]().name);
    // The prompt names the filters and the hidden forms.
    const prompt = aiClient.chatJson.mock.calls[0][0].messages[0].content;
    for (const d of c.dietary || []) expect(prompt).toContain(d);
    for (const a of c.allergies || []) expect(prompt).toContain(a);
    expect(prompt).toMatch(/Never include, even as a sauce, oil, milk/);
  });
  it('vegan + nut free prompt spells out whey, almond milk, pesto and satay', async () => {
    aiClient.chatJson.mockResolvedValue({ ok: true, data: aiPlan({}), provider: 'xai' });
    await gen(['vegan', 'nut free']);
    const prompt = aiClient.chatJson.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/whey/); expect(prompt).toMatch(/almond milk/); expect(prompt).toMatch(/pesto/); expect(prompt).toMatch(/satay/);
  });
  it.each([
    ['garbage text', { ok: true, data: 'not json at all {{', provider: 'xai' }],
    ['a parse failure', { ok: false, error: 'bad_json' }],
    ['meals as a string', { ok: true, data: { days: DAYS.map((day) => ({ day, meals: 'oats with almond milk' })) }, provider: 'xai' }],
  ])('%s from the AI falls back to a safe builder week', async (_l, ai) => {
    profile = { allergies: ['peanuts', 'sesame'] };
    aiClient.chatJson.mockResolvedValue(ai);
    const res = await gen(['gluten free']);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    assertSafe(res.body.plan.days, { dietary: ['gluten free'], allergies: ['peanuts', 'sesame'] }, /oat|almond|sesame|peanut/i);
  });
  it('profile allergies also apply to the instant builder week and its swaps', async () => {
    profile = { allergies: ['soy'] };
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', auth).send({ builderOnly: true, days: 7, calories: 2000, protein: 120, dietary: ['vegan'] });
    expect(res.status).toBe(200);
    assertSafe(res.body.plan.days, { dietary: ['vegan'], allergies: ['soy'] }, /tofu|tempeh|edamame|soy/i);
    for (const d of res.body.plan.days) for (const m of Object.values(d.meals)) for (const s of m.swaps || []) expect(safety.mealProblems(s, safety.excludedFlags({ dietary: ['vegan'], allergies: ['soy'] }))).toBeNull();
  });
  it('remembers the chosen filters on the profile so Coach and saved plans use them', async () => {
    storage.createOrUpdateProfile.mockClear();
    aiClient.chatJson.mockResolvedValue({ ok: true, data: aiPlan({}), provider: 'xai' });
    await gen(['nut free', 'vegan']);
    expect(storage.createOrUpdateProfile).toHaveBeenCalledWith(expect.any(String), { dietaryPreferences: ['nut free', 'vegan'] });
  });
});

describe('saved plans (POST and PUT /api/meal-plans)', () => {
  const stored = () => {
    const call = pgCalls.find((c) => /^\s*(INSERT INTO|UPDATE) meal_plans/i.test(c.sql));
    return JSON.parse(call.params[/^\s*INSERT/i.test(call.sql) ? 4 : 3]);
  };
  it.each(CASES)('$label never reaches the database on save', async (c) => {
    profile = { dietaryPreferences: c.dietary || [], allergies: c.allergies || [] };
    const days = aiPlan({ [c.slot]: c.bad }).days;
    const res = await request(app).post('/api/meal-plans').set('Authorization', auth).send({ name: 'My week', meals: days });
    expect(res.status).toBe(200);
    const saved = stored();
    expect(saved[0].meals[c.slot].replacedForFilters).toBe(true);
    assertSafe(saved, { dietary: c.dietary, allergies: c.allergies }, c.words);
  });
  it('an edit (PUT) that adds an unsafe AI meal is checked too', async () => {
    profile = { dietaryPreferences: ['nut free'] };
    const days = aiPlan({ breakfast: CASES[0].bad }).days;
    const res = await request(app).put('/api/meal-plans/1').set('Authorization', auth).send({ meals: days });
    expect(res.status).toBe(200);
    assertSafe(stored(), { dietary: ['nut free'] }, /almond/i);
  });
});

describe('Coach chat (POST /api/ai/chat)', () => {
  const chat = (text, context = {}) => {
    aiClient.chat.mockResolvedValue({ ok: true, text, provider: 'xai' });
    return request(app).post('/api/ai/chat').set('Authorization', `Bearer ${jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET)}`)
      .send({ messages: [{ role: 'user', content: 'What should I eat tonight?' }], context });
  };
  it.each([
    [{ dietaryPreferences: ['nut free'] }, 'Try a chicken satay bowl tonight. Drink plenty of water.', /satay/i],
    [{ dietaryPreferences: ['nut free'] }, 'Blend banana with almond milk.\nOr pasta with pesto.', /almond|pesto/i],
    [{ dietaryPreferences: ['gluten free'] }, 'Overnight oats are great. A beef stir-fry with soy sauce works too.', /oats|soy sauce/i],
    [{ allergies: ['sesame'] }, 'Dress the salad with toasted sesame oil.', /sesame/i],
    [{ allergies: ['shellfish'] }, 'Grill some garlic prawns with rice.', /prawn/i],
    [{ dietaryPreferences: ['vegan'] }, 'Have a whey shake after training.', /whey/i],
    [{ dietaryPreferences: ['egg free'] }, 'Make a tuna sandwich with mayo.', /mayo/i],
  ])('strips the unsafe suggestion for %j and adds a safe alternative', async (p, text, words) => {
    profile = p;
    const res = await chat(text);
    expect(res.status).toBe(200);
    expect(res.body.reply.split('I removed a suggestion')[0]).not.toMatch(words);
    expect(res.body.reply).toMatch(/I removed a suggestion that didn't fit your filters/);
    expect(res.body.reply).toMatch(/A safe option: /);
    const opts = aiClient.chat.mock.calls[0][0];
    expect(opts.system).toMatch(/Food rules for this user \(always follow\)/);
    for (const d of p.dietaryPreferences || []) expect(opts.system).toContain(d);
    for (const a of p.allergies || []) expect(opts.system).toContain(a);
  });
  it('filters sent in the chat context count too, and a safe reply is unchanged', async () => {
    profile = {};
    const res = await chat('Grill chicken with rice and broccoli.', { dietary: ['nut free'] });
    expect(res.body.reply).toBe('Grill chicken with rice and broccoli.');
    expect(aiClient.chat.mock.calls[0][0].system).toContain('nut free');
  });
  it('no filters: the reply is untouched', async () => {
    const res = await chat('Have a satay chicken bowl.');
    expect(res.body.reply).toBe('Have a satay chicken bowl.');
  });
});

describe('insight and weekly review', () => {
  const u1 = `Bearer ${jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET)}`;
  it('an insight that suggests an unsafe food is replaced by the built-in tip, and the prompt has the filters', async () => {
    profile = { dietaryPreferences: ['nut free'] };
    aiClient.chat.mockResolvedValue({ ok: true, text: 'Grab a handful of almonds for protein.', provider: 'xai' });
    const res = await request(app).post('/api/ai/insight').set('Authorization', u1).send({});
    expect(res.status).toBe(200);
    expect(res.body.insight).not.toMatch(/almond/i);
    expect(aiClient.chat.mock.calls[0][0].system).toContain('nut free');
  });
  it('weekly review strings are checked', async () => {
    profile = { allergies: ['peanuts'], dietaryPreferences: ['gluten free'] };
    aiClient.chatJson.mockResolvedValue({ ok: true, data: { headline: 'Solid week', wins: ['Logged 5 days'], focus: ['Add peanut butter toast at breakfast.', 'Drink more water.'], score: 7 }, provider: 'xai' });
    const res = await request(app).get('/api/ai/weekly-review').set('Authorization', u1);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.review)).not.toMatch(/peanut|toast/i);
    expect(res.body.review.focus).toContain('Drink more water.');
    expect(aiClient.chatJson.mock.calls[0][0].system).toMatch(/peanuts/);
  });
});

describe('Coach plans (catalogue, no AI) use the same derived check', () => {
  const cp = require('./lib/coach-plan');
  const base = { kcal: 2000, protein: 140, carbs: 200, fat: 60, storeId: 'woolworths' };
  it('a gluten-free Coach plan has no rolled oats (oats were untagged on main)', () => {
    expect(JSON.stringify(cp.buildCoachPlan({ ...base, flags: ['gluten-free'] }))).not.toMatch(/oat/i);
  });
  it.each([['nut-free', /peanut|almond|cashew|walnut|\bnuts?\b/i], ['dairy-free', /milk|yoghurt|cheese|whey/i], ['vegan', /egg|chicken|beef|salmon|tuna|milk|yoghurt|cheese/i]])('%s Coach plan passes the derived check', (flag, words) => {
    const p = cp.buildCoachPlan({ ...base, flags: [flag] });
    const meals = JSON.stringify(p.days);
    expect(meals).not.toMatch(words);
  });
});

describe('meal-safety unit', () => {
  it('a meal with any filter and no readable ingredients is unsafe; with no filters it passes', () => {
    expect(safety.mealProblems({ name: 'x' }, new Set(['nuts']))).toEqual(['no readable ingredient list']);
    expect(safety.mealProblems({ name: 'x' }, new Set())).toBeNull();
  });
  it('free-text allergies map to flags; a fish allergy also excludes shellfish', () => {
    expect([...safety.excludedFlags({ allergies: ['Peanuts', 'coeliac', 'fish'] })].sort()).toEqual(['fish', 'gluten', 'nuts', 'shellfish']);
  });
  it('"egg-free" or "nut free" in text names the filter, not the food', () => {
    expect([...safety.flagsInText('Make it egg-free and nut free')]).toEqual([]);
  });
});
