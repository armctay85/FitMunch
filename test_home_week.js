'use strict';
// Home "This week" (launch audit D2): the week saved at onboarding becomes the Home hero, with the targets and
// a one-tap shopping list. Pure helpers here; the saved rows are checked on Postgres in test_home_week_pg.js and
// the page in a real browser in test_home_week_rendered.js.
const fs = require('fs');
const path = require('path');
const hw = require('./public/js/fm-home-week');
const engine = require('./lib/meal-plan-engine');

const html = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
const fn = (name) => { const i = html.indexOf(`function ${name}(`); expect(i).toBeGreaterThan(-1); return html.slice(i, html.indexOf('\n}\n', i)); };

describe('summary of a saved plan', () => {
  const plan = engine.buildPlan({ calories: 1860, protein: 141, days: 7, dietary: [] });
  const row = { id: 9, name: 'Your first week', meals: plan.days };
  it("picks today's weekday, lists its meals in slot order, and totals the day", () => {
    const s = hw.summary(row, new Date('2026-10-15T10:00:00+11:00')); // a Thursday
    expect(s.days).toHaveLength(7);
    expect(s.today.day).toBe('Thursday');
    expect(s.days.filter((d) => d.today).map((d) => d.day)).toEqual(['Thursday']);
    expect(s.today.meals.map((m) => m.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(Math.abs(s.today.calories - 1860)).toBeLessThanOrEqual(1860 * 0.05);
    expect(s.shoppingPlan.days).toHaveLength(7);
  });
  it('the shopping plan gives the same list as the plan itself', () => {
    const s = hw.summary(row);
    expect(engine.aggregateShoppingList(s.shoppingPlan)).toEqual(engine.aggregateShoppingList(plan));
  });
  it('reads JSON text, { days } and list-shaped meals; day names that do not match fall back to the first day', () => {
    const text = hw.summary({ name: 'x', meals: JSON.stringify(plan.days) });
    expect(text.days).toHaveLength(7);
    expect(hw.summary({ name: 'x', meals: { days: plan.days } }).days).toHaveLength(7);
    const list = hw.summary({ name: 'x', meals: [{ day: 'Day 1', meals: [{ type: 'Dinner', name: 'b', calories: 500 }, { slot: 'breakfast', name: 'a', calories: 300 }] }] });
    expect(list.today.meals.map((m) => m.name)).toEqual(['a', 'b']);
    expect(list.today.calories).toBe(800);
  });
  it('no card for an empty, unreadable or manual plan with no days', () => {
    for (const meals of [[], '[', null, 5, [{ name: 'flat manual meal' }], { days: 'x' }]) expect(hw.summary({ meals })).toBeNull();
    expect(hw.summary(null)).toBeNull();
  });
});

describe('targets', () => {
  it('uses the saved targets, and derives carbs and fat only when they are missing', () => {
    expect(hw.targets({ targetCalories: 1860, targetProtein: 141, targetCarbs: 220, targetFat: 50 })).toEqual({ calories: 1860, protein: 141, carbs: 220, fat: 50 });
    expect(hw.targets({ targetCalories: 1860, targetProtein: 141 })).toEqual(require('./public/js/fm-targets').rebalance({ calories: 1860, protein: 141 }));
    expect(hw.targets({ targetCalories: 1860 })).toBeNull();
    expect(hw.targets(null)).toBeNull();
  });
});

describe('app wiring', () => {
  it('onboarding saves calories and all three macros, then the week, through the checked save routes', () => {
    const b = fn('onboardBuildWeek');
    expect(b).toMatch(/targetCalories: r\.calories, targetProtein: r\.protein, targetCarbs: r\.carbs, targetFat: r\.fat/);
    expect((b.match(/await onboardSaveWeek\(/g) || []).length).toBe(2); // builder week and AI week
    expect(fn('onboardSaveWeek')).toContain("API('/meal-plans', { method:'POST'");
    // The filter path is untouched: the builder week still sends the ticked diet to /meal-plan/generate.
    expect(b).toContain("builderOnly: true, goal: fitnessGoal, days: 7, calories: r.calories, protein: r.protein, dietary: diet");
  });
  it('Done keeps swaps, closes the modal and lands on Home', () => {
    const d = fn('onboardDone');
    expect(d).toMatch(/method:'PUT'/);
    expect(d).toMatch(/closeModal\('modal-onboard'\);\s*nav\('portal-home'\);\s*await loadPortalHome\(\);/);
    expect(html).toContain('id="ob-done" onclick="onboardDone()"');
  });
  it('Home is the default view and the week card sits first on it, with a one-tap shopping list', () => {
    expect(html).toMatch(/<div class="view active" id="view-portal-home">[\s\S]{0,400}<section class="hw-card" id="home-week"/);
    expect(html).toContain('<script src="/js/fm-home-week.js"></script>');
    const l = fn('loadHomeWeek');
    expect(l).toContain("API('/meal-plans')");
    expect(l).toContain('buildAiShoppingList(S_homeWeek.shoppingPlan)');
    expect(l).not.toMatch(/innerHTML/); // plan text is the user's: textContent only
    expect(fn('loadPortalHome')).toContain('await loadHomeWeek()');
  });
  it('the served helper has no banned words', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fm-home-week.js'), 'utf8');
    expect(src).not.toMatch(/Pty Ltd|inc\. GST|Grok|OpenClaw|MRR|\bdesk\b|\bagent\b|woolworths|coles|aldi|iga\b/i);
  });
});
