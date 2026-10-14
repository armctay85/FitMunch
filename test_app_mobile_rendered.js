'use strict';

// Renders the signed-in app in a real browser at 320px, 390px and 768px with a mocked
// /api, opens every view and modal, and checks that nothing is wider than the
// screen and that every visible tap target is at least 44px. Uses the system
// Chrome (CHROME env var, or the usual install paths); skipped locally if none
// is found, but fails when CI=true. Also runs at 768px (touch tablet).
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  process.env.CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
// In CI a missing Chrome is a failure, not a silent skip.
if (!executablePath && process.env.CI) {
  throw new Error('test_app_mobile_rendered: no Chrome found and CI=true. Install Chrome or set CHROME.');
}
const maybe = executablePath ? describe : describe.skip;

const user = (role) => ({ success: true, user: { id: 7, name: 'Sam Rivers', email: 'sam@example.com', role, subscriptionTier: 'premium', settings: {} } });
const plan = { id: 11, name: 'Lean week', meals: [], total_calories: 2000, created_at: '2026-10-10' };
const generic = {
  success: true,
  lists: [{ id: 1, name: 'Lean week: shopping list', items: [{ name: 'Chicken breast', qty: '1.12 kg', category: 'meat', checked: false }, { name: 'Brown rice, cooked', qty: '1.4 kg', category: 'grains', checked: true }], created_at: '2026-10-12' }],
  plans: [plan], mealPlans: [plan], workoutPlans: [],
  clients: [{ id: 3, client_id: 3, name: 'Alex Chen', email: 'alex@example.com', status: 'active', phase: 'cut' }],
  logs: [],
};
const VIEWS = {
  client: ['portal-home', 'ai-coach', 'portal-meals', 'portal-workouts', 'portal-plan', 'portal-progress', 'portal-shopping', 'receipt-scanner', 'meal-plans', 'shopping-lists', 'billing'],
  pt: ['dashboard', 'clients', 'meal-plans', 'workout-plans', 'shopping-lists', 'billing'],
};
const MODALS = ['modal-log-meal', 'modal-mealplan', 'modal-generate-shopping', 'modal-goals', 'modal-invite', 'modal-assign', 'modal-log-workout', 'modal-manual-list'];


// Every wait in this file has its own timeout so a stuck page fails fast instead of hanging.
const STEP_MS = 5000;      // any single wait
const SETTLE_MS = 60000;   // a whole settle() call
// The onboarding pop-up opens on an 800ms timer after /portal/me resolves. Rather than wait
// on the clock, the view checks pre-set its flag (fm_goals_prompted) so the timer never arms,
// and settle() asserts that state; the pop-up itself is tested on its own by waiting for its
// .open state.

