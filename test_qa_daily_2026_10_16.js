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

  it.each([
    [0, 'g'],
    [-1, 'g'],
    [NaN, 'g'],
    [Infinity, 'g'],
  ])('a loaf with %s grams uses the loaf basis, never 25 kcal', (qty, unit) => {
    const loaf = nut('Sourdough loaf', qty, unit);
    expect(loaf.calories).toBeGreaterThanOrEqual(400);
    expect(loaf.calories).not.toBe(25);
    expect(loaf.basis).toBe('whole loaf');
  });

  it('english muffins and bagels use a piece basis', () => {
    const muffins = nut('English muffins 6pk', 1, 'each');
    expect(muffins.calories).toBe(720);
    expect(muffins.basis).toBe('6 x one muffin');
    const bagels = nut('Bagels 5pk', 1, 'each');
    expect(bagels.calories).toBe(600);
    expect(bagels.basis).toBe('5 x one bagel');
  });

  it('coconut milk is a can of cooking liquid, soy yoghurt is not dairy, soy mince has a block basis', () => {
    const coconut = nut('Coconut milk', 1, 'each');
    expect(coconut.calories).toBeGreaterThan(400);
    expect(coconut.calories).not.toBe(6);
    expect(coconut.basis).toBe('one can');
    expect(core.inferCategory('Coconut milk 400ml', 'beverage')).toBe('pantry');
    const yoghurt = nut('Soy yoghurt', 1, 'each');
    expect(yoghurt.basis).toBe('one tub');
    expect(yoghurt.calories).not.toBe(120);
    expect(core.inferCategory('Soy yoghurt', 'dairy')).toBe('plant');
    const mince = nut('Soy protein mince', 1, 'each');
    expect(mince.basis).toBe('one block');
    expect(mince.calories).not.toBe(120);
    expect(core.inferCategory('Sourdough loaf', 'dairy')).toBe('grains');
    expect(core.inferCategory('English muffins 6pk', 'dairy')).toBe('grains');
    expect(core.inferCategory('Soy milk', 'meat')).toBe('beverage');
  });
});

function linesOf(reply, filters) {
  for (const line of String(reply).split('\n')) {
    expect(dietGuard.brokenGroups(line, filters)).toEqual([]);
  }
}

