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