// Proof the onboarding timer never armed (EQA #123 r2): before any app script runs, wrap
// setTimeout and count every timer whose callback opens the onboarding pop-up. settle() then
// requires that count to be 0, so a pre-set flag alone is not trusted; if the flag stops
// working, the count goes to 1 and the view checks fail (see the mutation test below).
const TRACK_ONBOARD_TIMERS = () => {
  window.__fmOnboardTimers = 0;
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ...rest) {
    try { if (typeof fn === 'function' && /openOnboarding|modal-onboard|modal-goals/.test(String(fn))) window.__fmOnboardTimers += 1; } catch (e) { /* ignore */ }
    return orig.call(this, fn, ...rest);
  };
};

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms}ms: ${what}`)), ms); })]).finally(() => clearTimeout(t));
}

// One snapshot of the page: finite animations finished, then which pop-ups are open and
// whether anything finite is still moving. Infinite animations (the .loader spinner) never
// finish, so they are ignored rather than awaited.
async function snapshot(page) {
  return withTimeout(page.evaluate(async (stepMs) => {
    const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 250); });
    const capped = (p) => Promise.race([p, new Promise((r) => setTimeout(r, stepMs))]);
    const finite = (x) => { try { return x.effect.getComputedTiming().iterations !== Infinity; } catch (_) { return true; } };
    const moving = () => document.getAnimations().filter(finite).filter((x) => x.playState === 'running' || x.playState === 'pending');
    await capped(Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map((l) => (l.sheet ? null : new Promise((r) => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); })))));
    await capped(document.fonts.ready);
    await frame(); await frame();
    void document.body.getBoundingClientRect();
    const running = moving();
    await capped(Promise.all(running.map((x) => x.finished.catch(() => {}))));
    await frame(); await frame();
    const open = [...document.querySelectorAll('.modal-overlay.open')].map((m) => m.id).join(',');
    const still = moving();
    return { open, quiet: running.length === 0 && still.length === 0, moving: still.map((x) => x.animationName || (x.effect && x.effect.target && x.effect.target.id) || 'anim').slice(0, 3).join(',') };
  }, STEP_MS), STEP_MS * 4, 'page snapshot');
}

// Waits until the page is at rest: network idle, stylesheets and fonts loaded, no finite
// animation running, and two consecutive snapshots agree. With onboardingDone the onboarding
// flag must be set, so no pop-up timer can still be pending.
async function settle(page, opts) {
  return withTimeout(settleInner(page, opts), SETTLE_MS + STEP_MS, 'settle');
}
async function settleInner(page, { onboardingDone = true } = {}) {
  if (onboardingDone) {
    const flag = await withTimeout(page.evaluate(() => sessionStorage.getItem('fm_goals_prompted')), STEP_MS * 4, 'onboarding flag');
    if (flag !== '1') throw new Error('onboarding flag not set: its 800ms pop-up timer could still fire');
    // Wait for /portal/me to be handled (the point where the app would arm the timer), then
    // require that no onboarding timer was ever scheduled.
    await page.waitForLoadState('networkidle', { timeout: STEP_MS }).catch(() => {});
    const armed = await withTimeout(page.evaluate(() => window.__fmOnboardTimers), STEP_MS * 4, 'onboarding timer count');
    if (armed !== 0) throw new Error(`onboarding pop-up timer was armed ${armed} time(s): the view checks are not at rest`);
  }
  const deadline = Date.now() + SETTLE_MS;
  let a = null;
  while (Date.now() < deadline) {
    await page.waitForLoadState('networkidle', { timeout: STEP_MS }).catch(() => {});
    // A snapshot that times out (a starved renderer under CPU load) counts as not settled yet.
    a = await snapshot(page).catch((e) => ({ open: '?', quiet: false, error: e.message }));
    if (!a.quiet) continue;
    const b = await snapshot(page).catch((e) => ({ open: '?', quiet: false, error: e.message }));
    if (b.quiet && a.open === b.open) return b.open;
    a = b;
  }
  throw new Error(`page never settled within ${SETTLE_MS}ms: pop-ups or animations kept changing (last ${JSON.stringify(a)})`);
}

// Every open pop-up must be at its final size (scale 1) before anything is measured.
async function openScales(page) {
  return withTimeout(page.evaluate(() => [...document.querySelectorAll('.modal-overlay.open')].map((o) => {
    const m = o.querySelector('.modal') || o;
    const t = new DOMMatrix(getComputedStyle(m).transform);
    return { id: o.id, scale: Math.hypot(t.a, t.b) };
  })), STEP_MS * 4, 'pop-up scales');
}
function scaleProblems(name, scales) {
  return scales.filter((x) => Math.abs(x.scale - 1) > 0.001).map((x) => `${name}: pop-up ${x.id} measured at scale ${x.scale}`);
}

async function measure(page) {
  return withTimeout(page.evaluate(() => {
    const vw = innerWidth;
    const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && b.bottom > 0 && b.top < innerHeight * 3; };
    const clipped = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
    const over = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > vw + 1 && !clipped(e)).map((e) => e.id || e.className || e.tagName);
    const small = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,[onclick],[role=button]')]
      .filter(vis)
      .filter((e) => !(e.tagName === 'A' && getComputedStyle(e).display === 'inline'))
      .filter((e) => { const b = e.getBoundingClientRect(); return b.height < 43.5 || b.width < 43.5; })
      .map((e) => `${(e.innerText || e.id || e.tagName).trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return { scrollW: document.documentElement.scrollWidth, vw, over: over.slice(0, 5), small: small.slice(0, 5) };
  }), STEP_MS * 4, 'measure');
}

