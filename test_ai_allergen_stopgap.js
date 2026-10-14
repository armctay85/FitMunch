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
  return { ...actual, getUserById: jest.fn(), getProfile: jest.fn(), createOrUpdateProfile: jest.fn(), mergeDietaryPreferences: jest.fn(async () => true) };
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
    // Hotfix: ticked filters are saved (merged, never shrunk) so Coach and the weekly review see them.
    expect(storage.mergeDietaryPreferences).toHaveBeenCalledTimes(1);
    const [uid, merge] = storage.mergeDietaryPreferences.mock.calls[0];
    expect(uid).toBe(storage.getProfile.mock.calls[0][0]);
    expect(merge(['dairy free'])).toEqual(['dairy free', 'nut free']);
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });

  it('#141 S1: no write when the profile could not be read (generate and onboarding)', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    for (const extra of [{}, { builderOnly: true }]) {
      const r = await generate({ dietary: ['nut free'], ...extra });
      expect(r.body.source).toBe('builder');
    }
    expect(storage.mergeDietaryPreferences).not.toHaveBeenCalled();
  });

  it('#141 M2: onboarding (builderOnly) saves ticked filters too', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    await generate({ dietary: ['nut free'], builderOnly: true });
    expect(storage.mergeDietaryPreferences).toHaveBeenCalledTimes(1);
    expect(storage.mergeDietaryPreferences.mock.calls[0][1]([])).toEqual(['nut free']);
  });

  it('#141 S1/S2: mergedFilterList dedupes, case-folds, skips no-ops and never overwrites odd formats', () => {
    const { mergedFilterList: m } = require('./meal-planner');
    expect(m(['gluten free'], ['nut free'])).toEqual(['gluten free', 'nut free']);
    expect(m(null, ['nut free'])).toEqual(['nut free']);
    expect(m([], ['nut free', 'nut free', 'Nut-Free'])).toEqual(['nut free']); // dedupe
    expect(m(['Gluten Free'], ['gluten free'])).toBeNull(); // case-folded: nothing added
    expect(m(['Gluten Free'], ['GLUTEN_FREE', 'dairy free'])).toEqual(['Gluten Free', 'dairy free']);
    expect(m(['nut free'], ['nut free'])).toBeNull(); // nothing added -> no write
    expect(m(['nut free'], [])).toBeNull();
    for (const odd of [[{ name: 'gluten free' }], { gluten: { severe: true } }, 'peanut-free diet', 'vegan', ['peanut-free diet'], [null], 7]) {
      expect([odd, m(odd, ['nut free'])]).toEqual([odd, null]);
    }
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

// ── r2 (Elite QA #135 r1) ─────────────────────────────────────────────────────
describe('r2 M1: filtered Coach gives recipes unless clearly not about food', () => {
  it.each([
    'Give me a dessert idea', 'What should I have tonight?', 'Any ideas for brekkie?', 'Suggest a smoothie',
    'What do I make for tea?', 'hmm', 'Something sweet?',
  ])('%s -> checked recipes, no AI', async (q) => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await chat(q);
    expect(r.body.source).toBe('builder');
    expect(r.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it('nutrition intent is always food, even for a training-sounding question', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await chat('How many sets of squats?', { intent: 'nutrition' });
    expect(r.body.source).toBe('builder');
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it.each([
    ['nut free', 'Try baklava or dukkah'], ['gluten free', 'teriyaki chicken with sourdough'], ['gluten free', 'gnocchi, naan or brioche'],
    ['dairy free', 'paneer korma, gelato'], ['egg free', 'pavlova or carbonara'], ['shellfish free', 'paella'], ['fish free', 'a dash of worcestershire'],
    ['fish free', 'prawn skewers'], ['nut free', 'peanuts'], ['nut free', 'almonds'], ['egg free', 'eggs'], ['nut free', 'two satays'], ['egg free', 'mini pavlovas'],
  ])('reply check: %s catches "%s"', (f, text) => {
    expect(dietGuard.textBreaksFilters(text, [f])).toBe(true);
  });
  it.each(['Foam roll your quads', 'Wrap up your session', 'Go nuts on the stairs', 'Bun up your hair', 'pie chart', 'egg-timer intervals', 'stomach bug', 'Fish for compliments', 'roll out your back'])(
    'S2: no over-match on "%s"', (text) => {
      expect(dietGuard.textBreaksFilters(text, ['gluten free', 'nut free', 'egg free', 'fish free', 'dairy free'])).toBe(false);
    });
});

describe('r2 M2: null-ish filters are dropped', () => {
  it('[null, "null", "undefined", ""] with no saved filters still reaches the AI', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const r = await generate({ dietary: [null, 'null', 'undefined', '', 'None'] });
    expect(aiClient.chatJson).toHaveBeenCalled();
    expect(JSON.stringify(r.body)).not.toMatch(/Not applied/);
  });
  it('the web plan screen reads only its own diet buttons', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/app.html'), 'utf8');
    expect(html).toContain("querySelectorAll('#dietary-tags .diet-tag.active[data-val]')");
    expect(html).not.toMatch(/querySelectorAll\('\.diet-tag\.active'\)/);
    expect(html).not.toContain('AI builds your weekly plan');
  });
});

describe('r2 M3 + S1: weekly review and insight', () => {
  const review = () => request(app).get('/api/ai/weekly-review').set('Authorization', token);
});

describe('r2 M4: builder hard-excludes shellfish, fish, soy and sesame', () => {
  const words = {
    'shellfish free': /prawn|shrimp|crab|lobster|mussel|oyster|squid|calamari|octopus|scallop/i,
    'fish free': /fish|salmon|tuna|barramundi|prawn|sardine|cod\b|snapper/i,
    'soy free': /tofu|tempeh|edamame|\bsoy|miso/i,
    'sesame free': /sesame|tahini|hummus/i,
  };
  it.each(Object.keys(words))('%s: no matching meal or swap across targets', (f) => {
    for (const diet of [[f], ['vegan', f], ['vegetarian', f], ['gluten free', 'nut free', f]]) {
      for (const calories of [1300, 2000, 3200]) for (const protein of [60, 150, 250]) {
        const plan = engine.withSwaps(engine.buildPlan({ calories, protein, days: 7, dietary: diet }), diet, calories);
        expect(JSON.stringify(plan.days)).not.toMatch(words[f]);
        expect(JSON.stringify(plan.notes || [])).not.toMatch(/Not applied/);
      }
    }
  });
});

describe('r2 S3 + mappings', () => {
  it('allergies stored as an object or JSON string count', () => {
    expect(dietGuard.combineFilters({ allergies: { peanut: true, soy: false } }, [])).toEqual(['nut free']);
    expect(dietGuard.combineFilters({ allergies: '["fish"]' }, [])).toEqual(['fish free']);
    expect(dietGuard.combineFilters({ allergies: 'shellfish' }, [])).toEqual(['shellfish free']);
  });
  it('object allergies route to the builder', async () => {
    account({ dietaryPreferences: null, allergies: { peanut: true } });
    const r = await generate();
    expect(r.body.source).toBe('builder');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
});

describe('typed meals are never replaced; they carry a warning', () => {
  it('POST /meal-plans saves as typed and warns', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockImplementation(async (_sql, params) => ({ rows: [{ id: 1, meals: params && params[4] }] }));
    const meals = [{ name: 'Prawn satay', foods: [{ name: 'Satay sauce' }] }, { name: 'Rice bowl', foods: [] }];
    const r = await request(app).post('/api/meal-plans').set('Authorization', token).send({ name: 'Mine', meals });
    spy.mockRestore();
    expect(JSON.parse(r.body.plan.meals)).toEqual(meals);
    expect(r.body.allergenWarnings).toEqual([{ meal: 'Prawn satay', contains: ['nuts'] }]);
  });
});

// ── r3 (Elite QA #135 r2) ─────────────────────────────────────────────────────
const QA4 = ['Best thing to smash after the gym?', 'What do I grab before training?', 'what should I neck after squats', 'What helps recovery after a run?'];
describe('r3 M1: training-framed food questions and the fail-closed reply gate', () => {
  it.each(QA4)('"%s" -> checked recipes for a dairy-free user', async (q) => {
    account({ dietaryPreferences: ['dairy free'], allergies: [] });
    const r = await chat(q, { intent: 'workout' });
    expect(r.body.source).toBe('builder');
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
});

describe('r3 S2: surviving mutants', () => {
  it.each(['Anything to smash at the gym?', 'What can I grab at the gym?', 'What to neck at the gym?', 'Recovery at the gym?', 'Fuel up at the gym?'])(
    'eating verbs alone make "%s" food', (q) => {
      expect(dietGuard.isFoodTalk('workout', q)).toBe(true);
    });
  it('a lexicon food in an otherwise training question counts as food', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await chat('Is baklava ok on rest days?', { intent: 'workout' });
    expect(r.body.source).toBe('builder');
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
});

describe('r3 S1: persistent allergen badge', () => {
  it('GET /meal-plans carries allergenWarnings per plan; PB toast warns for a peanut allergy', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockResolvedValue({ rows: [{ id: 1, meals: [{ name: 'PB toast', foods: [] }, { name: 'Rice bowl' }] }] });
    const r = await request(app).get('/api/meal-plans').set('Authorization', token);
    spy.mockRestore();
    expect(r.body.plans[0].allergenWarnings).toEqual([{ meal: 'PB toast', contains: expect.arrayContaining(['nuts']) }]);
  });
  it('the plan list and plan view render the badge', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/app.html'), 'utf8');
    expect(html).toContain('const warnBadge = allergenBadgeHtml(p.allergenWarnings);');
    expect(html).toContain("warnEl.innerHTML = allergenBadgeHtml(p.allergenWarnings, true);");
  });
});

// ── r4 (Elite QA #135 r3): filtered users never reach the AI in Coach, weekly review or insight ──
const COMING = dietGuard.COMING_SOON;
/** The checked meal named in a fixed reply is a real template that fits the filters. */
function expectSafeMeal(text, filters) {
  const names = engine.TEMPLATES.filter((t) => text.includes(`${t.name} (`)).map((t) => t.name);
  expect(names.length).toBeGreaterThan(0);
  expect(dietGuard.textBreaksFilters(text.replace(dietGuard.SAFE_NOTICE, ''), filters)).toBe(false);
}
describe('r4: fixed replies for filtered users', () => {
  it.each([
    ['dairy free', 'How many sets for squats?', 'workout'], ['dairy free', 'How much sleep do I need?', 'general'], ['gluten free', 'How do I reset my password?', 'general'],
    ['gluten free', 'How many sets for squats?', 'workout'], ['nut free', 'Give me a dessert idea', 'general'], ['gluten free', 'Grab a Milo after training?', 'workout'],
  ])('%s asking "%s": no AI, no credit, a safe meal and the coming-soon line', async (f, q, intent) => {
    account({ dietaryPreferences: [f], allergies: [], targetCalories: 2100, targetProtein: 140 });
    const r = await chat(q, { intent });
    expect(r.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(r.body.reply).toContain(COMING);
    expect(r.body.reply).not.toMatch(/MOCKAI|Milo|Up ?& ?Go|Musashi/i);
    expectSafeMeal(r.body.reply, [f]);
  });
  it('a training question gets food-free guidance plus one checked meal', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await chat('How many sets for squats?', { intent: 'workout' });
    expect(r.body.source).toBe('fixed');
    const guidance = r.body.reply.split('\n\n')[0];
    expect(guidance).toMatch(/sets/);
    expect(dietGuard.textBreaksFilters(guidance, ['vegan', 'gluten free', 'nut free', 'soy free', 'sesame free', 'fish free', 'egg free'])).toBe(false);
  });
  it('an unreadable profile never reaches the AI either', async () => {
    account(new Error('db down'));
    const r = await chat('How many sets for squats?', { intent: 'workout' });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(r.body.reply).toContain(COMING);
  });
  it.each(['before training', 'after training', 'after the gym', 'before my run', 'after squats', 'during training', 'post-gym', 'pre-run'])(
    '"What should I have %s?" counts as food', (w) => {
      expect(dietGuard.isFoodTalk('workout', `What should I have ${w}?`)).toBe(true);
      expect(dietGuard.isFoodTalk('workout', `Anything ${w}?`)).toBe(true);
    });
  it('weekly review: fixed, no AI, no credit, safe meal and coming-soon line', async () => {
    account({ dietaryPreferences: ['gluten free'], allergies: ['peanut'] });
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.body.source).toBe('fixed');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(r.body.review.focus).toContain(COMING);
    expectSafeMeal(JSON.stringify(r.body.review), ['gluten free', 'nut free']);
  });
  it('weekly review: no filters still reach the AI unchanged', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const data = { headline: 'h', wins: ['Ate satay'], focus: ['f'], score: 5 };
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data });
    expect((await request(app).get('/api/ai/weekly-review').set('Authorization', token)).body.review).toEqual(data);
  });
  it.each([['filters', { dietaryPreferences: [], allergies: ['peanut'] }], ['read error', new Error('db down')]])('insight (%s): fixed tip with a safe meal, no coming-soon line on the tile, no AI', async (_l, prof) => {
    account(prof);
    const r = await request(app).post('/api/ai/insight').set('Authorization', token).send({ todayCalories: 900, targetCalories: 2000, targetProtein: 150 });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(r.body.insight).not.toContain(COMING);
    expect(r.body.insight).toContain(dietGuard.SAFE_TIP);
    expectSafeMeal(r.body.insight, ['nut free']);
  });
  it('every fixed reply has a safe meal and the line, across filters and targets', () => {
    for (const filters of [['nut free'], ['gluten free'], ['vegan', 'soy free'], ['dairy free', 'egg free'], ['fish free'], ['shellfish free', 'sesame free'], ['kiwifruit']]) {
      for (const [calories, protein] of [[1300, 60], [2000, 150], [3500, 250]]) {
        const o = { filters, calories, protein };
        for (const text of [dietGuard.safeCoachReply(o).reply, dietGuard.safeTrainingReply(o), dietGuard.safeInsight(o), JSON.stringify(dietGuard.safeWeeklyReview(o))]) {
          if (text !== dietGuard.safeInsight(o)) expect(text).toContain(COMING);
          expectSafeMeal(text, filters);
          expect(text).not.toMatch(/woolworths|coles|aldi|grok|openai|anthropic|gemini/i);
        }
      }
    }
  });
});

describe('r4: typed-meal warnings', () => {
  it("'1peanut' and meals saved as JSON text raise a warning", async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockResolvedValue({ rows: [{ id: 1, meals: JSON.stringify([{ name: 'Toast', foods: [{ name: '1peanut butter' }] }]) }] });
    const r = await request(app).get('/api/meal-plans').set('Authorization', token);
    spy.mockRestore();
    expect(r.body.plans[0].allergenWarnings).toEqual([{ meal: 'Toast', contains: ['nuts'] }]);
    expect(dietGuard.textBreaksFilters('1peanut', ['nut free'])).toBe(true);
  });
  it('banner wraps at 390 and only the plan view uses role=alert', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/app.html'), 'utf8');
    expect(html).toMatch(/\.allergen-warning\{overflow-wrap:anywhere/);
    expect(html).toContain('allergenBadgeHtml(p.allergenWarnings, true)');
    expect(html).toContain('const warnBadge = allergenBadgeHtml(p.allergenWarnings);');
  });
});

