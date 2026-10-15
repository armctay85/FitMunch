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
  const hw = require('./public/js/fm-home-week');
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
    app.post('/api/meal-plans', (req, res) => { db.posts = (db.posts || 0) + 1; const row = { id: (db.nextId = (db.nextId || db.plans.length) + 1), ...req.body, total_calories: req.body.totalCalories }; db.plans.unshift(row); res.json({ success: true, plan: row, allergenWarnings: [] }); });
    app.put('/api/meal-plans/:id', (req, res) => { const row = db.plans.find((p) => String(p.id) === req.params.id); if (!row) return res.status(404).json({ success: false }); Object.assign(row, req.body); db.puts += 1; res.json({ success: true, plan: row, allergenWarnings: [] }); });
    app.get('/api/meal-plans', async (req, res) => {
      if (db.mealDelay) await new Promise((r) => setTimeout(r, db.mealDelay));
      if (db.mealStatus) return res.status(db.mealStatus).json({ success: false, error: 'unavailable' });
      if (db.noPlans) return res.json({ success: true });
      res.json({ success: true, plans: db.plans.map((p) => ({ ...p, allergenWarnings: db.warnings || [] })) });
    });
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
      : { success: true, lists: [], logs: [], recentMeals: db.todayCals ? [{ date: new Date().toISOString(), calories: db.todayCals }] : [], recentWorkouts: [] }));
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [320, 390, 1440]) {
    it(`${width}px: onboarding saves targets and the week, Done lands on Home with the week hero`, async () => {
      db = { profile: {}, profileSaves: [], plans: [], puts: 0, posts: 0, shopping: 0, warnings: [], todayCals: 1858 };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction(() => typeof openOnboarding === 'function' && typeof FMHomeWeek === 'object' && S && S.user);
      await p.waitForTimeout(800);
      await p.waitForFunction(() => document.getElementById('home-week').getAttribute('aria-busy') !== 'true');
      // Before onboarding: no week card, the Set goals prompt is there.
      expect(await p.isVisible('#home-week')).toBe(false);
      await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); openOnboarding(); });
      await p.fill('#ob-age', '34'); await p.selectOption('#ob-sex', 'male'); await p.fill('#ob-height', '180');
      await p.fill('#ob-weight', '82'); await p.fill('#ob-goal-weight', '78');
      await p.selectOption('#ob-goal', 'lose_weight'); await p.click('#ob-diet .diet-tag[data-val="vegetarian"]');
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
      await p.waitForSelector('#home-week-name');
      expect(db.puts).toBe(1); // Done re-saves the shown week (with any swaps) over the same row
      expect(db.plans).toHaveLength(1);
      expect(await p.evaluate(() => document.getElementById('view-portal-home').classList.contains('active'))).toBe(true);
      expect(await p.evaluate(() => document.getElementById('modal-onboard').classList.contains('open'))).toBe(false);

      const card = await p.evaluate(() => {
        const b = document.getElementById('home-week');
        return {
          name: b.querySelector('#home-week-name').textContent,
          tg: [...b.querySelectorAll('#home-week-targets b')].map((e) => e.textContent),
          labels: [...b.querySelectorAll('#home-week-targets span')].map((e) => e.textContent),
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
      const tile = hw.calorieTile(hw.summary({ meals: db.plans[0].meals }).average.calories, calories);
      expect(card.tg[0]).toBe(tile.value);
      expect(card.labels[0]).toBe('average');
      expect(card.tg.slice(1)).toEqual([`${protein}g`, `${t.targetCarbs}g`, `${t.targetFat}g`]);
      expect(tile.value).toContain(hw.formatCount(calories));
      expect(await p.textContent('#pm-cals')).toBe(hw.formatCount(1858));
      expect(await p.textContent('#pm-cals-sub')).toBe(`of ${hw.formatCount(calories)} goal`);
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

  for (const width of [320, 390, 1440]) {
    it(`${width}px: allergy entries in the API's real shape show on Home (red warning, calm note, notice)`, async () => {
      const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
      // Exactly what GET /api/meal-plans sends: { meal, contains } / { meal, contains: [], unchecked, note } / { meal: '', contains: [], notice }. No `message` field.
      db = { profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [], plans: [{ id: 1, name: 'Your first week', meals: plan.days }], puts: 0, shopping: 0,
        warnings: [
          { meal: '', contains: [], notice: 'We couldn\'t read all your allergies, so every allergen filter is on.' },
          { meal: 'Satay chicken', contains: ['nuts'] },
          { meal: 'Banana <img src=x onerror="window.__xss=1"> bowl', contains: ['banana'] },
          { meal: 'Arancini', contains: [], unchecked: true, note: 'We couldn\'t check this meal against your allergies, so check the ingredients.' },
        ] };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForSelector('#home-week-warn');
      // Red per-meal warning, built from meal + contains, with the alert role.
      expect(await p.getAttribute('#home-week-warn', 'role')).toBe('alert');
      const red = await p.textContent('#home-week-warn');
      expect(red).toContain('Satay chicken contains nuts');
      expect(red).toContain('contains banana');
      // The unreadable-list notice is its own alert.
      expect(await p.getAttribute('#home-week-notice', 'role')).toBe('alert');
      expect(await p.textContent('#home-week-notice')).toMatch(/couldn't read all your allergies/);
      // The calm "not checked" note: names the meal, says what to do, and is not an alert.
      expect(await p.getAttribute('#home-week-note', 'role')).toBeNull();
      const note = await p.textContent('#home-week-note');
      expect(note).toMatch(/Arancini/);
      expect(note).toMatch(/We couldn't check this meal against your allergies, so check the ingredients\./);
      expect(await p.isVisible('#home-week-note')).toBe(true);
      const noteBg = await p.evaluate(() => getComputedStyle(document.getElementById('home-week-note')).backgroundColor);
      expect(noteBg).toBe('rgb(248, 250, 252)');
      // The calorie tile is the week average against the saved goal.
      const tile = hw.calorieTile(hw.summary({ meals: plan.days }).average.calories, 2000);
      expect(await p.textContent('#home-week-cal')).toBe(tile.value);
      expect(tile.value).toMatch(/of 2,000$/);
      // API text is text only: the tag in the meal name is shown, never parsed.
      expect(await p.$('#home-week img')).toBeNull();
      expect(await p.evaluate(() => window.__xss === undefined)).toBe(true);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await p.evaluate(() => { const b = document.getElementById('home-week'); return b.scrollWidth > b.clientWidth + 1; })).toBe(false);
      if (shots) await p.locator('#home-week').screenshot({ path: `${shots}/home-week-warn-${width}.png` });
      if (width === 390) {
        // No warnings, no boxes.
        db.warnings = [];
        await p.evaluate(() => loadHomeWeek());
        expect(await p.$('#home-week-warn')).toBeNull();
        expect(await p.$('#home-week-note')).toBeNull();
        expect(await p.$('#home-week-notice')).toBeNull();
        db.warnings = [{ meal: 'Satay chicken', contains: ['nuts'] }];
        await p.evaluate(() => loadHomeWeek());
        // Carbs and fat are derived when only calories and protein were saved (older profiles).
        expect((await p.$$eval('#home-week-targets b', (e) => e.map((x) => x.textContent))).length).toBe(4);
        db.plans = [];
        await p.evaluate(() => loadHomeWeek());
        expect(await p.isVisible('#home-week')).toBe(false);
      }
      await ctx.close();
    });
  }

  it('500, 503 and a response with no plans list show a calm retry; an empty week stays hidden', async () => {
    const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
    db = { profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [], plans: [{ id: 1, name: 'Your first week', meals: plan.days }], puts: 0, shopping: 0, warnings: [], mealStatus: 500, mealDelay: 600 };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(`${base}/app.html`);
    await p.waitForSelector('#home-week-skel');
    await p.waitForSelector('#home-week-error');
    expect(await p.textContent('#home-week-error')).toBe("Couldn't load your week, try again");
    expect(await p.getAttribute('#home-week-error', 'role')).toBeNull();
    expect(await p.evaluate(() => document.getElementById('home-week-retry').getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    db.mealStatus = 503;
    db.mealDelay = 300;
    await p.click('#home-week-retry');
    await p.waitForSelector('#home-week-skel');
    await p.waitForSelector('#home-week-error');
    expect(await p.textContent('#home-week-error')).toBe("Couldn't load your week, try again");
    db.mealStatus = 0;
    db.mealDelay = 0;
    db.noPlans = true;
    await p.evaluate(() => loadHomeWeek());
    expect(await p.textContent('#home-week-error')).toBe("Couldn't load your week, try again");
    db.noPlans = false;
    await p.click('#home-week-retry');
    await p.waitForSelector('#home-week-name');
    expect(await p.$('#home-week-warn')).toBeNull();
    db.plans = [];
    await p.evaluate(() => loadHomeWeek());
    expect(await p.isVisible('#home-week')).toBe(false);
    await ctx.close();
  });

  it('repeat onboarding updates the existing Your first week row', async () => {
    const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
    db = { profile: {}, profileSaves: [], plans: [{ id: 4, name: 'Your first week', meals: plan.days }], puts: 0, posts: 0, shopping: 0, warnings: [], nextId: 4 };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(`${base}/app.html`);
    await p.waitForFunction(() => typeof openOnboarding === 'function' && S && S.user);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); openOnboarding(); });
    await p.fill('#ob-age', '34'); await p.selectOption('#ob-sex', 'male'); await p.fill('#ob-height', '180');
    await p.fill('#ob-weight', '82'); await p.fill('#ob-goal-weight', '78');
    await p.selectOption('#ob-goal', 'lose_weight');
    await p.click('#ob-step-1 .btn-green');
    await p.click('#ob-build');
    await p.waitForSelector('#ob-week .ob-day');
    expect(db.plans).toHaveLength(1);
    expect(db.plans[0].id).toBe(4);
    expect(db.posts).toBe(0);
    expect(db.puts).toBe(1);
    expect(db.plans[0].name).toBe('Your first week');
    await ctx.close();
  });
});
