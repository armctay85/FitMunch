'use strict';
// #87 shoulds: the app render is the priority image, the hero photo is small, and on
// phones and tablets the app card is cropped to the space above the fold with a fade.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const hero = html.split('<header class="hero">')[1].split('</header>')[0];

describe('homepage hero shoulds after #87', () => {
  it('fetchpriority=high is on the app image only', () => {
    expect(hero).toMatch(/<img class="hero-app"[^>]*fetchpriority="high"/);
    expect(hero).not.toMatch(/<img class="hero-food"[^>]*fetchpriority/);
    expect((html.match(/fetchpriority="high"/g) || []).length).toBe(1);
  });
  it('the hero photo is 120KB or less and its width/height match the file', () => {
    const f = path.join(__dirname, 'public', 'assets', 'fm-hero-mealprep-web.webp');
    expect(fs.statSync(f).size).toBeLessThanOrEqual(120 * 1024);
    expect(hero).toMatch(/<img class="hero-food" src="\/assets\/fm-hero-mealprep-web\.webp"[^>]*width="900" height="600"/);
  });
  it('under 860px the app card height is tied to the viewport and fades out', () => {
    const m = html.match(/@media\(max-width:859px\)\{\n  \.hero-shot([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/\.hero-app\{[^}]*height:clamp\(150px,calc\(100svh - \d+px\),460px\)[^}]*mask-image:linear-gradient/);
  });
});
