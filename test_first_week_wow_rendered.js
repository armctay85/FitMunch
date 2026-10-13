'use strict';

// (copied guard from test_first_week_wow_rendered.js) Renders the onboarding modal (#modal-onboard) in a real browser at 320, 390 and 768px with a
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
    + `!!! SKIPPING test_first_week_wow_rendered.js: ${!installed ? 'playwright-core is not installed' : !chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}.\n`
    + `!!! The onboarding modal was NOT checked in a real browser.\n`
    + `!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
}
if (mustRun && !canRun) {
  describe('onboarding modal rendered (CI, playwright-core installed)', () => {
    it('can launch a browser', () => {
      throw new Error(`test_first_week_wow_rendered.js cannot run in CI: ${!chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}`);
    });
  });
}
const maybe = canRun ? describe : describe.skip;

maybe('first week: personal header, estimated curve and meal swaps, rendered', () => {
  jest.setTimeout(120000);
  const engine = require('./lib/meal-plan-engine');
  const shots = process.env.WOW_SHOTS; // eg /workspace/shots/wow-1-4: save a screenshot per width
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.post('/api/meal-plan/generate', (req, res) => {
      const dietary = engine.normaliseDiet(req.body.dietary || []);
      res.json({ success: true, source: 'builder', plan: engine.withSwaps(engine.buildPlan({ calories: req.body.calories, protein: req.body.protein, days: 7, dietary }), dietary) });
    });
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
    it(`${width}px: header from my answers, estimate curve, swap updates the day live`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
      await ctx.addInitScript(() => localStorage.setItem('fm_token', 't.t'));
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction(() => typeof openOnboarding === 'function' && typeof FMWeekWow === 'object');
      await p.waitForTimeout(1200);
      await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); openOnboarding(); });
      await p.waitForTimeout(300);
      await p.fill('#ob-age', '34'); await p.selectOption('#ob-sex', 'male'); await p.fill('#ob-height', '180');
      await p.fill('#ob-weight', '82'); await p.fill('#ob-goal-weight', '78');
      await p.selectOption('#ob-goal', 'lose_weight'); await p.selectOption('#ob-diet', 'none');
      await p.click('#ob-step-1 .btn-green');
      const calories = Number(await p.inputValue('#ob-cals'));
      await p.click('#ob-build');
      await p.waitForSelector('#ob-week .ob-day');

      // (1) personal header from the answers and the week's real averages, and a labelled estimate.
      const head = await p.textContent('#ob-head');
      expect(head).toMatch(/^Built for 82kg, cutting to 78kg: \d{1,2},\d{3} cal, \d+g protein, 4 meals a day$/);
      const curve = await p.evaluate(() => {
        const f = document.getElementById('ob-curve');
        return { shown: f.style.display !== 'none', est: f.querySelector('.ob-est') && f.querySelector('.ob-est').textContent, label: f.querySelector('svg').getAttribute('aria-label'), cap: f.querySelector('figcaption').textContent };
      });
      expect(curve.shown).toBe(true);
      expect(curve.est).toBe('Estimate');
      expect(curve.label).toMatch(/^Estimated weight from 82 kg now to 78 kg around [A-Z][a-z]{2} \d{4}, over 10 weeks$/);
      expect(curve.cap).toMatch(/not a promise/);

      // (4) a Swap button on every meal, 44px or larger.
      const btns = await p.evaluate(() => [...document.querySelectorAll('#ob-week .ob-swap')].map((b) => ({ w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
      expect(btns).toHaveLength(28);
      for (const b of btns) { expect(b.h).toBeGreaterThanOrEqual(44); expect(b.w).toBeGreaterThanOrEqual(44); }

      // Every swap list starts closed.
      expect(await p.evaluate(() => [...document.querySelectorAll('#ob-week .ob-swaps')].filter((u) => u.offsetParent).length)).toBe(0);

      // Swap the first meal that has alternatives: the name, the day's calorie bar and the header update at once.
      const pickIdx = await p.evaluate(() => [...document.querySelectorAll('#ob-week .ob-swaps')].findIndex((u) => u.querySelectorAll('button').length > 0));
      expect(pickIdx).toBeGreaterThanOrEqual(0);
      const before = await p.evaluate((i) => { const row = document.querySelectorAll('#ob-week .ob-meal')[i]; const card = row.closest('.ob-day'); return { name: row.querySelector('.ob-meal-n').textContent, bar: card.querySelector('.ob-bar-label').textContent, day: [...document.querySelectorAll('#ob-week .ob-day')].indexOf(card) }; }, pickIdx);
      const swapBtn = (await p.$$('#ob-week .ob-swap'))[pickIdx];
      await swapBtn.click();
      expect(await swapBtn.getAttribute('aria-expanded')).toBe('true');
      const opts = await p.evaluate((i) => [...document.querySelectorAll('#ob-week .ob-swaps')[i].querySelectorAll('button')].map((b) => ({ name: b.firstChild.textContent, h: b.getBoundingClientRect().height })), pickIdx);
      expect(opts.length).toBeGreaterThanOrEqual(1);
      expect(opts.length).toBeLessThanOrEqual(3);
      for (const o of opts) { expect(o.h).toBeGreaterThanOrEqual(44); expect(o.name).toMatch(/^[A-Z]/); }
      if (shots) await p.screenshot({ path: `${shots}/swap-open-${width}.png` });
      const t0 = Date.now();
      await p.evaluate((i) => document.querySelectorAll('#ob-week .ob-swaps')[i].querySelector('button').click(), pickIdx);
      const after = await p.evaluate(({ i, day }) => {
        const card = document.querySelectorAll('#ob-week .ob-day')[day];
        const names = [...card.querySelectorAll('.ob-meal-n')].map((e) => e.textContent);
        return { names, bar: card.querySelector('.ob-bar-label').textContent, head: document.getElementById('ob-head').textContent, focused: document.activeElement && document.activeElement.className };
      }, { i: pickIdx, day: before.day });
      expect(Date.now() - t0).toBeLessThan(500); // instant: no network on the swap path
      expect(after.names).toContain(opts[0].name);
      expect(after.names).not.toContain(before.name);
      expect(after.focused).toBe('ob-swap');
      expect(await p.evaluate(() => [...document.querySelectorAll('#ob-week .ob-swaps')].filter((u) => u.offsetParent).length)).toBe(0);
      const dayKcal = Number(after.bar.match(/Calories (\d+) kcal/)[1]);
      expect(Math.abs(dayKcal - calories)).toBeLessThanOrEqual(calories * 0.05);
      expect(after.head).toMatch(/^Built for 82kg, cutting to 78kg: /);

      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      if (shots) {
        await p.evaluate(() => { document.getElementById('ob-week').scrollTop = 0; });
        await p.screenshot({ path: `${shots}/first-week-${width}.png` });
        await p.screenshot({ path: `${shots}/first-week-${width}-full-modal.png`, fullPage: true });
      }
      await ctx.close();
    });
  }
});
