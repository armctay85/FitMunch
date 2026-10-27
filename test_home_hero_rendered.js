'use strict';
// Measures the homepage hero app render in a real browser at 320, 390 and 860-1099 (where it is
// narrowest): every number and label in the render is at least 11px on screen, nothing overflows,
// and the render stays inside its figure (no overlap with what follows). Same CI guard as the others.
const fs = require('fs');
const path = require('path');
const FX = require('./scripts/fixtures/hero-app-render.json');

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
  console.warn(`\n!!! SKIPPING test_home_hero_rendered.js: ${!installed ? 'playwright-core is not installed' : !chromium ? `playwright-core failed to load (${loadError && loadError.message})` : 'no Chrome/Chromium executable found (set CHROME)'}. The hero was NOT measured in a real browser.\n`);
}
if (mustRun && !canRun) {
  describe('home hero rendered (CI, playwright-core installed)', () => {
    it('can launch a browser', () => { throw new Error('test_home_hero_rendered.js cannot run in CI: no browser'); });
  });
}
const maybe = canRun ? describe : describe.skip;

maybe('home hero app render, measured', () => {
  jest.setTimeout(120000);
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use('/api', (req, res) => res.json({}));
    app.use(express.static(path.join(__dirname, 'public')));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [320, 390, 768, 860, 899, 900, 1024, 1099, 1100, 1440]) {
    it(`${width}px: hero numbers and labels ≥11px, no overflow, render inside its figure`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`${base}/`);
      await p.waitForFunction(() => { const i = document.querySelector('.hero-app'); return i && i.complete && i.naturalWidth > 0; });
      const m = await p.evaluate(() => {
        const img = document.querySelector('.hero-app').getBoundingClientRect();
        const fig = document.querySelector('.hero-shot').getBoundingClientRect();
        const cap = document.querySelector('.hero-shot figcaption').getBoundingClientRect();
        return { w: img.width, bottom: img.bottom, figBottom: fig.bottom, capTop: cap.top, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(m.overflow).toBe(false);
      expect((m.w * FX.minFontCssPx) / FX.sourceCssWidth).toBeGreaterThanOrEqual(11);
      expect(m.bottom).toBeLessThanOrEqual(m.capTop + 0.5);
      expect(m.bottom).toBeLessThanOrEqual(m.figBottom + 0.5);
      await ctx.close();
    });
  }
});

// WCAG contrast from the rendered colour, compositing translucent text and
// backgrounds onto the real backdrop. Guards the nav CTA, the trial note,
// and the closing buttons that a broader link rule used to paint green.
function contrastOf(el, { border = false } = {}) {
  function parse(c) {
    const m = String(c).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 1 };
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  }
  function lin(ch) {
    const c = ch / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function lum(rgb) {
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }
  function over(fg, bg) {
    const a = fg.a == null ? 1 : fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
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
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  }
  function ratio(fg, bg) {
    const hi = Math.max(lum(fg), lum(bg));
    const lo = Math.min(lum(fg), lum(bg));
    return (hi + 0.05) / (lo + 0.05);
  }
  const cs = getComputedStyle(el);
  const bg = backdrop(el);
  if (border) {
    const edge = over(parse(cs.borderTopColor), bg);
    return ratio(edge, bg);
  }
  return ratio(over(parse(cs.color), bg), bg);
}

const CONVERT_PAGES = [
  '/ai-meal-planner-australia.html',
  '/high-protein-staples-meal-plan.html',
  '/meal-plan-software-personal-trainers.html',
  '/receipt-nutrition-scanner.html',
  '/pt-client-meal-plans.html',
  '/meal-plan-for-one.html',
  '/macro-meal-planner.html',
  '/meal-prep-shopping-list.html',
  '/supermarket-meal-planner.html',
  '/fitmunch-coach-vs-spreadsheets.html',
  '/grocery-meal-planner.html',
  '/high-protein-shopping-list.html',
  '/family-meal-plan.html',
  '/haul-teardown.html',
  '/ai-meal-plan-shopping-list.html',
];

maybe('contrast guards, measured', () => {
  jest.setTimeout(180000);
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use('/api', (req, res) => res.json({}));
    app.use(express.static(path.join(__dirname, 'public')));
    app.get(['/404', '/404.html'], (req, res) => {
      res.status(404).sendFile(path.join(__dirname, 'private', '404.html'));
    });
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

  for (const width of [320, 390, 768, 1440]) {
    it(`nav Start free is at least 4.5:1 at rest, hover, and focus (${width}px)`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(`${base}/`);
      const cta = p.locator('.nav-links a.nav-cta');
      await cta.scrollIntoViewIfNeeded();
      const rest = await cta.evaluate(contrastOf);
      await cta.hover();
      const hovered = await cta.evaluate(contrastOf);
      await cta.focus();
      const focused = await cta.evaluate(contrastOf);
      expect(rest).toBeGreaterThanOrEqual(4.5);
      expect(hovered).toBeGreaterThanOrEqual(4.5);
      expect(focused).toBeGreaterThanOrEqual(4.5);
      await ctx.close();
    });
  }

  it('homepage has no sample-day goal chips', async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`);
    expect(await p.locator('.goal-chip').count()).toBe(0);
    expect(await p.locator('#plan-demo').count()).toBe(0);
    await ctx.close();
  });

  it('hero trial button is at least 44px tall at 320px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`);
    const box = await p.locator('.hero-ctas .btn').first().boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });

  it('trial door note is at least 4.5:1 and 12px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/login.html?plan=premium#register`);
    await p.waitForFunction(() => {
      const n = document.getElementById('email-first-note');
      return n && getComputedStyle(n).display !== 'none';
    });
    const note = p.locator('#email-first-note');
    const ratio = await note.evaluate(contrastOf);
    const font = await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(font).toBeGreaterThanOrEqual(12);
    await ctx.close();
  });

  it('closing buttons on every convert block are at least 4.5:1', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage();
    for (const href of CONVERT_PAGES) {
      await p.goto(`${base}${href}`);
      const buttons = p.locator('.fm-convert a.fm-btn, .content-inner a.fm-btn');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        await btn.scrollIntoViewIfNeeded();
        const ghost = await btn.evaluate((el) => el.classList.contains('fm-btn-ghost'));
        expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        if (ghost) expect(await btn.evaluate(contrastOf, { border: true })).toBeGreaterThanOrEqual(4.5);
        await btn.hover();
        expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        await btn.focus();
        expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
      }
    }
    await ctx.close();
  });

  const GHOST_PAGES = [
    '/receipt-nutrition-scanner.html',
    '/pricing.html',
    '/for-pts.html',
    '/haul-teardown.html',
    '/ai-meal-planner-australia.html',
    '/404.html',
  ];

  for (const width of [320, 390, 768, 1440]) {
    it(`ghost buttons clear 4.5:1 text and 3:1 border at ${width}px`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage();
      for (const href of GHOST_PAGES) {
        await p.goto(`${base}${href}`);
        const buttons = p.locator('a.fm-btn-ghost, button.fm-btn-ghost');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          const box = await btn.boundingBox();
          if (!box || box.width < 2 || box.height < 2) continue;
          await btn.scrollIntoViewIfNeeded();
          expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
          expect(await btn.evaluate(contrastOf, { border: true })).toBeGreaterThanOrEqual(3);
          await btn.hover();
          expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
          await btn.focus();
          expect(await btn.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        }
      }
      await ctx.close();
    });
  }
});
