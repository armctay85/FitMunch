'use strict';

/**
 * Meal plan: every day within ±5% of the calorie target, the AI output is
 * checked and corrected, a slow AI never turns into a 500 or a timeout, and
 * the shopping list combines quantities across the week.
 */

jest.mock('./lib/ai-client', () => ({
  hasProvider: jest.fn(() => true),
  providerName: jest.fn(() => 'xai'),
  chatJson: jest.fn(),
}));
jest.mock('./lib/ai-usage', () => ({
  refundSmokeOnFailure: () => {},
  refundAiCall: jest.fn(async () => true),
  checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })),
}));
jest.mock('./server/storage.js', () => ({
  getUserById: jest.fn(async () => ({ id: 'u1', settings: {} })),
  effectiveTier: () => 'free',
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const engine = require('./lib/meal-plan-engine');
const aiClient = require('./lib/ai-client');

const within5 = (v, t) => Math.abs(v - t) <= t * 0.05;
const sumMeals = (day) => engine.SLOTS.reduce((s, k) => s + (day.meals[k] ? day.meals[k].calories : 0), 0);

function expectEveryDayOnTarget(plan, calories, days = 7) {
  expect(plan.days).toHaveLength(days);
  for (const day of plan.days) {
    expect(day.dailyTotals.calories).toBe(sumMeals(day));
    expect(within5(day.dailyTotals.calories, calories)).toBe(true);
  }
  expect(within5(plan.avgDailyCalories, calories)).toBe(true);
  expect(engine.everyDayOnTarget(plan, calories)).toBe(true);
}

function aiMeal(name, calories, ingredients = [{ item: 'Chicken breast', qty: '150g' }, { item: 'Eggs', qty: '2 large' }]) {
  return { name, ingredients, calories, protein: Math.round(calories / 16), carbs: Math.round(calories / 9), fat: Math.round(calories / 40), prepMins: 10 };
}
function aiDay(day, perMeal) {
  return { day, meals: { breakfast: aiMeal('B', perMeal[0]), lunch: aiMeal('L', perMeal[1]), dinner: aiMeal('D', perMeal[2]), snack: aiMeal('S', perMeal[3]) }, dailyTotals: { calories: 99999 } };
}
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const aiPlan = (perMeal, n = 7) => ({ planName: 'AI plan', summary: 's', days: NAMES.slice(0, n).map((d) => aiDay(d, perMeal)), weeklyBudgetEst: 110, avgDailyCalories: 2100 });

describe('food-DB plan builder', () => {
  for (const calories of [1200, 1500, 1800, 2100, 2500, 3000, 3600, 4500]) {
    for (const dietary of [[], ['vegetarian'], ['gluten free'], ['dairy free', 'nut free'], ['vegetarian', 'gluten free', 'dairy free', 'nut free']]) {
      it(`7 days at ${calories} kcal (${dietary.join(', ') || 'no filters'}): every day within ±5%`, () => {
        expectEveryDayOnTarget(engine.buildPlan({ calories, protein: 150, days: 7, dietary }), calories);
      });
    }
  }

  it('honours dietary filters', () => {
    const plan = engine.buildPlan({ calories: 2100, protein: 120, days: 7, dietary: ['vegetarian', 'nut free'] });
    const text = JSON.stringify(plan).toLowerCase();
    for (const banned of ['chicken', 'beef', 'salmon', 'tuna', 'barramundi', 'peanut', 'almond']) expect(text).not.toContain(banned);
  });

  it('gives 7 different days a variety of meals', () => {
    const plan = engine.buildPlan({ calories: 2100, protein: 100, days: 7 });
    expect(new Set(plan.days.map((d) => d.meals.dinner.name)).size).toBeGreaterThanOrEqual(5);
    expect(plan.days.map((d) => d.day)).toEqual(NAMES);
  });
});

describe('AI plan check and correction', () => {
  it('rejects the audit case: 1 day back when 7 were asked for', () => {
    const r = engine.normaliseAiPlan(aiPlan([420, 380, 520, 180], 1), { calories: 2100, days: 7, protein: 160 });
    expect(r).toEqual({ ok: false, reason: 'only_1_of_7_days' });
  });

  it('scales 1500 kcal days up to a 2100 target, re-totals them and scales the quantities', () => {
    const r = engine.normaliseAiPlan(aiPlan([420, 380, 520, 180]), { calories: 2100, days: 7, protein: 160 });
    expect(r.ok).toBe(true);
    expect(r.scaledDays).toBe(7);
    expectEveryDayOnTarget(r.plan, 2100);
    expect(r.plan.days[0].meals.breakfast.ingredients[0].qty).toBe('210g'); // 150g x 1.4
    expect(r.plan.days[0].meals.breakfast.ingredients[1].qty).toBe('3 large'); // 2 x 1.4 -> 3
    expect(r.plan.avgDailyCalories).not.toBe(99999);
  });

  it('ignores the AI\'s own dailyTotals and leaves on-target days alone', () => {
    const r = engine.normaliseAiPlan(aiPlan([500, 550, 700, 300]), { calories: 2100, days: 7, protein: 160 });
    expect(r.ok).toBe(true);
    expect(r.scaledDays).toBe(0);
    expect(r.plan.days[0].dailyTotals.calories).toBe(2050);
  });

  it('rejects a day too far off to scale, and days missing meals', () => {
    expect(engine.normaliseAiPlan(aiPlan([200, 200, 300, 100]), { calories: 2100, days: 7 }).ok).toBe(false);
    const broken = aiPlan([500, 550, 700, 300]);
    delete broken.days[3].meals.lunch;
    delete broken.days[3].meals.dinner;
    expect(engine.normaliseAiPlan(broken, { calories: 2100, days: 7 })).toEqual({ ok: false, reason: 'day_4_missing_meals' });
  });
});

describe('generatePlan: AI, one retry, then the builder, inside a time budget', () => {
  const input = { calories: 2100, protein: 160, days: 7, dietary: [] };

  it('uses a valid AI plan', async () => {
    const r = await engine.generatePlan(input, { callAi: async () => ({ ok: true, provider: 'xai', data: aiPlan([500, 550, 700, 300]) }) });
    expect(r.source).toBe('ai');
    expectEveryDayOnTarget(r.plan, 2100);
  });

  it('retries once after a short plan, then uses the retry', async () => {
    const callAi = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: aiPlan([420, 380, 520, 180], 1) })
      .mockResolvedValueOnce({ ok: true, provider: 'xai', data: aiPlan([420, 380, 520, 180]) });
    const r = await engine.generatePlan(input, { callAi });
    expect(callAi).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('ai_retry');
    expect(r.attempts).toEqual(['only_1_of_7_days']);
    expectEveryDayOnTarget(r.plan, 2100);
  });

  it('falls back to the builder after two bad AI answers', async () => {
    const callAi = jest.fn().mockResolvedValue({ ok: true, data: aiPlan([100, 100, 100, 100], 7) });
    const r = await engine.generatePlan(input, { callAi });
    expect(callAi).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('builder');
    expectEveryDayOnTarget(r.plan, 2100);
  });

  it('timeout path: a hung AI call is cut at the attempt limit, not retried, and the builder answers inside the budget', async () => {
    const callAi = jest.fn(() => new Promise(() => {}));
    const t0 = Date.now();
    const r = await engine.generatePlan(input, { callAi, budgetMs: 400, attemptMs: 150, minRetryMs: 100 });
    expect(Date.now() - t0).toBeLessThan(400);
    expect(callAi).toHaveBeenCalledTimes(1);
    expect(r.attempts).toEqual(['timeout']);
    expect(r.source).toBe('builder');
    expectEveryDayOnTarget(r.plan, 2100);
  });

  it('a thrown AI error goes to the retry, then the builder', async () => {
    const callAi = jest.fn().mockRejectedValue(new Error('socket hang up'));
    const r = await engine.generatePlan(input, { callAi });
    expect(callAi).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('builder');
  });
});

describe('POST /api/meal-plan/generate', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', require('./meal-planner'));
  const post = (body) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${token}`).send(body);

  afterEach(() => {
    delete process.env.MEAL_PLAN_BUDGET_MS;
    delete process.env.MEAL_PLAN_ATTEMPT_MS;
    aiClient.chatJson.mockReset();
    aiClient.hasProvider.mockReturnValue(true);
  });

  it('timeout path: a hung AI gives 200 with a full 7-day plan inside the budget, never a 500', async () => {
    process.env.MEAL_PLAN_BUDGET_MS = '600';
    process.env.MEAL_PLAN_ATTEMPT_MS = '250';
    aiClient.chatJson.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await post({ goal: 'lose_weight', calories: 2100, protein: 160, days: 7 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('builder');
    expectEveryDayOnTarget(res.body.plan, 2100);
  });

  it('the audit\'s 1-day 1500 kcal AI answer never reaches the user', async () => {
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: aiPlan([420, 380, 520, 180], 1) });
    const res = await post({ calories: 2100, protein: 160, days: 7 });
    expect(res.status).toBe(200);
    expect(aiClient.chatJson).toHaveBeenCalledTimes(2);
    expect(res.body.source).toBe('builder');
    expectEveryDayOnTarget(res.body.plan, 2100);
  });

  it('a valid AI plan is returned with every day on target', async () => {
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: aiPlan([420, 380, 520, 180]) });
    const res = await post({ calories: 2100, protein: 160, days: 7 });
    expect(res.body.source).toBe('ai');
    expectEveryDayOnTarget(res.body.plan, 2100);
    const prompt = aiClient.chatJson.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Return EXACTLY 7 entries');
    expect(prompt).toContain('MUST add up to 2100 kcal');
  });

  it('with no AI configured it still returns a built plan', async () => {
    aiClient.hasProvider.mockReturnValue(false);
    const res = await post({ calories: 1800, protein: 130, days: 5 });
    expect(res.status).toBe(200);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    expectEveryDayOnTarget(res.body.plan, 1800, 5);
  });

  it('rejects silly targets with a 400', async () => {
    expect((await post({ calories: 300 })).status).toBe(400);
    expect((await post({ calories: 2000, days: 30 })).status).toBe(400);
    expect((await post({ calories: 'abc' })).status).toBe(400);
  });
});

describe('shopping list aggregation', () => {
  it('sums the same item and unit across the week, with g+kg and ml+L combined', () => {
    const plan = { days: [
      { meals: { breakfast: { ingredients: [{ item: 'Eggs', qty: '3 large' }, { item: 'Milk', qty: '250ml' }, { item: 'Rolled oats', qty: '60g' }] } } },
      { meals: { breakfast: { ingredients: [{ item: 'Egg', qty: '2 large' }, { item: 'Milk', qty: '1L' }, { item: 'Rolled oats', qty: '0.5kg' }] },
        dinner: { ingredients: [{ item: 'Tomatoes', qty: '2' }, { item: 'Tomato', qty: '1' }, { item: 'Salt', qty: 'pinch' }] } } },
    ] };
    const byName = Object.fromEntries(engine.aggregateShoppingList(plan).map((i) => [i.name, i]));
    expect(byName.Eggs.qty).toBe('5 large');
    expect(byName.Milk.qty).toBe('1.25 L');
    expect(byName['Rolled oats'].qty).toBe('560 g');
    expect(byName.Tomatoes.qty).toBe('3');
    expect(byName.Salt.qty).toBe('for 1 meal');
    expect(Object.keys(byName)).toHaveLength(5);
  });

  it('a built 7-day plan gives one line per ingredient with the week\'s total', () => {
    const plan = engine.buildPlan({ calories: 2100, protein: 150, days: 7 });
    const list = engine.aggregateShoppingList(plan);
    const names = list.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    let chickenGrams = 0;
    for (const d of plan.days) for (const s of engine.SLOTS) for (const ing of d.meals[s].ingredients) if (ing.item === 'Chicken breast') chickenGrams += parseInt(ing.qty, 10);
    expect(list.find((i) => i.name === 'Chicken breast').amounts.g).toBe(chickenGrams);
  });

  it('POST /api/meal-plan/shopping returns the combined list for a plan', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    const token = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/meal-plan', require('./meal-planner'));
    const plan = engine.buildPlan({ calories: 2100, protein: 150, days: 7 });
    const res = await request(app).post('/api/meal-plan/shopping').set('Authorization', `Bearer ${token}`).send({ plan });
    expect(res.status).toBe(200);
    expect(res.body.list.itemCount).toBe(engine.aggregateShoppingList(plan).length);
    const chicken = res.body.list.items.find((i) => i.name === 'Chicken breast');
    expect(chicken.qty).toMatch(/^\d+(\.\d+)? (g|kg)$/);
    expect(chicken.aisle).toBe('Meat & Seafood');
  });
});

describe('Elite QA #88 r1 fixes', () => {
  const aiUsage = require('./lib/ai-usage');
  const fs = require('fs');

  it('M4: a meal whose macros do not back up its calories (4P+4C+9F, ±15%) rejects the plan', () => {
    const lying = aiPlan([500, 500, 500, 500]);
    for (const d of lying.days) for (const k of engine.SLOTS) Object.assign(d.meals[k], { protein: 5, carbs: 10, fat: 2 });
    expect(engine.normaliseAiPlan(lying, { calories: 2000, days: 7 })).toEqual({ ok: false, reason: 'meal_macros_mismatch' });
    // 1800 kcal "from" 150 g chicken (about 46 g protein, 5 g fat).
    const chicken = aiPlan([450, 450, 450, 450]);
    Object.assign(chicken.days[2].meals.dinner, { calories: 1800, protein: 46, carbs: 0, fat: 5 });
    expect(engine.normaliseAiPlan(chicken, { calories: 2100, days: 7 }).reason).toBe('meal_macros_mismatch');
  });

  it('M4: a mismatched AI plan falls back through the route', async () => {
    const lying = aiPlan([500, 500, 500, 500]);
    for (const d of lying.days) for (const k of engine.SLOTS) Object.assign(d.meals[k], { protein: 5, carbs: 10, fat: 2 });
    const r = await engine.generatePlan({ calories: 2000, protein: 120, days: 7 }, { callAi: async () => ({ ok: true, data: lying }) });
    expect(r.attempts).toEqual(['meal_macros_mismatch', 'meal_macros_mismatch']);
    expect(r.source).toBe('builder');
  });

  it('S1: non-numeric or non-positive meal values reject the plan instead of dropping the meal', () => {
    for (const bad of ['500 kcal', 'abc', NaN, -5, 0, null, '']) {
      const p = aiPlan([500, 550, 700, 300]);
      p.days[1].meals.snack.calories = bad;
      const r = engine.normaliseAiPlan(p, { calories: 2050, days: 7 });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('day_2_snack_bad_calories');
    }
    const p = aiPlan([500, 550, 700, 300]);
    p.days[0].meals.lunch.protein = 'lots';
    expect(engine.normaliseAiPlan(p, { calories: 2050, days: 7 }).reason).toBe('day_1_lunch_bad_protein');
    const ok = aiPlan([500, 550, 700, 300]);
    ok.days[0].meals.lunch.calories = '550';
    expect(engine.normaliseAiPlan(ok, { calories: 2050, days: 7 }).ok).toBe(true);
  });

  it('S2: a builder plan is disclosed and the AI credit is refunded', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    const app = express();
    app.use(express.json());
    app.use('/api/meal-plan', require('./meal-planner'));
    aiClient.hasProvider.mockReturnValue(true);
    aiClient.chatJson.mockResolvedValue({ ok: false, error: 'provider_error' });
    aiUsage.refundAiCall.mockClear();
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET)}`).send({ calories: 2000, protein: 120 });
    expect(res.body.source).toBe('builder');
    expect(res.body.notice).toBe("The AI didn't answer, so this plan was built from our food database to your targets. It didn't use an AI credit.");
    expect(aiUsage.refundAiCall).toHaveBeenCalledWith({ allowed: true, remaining: 9 }, { userId: 'u1', feature: 'meal_plan' });
    expect(res.body.remaining).toBe(10);
    const html = fs.readFileSync('public/app.html', 'utf8');
    expect(html).toContain("S_activePlan.notice = r.notice || '';");
    expect(html).toContain("const noticeLines = [plan.notice, ...(plan.notes || [])].filter(Boolean);");
    aiClient.chatJson.mockReset();
  });

  it('S2: an AI plan does not refund', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/meal-plan', require('./meal-planner'));
    aiClient.chatJson.mockResolvedValue({ ok: true, provider: 'xai', data: aiPlan([500, 550, 700, 300]) });
    aiUsage.refundAiCall.mockClear();
    const res = await request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET)}`).send({ calories: 2050, protein: 120 });
    expect(res.body.source).toBe('ai');
    expect(res.body.notice).toBeUndefined();
    expect(aiUsage.refundAiCall).not.toHaveBeenCalled();
    aiClient.chatJson.mockReset();
  });

  it('S3: the builder meets a high protein target (QA cases 1500/150 and 2000/180)', () => {
    for (const [calories, protein] of [[1500, 150], [2000, 180], [2600, 200]]) {
      const plan = engine.buildPlan({ calories, protein, days: 7 });
      expectEveryDayOnTarget(plan, calories);
      expect(plan.avgDailyProtein).toBeGreaterThanOrEqual(protein * 0.9);
      expect(plan.notes).toBeUndefined();
    }
  });

  it('S3: low carb picks lower-carb meals; an unmet protein target is told to the user', () => {
    const base = engine.buildPlan({ calories: 2000, protein: 100, days: 7 });
    const low = engine.buildPlan({ calories: 2000, protein: 100, days: 7, dietary: ['low carb'] });
    const carbs = (p) => p.days.reduce((n, d) => n + d.dailyTotals.carbs, 0);
    expect(carbs(low)).toBeLessThan(carbs(base) * 0.85);
    const vegan = engine.buildPlan({ calories: 2000, protein: 150, days: 7, dietary: ['vegan'] });
    expect(vegan.notes[0]).toMatch(/^Protein averages \d+ g a day against your 150 g target\. Tofu, tempeh or legumes would close the gap\.$/);
  });

  it('S4: diet names are normalised, and vegan excludes meat, fish, dairy and eggs', () => {
    expect(engine.normaliseDiet(['Gluten-Free', 'dairy_free', ' VEGAN ', 'gluten free'])).toEqual(['gluten free', 'dairy free', 'vegan']);
    const gfdf = JSON.stringify(engine.buildPlan({ calories: 2100, protein: 120, days: 7, dietary: ['gluten-free', 'dairy-free'] })).toLowerCase();
    for (const banned of ['bread', 'pasta', 'oats', 'yoghurt', 'skim milk', 'whey', 'ricotta', 'cottage']) expect(gfdf).not.toContain(banned);
    const vegan = engine.buildPlan({ calories: 2100, protein: 80, days: 7, dietary: ['vegan'] });
    expectEveryDayOnTarget(vegan, 2100);
    const text = JSON.stringify(vegan).toLowerCase();
    for (const banned of ['chicken', 'beef', 'salmon', 'tuna', 'barramundi', 'egg', 'yoghurt', 'whey', 'cheese', 'ricotta', 'skim milk']) expect(text).not.toContain(banned);
    for (const t of engine.TEMPLATES) {
      if (t.items.some(([f]) => /^Egg/.test(f))) expect(t.flags).toContain('eggs');
    }
  });

  it('S5: fractions in quantities scale and add up', () => {
    expect(engine.scaleQty('1/2 cup', 1.5)).toBe('0.75 cup');
    expect(engine.scaleQty('1 1/2 cups', 2)).toBe('3 cups');
    expect(engine.scaleQty('½ cup', 2)).toBe('1 cup');
    expect(engine.scaleQty('2 large', 1.4)).toBe('3 large');
    expect(engine.parseQty('1½ cups')).toEqual({ family: 'count:cup', amount: 1.5 });
    expect(engine.parseQty('1/0 cup')).toBeNull();
    const list = engine.aggregateShoppingList({ days: [{ meals: { lunch: { ingredients: [{ item: 'Peas', qty: '1/2 cup' }, { item: 'Peas', qty: '1 1/2 cups' }, { item: 'Peas', qty: '¾ cup' }] } } }] });
    expect(list).toEqual([{ name: 'Peas', qty: '2.75 cups', amounts: { 'count:cup': 2.8 }, meals: 3 }]);
  });

  it('L2: raw/uncooked/dry stay separate from the cooked item', () => {
    const list = engine.aggregateShoppingList({ days: [{ meals: { lunch: { ingredients: [{ item: 'Rice (uncooked)', qty: '100g' }, { item: 'Rice', qty: '200g' }, { item: 'Rice (uncooked)', qty: '50g' }] } } }] });
    expect(list.map((i) => `${i.name}: ${i.qty}`)).toEqual(['Rice: 200 g', 'Rice (uncooked): 150 g']);
  });

  it('L3: a timed-out attempt aborts the AI request', async () => {
    let seen;
    const callAi = jest.fn((attempt, signal) => { seen = signal; return new Promise(() => {}); });
    await engine.generatePlan({ calories: 2000, protein: 120, days: 7 }, { callAi, budgetMs: 300, attemptMs: 100 });
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen.aborted).toBe(true);
  });

  it('L4: the builder closes the rounding gap on the biggest dinner ingredient', () => {
    // Without the dinner adjustment, rounding every ingredient to 5 g leaves
    // some days tens of kcal off; with it every day is within 1%.
    for (const calories of [1333, 1777, 2222, 3111, 4321]) {
      const plan = engine.buildPlan({ calories, protein: 100, days: 7 });
      for (const d of plan.days) expect(Math.abs(d.dailyTotals.calories - calories)).toBeLessThanOrEqual(calories * 0.01);
    }
    expect(engine.buildPlan({ calories: 2000, protein: 100, days: 3 }).summary).toBe('3 days at about 2000 kcal a day, built from everyday foods.');
  });

  it('M3: no store names, prices or budget figures in the plan, prompt or list', async () => {
    const src = fs.readFileSync('meal-planner.js', 'utf8');
    expect(src).not.toMatch(/woolworths|coles|woolies|price:|weeklyBudgetEst|grocery budget|AUD|\$\{budget\}/i);
    const app = fs.readFileSync('public/app.html', 'utf8');
    expect(app).not.toMatch(/wooliesUrl|colesUrl|weeklyBudgetEst|Est\. Budget/);
    const p = aiPlan([500, 550, 700, 300]);
    p.weeklyBudgetEst = 9999;
    p.priceTotal = 123;
    const r = engine.normaliseAiPlan(p, { calories: 2050, days: 7 });
    expect(JSON.stringify(r.plan)).not.toMatch(/9999|weeklyBudgetEst|priceTotal/);
    const appSrv = express();
    appSrv.use(express.json());
    appSrv.use('/api/meal-plan', require('./meal-planner'));
    const res = await request(appSrv).post('/api/meal-plan/shopping').set('Authorization', `Bearer ${jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET)}`).send({ plan: engine.buildPlan({ calories: 2000, protein: 120, days: 7 }) });
    expect(JSON.stringify(res.body)).not.toMatch(/woolworths|coles|price|Url/i);
  });
});