// ── r5 (Elite QA #135 r4) ─────────────────────────────────────────────────────
const FSANZ_SHELLFISH = ['crustacea', 'crustacean', 'crustaceans', 'bivalve', 'bivalves', 'mollusc', 'molluscs', 'mollusk', 'mollusks', 'mollusca',
  'cephalopod', 'cephalopods', 'gastropod', 'gastropods', 'shellfish'];
const SHELLFISH_FOODS = ['prawn', 'shrimp', 'crab', 'lobster', 'Moreton Bay bugs', 'yabbies', 'marron', 'crayfish', 'oysters', 'mussels', 'scallops',
  'clams', 'pipis', 'squid', 'calamari', 'octopus', 'cuttlefish', 'snails', 'abalone'];
describe('r5 M1: FSANZ shellfish terms map on both paths', () => {
  it.each([...FSANZ_SHELLFISH, ...SHELLFISH_FOODS])('allergy "%s" maps to shellfish free (Coach mapping)', (a) => {
    expect(dietGuard.allergyDiets([a])).toEqual(['shellfish free']);
  });
  it.each(FSANZ_SHELLFISH)('typed allergy "%s" warns on every named shellfish food (typed-meal path)', (a) => {
    const filters = dietGuard.combineFilters({ allergies: [a] });
    for (const food of SHELLFISH_FOODS) expect([food, dietGuard.brokenGroups(`${food} with rice`, filters)]).toEqual([food, ['shellfish']]);
    // A typed meal naming the FSANZ term itself warns too.
    expect(dietGuard.brokenGroups(`${a} platter`, filters)).toEqual(['shellfish']);
  });
  it("'Satay prawn noodles' for peanut + crustacea warns about nuts and shellfish; Coach has no 'Not applied'", async () => {
    account({ dietaryPreferences: [], allergies: ['peanut', 'crustacea'] });
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockImplementation(async (_sql, params) => ({ rows: [{ id: 1, meals: params && params[4] }] }));
    const r = await request(app).post('/api/meal-plans').set('Authorization', token).send({ name: 'Mine', meals: [{ name: 'Satay prawn noodles', foods: [] }] });
    spy.mockRestore();
    expect(r.body.allergenWarnings).toEqual([{ meal: 'Satay prawn noodles', contains: expect.arrayContaining(['nuts', 'shellfish']) }]);
    const c = await chat('Dinner idea?', { intent: 'nutrition' });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(c.body.reply).not.toMatch(/Not applied/i);
    expect(c.body.reply).not.toMatch(/prawn|shrimp|crab|lobster|oyster|mussel|scallop|squid|calamari|octopus/i);
  });
  it("'mollus' alone maps (kills the mapping mutant)", () => {
    expect(dietGuard.allergyDiets(['Mollusca'])).toEqual(['shellfish free']);
    expect(dietGuard.allergyDiets(['molluscan'])).toEqual(['shellfish free']);
  });
});

