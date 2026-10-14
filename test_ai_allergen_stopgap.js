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
  it.each(['How many sets of squats?', 'How do I reset my password?', 'How much sleep do I need?'])('%s -> AI (non-food allow-list)', async (q) => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    aiClient.chat.mockResolvedValueOnce({ ok: true, text: 'Foam roll your quads, then wrap up your session. Go nuts on the stairs.', provider: 'mock' });
    const r = await chat(q, { intent: 'workout' });
    expect(aiClient.chat).toHaveBeenCalled();
    expect(r.body.reply).toMatch(/^Foam roll/); // S2: workout copy isn't replaced
  });
  it('nutrition intent is always food, even for a training-sounding question', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await chat('How many sets of squats?', { intent: 'nutrition' });
    expect(r.body.source).toBe('builder');
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it('the guarded system prompt tells the AI not to suggest foods', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    aiClient.chat.mockResolvedValueOnce({ ok: true, text: 'Three sets of eight.', provider: 'mock' });
    await chat('How many sets of squats?', { intent: 'workout' });
    expect(aiClient.chat.mock.calls[0][0].system).toMatch(/Do not suggest meals, recipes or foods/);
  });
  it('an unreadable profile fails closed in Coach', async () => {
    account(new Error('db down'));
    // A workout question still reaches the AI with the no-foods rule, and its reply is screened.
    const r = await chat('How many sets of squats?', { intent: 'workout' });
    expect(r.status).toBe(200);
    expect(aiClient.chat.mock.calls[0][0].system).toMatch(/Do not suggest meals/);
    // A food question never reaches the AI.
    aiClient.chat.mockClear();
    const f = await chat('dinner?');
    expect(f.body.source).toBe('builder');
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
  it('peanut allergy: unsafe review lines are dropped, safe ones kept', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { headline: 'Peanut butter week!', wins: ['Logged 5 days', 'Ate satay twice'], focus: ['Add a peanut butter snack for protein'], score: 7 } });
    const r = await review();
    expect(JSON.stringify(r.body.review)).not.toMatch(/peanut|satay/i);
    expect(r.body.review.wins).toEqual(['Logged 5 days']);
    expect(r.body.review.focus).toEqual([dietGuard.SAFE_TIP]);
    expect(aiClient.chatJson.mock.calls[0][0].system).toMatch(/never name a food/);
  });
  it('no filters: review unchanged', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const data = { headline: 'h', wins: ['Ate satay'], focus: ['f'], score: 5 };
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data });
    expect((await review()).body.review).toEqual(data);
  });
  it('insight: filtered users get the fixed safe tip, no AI', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    const r = await request(app).post('/api/ai/insight').set('Authorization', token).send({ todayCalories: 900, todayProtein: 20 });
    expect(r.body.insight).toBe(dietGuard.SAFE_TIP);
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
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
  it.each([
    'Grab a Milo after training.', 'Neck an Up&Go on the way.', 'Have a Musashi bar.', 'Try a Sustagen shake.', 'Grab a Chobani.', 'Have a Yakult.',
    'Snack on Coco Pops.', 'Grab some KFC.', "Have Hungry Jack's.", 'Eat a Clif bar.', 'Have a Mars protein bar.', 'Grab a Gaytime.', 'Have a Paddle Pop.',
    'Eat a Cornetto.', 'Have a Freddo.', 'Have a Bounty.', 'Grab a vanilla slice.', 'Eat arancini.', 'Have spanakopita.', 'Eat pierogi.', 'Try mochi.',
    'Have char kway teow.', 'Try banh xeo.', 'Snack on PB toast.', 'Grab a Zorblex bar.', 'Eat some frobnitz after.',
  ])('reply "%s" is replaced for a gluten-free + dairy-free + nut-free user', async (text) => {
    account({ dietaryPreferences: ['gluten free', 'dairy free'], allergies: ['peanut'] });
    aiClient.chat.mockResolvedValueOnce({ ok: true, text, provider: 'mock' });
    const r = await chat('How many sets of squats?', { intent: 'workout' });
    expect(aiClient.chat).toHaveBeenCalled();
    expect(r.body.source).toBe('builder');
  });
  it.each([
    'Three sets of eight, then have a rest day.', 'Drink plenty of water. Sleep 8 hours.', 'Try Romanian deadlifts with a 3 second lower.',
    'Foam roll your quads, then wrap up your session. Go nuts on the stairs.', 'Bun up your hair and check the pie chart.', 'Use egg-timer intervals.',
    'Fish for compliments after a stomach bug.', 'Keep your back flat before each Bulgarian split squat.',
  ])('workout-only reply "%s" is served as written', async (text) => {
    account({ dietaryPreferences: ['gluten free', 'dairy free'], allergies: ['peanut', 'fish', 'egg'] });
    aiClient.chat.mockResolvedValueOnce({ ok: true, text, provider: 'mock' });
    const r = await chat('How many sets of squats?', { intent: 'workout' });
    expect(r.body.reply).toBe(text);
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
  it('unreadable profile: an AI reply naming any allergen is replaced', async () => {
    account(new Error('db down'));
    aiClient.chat.mockResolvedValueOnce({ ok: true, text: 'Three sets, then grab some satay.', provider: 'mock' });
    const r = await chat('How many sets of squats?', { intent: 'workout' });
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toMatch(/satay/);
  });
  it('weekly review: extra fields are cleaned at any depth', async () => {
    account({ dietaryPreferences: [], allergies: ['peanut'] });
    aiClient.chatJson.mockResolvedValueOnce({ ok: true, provider: 'mock', data: { headline: 'h', wins: ['w'], focus: ['f'], score: 6, extra: { tip: 'Try satay', deep: [{ x: 'peanut butter' }, 'Sleep more'] }, note: 'Grab a Snickers' } });
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(JSON.stringify(r.body.review)).not.toMatch(/satay|peanut|Snickers/i);
    expect(r.body.review.extra.deep).toContain('Sleep more');
  });
  it('insight: a profile read error gives the safe tip', async () => {
    account(new Error('db down'));
    const r = await request(app).post('/api/ai/insight').set('Authorization', token).send({ todayCalories: 900 });
    expect(r.body.insight).toBe(dietGuard.SAFE_TIP);
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
    expect(html).toContain("warnEl.innerHTML = allergenBadgeHtml(p.allergenWarnings);");
  });
});
