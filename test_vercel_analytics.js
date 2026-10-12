'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
// Google site verification is a token file, not a page.
const SKIP = new Set(['google3b5c73dd27c81eaf.html']);

describe('Vercel Web Analytics', () => {
  const pages = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html') && !SKIP.has(f));

  it('finds the served pages', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const file of pages) {
    it(`${file} loads the same-origin insights script once, before </body>`, () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      const tag = '<script defer src="/_vercel/insights/script.js"></script>';
      expect(html.split(tag).length - 1).toBe(1);
      expect(html.indexOf(tag)).toBeLessThan(html.lastIndexOf('</body>'));
      expect(html).toContain('window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};');
    });
  }

  it('CSP already allows the same-origin script and beacon', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const csp = cfg.headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/connect-src 'self'/);
  });
});
