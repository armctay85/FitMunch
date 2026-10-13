const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

describe('homepage hero r3', () => {
  test('860-1100px has its own smaller H1 so it stays at 3 lines', () => {
    const m = html.match(/@media\(min-width:860px\) and \(max-width:1100px\)\{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/\.hero h1\{font-size:clamp\(2\.5rem,4\.9vw,3\.35rem\)/);
  });
  test('sample card shows quantity and which meals each item covers', () => {
    const card = html.slice(html.indexOf('<ol class="phone-list">'), html.indexOf('</ol>'));
    expect(card).toContain('<strong>Chicken breast 1kg</strong>');
    expect(card).toContain('<span class="src">4 dinners</span>');
    expect(card).toContain('<span class="src">6 lunches</span>');
    expect(card).toContain('<span class="src">7 breakfasts</span>');
    expect(html).not.toMatch(/class="(src|row-val)">(list|last shop|body|body need)</);
  });
});
