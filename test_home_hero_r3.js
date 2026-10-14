const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

describe('homepage hero r3', () => {
  test('860-1100px has its own smaller H1 so it stays at 3 lines', () => {
    const m = html.match(/@media\(min-width:860px\) and \(max-width:1100px\)\{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/\.hero h1\{font-size:clamp\(2\.5rem,4\.9vw,3\.35rem\)/);
  });
  test('hero shows a real first-week render next to our own food photo, not a text card', () => {
    const hero = html.split('<header class="hero">')[1].split('</header>')[0];
    expect(hero).toMatch(/<img class="hero-food" src="\/assets\/fm-hero-mealprep\.webp" alt="[^"]+"/);
    expect(hero).toMatch(/<img class="hero-app" src="\/assets\/fm-app-week\.webp" alt="FitMunch first week[^"]+"/);
    expect(hero).not.toMatch(/phone-list|Sample week|unsplash|pexels|shutterstock|istock/i);
    for (const f of ['fm-hero-mealprep.webp', 'fm-app-week.webp']) expect(fs.existsSync(path.join(__dirname, 'public', 'assets', f))).toBe(true);
  });
  test('860+ hero is top-aligned, the sub is wider, and the kicker shows on phones (EQA r3 S1, S2, L1)', () => {
    const desk = html.match(/@media\(min-width:860px\)\{([\s\S]*?)\n\}/)[1];
    expect(desk).toMatch(/\.hero\{padding:clamp\(56px,8vh,96px\) 48px 56px;align-items:flex-start\}/);
    expect(desk).toContain('.hero-sub{max-width:38ch}');
    expect(html).not.toContain('.hero-kicker{display:none}');
    expect(html).toMatch(/\.hero-kicker\{display:inline-block;font-size:\.66rem/);
  });
});
