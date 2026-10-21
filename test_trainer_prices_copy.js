const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');

describe('trainer prices match pricing.html (A$39 / A$79)', () => {
  const app = read('app.html');
  test('pricing.html is the source: A$39 and A$79', () => {
    const pricing = read('pricing.html');
    expect(pricing).toContain('A$39');
    expect(pricing).toContain('A$79');
  });
  test('in-app Billing shows A$39 and A$79 and sells the coach plans', () => {
    expect(app).toContain('>A$39<');
    expect(app).toContain('>A$79<');
    expect(app).toContain("startCheckout('coach-39', this)");
    expect(app).toContain("startCheckout('coach-79', this)");
    expect(app).toMatch(/plan === 'coach-39' \|\| plan === 'coach-79'\) \? '\/coach\/checkout'/);
  });
  test.each(['app.html', 'success.html', 'pricing.html', 'for-pts.html'])('%s shows no old trainer prices', (f) => {
    expect(read(f)).not.toMatch(/\$59(\.99)?\b|\$99\b(?!\.)|PT Starter|PT Pro/i);
  });
});

describe('copy hygiene', () => {
  test('meal plan timing is not understated', () => {
    const app = read('app.html');
    expect(app).not.toMatch(/~\s*15 seconds|about 30 seconds/);
    expect(app).toContain('Takes up to about a minute · common Australian supermarket ingredients');
    expect(app).toContain('No plan yet. Generate an Aussie supermarket week in up to about a minute.');
  });
  test('no dead fmNotifications hook in script.js', () => {
    expect(read('script.js')).not.toContain('fmNotifications');
  });
});

describe('trainer Billing', () => {
  const app = read('app.html');
  const billing = app.slice(app.indexOf('id="view-billing"'), app.indexOf('<!-- ══ HOME'));
  test('no store names in the planner lines', () => {
    const lines = app.split('\n').filter((l) => /about a minute/.test(l));
    // Static empty state, plus the same sentence painted only after a successful empty load.
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).not.toMatch(/Woolies|Coles|Woolworths/i);
  });
  test('no checkout for retired pt-* plans', () => {
    expect(app).not.toMatch(/startCheckout\(\s*['"]pt-/);
  });
  test('Coach buttons are full size (44px), not btn-sm', () => {
    const btns = billing.match(/<button[^>]*data-coach-plan[^>]*>/g) || [];
    expect(btns).toHaveLength(2);
    for (const b of btns) {
      expect(b).not.toMatch(/btn-sm/);
      expect(b).toMatch(/min-height:44px/);
    }
  });
  test('Coach section is hidden by default, first in Billing, and shown only for role pt', () => {
    expect(billing).toMatch(/<div id="billing-coach" hidden/);
    expect(billing.indexOf('id="billing-coach"')).toBeLessThan(billing.indexOf("startCheckout('premium'"));
    expect(app).toMatch(/const isPt = !!\(S\.user && S\.user\.role === 'pt'\);\s*box\.hidden = !isPt;/);
  });
  test('trainer Billing marks the current plan, shows the client cap and links the portal', () => {
    expect(app).toContain("API('/coach/billing-status')");
    expect(app).toContain("API('/billing-portal', { method: 'POST'");
    expect(billing).toContain('Manage billing');
    expect(app).toContain('Current plan');
  });
});

describe('#92 r2 lows and shoulds', () => {
  const app = read('app.html');
  test('old-price regex is case-insensitive (lowercase fixtures are caught)', () => {
    const re = /\$59(\.99)?\b|\$99\b(?!\.)|PT Starter|PT Pro/i;
    expect('pt pro plan').toMatch(re);
    expect('pt starter').toMatch(re);
  });
  test('trainer Billing sets its own subtitle', () => {
    expect(app).toContain("'Coach plans for trainers. 14-day trial. Manage or cancel any time.'");
  });
  test('Coach and Premium prices share the billing-price style and one format', () => {
    const billing = app.slice(app.indexOf('id="view-billing"'), app.indexOf('<!-- ══ HOME'));
    for (const amt of ['A$39', 'A$79', 'A$19.99']) {
      expect(billing).toMatch(new RegExp(`<div class="billing-price"[^>]*font-size:1\\.8rem[^>]*>${amt.replace('$', '\\$')}<span[^>]*> a month</span>`));
    }
    expect(billing).not.toContain('/mo AUD');
  });
  test('in-app portal opens ask to return to Billing', () => {
    expect(app).toContain("API('/billing-portal', { method: 'POST', body: JSON.stringify({ returnTo: 'app' }) })");
  });
  test('no store names anywhere in app.html, no store buttons or badges', () => {
    expect(app).not.toMatch(/Woolies|Woolworths|Coles|Aldi|\bIGA\b|Costco|woolworths\.com\.au|coles\.com\.au/i);
    expect(app).not.toMatch(/sl-woolies-link|sl-coles-link|Works with Woolworths/);
  });
});
