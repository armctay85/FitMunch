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

maybe('signed-in app rendered on phones', () => {
  jest.setTimeout(180000);
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
      it(`${role} at ${width}px: no horizontal overflow and 44px tap targets in every view and modal`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(() => localStorage.setItem('fm_token', 'test.token'));
        await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? user(role) : generic }));
        await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
        const page = await ctx.newPage();
        await page.goto(`${base}/app.html`);
        await page.waitForFunction(() => typeof nav === 'function' && document.documentElement.classList.contains('fm-authed'), null, { timeout: 15000 });
        const problems = [];
        for (const t of [...VIEWS[role].map((v) => ({ v })), ...MODALS.map((m) => ({ m }))]) {
          await page.evaluate((t) => {
            document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open'));
            if (t.v) nav(t.v); else openModal(t.m);
          }, t);
          await page.waitForTimeout(600);
          const r = await page.evaluate(() => {
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
          });
          const name = t.v || t.m;
          if (r.scrollW > r.vw) problems.push(`${name}: scrollWidth ${r.scrollW} > ${r.vw}`);
          if (r.over.length) problems.push(`${name}: overflows ${r.over.join(', ')}`);
          if (r.small.length) problems.push(`${name}: small targets ${r.small.join(', ')}`);
        }
        await ctx.close();
        expect(problems).toEqual([]);
      });
    }
  }
});
