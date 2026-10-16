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

// The same check the API uses: an ingredient "Peanuts 40g" is nuts; a name with no ingredients is unchecked.
function allergenWarningsFor(meals) {
  const mealSafety = require('./lib/meal-safety');
  const NOTE = "We couldn't check this meal against your allergies, so check the ingredients.";
  const checked = mealSafety.enforceSavedMeals(meals, { allergies: ['peanuts'] }).meals;
  const out = [];
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (v.allergenWarning && typeof v.allergenWarning === 'object' && !seen.has(v)) {
      seen.add(v);
      const w = v.allergenWarning;
      const contains = (Array.isArray(w.allergens) ? w.allergens : []).map((g) => String(g).replace(/^allergy: /, ''));
      const meal = String(v.name || v.mealName || v.title || 'Meal').slice(0, 80);
      if (contains.length) out.push({ meal, contains });
      else if (w.unrecognised) out.push({ meal, contains: [], unchecked: true, note: NOTE });
    }
    Object.entries(v).forEach(([k, x]) => { if (k !== 'allergenWarning') walk(x, depth + 1); });
  };
  walk(checked, 0);
  return out;
}

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
    app.put('/api/meal-plans/:id', (req, res) => {
      const row = db.plans.find((p) => String(p.id) === req.params.id);
      if (!row) return res.status(404).json({ success: false });
      db.lastPut = req.body;
      if (db.recompute && req.body && req.body.meals != null) {
        row.meals = req.body.meals;
        const sums = hw.planMacros(req.body.meals);
        row.total_calories = sums.calories;
        row.total_protein = sums.protein;
        row.total_carbs = sums.carbs;
        row.total_fat = sums.fat;
      } else Object.assign(row, req.body);
      db.puts += 1;
      const warnings = db.warningsFromMeals ? allergenWarningsFor(row.meals) : [];
      res.json({ success: true, plan: row, allergenWarnings: warnings });
    });
    app.get('/api/meal-plans', async (req, res) => {
      db.mealGets = (db.mealGets || 0) + 1;
      if (db.mealDelay) await new Promise((r) => setTimeout(r, db.mealDelay));
      if (db.mealAbort) { req.socket.destroy(); return; }
      if (db.meal304 === 'once' && db.mealGets === 1) return res.status(304).end();
      if (db.meal304 === 'always') return res.status(304).end();
      if (db.mealStatus) return res.status(db.mealStatus).json({ success: false, error: 'unavailable' });
      if (db.noPlans) return res.json({ success: true });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, plans: db.plans.map((p) => ({ ...p, allergenWarnings: db.warningsFromMeals ? allergenWarningsFor(p.meals) : (db.warnings || []) })) });
    });
    app.get('/api/portal/me', (req, res) => res.json({
      success: true,
      pt: db.pt || null,
      mealPlan: db.trainerMeal || null,
      workoutPlan: null,
      recentMeals: db.todayCals ? [{ date: new Date().toISOString(), calories: db.todayCals }] : [],
      recentWorkouts: [],
      shoppingLists: [],
    }));
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
    app.post('/api/meals/log', (req, res) => { db.mealLogs = db.mealLogs || []; db.mealLogs.push(req.body); res.json({ success: true, meal: { id: db.mealLogs.length } }); });
    app.get('/_vercel/insights/script.js', (req, res) => { res.type('application/javascript'); res.send(''); });
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
      const prog = await p.evaluate(() => ({
        text: document.getElementById('home-week-progress') ? document.getElementById('home-week-progress').textContent : '',
        logs: document.querySelectorAll('#home-week-today .hw-log').length,
        label: document.querySelector('#home-week-today .hw-log') ? document.querySelector('#home-week-today .hw-log').textContent : '',
      }));
      expect(prog.logs).toBe(4);
      expect(prog.label).toBe('Log');
      expect(prog.text).toMatch(/kcal left|kcal over/);
      expect(prog.text).toMatch(/\d/);
      expect([card.days, card.on]).toEqual([7, 1]);
      expect(card.firstOnScreen).toBe(true);
      expect(card.nudge).toBe('none');
      expect(card.cta).toBe('none');
      expect(card.shopH).toBeGreaterThanOrEqual(44);
      expect(card.plan).not.toMatch(/No plan yet/);
      expect(card.plan).toMatch(/Your first week/);
      // My Plan reads the same saved row, at this width, not the trainer assignment.
      await p.evaluate(() => nav('portal-plan'));
      await p.waitForSelector('#portal-saved-plan');
      const mine = await p.evaluate(() => ({
        text: document.getElementById('portal-plan-body').textContent,
        h: [...document.querySelectorAll('#portal-plan-body button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height),
      }));
      expect(mine.text).toContain('Your first week');
      expect(mine.text).not.toMatch(/No meal plan yet/);
      expect(mine.text).not.toMatch(/No plan yet/);
      const minTap = width >= 1000 ? 40 : 44;
      for (const h of mine.h) expect(h).toBeGreaterThanOrEqual(minTap);
      if (shots) await p.screenshot({ path: `${shots}/my-plan-${width}.png` });
      await p.addScriptTag({ path: require.resolve('axe-core') });
      const axeProblems = await p.evaluate(async () => {
        const rules = ['button-name', 'image-alt', 'label', 'color-contrast', 'link-name', 'document-title'];
        const view = document.getElementById('view-portal-plan');
        const res = await window.axe.run(view, { runOnly: { type: 'rule', values: rules } });
        return res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(axeProblems).toEqual([]);
      await p.evaluate(() => nav('portal-home'));
      await p.waitForSelector('#home-week-name');
      const homeAxe = await p.evaluate(async () => {
        const rules = ['button-name', 'image-alt', 'label', 'color-contrast', 'link-name'];
        const res = await window.axe.run(document.getElementById('view-portal-home'), { runOnly: { type: 'rule', values: rules } });
        return res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(homeAxe).toEqual([]);
      const homeTap = await p.evaluate(() => [...document.querySelectorAll('#home-mealplan-btn, #home-week-shop, #home-mealplan button, #home-week-today .hw-log')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      for (const h of homeTap) expect(h).toBeGreaterThanOrEqual(minTap);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await p.evaluate(() => { const b = document.getElementById('home-week'); return b.scrollWidth > b.clientWidth + 1; })).toBe(false);
      if (shots) await p.screenshot({ path: `${shots}/home-week-${width}.png` });
      await p.click('#home-week-today .hw-log');
      await p.waitForFunction(() => document.querySelector('#home-week-today .hw-log').textContent === 'Logged');
      expect(db.mealLogs.length).toBe(1);
      expect(db.mealLogs[0].foodName).toBeTruthy();
      expect(db.mealLogs[0].mealType).toBeTruthy();
      expect(db.mealLogs[0].calories).toBeGreaterThan(0);

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
    it(`${width}px: a scanned allergy line is marked contains and is not a pantry win`, async () => {
      db = { profile: {}, profileSaves: [], plans: [], puts: 0, shopping: 0, warnings: [] };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForFunction(() => typeof renderScanResults === 'function' && typeof nav === 'function');
      const payload = require('./lib/receipt-scan-core').buildScanPayload([
        { name: 'Almonds 200g', quantity: 200, unit: 'g', price: 6, category: 'pantry' },
        { name: 'Firm tofu', quantity: 1, unit: 'each', price: 4.5, category: 'dairy' },
        { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
      ], { filters: ['nut free'] });
      await p.evaluate((data) => { nav('receipt-scanner'); renderScanResults(data); }, payload);
      await p.waitForSelector('#scan-items-list .allergen-badge');
      const row = await p.evaluate(() => {
        const labels = [...document.querySelectorAll('#scan-items-list label')];
        const almond = labels.find((el) => /almond/i.test(el.textContent));
        const tofu = labels.find((el) => /tofu/i.test(el.textContent));
        const groups = [...document.querySelectorAll('#scan-items-list > div')].map((el) => el.textContent);
        return {
          badge: almond.querySelector('.allergen-badge').textContent,
          checked: almond.querySelector('input').checked,
          wins: document.getElementById('scan-wins').textContent,
          tofuCal: tofu.textContent,
          groups,
        };
      });
      expect(row.badge).toBe('contains nuts');
      expect(row.checked).toBe(false);
      expect(row.wins.toLowerCase()).not.toMatch(/almond/);
      expect(row.wins.toLowerCase()).toMatch(/chicken/);
      expect(row.groups.join('\n').toLowerCase()).toMatch(/protein/);
      expect(row.groups.join('\n').toLowerCase()).not.toMatch(/dairy[\s\S]*tofu|tofu[\s\S]*dairy/);
      expect(row.tofuCal).not.toMatch(/\b25 cal\b/);
      const minTap = width >= 1000 ? 40 : 44;
      const taps = await p.evaluate(() => [...document.querySelectorAll('#view-receipt-scanner button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      for (const h of taps) expect(h).toBeGreaterThanOrEqual(minTap);
      await p.addScriptTag({ path: require.resolve('axe-core') });
      const axeProblems = await p.evaluate(async () => {
        const res = await window.axe.run(document.getElementById('view-receipt-scanner'), { runOnly: { type: 'rule', values: ['button-name', 'image-alt', 'label', 'color-contrast', 'link-name'] } });
        return res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(axeProblems).toEqual([]);
      if (shots) await p.screenshot({ path: `${shots}/scan-allergy-${width}.png` });
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
    expect(await p.textContent('#home-mealplan')).toMatch(/Couldn't load your week, try again/);
    expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);
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
    expect(await p.textContent('#home-mealplan')).toMatch(/No plan yet/);
    await ctx.close();
  });

  // A failed GET must not be painted as an empty plan. Sidebar, terms and privacy sizes are left as they are on main.
  for (const width of [320, 390, 1440]) {
    it(`${width}px: 500, 304 and an aborted read never say there is no plan`, async () => {
      const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
      db = { profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [], plans: [{ id: 1, name: 'Your first week', meals: plan.days }], puts: 0, shopping: 0, warnings: [], mealStatus: 500 };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/app.html`);
      await p.waitForSelector('#home-mealplan-error');
      expect(await p.textContent('#home-week-error')).toBe("Couldn't load your week, try again");
      expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);
      if (width === 390) {
        await p.addScriptTag({ path: require.resolve('axe-core') });
        const axeProblems = await p.evaluate(async () => {
          const res = await window.axe.run(document.getElementById('view-portal-home'), { runOnly: { type: 'rule', values: ['button-name', 'image-alt', 'label', 'color-contrast', 'link-name'] } });
          return res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        });
        expect(axeProblems).toEqual([]);
      }
      await p.evaluate(() => nav('portal-plan'));
      await p.waitForSelector('#portal-plan-error');
      const failedPlan = await p.textContent('#portal-plan-body');
      expect(failedPlan).toMatch(/Couldn't load your week, try again/);
      expect(failedPlan).not.toMatch(/No meal plan yet/);
      const minTap = width >= 1000 ? 40 : 44;
      const planTap = await p.evaluate(() => [...document.querySelectorAll('#portal-plan-body button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      expect(planTap.length).toBeGreaterThan(0);
      for (const h of planTap) expect(h).toBeGreaterThanOrEqual(minTap);
      if (shots) await p.screenshot({ path: `${shots}/my-plan-load-fail-${width}.png` });

      db.mealStatus = 0;
      db.meal304 = 'always';
      await p.evaluate(() => nav('portal-home'));
      await p.evaluate(() => loadHomeWeek());
      await p.waitForSelector('#home-mealplan-error');
      expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);
      expect(await p.textContent('#home-week')).toMatch(/Couldn't load your week/);

      db.meal304 = 'once';
      db.mealGets = 0;
      await p.evaluate(() => { S_mealPlansCache = null; return loadHomeWeek(); });
      await p.waitForSelector('#home-week-name');
      expect(await p.textContent('#home-week-name')).toBe('Your first week');
      expect(await p.textContent('#home-mealplan')).toMatch(/Your first week/);
      expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);
      expect(db.mealGets).toBeGreaterThanOrEqual(2);

      db.meal304 = 'always';
      await p.evaluate(() => loadHomeWeek());
      expect(await p.textContent('#home-week-name')).toBe('Your first week');
      expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);

      db.meal304 = null;
      db.mealAbort = true;
      await p.evaluate(() => loadHomeWeek());
      await p.waitForSelector('#home-mealplan-error');
      expect(await p.textContent('#home-week-error')).toMatch(/Couldn't load/);
      expect(await p.textContent('#home-mealplan')).not.toMatch(/No plan yet/);
      const homeTap = await p.evaluate(() => [...document.querySelectorAll('#home-mealplan-retry, #home-week-retry')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      for (const h of homeTap) expect(h).toBeGreaterThanOrEqual(minTap);
      if (shots) await p.screenshot({ path: `${shots}/home-load-fail-${width}.png` });
      if (width === 390) {
        db.mealAbort = false;
        db.trainerMeal = { meal_plan_name: 'Trainer week', total_calories: 2000 };
        db.plans = [
          { id: 4, name: 'Old planDays', meals: { planDays: [{ day: 'Monday', meals: { lunch: { name: 'Rice bowl', calories: 500, protein: 20 } } }] } },
          { id: 3, name: 'Zero meals', meals: [{ day: 'Monday', meals: {} }] },
          { id: 2, name: 'Newer empty', meals: [] },
          { id: 1, name: 'Your first week', meals: plan.days },
        ];
        await p.evaluate(() => { S_mealPlansCache = null; return loadPortalHome(); });
        await p.waitForSelector('#home-week-name');
        expect(await p.textContent('#home-week-name')).toBe('Old planDays');
        expect(await p.textContent('#home-mealplan')).toMatch(/Trainer week/);
        await p.evaluate(() => nav('portal-plan'));
        await p.waitForSelector('#portal-saved-plan');
        const both = await p.textContent('#portal-plan-body');
        expect(both).toContain('Trainer week');
        expect(both).toContain('Old planDays');
        expect(both).not.toContain('Zero meals');
        expect(both).not.toMatch(/No meal plan yet/);
        if (shots) await p.screenshot({ path: `${shots}/my-plan-trainer-${width}.png` });
      }
      await ctx.close();
    });
  }

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

  // Onboarding weeks are day-shaped (plan.days: meals is a slot object). Meal Plans used to throw
  // "d.meals.flatMap is not a function" and draw no card. The same week carries three egg hits
  // first, then satay, banana and prawn: Home shows each group once.
  for (const width of [320, 390, 1440]) {
    it(`${width}px: onboarding week renders a Meal Plans card, and Home dedupes allergen groups`, async () => {
      const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
      const breakfast = plan.days[0].meals.breakfast.name;
      db = {
        profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [],
        plans: [{ id: 1, name: 'Your first week', meals: plan.days, total_calories: 2000, goal_type: 'weight_loss' }],
        puts: 0, shopping: 0,
        warnings: [
          { meal: '', contains: [], notice: 'We couldn\'t read all your allergies, so every allergen filter is on.' },
          { meal: 'Eggs on toast', contains: ['egg'] },
          { meal: 'Egg fried rice', contains: ['egg'] },
          { meal: 'Cheese omelette', contains: ['egg'] },
          { meal: 'Satay chicken', contains: ['nuts'] },
          { meal: 'Banana bowl', contains: ['banana'] },
          { meal: 'Garlic prawns', contains: ['prawn'] },
          { meal: 'Arancini', contains: [], unchecked: true, note: 'We couldn\'t check this meal against your allergies, so check the ingredients.' },
        ],
      };
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, hasTouch: width < 1000 });
      await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      p.on('pageerror', (e) => pageErrors.push(String(e)));
      p.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      await p.goto(`${base}/app.html`);
      await p.waitForSelector('#home-week-warn');
      const red = await p.textContent('#home-week-warn');
      expect(red).toBe('⚠️ Eggs on toast contains egg; Satay chicken contains nuts; Banana bowl contains banana (+1 more in Meal Planner)');
      expect(red.match(/contains egg/g)).toEqual(['contains egg']);
      expect(red).not.toContain('Egg fried rice');
      expect(red).not.toContain('Garlic prawns');
      expect(await p.getAttribute('#home-week-warn', 'role')).toBe('alert');
      expect(await p.getAttribute('#home-week-notice', 'role')).toBe('alert');
      expect(await p.textContent('#home-week-notice')).toMatch(/couldn't read all your allergies/);
      expect(await p.getAttribute('#home-week-note', 'role')).toBeNull();
      expect(await p.textContent('#home-week-note')).toMatch(/Arancini/);
      expect(await p.evaluate(() => getComputedStyle(document.getElementById('home-week-note')).backgroundColor)).toBe('rgb(248, 250, 252)');
      const shots = process.env.MEAL_PLAN_SHOTS;
      if (shots) await p.locator('#home-week').screenshot({ path: `${shots}/home-deduped-${width}.png` });

      await p.locator('#home-week button', { hasText: 'See the full week' }).click();
      await p.waitForSelector('#view-meal-plans.active #meal-plans-grid .plan-card');
      const card = await p.textContent('#meal-plans-grid .plan-card');
      expect(card).toContain('Your first week');
      expect(card).toContain('Monday');
      expect(card).toContain('Breakfast: ' + breakfast);
      expect(card).toContain('Tuesday');
      expect(await p.locator('#meal-plans-grid .plan-card').count()).toBe(1);
      expect(pageErrors).toEqual([]);
      const jsErrors = consoleErrors.filter((t) => !/Failed to load resource|net::ERR_|favicon/i.test(t));
      expect(jsErrors).toEqual([]);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (width === 1440) {
        const buttons = await p.evaluate(() => {
          const fine = matchMedia('(pointer: fine)').matches;
          const wide = matchMedia('(min-width: 1025px)').matches;
          const hs = [...document.querySelectorAll('#meal-plans-grid .plan-card-footer button')].map((b) => ({
            text: (b.textContent || '').trim(),
            h: b.getBoundingClientRect().height,
            w: b.getBoundingClientRect().width,
          }));
          return { fine, wide, hs };
        });
        expect(buttons.fine).toBe(true);
        expect(buttons.wide).toBe(true);
        expect(buttons.hs.map((b) => b.text)).toEqual(['Edit Meals', '🛒', '✕']);
        buttons.hs.forEach((b) => { expect(b.h).toBeGreaterThanOrEqual(40); });
      }
      if (shots) {
        await p.locator('#mp-saved-section').scrollIntoViewIfNeeded();
        await p.locator('#meal-plans-grid .plan-card').screenshot({ path: `${shots}/meal-plans-card-${width}.png` });
        await p.screenshot({ path: `${shots}/meal-plans-${width}.png` });
      }
      await ctx.close();
    });
  }

  // Edit used to flatten the week and drop ingredients, so 'Peanuts 40g' stopped warning
  // and the stored calories became 0. Save, then reload: the warning and the calories stay.
  it('edit, save, reload: an ingredient-only nut warning and the calories survive', async () => {
    const meals = [{
      day: 'Monday',
      meals: {
        breakfast: { name: 'Monday bowl', calories: 480, protein: 22, carbs: 40, fat: 18, ingredients: ['Peanuts 40g'] },
      },
    }];
    db = {
      profile: { targetCalories: 2000, targetProtein: 130 }, profileSaves: [],
      plans: [{ id: 3, name: 'Your first week', meals, total_calories: 480, goal_type: 'weight_loss' }],
      puts: 0, shopping: 0, warningsFromMeals: true, recompute: true,
    };
    expect(allergenWarningsFor(meals)).toEqual([{ meal: 'Monday bowl', contains: ['nuts'] }]);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
    const p = await ctx.newPage();
    const pageErrors = [];
    p.on('pageerror', (e) => pageErrors.push(String(e)));
    await p.goto(`${base}/app.html`);
    await p.waitForFunction(() => typeof nav === 'function' && S && S.user);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); nav('meal-plans'); });
    await p.waitForSelector('#meal-plans-grid .plan-card');
    const before = await p.textContent('#meal-plans-grid .plan-card');
    expect(before).toContain('Monday bowl');
    expect(before).toContain('contains nuts');
    expect(before).not.toMatch(/couldn't check/);
    expect(before).toContain('480 cal/day');
    await p.locator('#meal-plans-grid button', { hasText: 'Edit Meals' }).click();
    await p.waitForSelector('#modal-edit-meal-plan.open #edit-mp-meals [data-field=name]');
    expect(await p.inputValue('#edit-mp-meals [data-field=name]')).toBe('Monday bowl');
    expect(await p.inputValue('#edit-mp-meals [data-field=path]')).toBe('0.meals.breakfast');
    await p.fill('#edit-mp-meals [data-field=calories]', '510');
    await p.locator('#modal-edit-meal-plan button', { hasText: 'Save Changes' }).click();
    await p.waitForFunction(() => !document.getElementById('modal-edit-meal-plan').classList.contains('open'));
    await p.waitForFunction(() => (document.querySelector('#meal-plans-grid .plan-card') || {}).textContent.includes('510'));
    const saved = db.plans[0];
    expect(saved.meals[0].day).toBe('Monday');
    expect(saved.meals[0].meals.breakfast.name).toBe('Monday bowl');
    expect(saved.meals[0].meals.breakfast.ingredients).toEqual(['Peanuts 40g']);
    expect(saved.meals[0].meals.breakfast.calories).toBe(510);
    expect(saved.total_calories).toBe(510);
    expect(allergenWarningsFor(saved.meals)).toEqual([{ meal: 'Monday bowl', contains: ['nuts'] }]);
    await p.reload();
    await p.waitForFunction(() => typeof nav === 'function' && S && S.user);
    await p.evaluate(() => { document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open')); nav('meal-plans'); });
    await p.waitForSelector('#meal-plans-grid .plan-card');
    const after = await p.textContent('#meal-plans-grid .plan-card');
    expect(after).toContain('Monday bowl');
    expect(after).toContain('contains nuts');
    expect(after).toContain('510 cal');
    expect(after).not.toMatch(/couldn't check/);
    expect(after).not.toContain('Not checked');
    expect(pageErrors).toEqual([]);
    await ctx.close();
  });
});
