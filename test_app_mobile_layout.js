'use strict';

// CSS-level guard for the phone layout of the signed-in app (the rendered check
// lives in test_app_mobile_rendered.js): the bottom nav replaces the sidebar and
// nothing inside a view or a modal may be wider than the screen.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');

function mediaBlock(query) {
  const start = html.indexOf(`@media (${query}) {`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unterminated media block');
}

describe('signed-in app at 390px (no horizontal overflow)', () => {
  const phone = mediaBlock('max-width: 767px');

  it('shows the bottom nav and hides the sidebar on phones', () => {
    expect(phone).toMatch(/\.mobile-nav\{display:block\}/);
    expect(phone).toMatch(/\.sidebar\{display:none!important\}/);
  });

  it('lets views, grid items and form fields shrink below their content width', () => {
    expect(phone).toMatch(/\.main,\.view,\.scroll-body\{min-width:0\}/);
    expect(phone).toMatch(/\.scroll-body \*,\.modal \*\{min-width:0\}/);
    expect(phone).toMatch(/\.scroll-body input,\.scroll-body select,\.scroll-body textarea,\.modal input,\.modal select,\.modal textarea\{max-width:100%\}/);
  });

  it('keeps modals inside the screen and collapses wide inline grids to two columns', () => {
    expect(phone).toMatch(/\.modal\{width:calc\(100vw - 24px\);max-width:calc\(100vw - 24px\)/);
    expect(phone).toMatch(/\.modal \[style\*="grid-template-columns"\]\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}/);
    expect(phone).toMatch(/\.scroll-body \[style\*="repeat\(3"\]/);
    expect(phone).toMatch(/\.view-actions\{flex-wrap:wrap/);
  });

  it('has no fixed-width element wider than 390px in the app markup', () => {
    const widths = [...html.matchAll(/(?:^|[;{\s"])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    const wide = widths.filter((w) => w > 390);
    // .modal is 460px on desktop and is overridden on phones (asserted above).
    expect(wide.every((w) => w === 460)).toBe(true);
  });

  it('every main nav view is reachable from the phone bottom nav', () => {
    for (const id of ['portal-home', 'ai-coach', 'portal-meals', 'portal-workouts', 'portal-plan', 'portal-progress', 'portal-shopping', 'receipt-scanner', 'meal-plans', 'shopping-lists', 'billing', 'dashboard', 'clients']) {
      expect(html).toMatch(new RegExp(`\\{id:'${id}',\\s*icon:`));
    }
  });

  it('gives phone tap targets 44px and moves Sign out into the More sheet', () => {
    expect(phone).toMatch(/\.topnav \.btn-logout\{display:none\}/);
    expect(phone).toMatch(/\.nav-btn,\.diet-tag,\.metric-cta,[^{]*\{min-height:44px;min-width:44px\}/);
    expect(html).toMatch(/onclick="logout\(\)">🚪 Sign Out<\/button>/);
  });

  it('uses AA-contrast brand greens and visible focus styles', () => {
    expect(html).toMatch(/:root\{--leaf:#15803d;--leaf2:#166534;/);
    expect(html).toMatch(/\.modal input:focus-visible[^{]*\{outline:2px solid var\(--leaf2\);outline-offset:2px\}/);
    expect(html).toMatch(/\.modal-overlay\{visibility:hidden\}/);
  });

  it('names no supermarket in the signed-in app copy', () => {
    const copy = html;
    expect(copy).not.toMatch(/Woolies|Woolworths|\bColes\b|\bAldi\b|\bIGA\b|Costco/i);
  });

  it('puts header buttons on their own row below 1024px, 44px logo and Sign out at every width, labelled selects, AA checked items', () => {
    expect(html).toMatch(/@media \(max-width: 1024px\) \{\n \.view-header\{flex-wrap:wrap\}\n \.view-actions\{flex-wrap:wrap;width:100%\}\n \.view-actions \.btn\{white-space:nowrap;min-height:44px\}/);
    expect(html).toMatch(/\.nav-logo\{[^}]*min-height:44px\}/);
    expect(html).toMatch(/\.btn-logout\{[^}]*min-height:44px;min-width:44px\}/);
    expect(html).not.toMatch(/\.shop-item\.checked\{opacity/);
    expect(html).toContain('id="detail-phase" aria-label="Client phase"');
    expect(html).toContain('id="scan-meal-type" aria-label="Meal time"');
    expect(html).toContain('aria-label="Meal time" style="padding:4px 6px;font-size:.78rem" data-field="mealType"');
  });

  it('Shopping Lists copy does not point at the retired shopper', () => {
    expect(html).toContain('id="sl-sub">Your lists, ready for your next shop.</div>');
    expect(html).not.toMatch(/href="\/shopper"|Fitness Butler shopper/);
  });
});
