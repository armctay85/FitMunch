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
    expect(app).toContain('FitMunch AI · takes up to about a minute · common Australian supermarket ingredients');
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
    expect(lines).toHaveLength(2);
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