describe('r5 S1: malformed filter shapes fail closed', () => {
  const BAD = [[{ name: 'peanut' }], [['peanut']], { list: ['peanut'] }, 7, [7], true, [true]];
  it.each(BAD.map((b) => [JSON.stringify(b), b]))('saved %s counts as a filter and blocks the AI', async (_l, bad) => {
    account({ dietaryPreferences: [], allergies: bad });
    const r = await chat('How many sets for squats?', { intent: 'workout' });
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(r.body.source).toBe('fixed');
    account({ dietaryPreferences: bad, allergies: [] });
    await chat('How many sets for squats?', { intent: 'workout' });
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it.each(BAD.map((b) => [JSON.stringify(b), b]))('sent context %s blocks the AI', async (_l, bad) => {
    account({ dietaryPreferences: [], allergies: [] });
    await chat('How many sets for squats?', { intent: 'workout', context: { allergies: bad } });
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it.each(BAD.map((b) => [JSON.stringify(b), b]))('saving %s returns 400 and writes nothing', async (_l, bad) => {
    for (const k of ['allergies', 'dietaryPreferences']) {
      const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ [k]: bad });
      expect(r.status).toBe(400);
    }
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });
  it('well-formed filters still save; empty filters still reach the AI', async () => {
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: ['peanut'], dietaryPreferences: 'vegan' });
    expect(r.status).toBe(200);
    for (const empty of [[], [''], ['null'], 'none', null, [null], {}]) {
      jest.clearAllMocks();
      account({ dietaryPreferences: empty, allergies: [] });
      await chat('How many sets for squats?', { intent: 'workout' });
      expect([JSON.stringify(empty), aiClient.chat.mock.calls.length]).toEqual([JSON.stringify(empty), 1]);
    }
  });
});

