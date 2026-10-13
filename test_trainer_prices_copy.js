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
    expect(read(f)).not.toMatch(/\$59(\.99)?\b|\$99\b(?!\.)|PT Starter|PT Pro/);
  });
});

describe('copy hygiene', () => {
  test('meal plan timing is not understated', () => {
    const app = read('app.html');
    expect(app).not.toMatch(/~\s*15 seconds/);
    expect(app).toContain('up to about 30 seconds');
  });
  test('no dead fmNotifications hook in script.js', () => {
    expect(read('script.js')).not.toContain('fmNotifications');
  });
});
