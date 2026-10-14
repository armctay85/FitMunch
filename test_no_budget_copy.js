'use strict';
/**
 * FitMunch doesn't plan to a price. The meal-plan modal had a "Weekly budget ($)"
 * field and the API took a budget param it never used. This guards that:
 * - the API drops any budget param, so sending one changes nothing;
 * - "budget" (any case) never appears in served customer copy;
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

// Allowlist, kept deliberately small:
// - The URL slugs /budget-meal-plan and /budget-meal-planner. They are live, indexed
//   URLs in sitemap.xml, server.js and vercel.json; renaming them needs 301s and is an
//   SEO decision, not copy. The same slug is the analytics page id in js/fm-track.js
//   (matched by lib/funnel-events.js), which is never shown. Link text is still checked.
// - The two landing pages at those slugs. Their whole topic is the "budget meal plan"
//   search term; rewriting or retiring them is a separate decision (flagged on the PR).
const ALLOWED_FILES = new Set(['budget-meal-plan.html', 'budget-meal-planner.html']);
const SLUG = /\/?\bbudget-meal-plan(?:ner)?\b/g;

function servedFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) servedFiles(p, out);
    else if (/\.(html|js|json|webmanifest|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no "budget" in served customer copy', () => {
  const root = path.join(__dirname, 'public');
  const files = servedFiles(root).filter((f) => !ALLOWED_FILES.has(path.relative(root, f)));

  it('scans the served pages', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(`${path.sep}app.html`))).toBe(true);
  });

  it('no file has "budget" outside the allowed URL slugs', () => {
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8').replace(SLUG, '/SLUG');
      text.split('\n').forEach((line, i) => {
        if (/budget/i.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
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