// Settle, check every open pop-up's scale, measure, then re-check that the same pop-ups
// are still open (a pop-up that opened mid-measure would make the numbers meaningless).
async function checkScreen(page, name, opts) {
  const problems = [];
  const before = await settle(page, opts);
  problems.push(...scaleProblems(name, await openScales(page)));
  const r = await measure(page);
  const after = await snapshot(page);
  if (after.open !== before) problems.push(`${name}: pop-ups changed while measuring (${before || 'none'} -> ${after.open || 'none'})`);
  problems.push(...scaleProblems(name, await openScales(page)));
  if (r.scrollW > r.vw) problems.push(`${name}: scrollWidth ${r.scrollW} > ${r.vw}`);
  if (r.over.length) problems.push(`${name}: overflows ${r.over.join(', ')}`);
  if (r.small.length) problems.push(`${name}: small targets ${r.small.join(', ')}`);
  return problems;
}

async function openApp(browser, base, role, viewport, { onboardingDone = true } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  // The view checks mark the onboarding pop-up as already shown; it is tested on its own below.
  await ctx.addInitScript((done) => { localStorage.setItem('fm_token', 'test.token'); if (done) sessionStorage.setItem('fm_goals_prompted', '1'); }, onboardingDone);
  await ctx.addInitScript(TRACK_ONBOARD_TIMERS);
  await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? user(role) : generic }));
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_MS * 3);
  await page.goto(`${base}/app.html`, { timeout: 90000 });
  await page.waitForFunction(() => typeof nav === 'function' && document.documentElement.classList.contains('fm-authed'), null, { timeout: 15000 });
  return { ctx, page };
}

// Browser tests on a shared CI runner can be starved of CPU: retry a failed test once
// (a real layout failure fails both times) and give slow mode a longer budget.
if (typeof jest.retryTimes === 'function') jest.retryTimes(process.env.CI ? 1 : 0, { logErrorsBeforeRetry: true });

