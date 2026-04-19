const {
  computeDecisionScore,
  calcPriceDelta,
  normalizePrice,
  generateCaptureToken,
  estimateDepreciation,
  estimateOwnershipCost,
} = require('./server/carTrackerStore');

describe('carTrackerStore helpers', () => {
  test('normalizePrice handles currency string', () => {
    expect(normalizePrice('$249,990 AUD')).toBe(249990);
  });

  test('computeDecisionScore uses weighted average', () => {
    const score = computeDecisionScore({
      dailyUsability: 8,
      valueRetention: 9,
      collectorPotential: 7,
      maintenanceCost: 6,
      rarityUniqueness: 8,
    });

    expect(score).toBe(7.8);
  });

  test('calcPriceDelta returns amount and percent', () => {
    expect(calcPriceDelta(180000, 200000)).toEqual({ amount: -20000, percent: -10 });
  });

  test('generateCaptureToken creates token with expiry', () => {
    const payload = generateCaptureToken(30);
    expect(payload.token.length).toBeGreaterThan(20);
    expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('estimateDepreciation projects decreasing values', () => {
    const projection = estimateDepreciation({ purchasePrice: 200000, annualRate: 0.1, years: 3 });
    expect(projection).toEqual([
      { year: 1, estimatedValue: 180000 },
      { year: 2, estimatedValue: 162000 },
      { year: 3, estimatedValue: 145800 },
    ]);
  });

  test('estimateOwnershipCost returns annual and monthly costs', () => {
    const cost = estimateOwnershipCost({ purchasePrice: 200000, annualKms: 10000, fuelPer100km: 10, fuelPrice: 2, insuranceAnnual: 3000, maintenanceAnnual: 4000 });
    expect(cost.annualRunningCost).toBe(9000);
    expect(cost.monthlyRunningCost).toBe(750);
  });
});
