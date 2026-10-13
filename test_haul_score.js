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

describe('haul score QA r1', () => {
  it('M1: totals/payment lines or nameless lines are unreadable, not a score', () => {
    for (const raw of [
      [{ name: 'TOTAL', price: 54.2 }, { name: 'EFTPOS', price: 54.2 }, { name: 'CHANGE' }],
      [{ name: '' }, {}],
      [{ name: 'SUBTOTAL', price: 9 }, { name: 'GST', price: 1 }, { name: 'ROUNDING' }],
    ]) {
      expect(() => c.parseVisionItems(JSON.stringify(raw))).toThrow('scan_unreadable');
      expect(() => c.buildScanPayload(raw)).toThrow('scan_unreadable');
    }
  });
  it('M1: drops totals lines before scoring a real receipt', () => {
    const items = c.parseVisionItems(JSON.stringify([{ name: 'BROCCOLI', price: 3 }, { name: 'TOTAL', price: 3 }, { name: 'Card', price: 3 }]));
    expect(items.map((i) => i.name)).toEqual(['BROCCOLI']);
  });
  it('M2: store and house-brand words never reach displayed names, the gap line or shareText', () => {
    const p = c.buildScanPayload([
      { name: 'COLES COKE 1.25L', price: 3 }, { name: 'WOOLWORTHS MACRO CHICKEN BREAST', price: 12 },
      { name: 'WW BROCCOLI', price: 3 }, { name: 'ALDI HOMEBRAND RICE', price: 3 }, { name: 'IGA ESSENTIALS OATS', price: 3 },
    ]);
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/coles|woolworths|woolies|\bww\b|aldi|\biga\b|homebrand|essentials|macro chicken/i);
    expect(p.pantryGapReport.find((g) => g.gap === 'Treats and drinks').finding).toMatch(/\(COKE 1\.25L\)/);
    expect(p.items[1].name).toBe('CHICKEN BREAST');
  });
  it.each([
    ['RICE CAKES', 'staple'], ['FISH CAKES', 'protein'], ['WINE VINEGAR', 'other'], ['PIZZA BASE', 'staple'],
    ['WHOLEMEAL ENGLISH MUFFIN', 'staple'], ['JELLY BEANS', 'treat'], ['EASTER EGG', 'treat'], ['VEGEMITE', 'other'],
    ['CORNFLAKES', 'staple'], ['POPCORN', 'other'], ['APPLE JUICE', 'diet-drink'], ['ORANGE JUICE', 'diet-drink'],
    ['SALAD DRESSING', 'other'], ['CHOC CHIP MUFFIN', 'treat'], ['SPARKLING WINE', 'treat'], ['MIXED VEG', 'produce'],
  ])('M3: %s is %s', (name, kind) => {
    expect(c.itemKind({ name })).toBe(kind);
  });
  it('S1: without prices the gap line counts items instead of claiming a spend share', () => {
    const p = c.buildScanPayload([{ name: 'TIM TAM' }, { name: 'BROCCOLI' }, { name: 'CHICKEN BREAST' }, { name: 'RICE' }]);
    const f = p.pantryGapReport.find((g) => g.gap === 'Treats and drinks').finding;
    expect(f).toMatch(/^1 of 4 items were treats or soft drinks/);
    expect(f).not.toMatch(/%/);
  });
  const clean = [{ name: 'CHICKEN BREAST', price: 35 }, { name: 'BROCCOLI', price: 25 }, { name: 'RICE', price: 15 }, { name: 'SALMON', price: 15 }];
  it('S2: 10% treat spend caps at 74, 30% at 49', () => {
    expect(c.macroMatchScore([...clean, { name: 'TIM TAM', price: 10 }])).toBeLessThanOrEqual(74);
    expect(c.macroMatchScore([...clean.map((i) => ({ ...i, price: i.price * 0.7 })), { name: 'TIM TAM', price: 30 }])).toBeLessThanOrEqual(49);
  });
  it('S2: diet drinks lower a clean basket', () => {
    expect(c.macroMatchScore([...clean, { name: 'COKE NO SUGAR', price: 10 }])).toBeLessThan(c.macroMatchScore(clean));
  });
  it('S2: grade boundaries', () => {
    expect([79, 80, 89, 90, 69, 70, 59, 60, 44, 45].map(c.gradeForScore)).toEqual(['B+', 'A', 'A', 'A+', 'B', 'B+', 'C', 'B', 'D', 'C']);
  });
  it('S3: one mistyped price cannot sink a good basket', () => {
    const good = c.macroMatchScore(clean);
    const typo = c.macroMatchScore([...clean, { name: 'TIM TAM', price: 350 }]);
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeGreaterThanOrEqual(30);
    expect(typo).toBeLessThan(good);
    const b = c.haulBreakdown([...clean, { name: 'TIM TAM', price: 350 }]);
    expect(b.spend.treat / b.total).toBeLessThanOrEqual(0.4 + 1e-9);
  });
  it('L1: the old grade() is gone', () => {
    expect(c.grade).toBeUndefined();
  });
});

