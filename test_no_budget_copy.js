'use strict';
/**
 * FitMunch doesn't plan to a price. The meal-plan modal had a "Weekly budget ($)"
 * field and the API took a budget param it never used. This guards that:
 * - the API drops any budget param, so sending one changes nothing;
 * - "budget" (any case) and cost or saving promises never appear in served copy;
 * - the trainer dashboard has no "$0 subscription revenue" placeholder.
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
  getUserById: jest.fn(async () => ({ id: 'u1', settings: { aiDataConsent: true } })),
  effectiveTier: () => 'free',
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const mealPlanner = require('./meal-planner');

describe('meal-plan API ignores budget', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/meal-plan', mealPlanner);
  const post = (body) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${token}`).send(body);
  const base = { goal: 'lose_weight', calories: 2100, protein: 150, days: 7, dietary: ['vegetarian'] };

  afterEach(() => aiClient.chatJson.mockReset());

  it('planInput drops budget', () => {
    expect(mealPlanner.planInput({ ...base, budget: 80 })).toEqual(mealPlanner.planInput(base));
    expect(mealPlanner.planInput({ ...base, budget: 80 })).not.toHaveProperty('budget');
  });

  it('builder plan is identical with or without budget, and never mentions it', async () => {
    const a = await post({ ...base, builderOnly: true });
    const b = await post({ ...base, builderOnly: true, budget: 50 });
    const c = await post({ ...base, builderOnly: true, budget: 'abc', weeklyBudget: 300 });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(JSON.stringify(b.body)).not.toMatch(/budget/i);
  });

  it('the AI prompt is identical with or without budget', async () => {
    const prompts = [];
    aiClient.chatJson.mockImplementation(async (o) => { prompts.push(o.messages[0].content); return { ok: false, error: 'x' }; });
    await post(base);
    const n = prompts.length;
    await post({ ...base, budget: 50 });
    expect(n).toBeGreaterThan(0);
    expect(prompts.slice(n)).toEqual(prompts.slice(0, n));
    for (const p of prompts) expect(p).not.toMatch(/budget/i);
  });

  it('an invalid budget is not a 400 (it is ignored, not validated)', async () => {
    const r = await post({ ...base, builderOnly: true, budget: -5 });
    expect(r.status).toBe(200);
  });
});

// No allowlist: the old /budget-meal-plan and /budget-meal-planner landers were deleted
// and 301 to /high-protein-staples-meal-plan (Wilson, PR 121), so "budget" appears nowhere.
// FitMunch makes no cost or saving promise in served copy either. Plain price disclaimers
// ("Prices vary by store and week", "does not show supermarket prices") and the A$19.99
// subscription price are not promises and stay allowed.
const COST_PROMISES = [
  ['budget', /budget/i],
  ['cheap', /\bcheap(?:er|est|ly)?\b/i],
  ['save money / save $', /\bsav(?:e|es|ed|ing|ings)\b[^.<]{0,20}(?:\$|\bmoney\b|\bdollars?\b|\bcash\b|on (?:your )?(?:groceries|grocery|food|shop|shopping))/i],
  ['save on groceries', /\bsav(?:e|es|ing)\b[^.<]{0,10}\bgrocer/i],
  ['savings', /\bsavings\b/i],
  ['cost less / costs less', /\bcosts? less\b/i],
  ['spend less', /\bspend(?:ing)? less\b/i],
  ['lower bill', /\b(?:lower|cut|cuts|reduce|reduces|slash)\b[^.<]{0,20}\b(?:grocery|food|shopping|weekly)\s+(?:bill|spend|costs?)\b/i],
  ['$ per week', /\$\s?\d[\d.,]*\s*(?:a|per|\/)\s*(?:week|wk|day|meal|serve|serving)\b/i],
  ['per week $', /\bper (?:week|day|meal|serve)\b[^.<]{0,6}\$\s?\d/i],
  ['$ per gram of protein', /\$\s?\/\s?\d*\s?g\b|\$\d[\d.]*\s*(?:per|\/)\s*\d*\s?g(?:rams?)?\s+(?:of\s+)?protein/i],
  ['affordable / bargain / frugal', /\b(?:affordable|bargains?|frugal|economical|value for money|price[- ]conscious|low[- ]cost|inexpensive)\b/i],
];

function servedFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) servedFiles(p, out);
    else if (/\.(html|js|json|webmanifest|txt|xml)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no budget, cost or saving promises in served customer copy', () => {
  const root = path.join(__dirname, 'public');
  const files = servedFiles(root);

  it('scans the served pages, including the staples lander', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of ['app.html', 'index.html', 'high-protein-staples-meal-plan.html']) {
      expect(files.some((x) => x.endsWith(`${path.sep}${f}`))).toBe(true);
    }
  });

  for (const [label, re] of COST_PROMISES) {
    it(`no served file says ${label}`, () => {
      const hits = [];
      for (const f of files) {
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const m = line.match(re);
          if (m) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.slice(Math.max(0, m.index - 40), m.index + 60).trim()}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }

  it('the patterns catch the copy they are meant to', () => {
    const caught = (s) => COST_PROMISES.some(([, re]) => re.test(s));
    for (const s of ['Budget meal plan', 'cheap protein', 'Save $40 a week', 'save money on groceries', 'Costs less than takeaway',
      'Spend less each shop', 'cut your grocery bill', '$45 a week', 'per week $60', '$/25g protein', 'Affordable high protein',
      'big savings']) expect([s, caught(s)]).toEqual([s, true]);
    for (const s of ['Prices vary by store and week.', '14-day trial, then A$19.99 a month', 'FitMunch does not show supermarket prices',
      '3 days per week', 'Save your plan', 'Saved to your lists']) expect([s, caught(s)]).toEqual([s, false]);
  });

  it('the meal-plan modal has no budget field', () => {
    const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
    expect(app).not.toMatch(/mp-budget-sel/);
    expect(app).not.toMatch(/Weekly budget/i);
  });
});

describe('no $0 revenue placeholder in app.html', () => {
  const app = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
  it('has no subscription-revenue metric', () => {
    expect(app).not.toMatch(/subscription revenue/i);
    expect(app).not.toMatch(/id="m-month"/);
  });
  it('the only $0 left is the Free plan price', () => {
    const zeros = [...app.matchAll(/\$0(?![\d.,])/g)].map((m) => app.slice(m.index, m.index + 120));
    expect(zeros).toHaveLength(1);
    expect(zeros[0]).toMatch(/^\$0<span[^>]*> forever<\/span>/);
  });
});
