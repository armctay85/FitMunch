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
    const s = hw.summary(row, new Date(2026, 9, 15, 12)); // a Thursday, local time in any zone
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
  it('no card for an empty or unreadable plan with no name', () => {
    for (const meals of [[], '[', null, 5, { days: 'x' }]) expect(hw.summary({ meals })).toBeNull();
    expect(hw.summary(null)).toBeNull();
  });
  it('a flat meal the Meal Planner lists is the same plan on Home', () => {
    const s = hw.summary({ id: 3, name: 'Manual', meals: [{ name: 'flat manual meal', mealType: 'lunch', calories: 400, protein: 20 }] });
    expect(s).not.toBeNull();
    expect(s.name).toBe('Manual');
    expect(s.today.meals.map((m) => m.name)).toEqual(['flat manual meal']);
    expect(s.today.meals[0].slot).toBe('lunch');
  });
  it('summary and the listed-plan picker use flattenPlanMeals, not a second day parser', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fm-home-week.js'), 'utf8');
    const i = src.indexOf('function summary(');
    const body = src.slice(i, src.indexOf('function pickListedPlan('));
    expect(body).toContain('flattenPlanMeals(');
    expect(body).not.toContain('planDays(');
    const plan = engine.buildPlan({ calories: 1860, protein: 141, days: 7, dietary: [] });
    const listed = hw.pickListedPlan([
      { id: 1, name: 'Empty draft', meals: [] },
      { id: 9, name: 'Your first week', meals: plan.days },
    ]);
    expect(listed.id).toBe(9);
    expect(hw.summary(listed).name).toBe('Your first week');
    expect(hw.summary(listed).days).toHaveLength(7);
  });
});

describe('calorie tile and load states', () => {
  it('labels the week average against the goal, with a thousands separator', () => {
    expect(hw.formatCount(1860)).toBe('1,860');
    expect(hw.formatCount(1858)).toBe('1,858');
    expect(hw.formatCount(0)).toBe('0');
    expect(hw.calorieTile(1858, 1860)).toEqual({ value: '1,858 of 1,860', label: 'average' });
    expect(hw.calorieTile(1860, 1860)).toEqual({ value: '1,860 of 1,860', label: 'average' });
    expect(hw.calorieTile(0, 1860)).toEqual({ value: '1,860', label: 'cal / day' });
    const s = hw.summary(rowSafe(), new Date(2026, 9, 15, 12));
    expect(s.average.calories).toBeGreaterThan(0);
    expect(hw.calorieTile(s.average.calories, 1860).value).toBe(hw.formatCount(s.average.calories) + ' of 1,860');
  });
  it('500, 503 and a body with no plans list are errors; an empty list is no saved week', () => {
    expect(hw.loadFailure(500, { success: false }, false)).toBe('error');
    expect(hw.loadFailure(503, { success: false, error: 'busy' }, false)).toBe('error');
    expect(hw.loadFailure(200, null, true)).toBe('error');
    expect(hw.loadFailure(200, { success: true }, false)).toBe('error');
    expect(hw.loadFailure(200, { success: false, plans: [] }, false)).toBe('error');
    expect(hw.loadFailure(200, { success: true, plans: [] }, false)).toBe('empty');
    expect(hw.loadFailure(200, { success: true, plans: [{ id: 1 }] }, false)).toBe('ok');
  });
  it('repeat onboarding reuses the Your first week row', () => {
    expect(hw.onboardingPlanId([{ id: 2, name: 'Older plan' }, { id: 9, name: 'Your first week' }])).toBe(9);
    expect(hw.onboardingPlanId([{ id: 4, name: 'Your first week' }, { id: 3, name: 'Your first week' }])).toBe(4);
    expect(hw.onboardingPlanId([{ id: 1, name: 'Your first week, 15 Oct' }])).toBeNull();
    expect(hw.onboardingPlanId([])).toBeNull();
    expect(hw.onboardingPlanId(null)).toBeNull();
  });
});

