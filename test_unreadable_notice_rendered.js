'use strict';
// Unreadable-profile notice on Home insight and weekly review, measured at 390 and 1440.
const fs = require('fs');
const path = require('path');
const dietGuard = require('./lib/diet-guard');

const inCI = !!process.env.CI && process.env.CI !== 'false';
let installed = false;
try { require.resolve('playwright-core'); installed = true; } catch (_) { installed = false; }
let chromium = null; let loadError = null;
if (installed) { try { ({ chromium } = require('playwright-core')); } catch (e) { loadError = e; chromium = null; } }
const executablePath = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
const mustRun = inCI && installed;
const canRun = !!(chromium && executablePath);
if (!canRun && !mustRun) {
  // eslint-disable-next-line no-console
  console.warn(`\n!!! SKIPPING test_unreadable_notice_rendered.js: ${!installed ? 'playwright-core is not installed' : !chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome'}.\n`);
}
if (mustRun && !canRun) {
  describe('unreadable notice rendered (CI)', () => {
    it('can launch a browser', () => {
      throw new Error('test_unreadable_notice_rendered.js cannot run in CI');
    });
  });
}
const maybe = canRun ? describe : describe.skip;

function contrastOf(el) {
  function parse(c) {
    const m = String(c).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (!m) return { r: 255, g: 255, b: 255, a: 1 };
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  }
  function lin(ch) {
    const c = ch / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function lum(rgb) { return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b); }
  function over(fg, bg) {
    const a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function backdrop(node) {
    const layers = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const bg = parse(getComputedStyle(cur).backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 1) break;
      cur = cur.parentElement;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg);
    return bg;
  }
  const cs = getComputedStyle(el);
  const bg = backdrop(el);
  const fg = over(parse(cs.color), bg);
  const hi = Math.max(lum(fg), lum(bg));
  const lo = Math.min(lum(fg), lum(bg));
  return (hi + 0.05) / (lo + 0.05);
}

maybe('unreadable profile notice on insight and weekly review', () => {
  jest.setTimeout(120000);
  const NOTICE = dietGuard.UNREADABLE_NOTICE;
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.get('/api/auth/me', (req, res) => res.json({ success: true, user: { id: 'u1', name: 'Sam Rivers', role: 'client', subscriptionTier: 'free', aiDataConsent: true, settings: {} } }));
    app.get('/api/user/profile/:id', (req, res) => res.json({ success: true, profile: { targetCalories: 2000, targetProtein: 150, fitnessGoal: 'general_fitness' } }));
    app.get('/api/portal/me', (req, res) => res.json({ success: true, pt: null, mealPlan: null, workoutPlan: null, recentMeals: [], recentWorkouts: [], shoppingLists: [] }));
    app.post('/api/ai/insight', (req, res) => res.json({ success: true, insight: NOTICE, provider: null }));
    app.get('/api/ai/weekly-review', (req, res) => res.json({
      success: true,
      review: { headline: NOTICE, wins: [], focus: [], score: null },
      source: 'fixed',
      provider: null,
    }));
    app.get('/api/meal-plans', (req, res) => res.json({ success: true, plans: [] }));
    app.use('/api', (req, res) => res.json({ success: true }));
    app.get('/_vercel/insights/script.js', (req, res) => { res.type('application/javascript'); res.send(''); });
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [390, 1440]) {
    it(`${width}px: notice copy, contrast, size, and 44px controls`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction((notice) => {
        const el = document.getElementById('ai-coach-text');
        return el && el.textContent === notice && getComputedStyle(document.getElementById('ai-coach-card')).display !== 'none';
      }, NOTICE, { timeout: 20000 });
      const insight = await p.evaluate(contrastOf, await p.$('#ai-coach-text'));
      const insightSize = await p.$eval('#ai-coach-text', (el) => parseFloat(getComputedStyle(el).fontSize));
      const refreshH = await p.$eval('#ai-coach-refresh', (el) => el.getBoundingClientRect().height);
      const reviewH = await p.$eval('#wr-btn', (el) => el.getBoundingClientRect().height);
      expect(insight).toBeGreaterThanOrEqual(4.5);
      expect(insightSize).toBeGreaterThanOrEqual(16);
      expect(refreshH).toBeGreaterThanOrEqual(44);
      expect(reviewH).toBeGreaterThanOrEqual(44);
      await p.click('#wr-btn');
      await p.waitForFunction((notice) => {
        const el = document.getElementById('wr-headline');
        return el && el.textContent === notice;
      }, NOTICE);
      const weekly = await p.evaluate(contrastOf, await p.$('#wr-headline'));
      const weeklySize = await p.$eval('#wr-headline', (el) => parseFloat(getComputedStyle(el).fontSize));
      const reviewAfter = await p.$eval('#wr-btn', (el) => el.getBoundingClientRect().height);
      expect(weekly).toBeGreaterThanOrEqual(4.5);
      expect(weeklySize).toBeGreaterThanOrEqual(16);
      expect(reviewAfter).toBeGreaterThanOrEqual(44);
      expect((await p.textContent('#wr-body')).replace(/\s+/g, ' ').trim()).toBe(NOTICE);
      expect(await p.textContent('#ai-coach-text')).not.toMatch(/Lunch:|set up your allergy|Try this checked meal/);
      await ctx.close();
    });
  }
});
