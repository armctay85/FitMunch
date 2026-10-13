/** Haul score: what the basket is made of, weighted by spend. Treats and soft drinks must pull it down. */
const c = require('./lib/receipt-scan-core');

const AUDIT_BASKET = [
  { name: 'WW FULL CREAM MILK', quantity: 2, unit: 'L', price: 3.1, category: 'dairy' },
  { name: 'CHICKEN THIGH FILLET', quantity: 1, unit: 'unit', price: 11.42, category: 'meat' },
  { name: 'BANANA CAVENDISH', quantity: 1, unit: 'unit', price: 2.38, category: 'fruit' },
  { name: 'BABY SPINACH', quantity: 120, unit: 'g', price: 3, category: 'vegetables' },
  { name: 'SANITARIUM WEETBIX', quantity: 575, unit: 'g', price: 4.8, category: 'grains' },
  { name: 'TIM TAM ORIGINAL', quantity: 1, unit: 'unit', price: 2.75, category: 'pantry' },
  { name: 'SALMON PORTIONS', quantity: 4, unit: 'pk', price: 13, category: 'meat' },
  { name: 'JASMINE RICE', quantity: 5, unit: 'kg', price: 14.5, category: 'grains' },
  { name: 'FREE RANGE EGGS', quantity: 12, unit: 'unit', price: 6.9, category: 'dairy' },
  { name: 'COKE NO SUGAR', quantity: 10, unit: 'pk', price: 11, category: 'beverage' },
];
const without = (re) => AUDIT_BASKET.filter((i) => !re.test(i.name));

describe('haul score', () => {
  it('the audit basket with Tim Tams and a Coke 10pk is not 100 / A', () => {
    const p = c.buildScanPayload(AUDIT_BASKET);
    expect(p.haulScore).toBeLessThan(80);
    expect(['A', 'A+']).not.toContain(p.grade);
    expect(p.macroMatchScoreLabel).toBe(`${p.haulScore}/100 haul score`);
    const gap = p.pantryGapReport.find((g) => g.gap === 'Treats and drinks');
    expect(gap.finding).toMatch(/TIM TAM ORIGINAL/);
  });
  it('removing treats raises the score, and each treat lowers it', () => {
    const full = c.macroMatchScore(AUDIT_BASKET);
    const noCoke = c.macroMatchScore(without(/COKE/));
    const clean = c.macroMatchScore(without(/COKE|TIM TAM/));
    expect(clean).toBeGreaterThan(noCoke);
    expect(noCoke).toBeGreaterThan(full);
    expect(clean).toBeGreaterThanOrEqual(85);
  });
  it('a junk basket scores D', () => {
    const p = c.buildScanPayload([
      { name: 'TIM TAM', price: 5 }, { name: 'COKE 10PK', price: 12 }, { name: 'DORITOS', price: 4 }, { name: 'CADBURY BLOCK', price: 6 },
    ]);
    expect(p.haulScore).toBeLessThan(30);
    expect(p.grade).toBe('D');
  });
  it('no produce cannot reach A', () => {
    expect(c.macroMatchScore([{ name: 'CHICKEN BREAST', price: 12 }, { name: 'BEEF MINCE', price: 10 }, { name: 'RICE', price: 3 }])).toBeLessThan(70);
  });
  it('grade follows the score', () => {
    expect([95, 85, 75, 65, 50, 20].map(c.gradeForScore)).toEqual(['A+', 'A', 'B+', 'B', 'C', 'D']);
  });
  it('classifies lines', () => {
    expect(c.itemKind({ name: 'COKE NO SUGAR' })).toBe('diet-drink');
    expect(c.itemKind({ name: 'PEPSI 1.25L' })).toBe('treat');
    expect(c.itemKind({ name: 'GREEK YOGHURT' })).toBe('protein');
    expect(c.itemKind({ name: 'BROCCOLI' })).toBe('produce');
    expect(c.itemKind({ name: 'ROLLED OATS' })).toBe('staple');
  });
  it('empty basket is 0, never NaN', () => {
    expect(c.macroMatchScore([])).toBe(0);
  });
});