function rowSafe() {
  return { id: 9, name: 'Your first week', meals: engine.buildPlan({ calories: 1860, protein: 141, days: 7, dietary: [] }).days };
}

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
    expect(l).toContain("fetch('/api/meal-plans'");
    expect(l).toContain("cache: 'no-store'");
    expect(l).toContain('FMHomeWeek.pickListedPlan');
    expect(fn('renderPortalPlan')).toContain('FMHomeWeek.pickListedPlan');
    expect(fn('renderPortalPlan')).toContain("cache: 'no-store'");
    expect(l).toContain('FMHomeWeek.loadFailure(status, r, failed)');
    expect(l).toContain('FMHomeWeek.calorieTile');
    expect(l).toContain('buildAiShoppingList(S_homeWeek.shoppingPlan)');
    expect(l).not.toMatch(/innerHTML/); // plan text is the user's: textContent only
    const home = fn('loadPortalHome');
    expect(home).toContain('await loadHomeWeek()');
    expect(home).toContain('of ${FMHomeWeek.formatCount(S.goals.targetCalories)} goal');
    expect(fn('showHomeWeekError')).toContain("Couldn't load your week, try again");
    expect(fn('showHomeWeekError')).toContain("id = 'home-week-retry'");
    expect(fn('showHomeWeekError')).not.toMatch(/innerHTML/);
    expect(fn('showHomeWeekSkeleton')).toContain("id = 'home-week-skel'");
  });
  it('a second onboarding updates the existing Your first week row', () => {
    const s = fn('onboardSaveWeek');
    expect(s).toContain('FMHomeWeek.onboardingPlanId(plans)');
    expect(s).toContain("method:'PUT'");
    expect(s).toContain("API('/meal-plans', { method:'POST'");
  });
  it('the served helper has no banned words', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fm-home-week.js'), 'utf8');
    expect(src).not.toMatch(/Pty Ltd|inc\. GST|Grok|OpenClaw|MRR|\bdesk\b|\bagent\b|woolworths|coles|aldi|iga\b/i);
  });
  it('mealWarnings returns { meal, contains } (and unchecked or notice), never a message field', () => {
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const i = src.indexOf('function mealWarnings(');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf("\nrouter.get('/meal-plans'", i));
    expect(body).toContain('out.push({ meal, contains })');
    expect(body).toContain('unchecked: true, note: UNCHECKED_NOTE');
    expect(body).toContain('notice: dg.UNREADABLE_NOTICE');
    expect(body).not.toMatch(/\bmessage\s*:/);
  });
});

