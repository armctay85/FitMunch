'use strict';

// Playwright is not a devDependency, so this guards the 390px phone layout of
// the signed-in app at the CSS level: the bottom nav replaces the sidebar and
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
});
