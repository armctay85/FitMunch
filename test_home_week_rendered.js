'use strict';
// Onboarding -> Home in a real browser at 320, 390 and 1440px (launch audit D2). Needs playwright-core and Chrome.
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
    + `!!! SKIPPING test_home_week_rendered.js: ${!installed ? 'playwright-core is not installed' : !chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}.\n`
    + `!!! Onboarding -> Home was NOT checked in a real browser.\n`
    + `!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
}
if (mustRun && !canRun) {
  describe('onboarding to Home rendered (CI, playwright-core installed)', () => {
    it('can launch a browser', () => {
      throw new Error(`test_home_week_rendered.js cannot run in CI: ${!chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}`);
    });
  });
}
const maybe = canRun ? describe : describe.skip;

maybe('Save and build my week -> Home shows the week, the targets and a one-tap shopping list, rendered', () => {
  jest.setTimeout(120000);
  const engine = require('./lib/meal-plan-engine');
  const shots = process.env.HOME_SHOTS; // eg /workspace/shots/home-week: a screenshot per width
  let server; let browser; let base; let db;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    // A small stateful stand-in for the saved profile and plans (the real SQL is in test_home_week_pg.js).
    app.use((req, res, next) => { req.db = db; next(); });
    app.post('/api/user/profile', (req, res) => { Object.assign(db.profile, req.body); db.profileSaves.push(req.body); res.json({ success: true }); });
    app.get('/api/user/profile/:id', (req, res) => res.json({ success: true, profile: db.profile }));
    app.post('/api/meal-plans', (req, res) => { const row = { id: db.plans.length + 1, ...req.body, total_calories: req.body.totalCalories }; db.plans.unshift(row); res.json({ success: true, plan: row, allergenWarnings: [] }); });
    app.put('/api/meal-plans/:id', (req, res) => { const row = db.plans.find((p) => String(p.id) === req.params.id); Object.assign(row, req.body); db.puts += 1; res.json({ success: true, plan: row, allergenWarnings: [] }); });
    app.get('/api/meal-plans', (req, res) => res.json({ success: true, plans: db.plans.map((p) => ({ ...p, allergenWarnings: db.warnings })) }));
    app.post('/api/meal-plan/generate', (req, res) => {
      const dietary = engine.normaliseDiet(req.body.dietary || []);
      res.json({ success: true, source: 'builder', plan: engine.withSwaps(engine.buildPlan({ calories: req.body.calories, protein: req.body.protein, days: 7, dietary }), dietary, req.body.calories) });
    });
    app.post('/api/meal-plan/shopping', (req, res) => {
      db.shopping += 1;
      const items = engine.aggregateShoppingList(req.body.plan).map((i) => ({ name: i.name, qty: i.qty, aisle: 'pantry' }));
      res.json({ success: true, list: { name: 'Your first week: shopping list', itemCount: items.length, items, byAisle: { pantry: items }, aisleOrder: ['pantry'], aisleIcons: {} } });
    });
    app.post('/api/user/goal-weight', (req, res) => res.json({ success: true, goalWeightKg: req.body.goalWeightKg }));
    app.use('/api', (req, res) => res.json(req.path.includes('/auth/me')
      ? { success: true, user: { id: 7, name: 'Sam Rivers', email: 'sam@example.com', role: 'client', subscriptionTier: 'free', settings: {} } }
      : { success: true, lists: [], logs: [], recentMeals: [], recentWorkouts: [] }));
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [320, 390, 1440]) {
    it(`${width}px: onboarding saves targets and the week, Done lands on Home with the week hero`, async () => {
      db = { profile: {}, profileSaves: [], plans: [], puts: 0, shopping: 0, warnings: [] };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction(() => typeof openOnboarding === 'function' && typeof FMHomeWeek === 'object' && S && S.user);
      await p.waitForTimeout(800);
      // Before onboarding: no week card, the Set goals prompt is there.
      expect(await p.isVisible('#home-week')).toBe(false);
      await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); openOnboarding(); });
      await p.fill('#ob-age', '34'); await p.selectOption('#ob-sex', 'male'); await p.fill('#ob-height', '180');
      await p.fill('#ob-weight', '82'); await p.fill('#ob-goal-weight', '78');
      await p.selectOption('#ob-goal', 'lose_weight'); await p.selectOption('#ob-diet', 'vegetarian');
      await p.click('#ob-step-1 .btn-green');
      const calories = Number(await p.inputValue('#ob-cals')); const protein = Number(await p.inputValue('#ob-prot'));
      await p.click('#ob-build');
      await p.waitForSelector('#ob-week .ob-day');
      // Saved: calories and all three macros, and the week itself.
      const t = db.profileSaves[0];
      expect([t.targetCalories, t.targetProtein]).toEqual([calories, protein]);
      expect(t.targetCarbs).toBeGreaterThan(0); expect(t.targetFat).toBeGreaterThan(0);
      expect(t.dietaryPreferences).toBeUndefined(); // filters still go only through generate's rememberFilters
      expect(db.plans).toHaveLength(1);
      expect(db.plans[0].meals).toHaveLength(7);

      await p.click('#ob-done');
      await p.waitForSelector('#home-week:not([style*="display: none"])');
      expect(db.puts).toBe(1); // Done re-saves the shown week (with any swaps) over the same row
      expect(db.plans).toHaveLength(1);
      expect(await p.evaluate(() => document.getElementById('view-portal-home').classList.contains('active'))).toBe(true);
      expect(await p.evaluate(() => document.getElementById('modal-onboard').classList.contains('open'))).toBe(false);

      const card = await p.evaluate(() => {
        const b = document.getElementById('home-week');
        return {
          name: b.querySelector('#home-week-name').textContent,
          tg: [...b.querySelectorAll('#home-week-targets b')].map((e) => e.textContent),
          meals: b.querySelectorAll('#home-week-today li').length,
          days: b.querySelectorAll('.hw-days span').length,
          on: b.querySelectorAll('.hw-days span.on').length,
          firstOnScreen: b.getBoundingClientRect().top < innerHeight,
          nudge: getComputedStyle(document.getElementById('home-goals-nudge')).display,
          cta: getComputedStyle(document.getElementById('pm-cals-cta')).display,
          shopH: document.getElementById('home-week-shop').getBoundingClientRect().height,
          plan: document.getElementById('home-mealplan').textContent,
        };
      });
      expect(card.name).toBe('Your first week');
      expect(card.tg).toEqual([calories.toLocaleString('en-AU'), `${protein}g`, `${t.targetCarbs}g`, `${t.targetFat}g`]);
      expect(card.meals).toBe(4);
      expect([card.days, card.on]).toEqual([7, 1]);
      expect(card.firstOnScreen).toBe(true);
      expect(card.nudge).toBe('none');
      expect(card.cta).toBe('none');
      expect(card.shopH).toBeGreaterThanOrEqual(44);
      expect(card.plan).not.toMatch(/No plan yet/);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await p.evaluate(() => { const b = document.getElementById('home-week'); return b.scrollWidth > b.clientWidth + 1; })).toBe(false);
      if (shots) await p.screenshot({ path: `${shots}/home-week-${width}.png` });

      // One tap: the shopping list for the saved week.
      await p.click('#home-week-shop');
      await p.waitForFunction(() => document.getElementById('view-shopping-lists').classList.contains('active'));
      expect(db.shopping).toBe(1);
      expect(await p.textContent('#sl-ai-name')).toBe('Your first week: shopping list');
      if (shots) await p.screenshot({ path: `${shots}/home-week-shopping-${width}.png` });
      await ctx.close();
    });
  }

  it('390px: an allergy warning on the saved week shows in red on Home; no saved week means no card', async () => {
    const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
    db = { profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [], plans: [{ id: 1, name: 'Your first week', meals: plan.days }], puts: 0, shopping: 0,
      warnings: [{ meal: 'Peanut butter toast', contains: ['peanut'], message: 'Peanut butter toast contains peanut, which your filters exclude.' }] };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(`${base}/app.html`);
    await p.waitForSelector('#home-week .hw-warn');
    expect(await p.getAttribute('#home-week .hw-warn', 'role')).toBe('alert');
    expect(await p.textContent('#home-week .hw-warn')).toMatch(/contains peanut/);
    // Carbs and fat are derived when only calories and protein were saved (older profiles).
    expect((await p.$$eval('#home-week-targets b', (e) => e.map((x) => x.textContent))).length).toBe(4);
    db.plans = [];
    await p.evaluate(() => loadHomeWeek());
    expect(await p.isVisible('#home-week')).toBe(false);
    await ctx.close();
  });
});