// The saved week's allergen entries, in the shape the API really sends (api_server.js mealWarnings):
// { meal, contains[] }, { meal, contains: [], unchecked, note } and { meal: '', contains: [], notice }.
// There is no `message` field. (Elite QA #146: the card used to read one and showed nothing.)
describe('allergen warnings on the Home card (real API shape)', () => {
  const NOTE = "We couldn't check this meal against your allergies, so check the ingredients.";
  it('builds the red text from meal and contains', () => {
    const w = hw.warnings([{ meal: 'Satay chicken', contains: ['nuts'] }, { meal: 'Banana pancakes', contains: ['banana', 'egg'] }]);
    expect(w.red).toEqual(['Satay chicken contains nuts', 'Banana pancakes contains banana, egg']);
    expect(w.notes).toEqual([]);
    expect(w.notice).toBe('');
  });
  it('an unchecked meal is a calm note, never red', () => {
    const w = hw.warnings([{ meal: 'Arancini', contains: [], unchecked: true, note: NOTE }, { meal: 'Arancini', contains: [], unchecked: true, note: NOTE }]);
    expect(w.red).toEqual([]);
    expect(w.notes).toEqual(['Arancini']);
  });
  it('the unreadable-list notice is kept, and a mix keeps all three', () => {
    const w = hw.warnings([
      { meal: '', contains: [], notice: 'We could not read all your allergies' },
      { meal: 'Satay chicken', contains: ['nuts'] },
      { meal: 'Mum\'s special', contains: [], unchecked: true, note: NOTE },
    ]);
    expect(w).toEqual({ notice: 'We could not read all your allergies', red: ['Satay chicken contains nuts'], notes: ["Mum's special"] });
  });
  it('a made-up message field is ignored, and junk entries are skipped', () => {
    expect(hw.warnings([{ meal: 'Peanut toast', contains: [], message: 'Peanut toast contains peanut' }, null, 'x', 7, { meal: 'A', contains: [5, '', '  '] }])).toEqual({ notice: '', red: [], notes: [] });
    expect(hw.warnings(undefined)).toEqual({ notice: '', red: [], notes: [] });
    expect(hw.warnings({ meal: 'x', contains: ['y'] })).toEqual({ notice: '', red: [], notes: [] });
  });
  it('loadHomeWeek renders them from the helper: red and notice get the alert role, the calm note does not, no innerHTML', () => {
    const l = fn('loadHomeWeek');
    expect(l).toContain('FMHomeWeek.allergenPreview(row.allergenWarnings)');
    expect(l).toContain("w.textContent = '⚠️ ' + aw.text");
    expect(l).not.toMatch(/aw\.red\.slice\(0,\s*3\)/);
    expect(l).not.toMatch(/\.message|innerHTML/);
    const redBlock = l.slice(l.indexOf("id = 'home-week-warn'"), l.indexOf("id = 'home-week-note'"));
    expect(redBlock).toContain("setAttribute('role', 'alert')");
    const noteBlock = l.slice(l.indexOf("id = 'home-week-note'"), l.indexOf("const t = document.createElement('div'); t.className = 'hw-k'"));
    expect(noteBlock).not.toContain('role');
    expect(noteBlock).toContain('uncheckedNote(');
    expect(l).toContain("id = 'home-week-notice'");
  });
});

