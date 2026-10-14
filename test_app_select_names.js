'use strict';

// Every <select> in app.html has an accessible name: an aria-label, aria-labelledby,
// a <label for> that points at it, or a wrapping <label>. Then axe runs in a real
// browser at 320, 390 and 768px over the Meal and Workout Plans screens and the
// plan modals and must find no unnamed select or form control.
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');

describe('app.html selects have accessible names (static)', () => {
  const selects = [...HTML.matchAll(/<select\b([^>]*)>/g)];
  it('finds the selects', () => { expect(selects.length).toBeGreaterThan(15); });
  it.each(selects.map((m) => [m[1].match(/id="([^"]+)"/)?.[1] || m[1].trim().slice(0, 60), m]))('%s', (_name, m) => {
    const attrs = m[1];
    if (/aria-label(ledby)?="[^"]+"/.test(attrs)) return;
    const id = attrs.match(/id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    const forRe = new RegExp(`<label\\b[^>]*for="${id}"[^>]*>\\s*[^<\\s]`);
    const before = HTML.slice(0, m.index);
    const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    expect(forRe.test(HTML) || wrapped).toBe(true);
  });
});

const CANDIDATES = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
if (!executablePath && process.env.CI) throw new Error('test_app_select_names: no Chrome found and CI=true.');
const maybe = executablePath ? describe : describe.skip;

const user = { success: true, user: { id: 7, name: 'Sam Rivers', email: 'sam@example.com', role: 'pt', subscriptionTier: 'premium', settings: {} } };
const generic = { success: true, lists: [], plans: [], mealPlans: [], workoutPlans: [], clients: [], logs: [] };
const TARGETS = [{ v: 'meal-plans' }, { v: 'workout-plans' }, { m: 'modal-mealplan' }, { m: 'modal-assign' }, { m: 'modal-generate-shopping' }, { m: 'modal-log-meal' }];
const RULES = ['select-name', 'label', 'aria-input-field-name'];

maybe('axe: no unnamed selects on the plans screens', () => {
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });

  for (const width of [320, 390, 768]) {
    it(`axe at ${width}px`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(() => localStorage.setItem('fm_token', 'test.token'));
      await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? user : generic }));
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const page = await ctx.newPage();
      await page.goto(`${base}/app.html`);
      await page.waitForFunction(() => typeof nav === 'function' && document.documentElement.classList.contains('fm-authed'), null, { timeout: 15000 });
      await page.addScriptTag({ path: require.resolve('axe-core') });
      const problems = [];
      for (const t of TARGETS) {
        await page.evaluate((t) => {
          document.querySelectorAll('.modal-overlay.open').forEach((e) => e.classList.remove('open'));
          if (t.v) nav(t.v); else openModal(t.m);
        }, t);
        await page.waitForTimeout(300);
        const res = await page.evaluate((rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules } }), RULES);
        for (const v of res.violations) problems.push(`${t.v || t.m}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      }
      await ctx.close();
      expect(problems).toEqual([]);
    }, 120000);
  }
});
