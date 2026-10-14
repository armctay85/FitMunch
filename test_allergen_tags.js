'use strict';
// Allergen tags on every builder meal template are checked against allergens DERIVED from the
// ingredients, never read back from the tags. Oats and oat milk count as gluten: oats are not sold
// as gluten free in Australia. Tamari counts only if labelled with wheat.
const engine = require('./lib/meal-plan-engine');

const ALLERGENS = [
  ['gluten', /^(Seitan|Wholegrain bread|Sourdough|White bread|Bread|Pasta|Spaghetti|Rolled oats|Oat|Oats|Oatmeal|Weetbix|Wheat|Couscous|Barley|Rye|Malt|Soy sauce|Tamari.*with wheat)/i],
  ['nuts', /^(Peanut|Almond|Cashew|Walnut|Pecan|Hazelnut|Pistachio|Macadamia)/i],
  ['dairy', /^(Whey|Casein|Greek yoghurt|Chobani|Cottage|Ricotta|Cheddar|Cheese|Skim milk|Full cream milk|Protein milk|Milk|Butter|Cream|Yoghurt)/i],
  ['eggs', /^(Egg|Scrambled eggs)/i],
  ['soy', /^(Firm tofu|Tofu|Tempeh|Edamame|Soy)/i],
  ['fish', /^(Salmon|Tuna|Barramundi|Prawns|Fish|Shrimp|Crab|Lobster|Mussels|Oysters|Squid)/i],
  ['meat', /^(Chicken|Beef|Lamb|Pork|Turkey|Bacon|Ham)/i],
];
const derived = (items) => [...new Set(items.flatMap(([food]) => ALLERGENS.filter(([, re]) => re.test(food)).map(([f]) => f)))];

describe('meal template allergen tags', () => {
  it('every template carries every allergen its ingredients have', () => {
    const missing = [];
    for (const t of engine.TEMPLATES) for (const a of derived(t.items)) if (!t.flags.includes(a)) missing.push(`${t.name}: ${a}`);
    expect(missing).toEqual([]);
  });
  it('oat milk, oats, barley, rye, malt and soy sauce count as gluten; tamari only with wheat', () => {
    for (const f of ['Oat milk', 'Rolled oats (dry)', 'Oatmeal (cooked)', 'Barley (cooked)', 'Rye bread', 'Malt extract', 'Soy sauce']) expect([f, derived([[f, 10]]).includes('gluten')]).toEqual([f, true]);
    expect(derived([['Tamari (wheat free)', 10]])).not.toContain('gluten');
    expect(derived([['Tamari (with wheat)', 10]])).toContain('gluten');
  });
  it('a gluten-free week never includes oat milk or oats', () => {
    for (const calories of [1600, 2000, 2400]) {
      const text = JSON.stringify(engine.buildPlan({ calories, protein: 120, days: 7, dietary: ['gluten free'] })).toLowerCase();
      expect(text).not.toMatch(/oat milk|oats|berry chia pudding/);
    }
  });
});