describe('haul score QA r2', () => {
  const clean = [
    { name: 'CHICKEN BREAST', price: 12 }, { name: 'BROCCOLI', price: 4 }, { name: 'BANANA', price: 3 },
    { name: 'JASMINE RICE', price: 5 }, { name: 'FREE RANGE EGGS', price: 7 }, { name: 'BABY SPINACH', price: 3 },
  ];
  const STORE = /woolworths|woolies|coles(?!law)|\bww\b|\baldi\b|\biga\b|harris ?farm|foodworks|drakes|\bspar\b|foodland|ritchies|supabarn|everyday ?rewards|flybuys/i;

  it.each([
    ['COLES COKE', 'COKE'], ['ColesCoke', 'Coke'], ['COLES-COKE', 'COKE'], ["Coles' Finest Beef", 'Finest Beef'],
    ['Harris Farm Apples', 'Apples'], ['HarrisFarm Pears', 'Pears'], ['FoodWorks Bananas', 'Bananas'], ['Drakes Milk', 'Milk'],
    ['Spar Rice', 'Rice'], ['Foodland Eggs', 'Eggs'], ['Ritchies Bread', 'Bread'], ['Supabarn Oats', 'Oats'],
    ['Everyday Rewards Chicken', 'Chicken'], ['Flybuys Tuna', 'Tuna'], ['Chicken Coles 500g', 'Chicken 500g'],
    ['Milk WOOLWORTHS 2L', 'Milk 2L'], ['Eggs - Aldi', 'Eggs - '.trim()],
  ])('M1: strips store and loyalty names anywhere: %s -> %s', (raw, want) => {
    const got = c.displayName(raw);
    expect(got).not.toMatch(STORE);
    if (want !== 'Eggs -') expect(got).toBe(want);
  });

  it.each(['Coleslaw mix', 'Sparkling water', 'Garibaldi biscuits', 'Macadamia nuts'])('M1: food words that contain a store name stay: %s', (n) => {
    expect(c.displayName(n)).toBe(n);
  });

  it.each([
    'Coles Savings', 'Member Savings', 'Promo Discount', '*** GST', 'Price Reduction', 'Amount tendered',
    'Bag 15c', 'Reusable bag', 'Loyalty Points', 'Everyday Rewards', 'Flybuys', 'TOTAL', '  Card ****1234', 'Change', 'EFTPOS PURCHASE',
  ])('M2: junk line dropped mid-line too: %s', (n) => {
    const kept = c.readableItems([{ name: n, price: 5 }, { name: 'Chicken breast', price: 10 }]).map((i) => i.name);
    expect(kept).toEqual(['Chicken breast']);
  });

  it.each(['Baby spinach bag', 'Salad bag 200g', 'Cardamom pods', 'Chicken breast'])('M2: real food is kept: %s', (n) => {
    expect(c.readableItems([{ name: n, price: 5 }, { name: 'Chicken breast', price: 10 }]).map((i) => i.name)).toContain(n);
  });

  it('M1/M2: a full payload from a loyalty-heavy receipt carries no store or loyalty names', () => {
    const items = c.readableItems([
      { name: 'Coles Savings', price: 2 }, { name: 'ColesCoke 1.25L', price: 3 }, { name: 'Harris Farm Apples', price: 4 },
      { name: 'Everyday Rewards', price: 0 }, { name: 'Drakes Chicken', price: 11 },
    ]);
    const names = items.map((i) => c.displayName(i.name)).join(' | ');
    expect(names).not.toMatch(STORE);
    expect(c.pantryGapReport(items, { protein: 50 }).map((g) => g.finding).join(' ')).not.toMatch(STORE);
  });

  it('S1: only unrecognised lines is unreadable, not a score', () => {
    expect(() => c.readableItems([{ name: 'ITEM 1234', price: 5 }, { name: 'Crab sticks', price: 4 }])).toThrow('scan_unreadable');
  });

  it('S1: one line weighs at most $100', () => {
    expect(c.LINE_MAX_DOLLARS).toBe(100);
    const veg = ['BROCCOLI', 'CARROTS', 'SPINACH', 'BANANA', 'APPLE'].map((name) => ({ name, price: 50 }));
    const b = c.haulBreakdown([{ name: 'CHICKEN BREAST', price: 500 }, ...veg]);
    expect(b.spend.protein).toBe(100);
    expect(b.total).toBe(350);
  });

  it('S1: a small diet-drink share still lowers the score (below the 10% cap)', () => {
    const base = [{ name: 'CHICKEN BREAST', price: 12 }, { name: 'JASMINE RICE', price: 14 }, { name: 'BANANA', price: 2 }];
    const withDiet = [...base, { name: 'COKE NO SUGAR', price: 1.5 }];
    const b = c.haulBreakdown(withDiet);
    expect(b.share.diet).toBeGreaterThan(0);
    expect(b.share.diet).toBeLessThan(0.1);
    expect(c.macroMatchScore(withDiet)).toBeLessThan(c.macroMatchScore([...base, { name: 'CRAB STICKS', price: 1.5 }]));
  });

  it('S1: vegemite is not produce', () => {
    expect(c.itemKind({ name: 'VEGEMITE 380G' })).not.toBe('produce');
  });

  it.each(['Pringles Original', 'Skittles', 'M&Ms Peanut', "M & M's", 'Freddo Frog', 'Sour Patch Kids', 'Lindt Easter Bunny'])('S2: %s is a treat', (n) => {
    expect(c.itemKind({ name: n })).toBe('treat');
  });

  it('S2: pancake mix is not a treat; cupcakes are', () => {
    expect(c.itemKind({ name: 'Pancakes mix' })).not.toBe('treat');
    expect(c.itemKind({ name: 'Cupcakes' })).toBe('treat');
  });
});