describe('saved plan meals, both shapes', () => {
  const plan = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
  it('reads the week onboarding saves (plan.days, slot objects) and keeps the days', () => {
    const flat = hw.flattenPlanMeals(plan.days);
    expect(flat.days.map((d) => d.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(flat.days[0].meals.map((m) => m.mealType)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(flat.days[0].meals[0].name).toBe(plan.days[0].meals.breakfast.name);
    expect(flat.items).toHaveLength(28);
    expect(hw.flattenPlanMeals({ days: plan.days }).days).toHaveLength(7);
    expect(hw.flattenPlanMeals(JSON.stringify(plan.days)).days).toHaveLength(7);
  });
  it('reads a flat manual list and a day whose meals are foods', () => {
    const manual = hw.flattenPlanMeals([{ name: 'Oats', mealType: 'breakfast', calories: 300, protein: 12 }]);
    expect(manual.days).toEqual([]);
    expect(manual.items[0]).toEqual(expect.objectContaining({ name: 'Oats', mealType: 'breakfast', calories: 300, protein: 12 }));
    const foods = hw.flattenPlanMeals([{ day: 'Monday', meals: [{ mealType: 'lunch', foods: [{ name: 'Rice', calories: 200, protein: 4 }] }] }]);
    expect(foods.days[0].day).toBe('Monday');
    expect(foods.days[0].meals[0]).toEqual(expect.objectContaining({ name: 'Rice', mealType: 'lunch', calories: 200, protein: 4 }));
  });
  it('does not throw on a missing or odd shape', () => {
    for (const raw of [undefined, null, 5, true, 'nope', '[', '{', { days: 'x' }, { days: null }, [{ meals: 5 }], [{ day: 'Monday', meals: 'egg' }], [{ day: 'Monday', meals: { breakfast: 'egg' } }], { notMeals: true }]) {
      expect(() => hw.flattenPlanMeals(raw)).not.toThrow();
      const r = hw.flattenPlanMeals(raw);
      expect(Array.isArray(r.days)).toBe(true);
      expect(Array.isArray(r.items)).toBe(true);
    }
  });
  it('Meal Plans, edit and the shopping button read meals through the helper', () => {
    expect(html).not.toMatch(/\.meals\.flatMap/);
    expect(fn('savedPlanMealsHtml')).toContain('FMHomeWeek.flattenPlanMeals');
    expect(fn('loadMealPlans')).toContain('savedPlanMealsHtml(p)');
    expect(fn('openEditMealPlan')).toContain('FMHomeWeek.editMealRows');
    expect(fn('saveEditedMealPlan')).toContain('FMHomeWeek.applyMealEdits');
    expect(fn('saveEditedMealPlan')).toContain('FMHomeWeek.planMacros');
    expect(fn('buildListFromSaved')).toContain('FMHomeWeek.flattenPlanMeals');
    expect(fn('onboardBuildWeek')).toContain('await onboardSaveWeek(b.plan, fitnessGoal)');
  });
  it('string foods keep the parent meal on the card and in the shopping list', () => {
    const raw = [{ day: 'Monday', meals: [{ name: 'Peanut sauce chicken', mealType: 'lunch', calories: 640, foods: ['peanuts'] }] }];
    const r = hw.flattenPlanMeals(raw);
    expect(r.days[0].meals).toHaveLength(1);
    expect(r.days[0].meals[0].name).toBe('Peanut sauce chicken');
    expect(r.days[0].meals[0].foods).toEqual(['peanuts']);
    expect(r.items).toHaveLength(1);
    const shop = engine.aggregateShoppingList({ days: r.days });
    expect(shop.map((i) => i.name.toLowerCase())).toContain('peanuts');
    const slot = hw.flattenPlanMeals([{ day: 'Monday', meals: { lunch: { name: 'Peanut sauce chicken', foods: ['peanuts'] } } }]);
    expect(slot.days[0].meals[0].name).toBe('Peanut sauce chicken');
  });
  it('an array of meal arrays still lists the meals', () => {
    const r = hw.flattenPlanMeals([[{ name: 'Oats', mealType: 'breakfast', calories: 300 }]]);
    expect(r.items.map((i) => i.name)).toEqual(['Oats']);
    expect(r.items[0].calories).toBe(300);
  });
  it('a non-array is empty because of the array guard alone', () => {
    // some() and forEach() would otherwise be read as a meal list. Removing only
    // `if (!Array.isArray(meals)) return empty;` lets this through.
    const fake = {
      some() { return false; },
      forEach(cb) { cb({ name: 'Oats', mealType: 'breakfast', calories: 300 }); },
    };
    expect(hw.flattenPlanMeals(fake)).toEqual({ days: [], items: [] });
  });
});

describe('editing a saved plan keeps the day shape', () => {
  const src = [{
    day: 'Monday',
    dailyTotals: { calories: 480 },
    meals: {
      breakfast: { name: 'Monday bowl', calories: 480, protein: 22, carbs: 40, fat: 18, ingredients: [{ item: 'Peanuts', qty: '40g' }], swaps: ['rice cakes'] },
      lunch: { name: 'Rice bowl', calories: 300, protein: 15, ingredients: [{ item: 'Rice', qty: '150g' }] },
    },
  }];
  it('patches name and macros on the original meal and leaves ingredients', () => {
    const rows = hw.editMealRows(src);
    expect(rows.map((r) => r.path)).toEqual(['0.meals.breakfast', '0.meals.lunch']);
    const saved = hw.applyMealEdits(src, [{ ...rows[0], calories: 510, protein: 24 }, rows[1]]);
    expect(saved[0].day).toBe('Monday');
    expect(saved[0].dailyTotals).toEqual({ calories: 480 });
    expect(saved[0].meals.breakfast.ingredients).toEqual([{ item: 'Peanuts', qty: '40g' }]);
    expect(saved[0].meals.breakfast.swaps).toEqual(['rice cakes']);
    expect(saved[0].meals.breakfast.calories).toBe(510);
    expect(saved[0].meals.lunch.ingredients).toEqual([{ item: 'Rice', qty: '150g' }]);
    expect(src[0].meals.breakfast.calories).toBe(480);
    expect(hw.planMacros(saved)).toEqual({ calories: 810, protein: 39, carbs: 40, fat: 18 });
  });
  it('sums a day-shaped week from the meals, and a food list from its foods', () => {
    expect(hw.planMacros(src).calories).toBe(780);
    expect(hw.planMacros({ days: src }).calories).toBe(780);
    const week = engine.buildPlan({ calories: 2000, protein: 130, days: 7, dietary: [] });
    const daily = hw.planMacros(week.days);
    expect(daily.calories).toBeGreaterThan(1700);
    expect(daily.calories).toBeLessThan(2300);
    expect(hw.planMacros([{ name: 'Bowl', calories: 999, foods: [{ name: 'Rice', calories: 200, protein: 4 }, { name: 'Chicken', calories: 150, protein: 30 }] }])).toEqual({ calories: 350, protein: 34, carbs: 0, fat: 0 });
    const api = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    const put = api.slice(api.indexOf("router.put('/meal-plans/:id'"), api.indexOf("router.delete('/meal-plans/:id'"));
    expect(put).toContain('planMacros');
    expect(put).not.toMatch(/flatMap\(m => m\.foods/);
  });
});

// A week that starts with three egg meals used to fill the three red slots with the same group
// and hide satay, banana and prawn. Each contains group is shown once, on the first meal that hits it.
describe('Home allergen lines, one per group', () => {
  const NOTE = "We couldn't check this meal against your allergies, so check the ingredients.";
  const list = [
    { meal: '', contains: [], notice: 'We couldn\'t read all your allergies, so every allergen filter is on.' },
    { meal: 'Eggs on toast', contains: ['egg'] },
    { meal: 'Egg fried rice', contains: ['egg'] },
    { meal: 'Cheese omelette', contains: ['Egg'] },
    { meal: 'Satay chicken', contains: ['nuts'] },
    { meal: 'Banana bowl', contains: ['banana'] },
    { meal: 'Garlic prawns', contains: ['prawn'] },
    { meal: 'Arancini', contains: [], unchecked: true, note: NOTE },
  ];
  it('shows each distinct group once and counts the rest', () => {
    const p = hw.allergenPreview(list);
    expect(p.lines).toEqual([
      'Eggs on toast contains egg',
      'Satay chicken contains nuts',
      'Banana bowl contains banana',
      'Garlic prawns contains prawn',
    ]);
    expect(p.shown).toEqual(p.lines.slice(0, 3));
    expect(p.more).toBe(1);
    expect(p.text).toBe('Eggs on toast contains egg; Satay chicken contains nuts; Banana bowl contains banana (+1 more in Meal Planner)');
    expect(p.text.match(/contains egg/g)).toEqual(['contains egg']);
    expect(p.text).not.toContain('Egg fried rice');
    expect(p.text).not.toContain('Cheese omelette');
    expect(p.text).not.toContain('Garlic prawns');
    expect(p.notice).toBe(hw.warnings(list).notice);
    expect(p.notes).toEqual(hw.warnings(list).notes);
    expect(p.notes).toEqual(['Arancini']);
  });
  it('a second group on a later meal still appears, and an empty list stays empty', () => {
    const p = hw.allergenPreview([{ meal: 'Eggs on toast', contains: ['egg', 'egg'] }, { meal: 'Pad thai', contains: ['egg', 'peanut'] }]);
    expect(p.lines).toEqual(['Eggs on toast contains egg', 'Pad thai contains peanut']);
    expect(p.more).toBe(0);
    expect(p.text).not.toContain('(+');
    expect(hw.allergenPreview(undefined)).toEqual({ notice: '', notes: [], lines: [], shown: [], more: 0, text: '' });
  });
});
