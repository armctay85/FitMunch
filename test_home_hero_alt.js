'use strict';
// The hero app render (public/assets/fm-app-week.webp) is #115's first-week screen for a 2,000 kcal /
// 150g protein week: the personal opening line, Wednesday's totals and its breakfast with Swap open.
// Render script: /workspace/shots/pr87-r6/render-hero.js; its measurements are in
// scripts/fixtures/hero-app-render.json. Alt, figcaption and pixel sizes are pinned to the builder.
const fs = require('fs');
const path = require('path');
const engine = require('./lib/meal-plan-engine');
const FX = require('./scripts/fixtures/hero-app-render.json');

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const tag = (html.match(/<img class="hero-app"[^>]*>/) || [''])[0];
const alt = (tag.match(/alt="([^"]*)"/) || [])[1] || '';
const plan = engine.buildPlan({ calories: FX.inputs.calories, protein: FX.inputs.protein, days: 7, goal: FX.inputs.goal });
const wed = plan.days.find((d) => d.day === 'Wednesday');
const title = (s) => s.split(' ').map((w, i) => (i > 0 && ['and', 'with', 'or', 'of', 'on', 'in', 'the', 'a', 'to', 'for'].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

describe('home hero app render alt text and caption', () => {
  it('the alt names the day, its calories and protein, the breakfast and the open Swap list', () => {
    expect(alt).toMatch(/Wednesday at \d+ cal and \d+g protein, with .+ for breakfast and its Swap list open/);
  });
  it('the alt numbers and breakfast match the builder for Wednesday at 2,000 kcal / 150g', () => {
    const [, cal, prot] = alt.match(/(\d+) cal and (\d+)g protein/).map(Number);
    expect(cal).toBe(wed.dailyTotals.calories);
    expect(prot).toBe(wed.dailyTotals.protein);
    expect(FX.dayTotals).toEqual({ calories: wed.dailyTotals.calories, protein: wed.dailyTotals.protein });
    expect(wed.meals.breakfast.name).toBe(FX.breakfast);
    expect(alt).toContain(`with ${title(wed.meals.breakfast.name)} for breakfast`);
    expect(alt).toContain(`built for ${FX.inputs.weightKg}kg, cutting to ${FX.inputs.goalKg}kg`);
  });
  it('the figcaption numbers are the builder inputs (EQA L1)', () => {
    const cap = (html.match(/<figure class="hero-shot">[\s\S]*?<figcaption>([^<]*)<\/figcaption>/) || [])[1] || '';
    const kcal = Number((cap.match(/([\d,]+) kcal/) || [])[1].replace(/,/g, ''));
    const prot = Number((cap.match(/(\d+)g protein/) || [])[1]);
    expect([kcal, prot]).toEqual([FX.inputs.calories, FX.inputs.protein]);
    expect(cap).toContain(`${FX.inputs.weightKg}kg cutting to ${FX.inputs.goalKg}kg`);
  });
  it('declares the real pixel size of the webp, and the CSS aspect ratio matches', () => {
    const buf = fs.readFileSync(path.join(__dirname, 'public', 'assets', 'fm-app-week.webp'));
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
    expect(buf.toString('ascii', 12, 16)).toBe('VP8 ');
    const w = buf.readUInt16LE(26) & 0x3fff; const h = buf.readUInt16LE(28) & 0x3fff;
    expect([w, h]).toEqual([FX.pixelWidth, FX.pixelHeight]);
    expect(tag).toContain(`width="${w}"`);
    expect(tag).toContain(`height="${h}"`);
    expect(html).toContain(`aspect-ratio:${w}/${h}`);
  });
  it('M1: at the CSS minimum width every hero number and label is at least 11px', () => {
    const m = html.match(/\.hero-app\{[^}]*width:clamp\((\d+)px,(\d+)%,(\d+)px\)/);
    expect(m).toBeTruthy();
    const minW = Number(m[1]);
    expect(minW).toBeGreaterThanOrEqual(292);
    expect((minW * FX.minFontCssPx) / FX.sourceCssWidth).toBeGreaterThanOrEqual(11);
  });
});
