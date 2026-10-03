'use strict';

const { estimateNutrition } = require('./lib/receipt-scan-core');
const { lineGuidance } = require('./lib/list-guidance');

describe('estimateNutrition', () => {
  it('returns null when there is no nutrition match', () => {
    expect(estimateNutrition('cucumber', 1, 'each')).toBeNull();
    expect(estimateNutrition('tomatoes', 80, 'g')).toBeNull();
    expect(estimateNutrition('brown onions', 80, 'g')).toBeNull();
    expect(estimateNutrition('mixed berries', 80, 'g')).toBeNull();
    expect(estimateNutrition('zucchini', 100, 'g')).toBeNull();
  });

  it('sizes a tuna can and per-each foods from their own unit', () => {
    const tuna = estimateNutrition('Tuna chunks', 1, 'each');
    expect(tuna.protein).toBe(26);
    expect(tuna.protein).not.toBe(3);

    const eggs = estimateNutrition('Free range eggs', 2, 'each');
    expect(eggs.protein).toBe(12);

    const banana = estimateNutrition('banana', 1, 'each');
    expect(banana.protein).toBe(1);

    const per100 = estimateNutrition('Tuna chunks', 100, 'g');
    expect(per100.protein).toBe(27);
  });

  it('returns null for pack and unknown units', () => {
    expect(estimateNutrition('banana', 1, 'pack')).toBeNull();
    expect(estimateNutrition('eggs', 12, 'packet')).toBeNull();
    expect(estimateNutrition('chicken breast', 1, 'box')).toBeNull();
    expect(estimateNutrition('rolled oats', 750, '')).toBeNull();
    expect(estimateNutrition('rolled oats', 750, 'unit')).toBeNull();
  });

  it('converts a counted food when the receipt quantity is grams', () => {
    const banana = estimateNutrition('banana', 120, 'g');
    expect(banana.protein).toBe(1);

    const eggs = estimateNutrition('eggs', 600, 'g');
    expect(eggs.protein).toBe(72);

    const dozen = estimateNutrition('Free range eggs', 600, 'g');
    expect(dozen.protein).toBe(72);
  });

  it('does not show 0 protein for a known food', () => {
    expect(estimateNutrition('olive oil', 15, 'ml')).toBeNull();
    expect(estimateNutrition('spinach', 5, 'g')).toBeNull();
    expect(estimateNutrition('apple', 1, 'each').protein).toBe(1);
  });

  it('matches whole words and skips excluded foods', () => {
    expect(estimateNutrition('goats cheese', 100, 'g').protein).toBe(25);
    expect(estimateNutrition('cheesecake', 100, 'g')).toBeNull();
    expect(estimateNutrition('coconut milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('oat milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('potato chips', 100, 'g')).toBeNull();
    expect(estimateNutrition('potato', 100, 'g').protein).toBe(2);
    expect(estimateNutrition('cheddar', 30, 'g').protein).toBe(8);
  });

  it('does not treat plant milks, banana bakery, or fries as the staple food', () => {
    expect(estimateNutrition('almond milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('rice milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('soy milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('macadamia milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('cashew milk', 250, 'ml')).toBeNull();
    expect(estimateNutrition('full cream milk', 100, 'ml').protein).toBe(3);
    expect(estimateNutrition('banana bread', 100, 'g')).toBeNull();
    expect(estimateNutrition('banana cake', 100, 'g')).toBeNull();
    expect(estimateNutrition('banana muffin', 100, 'g')).toBeNull();
    expect(estimateNutrition('banana chips', 100, 'g')).toBeNull();
    expect(estimateNutrition('banana', 1, 'each').protein).toBe(1);
    expect(estimateNutrition('sweet potato fries', 100, 'g')).toBeNull();
    expect(estimateNutrition('sweet potato wedges', 100, 'g')).toBeNull();
    expect(estimateNutrition('sweet potato', 100, 'g').protein).toBe(2);
    expect(estimateNutrition('brown rice', 100, 'g').protein).toBe(8);
  });
});

describe('list protein labels and swaps', () => {
  it('labels a banana serve from the plural staple name', () => {
    const line = lineGuidance({ sku: 'bananas-1kg', name: 'Bananas 1kg', aisle: 'Produce' });
    expect(line.proteinLabel).toBe('1g protein / 1 banana');
  });

  it('hides the protein label when nutrition is unknown', () => {
    const line = lineGuidance({ sku: 'cucumber', name: 'Cucumber each', aisle: 'Produce' });
    expect(line.proteinPerServe).toBeNull();
    expect(line.proteinLabel).toBeNull();
  });

  it('labels tuna as one can, not 3g', () => {
    const line = lineGuidance({ sku: 'tuna-4pk', name: 'Tuna chunks 4 pack', aisle: 'Pantry' });
    expect(line.proteinLabel).toBe('26g protein / 1 can');
  });

  it('writes a same-kind swap only when the replaced food is on the list', () => {
    const thigh = lineGuidance(
      { sku: 'chicken-thigh-1kg', name: 'Chicken thigh 1kg', aisle: 'Meat' },
      ['Chicken thigh 1kg', 'Chicken breast 1kg']
    );
    expect(thigh.swap).toBe('Use chicken breast instead of chicken thigh');

    const yoghurt = lineGuidance(
      { sku: 'greek-yoghurt-1kg', name: 'Greek yoghurt 1kg', aisle: 'Dairy' },
      ['Greek yoghurt 1kg', 'sour cream']
    );
    expect(yoghurt.swap).toBeNull();

    const cheeseMissing = lineGuidance(
      { sku: 'cheese-250g', name: 'Tasty cheese 250g', aisle: 'Dairy' },
      ['Cottage cheese 250g']
    );
    expect(cheeseMissing.swap).toBeNull();

    const cheese = lineGuidance(
      { sku: 'cheese-250g', name: 'Tasty cheese 250g', aisle: 'Dairy' },
      ['Tasty cheese 250g']
    );
    expect(cheese.swap).toBe('Use cottage cheese instead of tasty cheese');
  });
});
