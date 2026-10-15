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
// Do not requireActual storage.js: that builds a real pg.Pool (max 20) and never closes it.
jest.mock('./server/storage.js', () => {
  const noop = () => jest.fn(async () => undefined);
  return {
    getUserById: jest.fn(async () => ({ id: 'u1', email: 'me@example.com', name: 'Pat', subscriptionTier: 'premium', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(),
    getMealLogsForPeriod: jest.fn(async () => logs),
    getRecentWorkouts: jest.fn(async () => [{ workoutType: 'squats', date: new Date() }]),
    getProgressHistory: jest.fn(async () => []),
    createOrUpdateProfile: jest.fn(),
    effectiveTier: (user) => (user && user.subscriptionTier ? String(user.subscriptionTier) : 'free'),
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
  aiUsage.refundAiCall.mockClear();
  storage.getUserById.mockResolvedValue({ id: 'u1', email: 'me@example.com', name: 'Pat', subscriptionTier: 'premium', settings: { aiDataConsent: true } });
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
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
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
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.objectContaining({ allowed: true }), { userId: 'u-filtered', feature: 'chat' });
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
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.anything(), { userId: 'u-filtered', feature: 'weekly_review' });
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
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
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

describe('non-Latin replies are unverified', () => {
  const scripts = [
    ['Chinese', '请吃花生酱、牛奶、鸡蛋和面包', '花生酱'],
    ['Japanese', 'ピーナッツとミルクと卵とパン', 'ピーナッツ'],
    ['Korean', '땅콩버터와 우유와 계란과 빵', '땅콩'],
    ['Hindi', 'मूंगफली और दूध और अंडा और ब्रेड', 'मूंगफली'],
    ['Arabic', 'زبدة الفول السوداني وحليب وبيض وخبز', 'سوداني'],
    ['Thai', 'ถั่วลิสงและนมและไข่และขนมปัง', 'ถั่วลิสง'],
    ['Hebrew', 'בוטנים וחלב וביצה ולחם', 'בוטנים'],
  ];
  const filters = ['nut free', 'dairy free', 'egg free', 'gluten free', 'soy free'];

  it.each(scripts)('%s names an allergen and is not verified', (name, text) => {
    for (const f of filters) {
      expect(dietGuard.replyIssues(text, [f])).toContain('unverified:nonlatin');
      expect(dietGuard.replyVerified(text, [f])).toBe(false);
    }
    expect(dietGuard.brokenGroups(text, ['nut free'])).toContain('nuts');
    expect(dietGuard.brokenGroups(text, ['dairy free'])).toContain('dairy');
    expect(dietGuard.brokenGroups(text, ['egg free'])).toContain('eggs');
    expect(dietGuard.brokenGroups(text, ['gluten free'])).toContain('gluten');
  });

  it.each(scripts)('a %s reply is not served', async (_name, text, needle) => {
    say(text, text);
    const r = await chat('Snack idea?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toContain(needle);
    expect(r.body.provider).toBeNull();
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
  });

  it('mixed Latin and Chinese is unverified and is not served', async () => {
    const mixed = 'chicken and 花生酱';
    expect(dietGuard.replyVerified(mixed, ['nut free'])).toBe(false);
    expect(dietGuard.replyIssues(mixed, ['nut free'])).toEqual(expect.arrayContaining(['unverified:nonlatin', 'excluded:nuts']));
    say(mixed, mixed);
    const r = await chat('Dinner idea?');
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toContain('花生');
    expect(r.body.reply).not.toContain(mixed);
  });

  it('accented Latin still verifies, and a Cyrillic lookalike does not', () => {
    const accented = 'At 2,100 kcal and 150 g protein, havé chicken, rice and broccoli after training.';
    expect(dietGuard.replyVerified(accented, ['dairy free'])).toBe(true);
    const lookalike = 'Аt 2,100 kcal and 150 g protein, have chicken, rice and broccoli after training.';
    expect(dietGuard.replyIssues(lookalike, ['dairy free'])).toContain('unverified:nonlatin');
  });
});

describe('a credit is only kept for a verified AI reply', () => {
  it('a provider throw is a 200 builder answer and the credit is returned', async () => {
    aiClient.chat.mockImplementation(async () => { throw new Error('provider rejected'); });
    const r = await chat('Quick high-protein snack for the arvo?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.provider).toBeNull();
    expect(r.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.checkAndConsume).toHaveBeenCalledTimes(1);
  });

  it('a filtered free user at the monthly cap gets the builder and is not charged', async () => {
    storage.getUserById.mockResolvedValue({ id: 'u1', email: 'me@example.com', name: 'Pat', subscriptionTier: 'free', settings: { aiDataConsent: true } });
    aiUsage.checkAndConsume.mockResolvedValue({ allowed: false, limit: 10, used: 10, upgrade: true });
    const r = await chat('What is a good dinner tonight?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.upgrade).toBe(true);
    expect(r.body.reply).toMatch(/You asked: What is a good dinner tonight\?/);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
  });

  it('a filtered weekly review at the cap is the builder and is not charged', async () => {
    logs = [0, 1, 2].map((n) => ({ date: new Date(Date.now() - n * 86400000), mealType: 'lunch', foodName: 'Chicken and rice', calories: 500, protein: 40 }));
    aiUsage.checkAndConsume.mockResolvedValue({ allowed: false, limit: 10, used: 10, upgrade: true });
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(r.body.review.score).toBeGreaterThanOrEqual(4);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
  });
});

describe('the retry shares one time budget', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('the second call gets only the time that is left', async () => {
    let t = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    let n = 0;
    aiClient.chat.mockImplementation(async () => {
      n += 1;
      if (n === 1) t += 4000;
      return { ok: true, text: n === 1 ? 'Have a Milo.' : SAFE, provider: 'mock', model: 'm' };
    });
    const r = await chat('Snack idea?');
    expect(r.body.source).toBe('ai');
    expect(aiClient.chat).toHaveBeenCalledTimes(2);
    const first = aiClient.chat.mock.calls[0][0].budgetMs;
    const second = aiClient.chat.mock.calls[1][0].budgetMs;
    expect(first).toBe(12000);
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThanOrEqual(2500);
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
  });

  it('skips the retry when the first call uses the budget', async () => {
    let t = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    aiClient.chat.mockImplementation(async () => {
      t += 11000;
      return { ok: true, text: 'Have a Milo.', provider: 'mock', model: 'm' };
    });
    const r = await chat('Snack idea?');
    expect(aiClient.chat).toHaveBeenCalledTimes(1);
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toMatch(/Milo/i);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
  });
});

describe('fallbacks answer the question with the saved numbers', () => {
  it('quotes a safe question and does not repeat a banned food', async () => {
    say('Have a Milo.', 'Have a Chobani.');
    const quoted = await chat('What is a good dinner tonight?');
    expect(quoted.body.reply.startsWith(dietGuard.SAFE_NOTICE)).toBe(true);
    expect(quoted.body.reply).toMatch(/You asked: What is a good dinner tonight\?/);
    expect(quoted.body.reply).toMatch(/[Dd]inner/);
    const banned = await chat('Can I have Milo?');
    expect(banned.body.reply).toMatch(/That does not fit your filters/);
    expect(banned.body.reply).not.toMatch(/Milo/i);
  });

  it('an insight fallback cites the saved 2,150 kcal and 165 g, not the request defaults', async () => {
    profile({ targetCalories: 2150, targetProtein: 165 });
    const r = await request(app).post('/api/ai/insight').set('Authorization', token)
      .send({ todayCalories: 400, todayProtein: 20, targetCalories: 2000, targetProtein: 150 });
    expect(r.status).toBe(200);
    expect(r.body.provider).toBeNull();
    expect(r.body.insight).toMatch(/2,150 kcal and 165 g protein/);
    expect(r.body.insight).not.toMatch(/2,000/);
    expect(aiClient.chat.mock.calls[0][0].messages[0].content).toMatch(/2150/);
    expect(aiClient.chat.mock.calls[0][0].messages[0].content).not.toMatch(/\b2000\b/);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.anything(), { userId: 'u-filtered', feature: 'insight' });
  });
});

describe('lexicon gaps and natural prose', () => {
  it('bars, granola, and generic protein fail closed, and named plant proteins do not', () => {
    expect(dietGuard.brokenGroups('Musashi bar', ['nut free'])).toContain('nuts');
    expect(dietGuard.brokenGroups('Mars protein bar', ['nut free'])).toContain('nuts');
    expect(dietGuard.brokenGroups('granola', ['nut free'])).toContain('nuts');
    expect(dietGuard.brokenGroups('protein powder', ['dairy free'])).toContain('dairy');
    expect(dietGuard.brokenGroups('protein shake', ['dairy free'])).toContain('dairy');
    expect(dietGuard.brokenGroups('plant protein shake', ['soy free'])).toContain('soy');
    expect(dietGuard.brokenGroups('pea protein powder', ['dairy free'])).toEqual([]);
    expect(dietGuard.brokenGroups('pea protein powder', ['soy free'])).toEqual([]);
    expect(dietGuard.brokenGroups('rice protein shake', ['soy free'])).toEqual([]);
    expect(dietGuard.brokenGroups('soy protein shake', ['soy free'])).toContain('soy');
    expect(dietGuard.brokenGroups('have some dairy', ['dairy free'])).toContain('dairy');
    expect(dietGuard.replyIssues('Try zymbar with rice.', ['dairy free'])).toContain('unverified:zymbar');
  });

  it('nine realistic safe answers verify, and an unknown food still does not', () => {
    const good = [
      'At 2,100 kcal and 150 g protein, you are a little short today. Chicken, rice and broccoli at dinner gets you most of the way there without a huge portion.',
      'You have room for about 700 kcal and 40 g protein tonight. A beef and sweet potato bowl from your plan fits, and it keeps dairy out.',
      'Training went well. Eat within an hour: chicken and rice, then fruit if you are still hungry. That sits inside 2,100 kcal and 150 g protein.',
      'Skip the shake. A tin of tuna on rice is the simpler snack and it fits a dairy free day at 2,100 kcal and 150 g protein.',
      'Your logging streak is useful. Today is light on protein, so make lunch the bigger meal: beef and rice, not a sweet snack.',
      'For breakfast, try rice cakes with banana. At 2,100 kcal that is a small start, so make lunch count.',
      'You asked about recovery. Sleep and the next meal matter more than a product. Chicken and rice after training, at 2,100 kcal and 150 g protein.',
      'A good week looks like three logged days and one session you can repeat. Keep dinner simple: beef, potato, vegetables.',
      'If dinner is the gap, cook once and eat it twice. Chicken, rice and broccoli covers the protein without adding much else.',
    ];
    for (const text of good) expect(dietGuard.replyVerified(text, ['dairy free'])).toBe(true);
    expect(dietGuard.replyVerified('Try zymbar with rice.', ['dairy free'])).toBe(false);
    expect(dietGuard.replyVerified('Have a Musashi bar.', ['nut free'])).toBe(false);
    expect(dietGuard.replyVerified('A plant protein shake.', ['soy free'])).toBe(false);
    expect(dietGuard.replyVerified('At 2,100 kcal and 150 g protein, have pea protein powder.', ['dairy free'])).toBe(true);
  });
});

describe('a non-string or empty provider reply is a fallback and the credit is returned', () => {
  const days = () => [0, 1, 2].map((n) => ({ date: new Date(Date.now() - n * 86400000), mealType: 'lunch', foodName: 'Chicken and rice', calories: 600, protein: 40 }));
  const shapes = [
    ['number', 21500],
    ['array', ['At 2,100 kcal and 150 g protein, have chicken and rice.']],
    ['object', { text: 'At 2,100 kcal and 150 g protein, have chicken and rice.' }],
  ];

  it.each(shapes)('chat treats a %s reply as unverified and refunds', async (_name, text) => {
    aiClient.chat.mockResolvedValue({ ok: true, text, provider: 'mock', model: 'm' });
    const r = await chat('Snack idea?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.provider).toBeNull();
    expect(r.body.reply).toMatch(/2,100 kcal/);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.anything(), { userId: 'u-filtered', feature: 'chat' });
  });

  it.each(shapes)('insight treats a %s reply as unverified and refunds', async (_name, text) => {
    aiClient.chat.mockResolvedValue({ ok: true, text, provider: 'mock', model: 'm' });
    const r = await request(app).post('/api/ai/insight').set('Authorization', token)
      .send({ todayCalories: 400, todayProtein: 20, targetCalories: 2000, targetProtein: 150 });
    expect(r.status).toBe(200);
    expect(r.body.provider).toBeNull();
    expect(r.body.insight).toMatch(/2,100 kcal/);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.anything(), { userId: 'u-filtered', feature: 'insight' });
  });

  it.each([
    ['number', 21500],
    ['array', ['You logged 3 days at 2,100 kcal and 150 g protein with chicken and rice.']],
    ['object', { score: 21500 }],
  ])('weekly treats a %s reply as unverified and refunds', async (_name, data) => {
    logs = days();
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'mock', data });
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(r.body.provider).toBeNull();
    expect(r.body.review.score).toBeGreaterThanOrEqual(4);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith(expect.anything(), { userId: 'u-filtered', feature: 'weekly_review' });
  });
});

describe('questions Coach cannot read still get the day plan', () => {
  it.each([
    'What should I eat post-leg-day?',
    'What should I eat while bulking?',
    '¿Qué puedo comer hoy?',
    '今天吃什么',
  ])('"%s" says it cannot read the question and offers the day', async (q) => {
    say('Have a Milo.', 'Have a Chobani.');
    const r = await chat(q);
    expect(r.status).toBe(200);
    expect(r.body.reply).toMatch(/I can't read that question/);
    expect(r.body.reply).not.toMatch(/That does not fit your filters/);
    expect(r.body.reply).toMatch(/Breakfast:/);
    expect(r.body.reply).toMatch(/Lunch:/);
    expect(r.body.reply).toMatch(/Dinner:/);
    expect(dietGuard.textBreaksFilters(r.body.reply.replace(dietGuard.SAFE_NOTICE, ''), ['dairy free'])).toBe(false);
  });
});

describe('a profile that cannot be read stays filter-safe', () => {
  it('a food question gets the notice and a day that keeps dairy, gluten and egg out', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    const r = await chat('What should I eat for dinner?');
    expect(r.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(r.body.reply).toContain(dietGuard.UNREADABLE_NOTICE);
    expect(r.body.reply).toMatch(/Breakfast:/);
    expect(r.body.reply).toMatch(/Dinner:/);
    for (const f of ['dairy free', 'gluten free', 'egg free']) {
      expect(dietGuard.textBreaksFilters(r.body.reply, [f])).toBe(false);
    }
  });

  it('insight does not call the model and the tip keeps dairy, gluten and egg out', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    const r = await request(app).post('/api/ai/insight').set('Authorization', token)
      .send({ todayCalories: 400, todayProtein: 20 });
    expect(r.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    expect(r.body.provider).toBeNull();
    expect(r.body.insight).toContain(dietGuard.SAFE_TIP);
    expect(r.body.insight).not.toContain(dietGuard.UNREADABLE_NOTICE);
    for (const f of ['dairy free', 'gluten free', 'egg free']) {
      expect(dietGuard.textBreaksFilters(r.body.insight, [f])).toBe(false);
    }
  });

  it('insight expands an unreadable profile to every allergen-free filter and omits the chat notice', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    const r = await request(app).post('/api/ai/insight').set('Authorization', token)
      .send({ todayCalories: 400, todayProtein: 20 });
    expect(r.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(r.body.insight).not.toContain(dietGuard.UNREADABLE_NOTICE);
    expect(r.body.insight).not.toContain(dietGuard.COMING_SOON);
    for (const f of dietGuard.ALL_FREE) {
      expect(dietGuard.textBreaksFilters(r.body.insight, [f])).toBe(false);
    }
  });

  it('weekly with three logged days does not call the model', async () => {
    storage.getProfile.mockRejectedValue(new Error('db down'));
    logs = [0, 1, 2].map((n) => ({ date: new Date(Date.now() - n * 86400000), mealType: 'lunch', foodName: 'Chicken and rice', calories: 600, protein: 40 }));
    const r = await request(app).get('/api/ai/weekly-review').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('fixed');
    expect(r.body.review.score).toBeNull();
    expect(JSON.stringify(r.body.review)).not.toContain(dietGuard.UNREADABLE_NOTICE);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
    for (const f of ['dairy free', 'gluten free', 'egg free']) {
      expect(dietGuard.textBreaksFilters(JSON.stringify(r.body.review), [f])).toBe(false);
    }
  });
});

describe('cite, prose, prefix and prompt mutants', () => {
  it('21500 is not a cite of 2,150, and a real 2150 token is', async () => {
    profile({ targetCalories: 2150, targetProtein: 165 });
    say('21500');
    const glued = await chat('Snack idea?');
    expect(glued.body.source).toBe('ai');
    expect(glued.body.reply.startsWith('At 2,150 kcal and 165 g protein.')).toBe(true);
    expect(glued.body.reply).toContain('21500');
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
    say('Have chicken and rice at 2,150 kcal.');
    const formatted = await chat('Snack idea?');
    expect(formatted.body.reply).toBe('Have chicken and rice at 2,150 kcal.');
    say('Have chicken and rice at 2150 kcal.');
    const raw = await chat('Snack idea?');
    expect(raw.body.reply).toBe('Have chicken and rice at 2150 kcal.');
    say('Have chicken and rice at 2,1500 kcal.');
    const longer = await chat('Snack idea?');
    expect(longer.body.reply.startsWith('At 2,150 kcal and 165 g protein.')).toBe(true);
  });

  it('pain is not coaching prose, so a reply that says it is unverified', () => {
    expect(dietGuard.replyIssues('Have chicken and rice. Stop if you feel pain.', ['gluten free'])).toContain('unverified:pain');
    expect(dietGuard.replyVerified('Have chicken and rice. Stop if you feel pain.', ['dairy free'])).toBe(false);
  });

  it('typed prefixes match kiwifruit and kiwi, and stop at the length boundary', () => {
    expect(dietGuard.replyIssues('Have some kiwi with rice.', dietGuard.combineFilters({ allergies: ['kiwifruit'] }))).toContain('allergy:kiwifruit');
    expect(dietGuard.replyIssues('Have some kiwifruit with rice.', dietGuard.combineFilters({ allergies: ['kiwi'] }))).toContain('allergy:kiwi');
    expect(dietGuard.replyIssues('Have strawberry with rice.', dietGuard.combineFilters({ allergies: ['berry'] }))).toContain('allergy:berry');
    expect(dietGuard.replyIssues('Have pea with rice.', dietGuard.combineFilters({ allergies: ['pea'] }))).toContain('allergy:pea');
    expect(dietGuard.replyIssues('Have peanut with rice.', dietGuard.combineFilters({ allergies: ['pea'] }))).not.toContain('allergy:pea');
    expect(dietGuard.replyIssues('Have kiw with rice.', dietGuard.combineFilters({ allergies: ['kiwifruit'] }))).not.toContain('allergy:kiwifruit');
  });

  it('a kiwifruit allergy rejects a reply that only says kiwi', async () => {
    profile({ dietaryPreferences: [], allergies: ['kiwifruit'] });
    say('Have some kiwi with rice.', 'Kiwi again with chicken.');
    const r = await chat('Snack idea?');
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).not.toMatch(/kiwi/i);
    expect(aiUsage.refundAiCall).toHaveBeenCalledTimes(1);
  });

  it('recent logs keep a safe meal and drop one the filters cannot verify', async () => {
    profile({ dietaryPreferences: [], allergies: ['milk'] });
    logs = [
      { mealType: 'snack', foodName: 'oat milk', calories: 120, protein: 4, date: new Date() },
      { mealType: 'lunch', foodName: 'Chicken and rice', calories: 640, protein: 48, date: new Date() },
    ];
    say(SAFE);
    const r = await chat('What should I eat after training?');
    expect(r.status).toBe(200);
    const system = aiClient.chat.mock.calls[0][0].system;
    expect(system).toContain('Chicken and rice');
    expect(system).not.toMatch(/oat milk/i);
  });

  it('with no filters, an unrecognised recent log is still told to Coach', async () => {
    profile({ dietaryPreferences: [], allergies: [] });
    logs = [{ mealType: 'snack', foodName: 'zymbar', calories: 100, protein: 5, date: new Date() }];
    say('Have chicken and rice.');
    const r = await chat('What should I eat after training?');
    expect(r.status).toBe(200);
    expect(aiClient.chat.mock.calls[0][0].system).toContain('zymbar');
  });

  it('a filtered user with no provider gets the builder and is not charged', async () => {
    aiClient.hasProvider.mockReturnValue(false);
    const r = await chat('What is a good dinner tonight?');
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('builder');
    expect(r.body.reply).toMatch(/You asked: What is a good dinner tonight\?/);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });

  it('a user with no filters and no provider gets 503 before any credit', async () => {
    profile({ dietaryPreferences: [], allergies: [] });
    aiClient.hasProvider.mockReturnValue(false);
    const r = await chat('What is a good dinner tonight?');
    expect(r.status).toBe(503);
    expect(aiClient.chat).not.toHaveBeenCalled();
    expect(aiUsage.checkAndConsume).not.toHaveBeenCalled();
  });
});
