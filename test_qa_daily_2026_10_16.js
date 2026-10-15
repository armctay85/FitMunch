'use strict';
// Daily live QA, 16 Oct 2026: coach fit wording, receipt loaf/tofu, allergy rows.
const dietGuard = require('./lib/diet-guard');
const core = require('./lib/receipt-scan-core');

const FILTERS = dietGuard.combineFilters({ dietaryPreferences: ['vegetarian'], allergies: ['peanut', 'tree nuts'] });
const LUNCH = 'one high-protein lunch to buy at Woolworths';

describe('coach: a shop lunch that passes the saved diet says it fits', () => {
  const reply = () => dietGuard.addressedCoachReply({
    filters: FILTERS, calories: 2180, protein: 109, question: LUNCH, intent: 'nutrition',
  }).reply;

  it('names one lunch, with its own calories and protein, and says it fits', () => {
    const text = reply();
    expect(text).toMatch(/This fits your filters/);
    expect(text).not.toMatch(/does not fit/i);
    expect(text).not.toMatch(/I can't read/i);
    expect(text).not.toMatch(/this is lunch/i);
    expect(text).toMatch(/Lunch: Quinoa, corn and avocado bowl \(644 kcal, 20 g protein\)/);
    expect(text).toMatch(/It is peanut free and nut free\./);
    expect(text).not.toMatch(/Breakfast:|Dinner:|Snack:/);
    expect(text).not.toMatch(/\b(coles|aldi|iga|woolworths)\b/i);
    expect(text).not.toMatch(/\b(budget|cheap|save|savings|\$)\b/i);
    expect(dietGuard.textBreaksFilters(text, FILTERS)).toBe(false);
    expect((text.match(/Lunch:/g) || []).length).toBe(1);
  });

  it('a meal that fails the saved allergies is still refused', () => {
    const text = dietGuard.addressedCoachReply({
      filters: FILTERS, calories: 2180, protein: 109, question: 'Can I have peanut butter for lunch?', intent: 'nutrition',
    }).reply;
    expect(text).toMatch(/That does not fit your filters/);
    expect(text).not.toMatch(/This fits your filters/);
    expect(text).not.toMatch(/peanut butter/i);
    expect(dietGuard.textBreaksFilters(text, FILTERS)).toBe(false);
  });

  it('an unreadable profile still fails closed', () => {
    const filters = ['unreadable filter', ...dietGuard.ALL_FREE];
    const text = dietGuard.addressedCoachReply({
      filters, calories: 2180, protein: 109, question: LUNCH, intent: 'nutrition',
    }).reply;
    expect(dietGuard.unreadable(filters)).toBe(true);
    expect(text).toContain(dietGuard.UNREADABLE_NOTICE);
    expect(text).toMatch(/Breakfast:/);
    expect(text).toMatch(/Lunch:/);
    expect(text).toMatch(/Dinner:/);
    expect(text).not.toMatch(/This fits your filters/);
    for (const f of ['dairy free', 'gluten free', 'egg free', 'nut free']) {
      expect(dietGuard.textBreaksFilters(text, [f])).toBe(false);
    }
  });
});

describe('receipt nutrition and category', () => {
  function nut(name, qty, unit) {
    return core.estimateNutrition(name, qty, unit);
  }

  it('scores a sourdough loaf as a loaf, never 25 kcal', () => {
    const loaf = nut('Sourdough loaf', 1, 'each');
    expect(loaf.calories).toBeGreaterThanOrEqual(400);
    expect(loaf.calories).not.toBe(25);
    expect(loaf.protein).toBeGreaterThan(1);
    expect(loaf.basis).toBe('whole loaf');
    const weighed = nut('Sourdough loaf 700g', 700, 'g');
    expect(weighed.calories).toBeGreaterThanOrEqual(400);
    expect(weighed.basis).toBeUndefined();
  });

  it.each([
    ['Sourdough roll', 1, 'each', 100, 'one roll'],
    ['Wholegrain wraps', 1, 'each', 100, 'one wrap'],
    ['Multigrain bread', 1, 'each', 80, 'one slice'],
    ['White bread', 1, 'each', 80, 'one slice'],
    ['Wholemeal bread', 1, 'each', 80, 'one slice'],
    ['Rye bread', 1, 'each', 80, 'one slice'],
    ['Turkish bread', 1, 'each', 80, 'one slice'],
  ])('%s is a real piece, not 25 kcal', (name, qty, unit, minCal, basis) => {
    const n = nut(name, qty, unit);
    expect(n.calories).toBeGreaterThanOrEqual(minCal);
    expect(n.calories).not.toBe(25);
    expect(n.basis).toBe(basis);
  });

  it('keeps tofu and tempeh out of dairy, and plant milks out of dairy', () => {
    expect(core.inferCategory('Firm tofu 350g', 'dairy')).toBe('protein');
    expect(core.inferCategory('Tempeh', 'dairy')).toBe('protein');
    expect(core.inferCategory('Soy protein mince', 'other')).toBe('protein');
    expect(core.inferCategory('Soy milk 1L', 'dairy')).toBe('beverage');
    expect(core.inferCategory('Oat milk', 'dairy')).toBe('beverage');
    expect(core.inferCategory('Almond milk', 'dairy')).toBe('beverage');
    expect(core.inferCategory('Full cream milk 2L', 'other')).toBe('dairy');
    const tofu = nut('Firm tofu', 1, 'each');
    expect(tofu.calories).toBeGreaterThanOrEqual(150);
    expect(tofu.basis).toBe('one block');
    const shop = core.buildScanPayload([
      { name: 'Firm tofu', quantity: 1, unit: 'each', price: 4.5, category: 'dairy' },
      { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
    ]);
    const row = shop.items.find((i) => /tofu/i.test(i.name));
    expect(row.category).toBe('protein');
    expect(row.price).toBe(4.5);
    expect(row.name).toMatch(/tofu/i);
  });
});

describe('a scanned allergy hit is marked and is not a pantry win', () => {
  const lines = [
    { name: 'Almonds 200g', quantity: 200, unit: 'g', price: 6, category: 'pantry' },
    { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
    { name: 'Broccoli', quantity: 1, unit: 'each', price: 3, category: 'vegetables' },
  ];

  it('marks contains nuts and leaves almonds out of wins and the haul', () => {
    const plain = core.buildScanPayload(lines);
    const marked = core.buildScanPayload(lines, { filters: ['nut free'] });
    const almonds = marked.items.find((i) => /almond/i.test(i.name));
    expect(almonds.contains).toContain('nuts');
    expect(almonds.pantryWin).toBe(false);
    expect(marked.wins.join(' ').toLowerCase()).not.toMatch(/almond/);
    expect(marked.wins.join(' ').toLowerCase()).toMatch(/chicken/);
    expect(marked.haulScore).not.toBe(plain.haulScore);
    expect(JSON.stringify(marked.wins)).not.toMatch(/savings/i);
    expect(marked.tonightDinner.meal.toLowerCase()).not.toMatch(/almond/);
  });

  it('an unreadable filter list is not counted as wins', () => {
    const marked = core.buildScanPayload(lines, { filters: dietGuard.ALL_FREE, unreadable: true });
    expect(marked.wins).toEqual([]);
    expect(marked.items.every((i) => i.pantryWin === false)).toBe(true);
  });
});
