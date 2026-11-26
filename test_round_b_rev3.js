'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./lib/receipt-scan-core');
const lines = require('./lib/receipt-lines');
const foodDb = require('./food-db');

// Generative shapes for a weighed line whose weight is not a finished number.
const BROKEN = [
  ['Sweet Potato kg .', 'Sweet Potato'],
  ['Carrots kg 1.', 'Carrots'],
  ['Broccoli kg 0.', 'Broccoli'],
  ['Pumpkin g .', 'Pumpkin'],
  ['Apples g 2.', 'Apples'],
  ['Tomato kg 12.', 'Tomato'],
  ['Onion kg 1.', 'Onion'],
  ['Zucchini kg .', 'Zucchini'],
  ['Pear g 4.', 'Pear'],
  ['Cabbage kg', 'Cabbage'],
  ['Baby spinach kg .', 'Baby spinach'],
  ['Capsicum g 1.', 'Capsicum'],
  ['Mushroom kg 3. @ 9.99', 'Mushroom'],
  ['Beans 1. kg', 'Beans'],
];

function scanLine(line) {
  return core.buildScanPayload([{
    name: line,
    quantity: 1,
    unit: 'kg',
    price: 3.35,
    category: 'vegetables',
    line,
  }]);
}

describe('Rev 3 M1 unreadable weighed lines', () => {
  it.each(BROKEN)('%s is one clean item and nutrition unknown', (line, want) => {
    const parsed = lines.parseReceiptText(line);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe(want);
    expect(parsed[0].name).not.toMatch(/\bkg\b|\bg\b|\d|\./i);
    expect(parsed[0].unit).not.toBe('kg');
    expect(parsed[0].weightStatus).toBe('unknown');

    const payload = scanLine(line);
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0];
    expect(item.name).toBe(want);
    expect(item.nutrition).toBeNull();
    expect(item.nutritionStatus).toBe('unknown');
    expect(item.unit).not.toBe('kg');
  });

  it('a finished per-kg weight is still that weight', () => {
    const t = lines.parseReceiptText('Sweet Potato kg 0.84 @ 3.99 3.35');
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('Sweet Potato');
    expect(t[0].quantity).toBe(0.84);
    expect(t[0].unit).toBe('kg');
    expect(t[0].price).toBe(3.35);
    const item = scanLine('Sweet Potato kg 0.84 @ 3.99 3.35').items[0];
    expect(item.nutritionStatus).toBe('known');
    expect(item.unit).toBe('kg');
    expect(item.quantity).toBe(0.84);
  });
});

describe('Rev 3 M2 skim milk', () => {
  it('Skim Milk 2L uses the AFCD Release 3 skim row, at or under 1.5 g fat per 100 mL', () => {
    const row = foodDb.FOODS.find((f) => String(f.afcd || '').toUpperCase() === 'F005637');
    expect(row).toBeTruthy();
    expect(row.f).toBeLessThanOrEqual(1.5);
    expect(row.src).toMatch(/AFCD Release 3/i);
    expect(row.src).toMatch(/F005637/);
    const item = core.buildScanPayload([{
      name: 'Skim Milk 2L',
      quantity: 1,
      unit: 'each',
      price: 3,
      category: 'dairy',
      line: 'Skim Milk 2L 3.00',
    }]).items[0];
    expect(item.nutritionStatus).toBe('known');
    expect(item.nutrition.fat).toBe(Math.round(row.f * 20));
    expect(item.nutrition.fat).toBeLessThanOrEqual(30);
    expect(item.nutrition.calories).toBe(Math.round(row.cal * 20));
    expect(item.nutrition.protein).toBe(Math.round(row.p * 20));
  });

  it('Zymil Full Cream stays full cream', () => {
    const item = core.buildScanPayload([{
      name: 'Pauls Zymil Full Cream Milk 2L',
      quantity: 1,
      unit: 'each',
      price: 4,
      category: 'dairy',
      line: 'Pauls Zymil Full Cream Milk 2L',
    }]).items[0];
    expect(item.nutritionStatus).toBe('known');
    expect(item.nutrition.fat).toBeGreaterThanOrEqual(60);
  });
});

describe('Rev 3 S1 unknown items are not logged silently', () => {
  it('logScannedItems says the item was not logged because nutrition is unknown', () => {
    const app = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
    const start = app.indexOf('async function logScannedItems');
    const body = app.slice(start, app.indexOf('\nfunction ', start + 10));
    expect(body).toMatch(/wasn't logged because its nutrition is unknown/);
    expect(body).toMatch(/weren't logged because their nutrition is unknown/);
    expect(body).not.toMatch(/if \(!item\.nutrition\) continue;/);
  });
});
