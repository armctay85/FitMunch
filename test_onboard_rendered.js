'use strict';

// Renders the onboarding modal (#modal-onboard) in a real browser at 320, 390 and 768px with a
// mocked /api and the real meal-plan builder, walks all three steps, and checks for no horizontal
// overflow, 44px fields and close button, 48px buttons, and a week that never goes over protein.
// Needs playwright-core and Chrome. Joins test_app_mobile_rendered.js's MODALS once that lands.
const fs = require('fs');
const path = require('path');

// In CI, if playwright-core is installed this suite must run: a missing browser or a module that
// won't load is a failure, never a skip. It only skips when playwright-core is not installed, or
// locally (outside CI) when it can't load, and then it says so loudly.
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
  console.warn(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`
    + `!!! SKIPPING test_onboard_rendered.js: ${!installed ? 'playwright-core is not installed' : !chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}.\n`
    + `!!! The onboarding modal was NOT checked in a real browser.\n`
    + `!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
}
if (mustRun && !canRun) {
  describe('onboarding modal rendered (CI, playwright-core installed)', () => {
    it('can launch a browser', () => {
      throw new Error(`test_onboard_rendered.js cannot run in CI: ${!chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}`);
    });
  });
}
const maybe = canRun ? describe : describe.skip;

maybe('onboarding modal rendered on phones and tablets', () => {
  jest.setTimeout(120000);
  const engine = require('./lib/meal-plan-engine');
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.post('/api/meal-plan/generate', (req, res) => res.json({ success: true, source: 'builder', plan: engine.buildPlan({ calories: req.body.calories, protein: req.body.protein, days: 7, dietary: req.body.dietary || [] }) }));
    app.use('/api', (req, res) => res.json(req.path.includes('/auth/me')
      ? { success: true, user: { id: 7, name: 'Sam Rivers', email: 'sam@example.com', role: 'client', subscriptionTier: 'free', settings: {} } }
      : { success: true, lists: [], plans: [], logs: [], profile: {} }));
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [320, 390, 768]) {
    it(`${width}px: three steps, tap targets, no overflow, protein capped`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
      await ctx.addInitScript(() => localStorage.setItem('fm_token', 't.t'));
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction(() => typeof openOnboarding === 'function');
      await p.waitForTimeout(1200); // let the first-run auto-open (800ms) fire before we drive the modal
      await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); openOnboarding(); });
      await p.waitForTimeout(300);
      expect(await p.textContent('#ob-stepno')).toBe('Step 1 of 3');
      await p.fill('#ob-age', '34'); await p.selectOption('#ob-sex', 'male'); await p.fill('#ob-height', '180'); await p.fill('#ob-weight', '130');
      await p.selectOption('#ob-goal', 'lose_weight'); await p.selectOption('#ob-diet', 'dairy_free');
      const sizes = await p.evaluate(() => [...document.querySelectorAll('#modal-onboard input, #modal-onboard select, #modal-onboard button')]
        .filter((e) => e.offsetParent).map((e) => ({ tag: e.tagName, btn: e.classList.contains('btn'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
      for (const s of sizes) {
        expect(s.h).toBeGreaterThanOrEqual(s.btn ? 48 : 44);
        if (s.tag === 'BUTTON') expect(s.w).toBeGreaterThanOrEqual(44);
      }
      await p.click('#ob-step-1 .btn-green');
      expect(await p.textContent('#ob-stepno')).toBe('Step 2 of 3');
      const protein = Number(await p.inputValue('#ob-prot'));
      await p.click('#ob-build');
      await p.waitForSelector('#ob-week .ob-day');
      expect(await p.textContent('#ob-stepno')).toBe('Step 3 of 3');
      const week = await p.evaluate(() => ({
        days: document.querySelectorAll('#ob-week .ob-day').length,
        bars: document.querySelectorAll('#ob-week .ob-bar-track').length,
        labels: [...document.querySelectorAll('#ob-week .ob-meal-k')].map((e) => e.textContent),
        proteins: [...document.querySelectorAll('#ob-week .ob-bar-label')].map((e) => e.textContent).filter((t) => t.startsWith('Protein')),
        note: document.getElementById('ob-week-note').textContent,
        consentShown: !!document.querySelector('#modal-ai-consent.open'),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(week.days).toBe(7);
      expect(week.bars).toBe(14);
      expect(week.labels.slice(0, 4)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
      for (const t of week.proteins) expect(Number(t.match(/Protein (\d+)g/)[1])).toBeLessThanOrEqual(protein);
      expect(week.note).toMatch(/Turn on AI in Privacy/);
      expect(week.consentShown).toBe(false);
      expect(week.overflow).toBe(false);
      await ctx.close();
    });
  }
});