describe('r5 S2: workout plan for filtered users', () => {
  const wp = (body = {}) => request(app).post('/api/ai/workout-plan').set('Authorization', token).send({ daysPerWeek: 4, focus: 'bulk with peanut butter shakes', ...body });
  it.each([['filters', { dietaryPreferences: [], allergies: ['peanut'] }], ['read error', new Error('db down')]])('%s: fixed food-free plan, no AI, no credit', async (_l, prof) => {
    account(prof);
    const r = await wp();
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(r.body.plan.frequency).toBe(4);
    expect(new Set(r.body.plan.workouts.map((w) => w.day))).toEqual(new Set([1, 2, 3, 4]));
    const text = JSON.stringify(r.body.plan);
    expect(text).not.toMatch(/peanut|shake/i);
    expect(lexiconFlags(text)).toEqual([]);
  });
  it('no filters: the AI is still asked', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { planName: 'p', workouts: [{ day: 1, name: 'Squat' }] } });
    const r = await wp();
    expect(aiClient.chatJson).toHaveBeenCalledTimes(1);
    expect(r.body.plan.planName).toBe('p');
  });
});
function lexiconFlags(text) { return [...require('./lib/food-lexicon-127a').scan(text).flags]; }

describe('r5 S3: checked meals never warn for a filter they fit', () => {
  it('every checked template passes the warnings for every filter it fits', () => {
    const bad = [];
    for (const d of engine.DIET_FILTERS) for (const slot of engine.SLOTS) for (const t of engine.swapTemplatesFor(slot, [d])) {
      const saved = JSON.stringify({ name: t.name, foods: (t.items || []).map(([name, grams]) => ({ name, grams })) });
      for (const text of [t.name, saved]) { const g = dietGuard.brokenGroups(text, [d]); if (g.length) bad.push(`${d} | ${t.name} | ${g}`); }
    }
    expect(bad).toEqual([]);
  });
  it("'Tofu scramble' isn't eggs and a soy milk smoothie isn't dairy, but real eggs and milk still warn", () => {
    expect(dietGuard.brokenGroups('Tofu scramble on wholegrain toast', ['egg free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Soy milk, tofu and banana smoothie', ['vegan', 'gluten free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Scrambled eggs and tofu', ['egg free'])).toEqual(['eggs']);
    expect(dietGuard.brokenGroups('Banana smoothie', ['dairy free'])).toEqual(['dairy']);
    expect(dietGuard.brokenGroups('Soy milk smoothie with yoghurt', ['dairy free'])).toEqual(['dairy']);
  });
});

describe('r5 S4: surviving mutants', () => {
  it("'flour' is a carrier word: almond flour is nuts, not gluten", () => {
    expect(dietGuard.brokenGroups('almond flour pancakes base', ['gluten free']).includes('gluten')).toBe(true); // pancakes are gluten
    expect(dietGuard.brokenGroups('almond flour', ['gluten free'])).toEqual([]);
    expect(dietGuard.brokenGroups('almond flour', ['nut free'])).toEqual(['nuts']);
  });
  it('weekly review: an unreadable profile fails closed (no AI, no credit)', async () => {
    account(new Error('db down'));
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });
});

describe('r5 S5 + L', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, 'public/app.html'), 'utf8');
  it('saved-plan cards are one column at 480px and below', () => {
    expect(html).toMatch(/@media\(max-width:480px\)\{\.plan-grid\{grid-template-columns:1fr\}\}/);
  });
  it("typed plans with no goal or calories don't show 'Goal · - cal/day'", () => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('escapeHtml', `${html.match(/function planMetaHtml[\s\S]*?\n\}/)[0]}; return planMetaHtml;`)((x) => String(x));
    expect(fn({}, 'Goal')).toBe('');
    expect(fn({ total_calories: 0 }, 'Goal')).toBe('');
    expect(fn({ goal_type: 'weight_loss', total_calories: 1800 }, 'Weight loss')).toBe('<div class="plan-card-meta">Weight loss · 1800 cal/day</div>');
    expect(fn({ total_calories: 1800 }, 'Goal')).toBe('<div class="plan-card-meta">1800 cal/day</div>');
    expect(html).not.toContain("escapeHtml(p.total_calories||' - ')} cal/day");
  });
  it.each([['Big M', 'dairy free', 'dairy'], ['Yoplait', 'dairy free', 'dairy'], ['Shapes', 'gluten free', 'gluten'], ["Domino's", 'gluten free', 'gluten'], ['🥜 handful', 'nut free', 'nuts']])(
    'typed %s warns for %s', (meal, f, g) => {
      expect(dietGuard.brokenGroups(meal, [f])).toContain(g);
    });
  it('the fixed weekly review has no score and the UI hides a missing one', async () => {
    account({ dietaryPreferences: ['gluten free'], allergies: [] });
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.body.review.score).toBeNull();
    expect(html).toContain('${hasScore ? `<div style="width:54px');
  });
  it('with no AI provider, filtered users still get the fixed weekly review and workout plan (no 503)', async () => {
    aiClient.hasProvider.mockReturnValue(false);
    try {
      account({ dietaryPreferences: ['gluten free'], allergies: [] });
      const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('fixed');
      const w = await request(app).post('/api/ai/workout-plan').set('Authorization', token).send({});
      expect(w.status).toBe(200);
      account({ dietaryPreferences: [], allergies: [] });
      expect((await request(app).get('/api/ai/weekly-review').set('Authorization', token)).status).toBe(503);
    } finally { aiClient.hasProvider.mockReturnValue(true); }
  });
});