maybe('signed-in app rendered on phones', () => {
  jest.setTimeout(process.env.FM_SLOW_TESTS ? 360000 : 180000);
  let server; let browser; let base;

  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });

  for (const role of ['client', 'pt']) {
    for (const width of [320, 390, 768]) {
      // One test per role and width, each with its own timeout, so no single test runs long.
      it(`${role} at ${width}px: no horizontal overflow and 44px tap targets in every view and modal`, async () => {
        const { ctx, page } = await openApp(browser, base, role, { width, height: 760 });
        const problems = [];
        problems.push(...await checkScreen(page, 'start'));
        for (const t of [...VIEWS[role].map((v) => ({ v })), ...MODALS.map((m) => ({ m }))]) {
          await withTimeout(page.evaluate((t) => {
            document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open'));
            if (t.v) nav(t.v); else openModal(t.m);
          }, t), STEP_MS, `open ${t.v || t.m}`);
          problems.push(...await checkScreen(page, t.v || t.m));
        }
        await ctx.close();
        expect(problems).toEqual([]);
      }, 240000);
    }
  }

  // Mutation check for the timer proof: without the pre-set flag the app arms the 800ms
  // onboarding timer, and settle() must fail (it would pass on the flag alone, since the app
  // sets the flag itself just before arming the timer).
  it('settle() fails when the onboarding flag is not pre-set (the timer armed)', async () => {
    const { ctx, page } = await openApp(browser, base, 'client', { width: 390, height: 760 }, { onboardingDone: false });
    await page.waitForFunction(() => window.__fmOnboardTimers > 0, null, { timeout: 15000 });
    const err = await settle(page).then(() => null, (e) => e.message);
    const flag = await page.evaluate(() => sessionStorage.getItem('fm_goals_prompted'));
    await ctx.close();
    expect(flag).toBe('1');
    expect(err).toMatch(/onboarding pop-up timer was armed 1 time/);
  }, 120000);

  it('with the flag pre-set no onboarding timer is ever armed', async () => {
    const { ctx, page } = await openApp(browser, base, 'client', { width: 390, height: 760 });
    await settle(page);
    const n = await page.evaluate(() => window.__fmOnboardTimers);
    const open = await page.evaluate(() => !!document.querySelector('#modal-onboard.open, #modal-goals.open'));
    await ctx.close();
    expect(n).toBe(0);
    expect(open).toBe(false);
  }, 120000);

  // The onboarding pop-up opens on its own 800ms timer, so it gets its own test: wait for
  // it to open, let it settle, and check its scale, overflow and tap targets.
  for (const width of [320, 390]) {
    it(`client at ${width}px: the onboarding pop-up opens on its timer at full size with 44px targets`, async () => {
      const { ctx, page } = await openApp(browser, base, 'client', { width, height: 760 }, { onboardingDone: false });
      await page.waitForFunction(() => document.querySelector('#modal-onboard.open, #modal-goals.open'), null, { timeout: 15000 });
      const problems = await checkScreen(page, 'onboarding', { onboardingDone: false });
      const open = (await snapshot(page)).open;
      await ctx.close();
      expect(open).toMatch(/modal-onboard|modal-goals/);
      expect(problems).toEqual([]);
    }, 120000);
  }

  // Mutation check for the scale check: a pop-up held mid-zoom must be reported. If the scale
  // check is deleted from checkScreen, this test fails.
  it('a pop-up measured mid-zoom is reported (scale check is live)', async () => {
    const { ctx, page } = await openApp(browser, base, 'client', { width: 390, height: 760 });
    await settle(page);
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.textContent = '#modal-goals .modal, #modal-log-meal .modal{transform:scale(.96) !important;transition:none !important}';
      document.head.appendChild(st);
      openModal('modal-goals'); openModal('modal-log-meal');
    });
    const problems = await checkScreen(page, 'mutant');
    await ctx.close();
    const scaled = problems.filter((p) => /measured at scale 0\.96/.test(p));
    expect(scaled.some((p) => p.includes('modal-goals'))).toBe(true);
    expect(scaled.some((p) => p.includes('modal-log-meal'))).toBe(true);
  }, 120000);

  // An infinite animation (the loading spinner) must not stop the page from settling.
  it('settles with the infinite spinner running', async () => {
    const { ctx, page } = await openApp(browser, base, 'client', { width: 390, height: 760 });
    await withTimeout(page.evaluate(() => { const l = document.createElement('div'); l.className = 'loader'; l.id = 'spin-test'; document.body.appendChild(l); }), STEP_MS, 'add spinner');
    const t0 = Date.now();
    await settle(page);
    const spinning = await withTimeout(page.evaluate(() => document.getAnimations().some((a) => a.effect.target && a.effect.target.id === 'spin-test' && a.playState === 'running')), STEP_MS, 'spinner state');
    await ctx.close();
    expect(spinning).toBe(true);
    expect(Date.now() - t0).toBeLessThan(SETTLE_MS);
  }, 120000);

  // Above 1024px the header action buttons are also at least 44px tall.
  it('header buttons are at least 44px tall at 1280px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 'test.token'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    await ctx.addInitScript(TRACK_ONBOARD_TIMERS);
    await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? user('pt') : generic }));
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(STEP_MS * 3);
    await page.goto(`${base}/app.html`, { timeout: 90000 });
    await page.waitForFunction(() => typeof nav === 'function' && document.documentElement.classList.contains('fm-authed'), null, { timeout: 15000 });
    const short = [];
    for (const v of VIEWS.pt) {
      await withTimeout(page.evaluate((v) => nav(v), v), STEP_MS, `nav ${v}`);
      await settle(page);
      short.push(...await page.evaluate(() => [...document.querySelectorAll('.view.active .view-actions .btn, .view[style*="block"] .view-actions .btn')]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .filter((e) => e.getBoundingClientRect().height < 43.5)
        .map((e) => `${e.innerText.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}px`)));
    }
    await ctx.close();
    expect(short).toEqual([]);
  }, 120000);
});
