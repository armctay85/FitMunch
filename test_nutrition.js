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
});

describe('list protein labels and swaps', () => {
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
