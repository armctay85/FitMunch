'use strict';
// Every ingredient named in a sample-day meal must be on that combination's trolley.
const fs = require('fs');
const path = require('path');
const demo = require('./public/js/fm-plan-demo');

// Longer phrases first so "egg whites" is not also read as "eggs".
const FOODS = [
  ['egg whites', 'Egg whites'],
  ['cottage cheese', 'Cottage cheese'],
  ['greek yoghurt', 'Greek yoghurt'],
  ['soy yoghurt', 'Soy yoghurt'],
  ['sweet potato', 'Sweet potato'],
  ['rolled oats', 'Rolled oats'],
  ['omelette', 'Eggs'],
  ['potatoes', 'Potatoes'],
  ['potato', 'Potatoes'],
  ['chicken', 'Chicken breast'],
  ['broccoli', 'Broccoli'],
  ['berries', 'Berries'],
  ['yoghurt', 'Yoghurt'],
  ['salmon', 'Salmon'],
  ['greens', 'Greens'],
  ['banana', 'Banana'],
  ['oats', 'Rolled oats'],
  ['oat', 'Rolled oats'],
  ['eggs', 'Eggs'],
  ['egg', 'Eggs'],
  ['rice', 'Rice'],
  ['beef', 'Beef mince'],
  ['pasta', 'Pasta'],
  ['fruit', 'Fruit'],
  ['tofu', 'Tofu'],
  ['chickpea', 'Chickpeas'],
  ['lentil', 'Lentils'],
  ['tempeh', 'Tempeh'],
  ['tuna', 'Tuna'],
  ['toast', 'Bread'],
  ['turkey', 'Turkey mince'],
  ['nuts', 'Nuts'],
  ['veggie', 'Vegetables'],
].sort((a, b) => b[0].length - a[0].length);

function ingredientsIn(name) {
  let rest = String(name).toLowerCase();
  const need = [];
  for (const [needle, label] of FOODS) {
    const at = rest.indexOf(needle);
    if (at === -1) continue;
    need.push(label);
    rest = rest.slice(0, at) + ' '.repeat(needle.length) + rest.slice(at + needle.length);
  }
  return need;
}

describe('sample day trolley matches the meals', () => {
  const goals = Object.keys(demo.PLANS);

  it('covers all 9 goal and diet combinations', () => {
    expect(goals.sort()).toEqual(['build', 'cut', 'hold']);
    for (const goal of goals) {
      expect(Object.keys(demo.PLANS[goal]).sort()).toEqual(['classic', 'plant', 'protein']);
    }
  });

  for (const goal of ['cut', 'build', 'hold']) {
    for (const diet of ['classic', 'protein', 'plant']) {
      it(`${goal}/${diet}: every meal ingredient is on the trolley, and the trolley has no extras`, () => {
        const plan = demo.PLANS[goal][diet];
        const trolley = demo.trolleyFor(plan);
        const needed = [];
        for (const row of plan.meals) {
          const fromName = ingredientsIn(row.name);
          expect(fromName.length).toBeGreaterThan(0);
          for (const item of fromName) {
            expect(row.items).toContain(item);
            expect(trolley).toContain(item);
            if (!needed.includes(item)) needed.push(item);
          }
          for (const item of row.items) expect(fromName).toContain(item);
        }
        expect(trolley.slice().sort()).toEqual(needed.slice().sort());
      });
    }
  }

  it('Build/Classic lists greens, cottage cheese and fruit', () => {
    const trolley = demo.trolleyFor(demo.PLANS.build.classic);
    expect(trolley).toEqual(expect.arrayContaining(['Greens', 'Cottage cheese', 'Fruit']));
  });

  it('the caption follows the goal, and Cut/Classic keeps the 82kg line', () => {
    const cut = demo.PLANS.cut.classic;
    expect(demo.captionFor('cut', 'classic', cut)).toBe(
      'Your first week: built for 82kg cutting to 78kg, at 2,000 kcal and 150g protein, with Swap open on breakfast.'
    );
    expect(demo.captionFor('build', 'classic', demo.PLANS.build.classic)).toBe(
      'Build, Classic: a sample day at 2,800 kcal and 180g protein.'
    );
    expect(demo.captionFor('hold', 'plant', demo.PLANS.hold.plant)).toBe(
      'Hold, Plant: a sample day at 2,300 kcal and 120g protein.'
    );
    expect(demo.captionFor('build', 'classic', demo.PLANS.build.classic)).not.toMatch(/82kg/);
    expect(demo.captionFor('hold', 'classic', demo.PLANS.hold.classic)).not.toMatch(/82kg/);
  });
});

describe('homepage menu and plan caption markup', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

  it('the mobile menu button controls the same links, and Pricing stays in the bar', () => {
    expect(html).toContain('id="nav-toggle"');
    expect(html).toContain('aria-controls="site-menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="site-menu"');
    expect(html).toContain('class="nav-keep" href="#pricing"');
    expect(html).toContain("e.key === 'Escape'");
  });
});
