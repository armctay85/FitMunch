const fs = require('fs');
const path = require('path');
const { displayName } = require('./lib/item-name-case');
const core = require('./lib/receipt-scan-core');
const coreSrc = fs.readFileSync(path.join(__dirname, 'lib/receipt-scan-core.js'), 'utf8');

describe('receipt item display names', () => {
  test.each([
    ['CHICKEN BREAST', 'Chicken Breast'],
    ['BROWN RICE', 'Brown Rice'],
    ['GREEK YOGHURT', 'Greek Yoghurt'],
    ['UHT FULL CREAM MILK 2L', 'UHT Full Cream Milk 2L'],
    ['A2 MILK 1L', 'A2 Milk 1L'],
    ['BBQ CHICKEN', 'BBQ Chicken'],
    ['ROLLED OATS 750G', 'Rolled Oats 750g'],
    ['BANANAS 1KG', 'Bananas 1kg'],
    ['BEEF MINCE 500 G', 'Beef Mince 500 g'],
    ['ALMOND MILK 1 L', 'Almond Milk 1 L'],
    ['COCONUT WATER 330ML', 'Coconut Water 330ml'],
    ['FREE-RANGE EGGS 12PK', 'Free-Range Eggs 12pk'],
    ["NATURE'S MUESLI", "Nature's Muesli"],
    ['SALT AND VINEGAR CHIPS', 'Salt and Vinegar Chips'],
    ['TUNA (IN OIL)', 'Tuna (in Oil)'],
    ['KG CHICKEN', 'kg Chicken'],
    ['CHICKEN THIGH KG', 'Chicken Thigh kg'],
    ['ÉCLAIR', 'Éclair'],
    ['CRÈME FRAÎCHE 200ML', 'Crème Fraîche 200ml'],
    ['ÖKO MÜSLI', 'Öko Müsli'],
    ['VITAMIN A TABS', 'Vitamin A Tabs'],
    ['LF YOGHURT', 'LF Yoghurt'],
    ['NAS PEANUT BUTTER', 'NAS Peanut Butter'],
    ['PB&J SANDWICH', 'PB&J Sandwich'],
    ['COLA 6X330ML', 'Cola 6x330ml'],
    ['MUESLI BARS 60G X 4', 'Muesli Bars 60g x 4'],
    ['MCCAIN PEAS', 'McCain Peas'],
    ['PET FOOD', 'Pet Food'],
  ])('%s -> %s', (raw, want) => {
    expect(displayName(raw)).toBe(want);
  });

  test('mixed-case names are left alone', () => {
    for (const n of ['Chicken Breast', 'iPhone case', 'eggs', 'McCain Peas', 'Greek yoghurt 1KG']) {
      expect(displayName(n)).toBe(n);
    }
  });

  test('non-strings and names without letters pass through', () => {
    expect(displayName(undefined)).toBeUndefined();
    expect(displayName(null)).toBeNull();
    expect(displayName('123')).toBe('123');
    expect(displayName('Éclair')).toBe('Éclair');
  });

  test('scan payload names are normalised everywhere they appear', () => {
    const raw = [
      { name: 'CHICKEN BREAST', quantity: 1, unit: 'kg', price: 1, category: 'meat' },
      { name: 'BROWN RICE', quantity: 1, unit: 'kg', price: 1, category: 'grains' },
      { name: 'BROCCOLI', quantity: 500, unit: 'g', price: 1, category: 'vegetables' },
      { name: 'UHT MILK 2L', quantity: 2, unit: 'L', price: 1, category: 'dairy' },
    ];
    const p = core.buildScanPayload(raw, { scannerProvider: 'vision' });
    expect(p.items.map(i => i.name)).toEqual(['Chicken Breast', 'Brown Rice', 'Broccoli', 'UHT Milk 2L']);
    expect(p.byCategory.meat[0].name).toBe('Chicken Breast');
    expect(JSON.stringify(p.tonightDinner)).not.toMatch(/CHICKEN|BROCCOLI/);
    expect(p.items[0].nutrition.protein).toBeGreaterThan(0);
  });

  test('server and browser copies are identical', () => {
    const a = fs.readFileSync(path.join(__dirname, 'lib/item-name-case.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, 'public/js/fm-item-name.js'), 'utf8');
    expect(b).toBe(a);
  });

  test('client renders use the helper and pages load it', () => {
    const app = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    const fs1 = fs.readFileSync(path.join(__dirname, 'public/js/fm-first-scan.js'), 'utf8');
    expect(app).toContain('<script src="/js/fm-item-name.js"></script>');
    expect(app).toContain('${escapeHtml(window.FMItemName?FMItemName.displayName(item.name):item.name)}');
    expect(index.indexOf('/js/fm-item-name.js')).toBeGreaterThan(-1);
    expect(index.indexOf('/js/fm-item-name.js')).toBeLessThan(index.indexOf('/js/fm-first-scan.js'));
    expect(fs1).toContain('showName(name)');
  });

  test('server helper is aliased as caseName so it cannot collide with displayName', () => {
    expect(coreSrc).toMatch(/const \{ displayName: caseName \} = require\('\.\/item-name-case'\)/);
    expect(coreSrc).not.toMatch(/^const \{ displayName \}/m);
  });
});
