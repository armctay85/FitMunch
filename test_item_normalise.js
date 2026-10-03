'use strict';

const fixture = require('./test/fixtures/item-normalise.json');
const normalise = require('./lib/item-normalise');
const core = require('./lib/receipt-scan-core');

describe('item normaliser', () => {
  test('fixture cases match', () => {
    fixture.cases.forEach((row) => {
      const got = normalise.normaliseLabel(row.input);
      expect(got.itemKey).toBe(row.itemKey);
      expect(got.packSizeValue).toBe(row.packSizeValue);
      expect(got.packSizeUnit).toBe(row.packSizeUnit);
      expect(got.confidence).toBe(row.confidence);
    });
  });

  test('pack sizes cover the receipt shapes', () => {
    expect(normalise.parsePack('Chicken 1kg').packSizeValue).toBe(1000);
    expect(normalise.parsePack('Yoghurt 500g').packSizeUnit).toBe('g');
    expect(normalise.parsePack('Milk 2L')).toEqual({ packSizeValue: 2000, packSizeUnit: 'ml', weighed: null });
    expect(normalise.parsePack('Milk 1.5l').packSizeValue).toBe(1500);
    expect(normalise.parsePack('Oil 375ml').packSizeUnit).toBe('ml');
    expect(normalise.parsePack('Eggs 12pk').packSizeUnit).toBe('each');
    expect(normalise.parsePack('Eggs 12 pack').packSizeValue).toBe(12);
    expect(normalise.parsePack('Tuna 6x95g').packSizeValue).toBe(570);
    expect(normalise.parsePack('Bananas per kg').weighed).toBe('per_kg');
    expect(normalise.keyFromSku('oats-750g')).toBe('oats');
    expect(normalise.keyFromSku('chicken-breast-1kg')).toBe('chicken-breast');
  });

  test('parseVisionItems accepts an object and a legacy array', () => {
    const objectForm = core.parseVisionItems(JSON.stringify({
      store: 'Coles',
      purchasedOn: '2026-09-12',
      items: [{ name: 'Oats', price: 4, category: 'grains' }],
    }));
    expect(objectForm.store).toBe('Coles');
    expect(objectForm.purchasedOn).toBe('2026-09-12');
    expect(objectForm.items).toHaveLength(1);
    const arrayForm = core.parseVisionItems(JSON.stringify([
      { name: 'Oats', price: 4, category: 'grains' },
    ]));
    expect(arrayForm.store).toBeNull();
    expect(arrayForm.items[0].name).toBe('Oats');
  });
});
