const fs = require('fs');
const path = require('path');

/**
 * Grep gate for supermarket catalogue prices.
 * Scans ios/ (when that tree exists) plus the native target and its tests,
 * including bundled JSON and fixtures. StoreKit subscription prices stay.
 */

const ROOTS = ['ios', 'FitMunch', 'FitMunchTests', 'FitMunchUITests'];
const TEXT_EXT = new Set(['.swift', '.json', '.plist', '.txt', '.md', '.storekit', '.strings', '.xml', '.yaml', '.yml']);

const SUBSCRIPTION_FILES = new Set([
  'FitMunchProducts.storekit',
  'PaywallCatalogTests.swift',
  'PremiumManager.swift',
  'PaywallCatalog.swift',
  'PaywallView.swift',
  'OnboardingView.swift',
  'OnboardingViewModel.swift',
]);

const CATALOGUE_DATE = [
  { name: 'specials', re: /\bspecials\b/i },
  { name: 'catalogue', re: /\bcatalogue\b/i },
  { name: 'on special', re: /\bon special\b/i },
  { name: 'catalogue date range', re: /\b\d{1,2}\s+(?:to|through|-)\s+\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i },
  { name: 'catalogue week date', re: /\bweek\s+(?:ending|of)\s+\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i },
];

function isSubscriptionFile(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (normalized.startsWith('ios/')) return false;
  return SUBSCRIPTION_FILES.has(path.basename(normalized));
}

function quotedPriceLiterals(line) {
  const hits = [];
  const strings = line.match(/"(?:\\.|[^"\\\n])*"/g) || [];
  const price = /\$(?:0(?![.\w])|[1-9]\d*)(?:\.\d+)?/;
  const interpolated = /\$\\\(/;
  for (const literal of strings) {
    if (price.test(literal) || interpolated.test(literal)) hits.push(literal);
  }
  return hits;
}

function supermarketHits(relPath, source) {
  const subscriptionFile = isSubscriptionFile(relPath);
  const hits = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const reasons = [];
    for (const rule of CATALOGUE_DATE) {
      if (rule.re.test(line)) reasons.push(rule.name);
    }
    if (!subscriptionFile) {
      reasons.push(...quotedPriceLiterals(line));
      if (/Budget\s+\$/.test(line)) reasons.push('Budget $');
      if (/Est\.\s*shop/i.test(line)) reasons.push('Est. shop');
      if (/Shop budget/i.test(line)) reasons.push('Shop budget');
      if (/\bbasket\s+total\b/i.test(line)) reasons.push('basket total');
    }
    if (reasons.length) {
      hits.push(`${relPath}:${index + 1}: ${reasons.join(', ')}: ${line.trim()}`);
    }
  });
  return hits;
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name.endsWith('.xcassets')) continue;
      walk(full, acc);
    } else if (TEXT_EXT.has(path.extname(name))) {
      acc.push(full);
    }
  }
  return acc;
}

function scanIosTrees(rootDir) {
  const hits = [];
  for (const root of ROOTS) {
    const abs = path.join(rootDir, root);
    for (const file of walk(abs, [])) {
      const rel = path.relative(rootDir, file);
      const text = fs.readFileSync(file, 'utf8');
      hits.push(...supermarketHits(rel, text));
    }
  }
  return hits;
}

describe('iOS supermarket price and catalogue-date gate', () => {
  it('flags price literals, specials, and catalogue dates under ios/', () => {
    const sample = [
      '"Chicken breast $4.50"',
      '"Est. shop", "$\\(total)"',
      'labeledField("Budget $", text: $budget)',
      'Shop budget',
      'Prices from public specials',
      'Catalogue week 25 to 31 Aug 2026',
      'on special until Friday',
    ].join('\n');
    const hits = supermarketHits('ios/Fixtures/catalogue.json', sample);
    expect(hits.some((hit) => hit.includes('$4.50'))).toBe(true);
    expect(hits.some((hit) => hit.includes('Est. shop'))).toBe(true);
    expect(hits.some((hit) => hit.includes('Budget $'))).toBe(true);
    expect(hits.some((hit) => hit.includes('Shop budget'))).toBe(true);
    expect(hits.some((hit) => hit.includes('specials'))).toBe(true);
    expect(hits.some((hit) => hit.includes('catalogue date range') || hit.includes('catalogue'))).toBe(true);
    expect(hits.some((hit) => hit.includes('on special'))).toBe(true);
  });

  it('keeps the list line and StoreKit subscription prices', () => {
    const honest = [
      'Text("Check prices at checkout")',
      'Text("\\(meal.protein ?? 0)g protein per serve")',
      'let price: FlexDouble?',
      '["role": $0.role, "content": $0.content]',
    ].join('\n');
    expect(supermarketHits('ios/Plan.swift', honest)).toEqual([]);
    expect(supermarketHits('FitMunch/Views/MealPlanView.swift', honest)).toEqual([]);

    const storeKit = 'displayPrice: "A$19.99"\nannual "A$149.99"';
    expect(supermarketHits('FitMunchTests/PaywallCatalogTests.swift', storeKit)).toEqual([]);
    expect(supermarketHits('ios/PaywallCatalogTests.swift', storeKit).length).toBeGreaterThan(0);
  });

  it('paywall and onboarding do not cite supermarket savings', () => {
    const paywall = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/PaywallView.swift'), 'utf8');
    const onboarding = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/OnboardingView.swift'), 'utf8');
    const banned = /\b(specials|catalogue|woolworths|woolies|coles|aldi)\b/i;
    expect(paywall).not.toMatch(banned);
    expect(onboarding).not.toMatch(banned);
  });

  it('the iOS tree has no supermarket price literals or catalogue-date copy', () => {
    const plan = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/MealPlanView.swift'), 'utf8');
    expect(plan).toContain('Check prices at checkout');
    expect(plan).toContain('protein per serve');
    expect(scanIosTrees(__dirname)).toEqual([]);
  });
});