describe('coach notes are filtered before they are appended', () => {
  it('a vegan soy and wheat lunch that fits does not then name soy', () => {
    const filters = dietGuard.combineFilters({ dietaryPreferences: ['vegan'], allergies: ['soy', 'wheat'] });
    const out = dietGuard.addressedCoachReply({
      filters, calories: 2180, protein: 180, question: 'one high-protein lunch', intent: 'nutrition',
    });
    expect(out.plan.notes.join(' ')).toMatch(/tofu/i);
    expect(out.reply).toMatch(/This fits your filters/);
    expect(out.reply).not.toMatch(/does not fit/i);
    expect(out.reply).not.toMatch(/tofu|tempeh|legumes/i);
    expect(out.reply).toMatch(/Add a protein you've saved as OK/);
    expect(out.reply).toMatch(/Lunch: Quinoa, corn and avocado bowl/);
    linesOf(out.reply, filters);
  });

  it('a peanut butter question is still refused, without eggs, yoghurt or tofu', () => {
    const filters = dietGuard.combineFilters({
      dietaryPreferences: ['vegetarian'],
      allergies: ['egg', 'milk', 'soy', 'peanut', 'tree nuts', 'wheat', 'sesame', 'fish', 'shellfish'],
    });
    const out = dietGuard.addressedCoachReply({
      filters, calories: 2180, protein: 180, question: 'Can I have peanut butter for lunch?', intent: 'nutrition',
    });
    expect(out.plan.notes.join(' ')).toMatch(/Eggs, Greek yoghurt or tofu/);
    expect(out.reply).toMatch(/That does not fit your filters/);
    expect(out.reply).not.toMatch(/This fits your filters/);
    expect(out.reply).not.toMatch(/peanut butter|Eggs|yoghurt|tofu/i);
    expect(out.reply).toMatch(/Lunch: Quinoa, corn and avocado bowl/);
    linesOf(out.reply, filters);
  });

  it.each([
    ['soy', dietGuard.combineFilters({ dietaryPreferences: ['vegan'], allergies: ['soy', 'wheat'] }), 'one high-protein lunch'],
    ['egg', ['egg free', 'gluten free', 'soy free'], 'one high-protein lunch'],
    ['dairy', ['dairy free', 'fish free', 'gluten free', 'soy free', 'nut free', 'egg free'], 'one high-protein lunch'],
    ['fish', ['fish free', 'gluten free', 'soy free', 'nut free', 'egg free', 'dairy free'], 'one high-protein lunch'],
    ['shellfish', ['shellfish free'], 'one high-protein dinner'],
  ])('%s profile: no line of the fit reply names a broken group', (_label, filters, question) => {
    const text = dietGuard.addressedCoachReply({
      filters, calories: 2180, protein: 250, question, intent: 'nutrition',
    }).reply;
    expect(text).toMatch(/This fits your filters/);
    linesOf(text, filters);
  });

  it('refusal and unreadable replies have no broken line either', () => {
    const refused = dietGuard.combineFilters({ dietaryPreferences: ['vegetarian'], allergies: ['peanut', 'egg', 'milk'] });
    const no = dietGuard.addressedCoachReply({
      filters: refused, calories: 2180, protein: 180, question: 'peanut butter for lunch', intent: 'nutrition',
    }).reply;
    expect(no).toMatch(/That does not fit your filters/);
    linesOf(no, refused);
    const unread = ['unreadable filter', ...dietGuard.ALL_FREE];
    const day = dietGuard.addressedCoachReply({
      filters: unread, calories: 2180, protein: 180, question: 'one high-protein lunch', intent: 'nutrition',
    }).reply;
    expect(day).toContain(dietGuard.UNREADABLE_NOTICE);
    expect(day).not.toMatch(/This fits your filters/);
    linesOf(day, unread);
  });

  it('a note that names a broken group is replaced only by a food-free line', () => {
    const plan = { notes: ['Prawns and mussels would close the gap.', 'Eggs or Greek yoghurt would close the gap.'] };
    const shell = dietGuard.notesForReply(plan, ['shellfish free']);
    expect(shell).toMatch(/Add a protein you've saved as OK/);
    expect(shell).not.toMatch(/prawn|mussel/i);
    expect(shell).toMatch(/Eggs or Greek yoghurt/);
    expect(dietGuard.notesForReply(plan, ['egg free', 'dairy free', 'shellfish free'])).not.toMatch(/egg|yoghurt|prawn/i);
    expect(dietGuard.notesForReply({ notes: ['Drink water with lunch.'] }, ['nut free'])).toMatch(/Drink water/);
    expect(dietGuard.brokenGroups(dietGuard.SAFE_PROTEIN_LINE, dietGuard.ALL_FREE)).toEqual([]);
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

  it('raw allergen words map onto the same groups as the diet filters', () => {
    for (const word of ['peanut', 'tree nut', 'almond', 'cashew', 'walnut', 'milk', 'egg', 'soy', 'wheat', 'gluten', 'sesame', 'fish', 'shellfish']) {
      const marked = core.buildScanPayload([
        { name: 'Almonds 200g', quantity: 200, unit: 'g', price: 6, category: 'pantry' },
        { name: 'Full cream milk 1L', quantity: 1, unit: 'L', price: 2, category: 'dairy' },
        { name: 'Free range eggs 12pk', quantity: 12, unit: 'each', price: 7, category: 'dairy' },
        { name: 'Firm tofu', quantity: 1, unit: 'each', price: 4, category: 'other' },
        { name: 'White bread', quantity: 1, unit: 'each', price: 3, category: 'grains' },
        { name: 'Sesame snaps', quantity: 1, unit: 'each', price: 2, category: 'snacks' },
        { name: 'Salmon 200g', quantity: 200, unit: 'g', price: 8, category: 'meat' },
        { name: 'Prawns 300g', quantity: 300, unit: 'g', price: 9, category: 'meat' },
        { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
      ], { filters: [word] });
      const hits = marked.items.filter((i) => i.contains && i.contains.length);
      expect(hits.length).toBeGreaterThan(0);
    }
  });

  it('every filter moves the haul score', () => {
    const basket = [
      { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
      { name: 'Full cream milk 2L', quantity: 2, unit: 'L', price: 3.2, category: 'dairy' },
      { name: 'Free range eggs 12pk', quantity: 12, unit: 'each', price: 7, category: 'dairy' },
      { name: 'Almonds 200g', quantity: 200, unit: 'g', price: 6, category: 'pantry' },
      { name: 'Prawns 300g', quantity: 300, unit: 'g', price: 9, category: 'meat' },
      { name: 'Broccoli', quantity: 1, unit: 'each', price: 3, category: 'vegetables' },
      { name: 'Tim Tam', quantity: 1, unit: 'each', price: 4, category: 'snacks' },
      { name: 'Greek yoghurt', quantity: 500, unit: 'g', price: 5, category: 'dairy' },
      { name: 'White bread', quantity: 1, unit: 'each', price: 3, category: 'grains' },
    ];
    const plain = core.buildScanPayload(basket).haulScore;
    for (const f of ['nut free', 'dairy free', 'egg free', 'shellfish free', 'peanut', 'milk', 'egg']) {
      expect(core.buildScanPayload(basket, { filters: [f] }).haulScore).not.toBe(plain);
    }
  });

  it('nut-free is not a nut hit unless the rest of the line names a nut', () => {
    const marked = (name, filters) => core.buildScanPayload([
      { name, quantity: 1, unit: 'each', price: 5, category: 'pantry' },
      { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12, category: 'meat' },
    ], { filters }).items.find((i) => /granola|almond|bar/i.test(i.name));
    expect(marked('Nut-free granola', ['nut free']).contains).toEqual([]);
    expect(marked('Granola, no nuts', ['peanut']).contains).toEqual([]);
    expect(marked('Nut-free granola with cashews', ['nut free']).contains).toContain('nuts');
    expect(marked('Almond nut-free bar', ['nut free']).contains).toContain('nuts');
    expect(marked('Granola', ['nut free']).contains).toContain('nuts');
  });

  it('a thrown profile read marks the scan unreadable', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'receipt-scanner.js'), 'utf8');
    const i = src.indexOf('const profile = await getProfile');
    const body = src.slice(i, i + 600);
    expect(body).toContain('filtersUnreadable = true');
    expect(body).not.toContain('filtersUnreadable = false');
  });
});
