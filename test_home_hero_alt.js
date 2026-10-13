'use strict';
// The hero app render (public/assets/fm-app-week.webp) is Wednesday of the real builder's week at
// 2,000 kcal / 150g protein (render script: /workspace/shots/pr87-r5/render-app-week.js). Its alt
// text must quote the same numbers the builder produces for that day, so it can't drift.
const fs = require('fs');
const path = require('path');
const engine = require('./lib/meal-plan-engine');

describe('home hero app render alt text', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const tag = (html.match(/<img class="hero-app"[^>]*>/) || [''])[0];
  const alt = (tag.match(/alt="([^"]*)"/) || [])[1] || '';

  it('the alt names the rendered day and its calories and protein', () => {
    expect(alt).toMatch(/Wednesday: \d+ cal and \d+g protein/);
  });

  it('the alt numbers match the builder output for Wednesday at 2,000 kcal / 150g', () => {
    const plan = engine.buildPlan({ calories: 2000, protein: 150, days: 7, goal: 'lose_weight' });
    const wed = plan.days.find((d) => d.day === 'Wednesday');
    const [, cal, prot] = alt.match(/(\d+) cal and (\d+)g protein/).map(Number);
    expect(cal).toBe(wed.dailyTotals.calories);
    expect(prot).toBe(wed.dailyTotals.protein);
    expect(alt).toContain('2005 cal and 148g protein');
  });

  it('declares the real pixel size of the webp', () => {
    const buf = fs.readFileSync(path.join(__dirname, 'public', 'assets', 'fm-app-week.webp'));
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
    // VP8 (lossy) frame: width/height are 14-bit little-endian at offsets 26 and 28.
    expect(buf.toString('ascii', 12, 16)).toBe('VP8 ');
    const w = buf.readUInt16LE(26) & 0x3fff; const h = buf.readUInt16LE(28) & 0x3fff;
    expect(tag).toContain(`width="${w}"`);
    expect(tag).toContain(`height="${h}"`);
  });
});
