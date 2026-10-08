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
  { name: 'catalogue date range', re: /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*(?:to|through|-)\s*\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i },
];

// Whole-file wording. The only grocery price sentence allowed is
// "Prices vary by store and week."
const BANNED_WORDS = [
  { name: 'cheap', re: /\bcheap\b/i },
  { name: 'special', re: /\bspecial\b/i },
  { name: 'specials', re: /\bspecials\b/i },
  { name: 'estimated price', re: /\bestimated price\b/i },
  { name: 'Check prices at checkout', re: /check prices at checkout/i },
  { name: 'Check the shelf price', re: /check the shelf price/i },
  {
    name: 'Woolies, Coles or Aldi $ figure',
    re: /\b(?:woolies|woolworths|coles|aldi)\b[^\n$]{0,80}\$\s*\d+(?:\.\d+)?|\$\s*\d+(?:\.\d+)?[^\n]{0,80}\b(?:woolies|woolworths|coles|aldi)\b/i,
  },
];

// Supermarket wording inside Swift string literals only. Identifiers such as
// savingsPercent, subscription "Save N%", and words like personalized stay.
const GROCERY_WORDS = [
  { name: 'cheap', re: /\bcheapest\b|\bcheaper\b|\bcheap\b/i },
  { name: 'special', re: /\bspecials?\b/i },
  { name: 'saving', re: /\bsavings?\b/i },
];

function isSubscriptionFile(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (normalized.startsWith('ios/')) return false;
  return SUBSCRIPTION_FILES.has(path.basename(normalized));
}

function swiftStringLiterals(line) {
  return line.match(/"(?:\\.|[^"\\\n])*"/g) || [];
}

function quotedPriceLiterals(line) {
  const hits = [];
  const price = /\$(?:0(?![.\w])|[1-9]\d*)(?:\.\d+)?/;
  const interpolated = /\$\\\(/;
  for (const literal of swiftStringLiterals(line)) {
    if (price.test(literal) || interpolated.test(literal)) hits.push(literal);
  }
  return hits;
}

function groceryWordHits(relPath, line) {
  if (path.extname(relPath) !== '.swift') return [];
  const hits = [];
  for (const literal of swiftStringLiterals(line)) {
    for (const rule of GROCERY_WORDS) {
      if (rule.re.test(literal)) hits.push(rule.name);
    }
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
    for (const rule of BANNED_WORDS) {
      if (rule.re.test(line)) reasons.push(rule.name);
    }
    reasons.push(...groceryWordHits(relPath, line));
    if (!subscriptionFile) {
      reasons.push(...quotedPriceLiterals(line));
      if (/Budget\s+\$/.test(line)) reasons.push('Budget $');
      if (/Est\.\s*shop/i.test(line)) reasons.push('Est. shop');
      if (/Shop budget/i.test(line)) reasons.push('Shop budget');
      if (/\bbasket\s+total\b/i.test(line)) reasons.push('basket total');
      if (/Check prices at checkout/i.test(line)) reasons.push('Check prices at checkout');
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
      'Text("Prices vary by store and week.")',
      'Text("Check prices at checkout")',
      'Text("\\(meal.protein ?? 0)g protein per serve")',
      'let price: FlexDouble?',
      '["role": $0.role, "content": $0.content]',
    ].join('\n');
    expect(supermarketHits('ios/Plan.swift', honest).some((hit) => hit.includes('Check prices at checkout'))).toBe(true);
    expect(supermarketHits('FitMunch/Views/MealPlanView.swift', [
      'Text("Prices vary by store and week.")',
      'Text("\\(meal.protein ?? 0)g protein per serve")',
    ].join('\n'))).toEqual([]);

    const storeKit = 'displayPrice: "A$19.99"\nannual "A$149.99"';
    expect(supermarketHits('FitMunchTests/PaywallCatalogTests.swift', storeKit)).toEqual([]);
    expect(supermarketHits('ios/PaywallCatalogTests.swift', storeKit).length).toBeGreaterThan(0);
  });

  it('fails on banned supermarket words', () => {
    const banned = [
      ['Woolies $4.50', 'Woolies, Coles or Aldi $ figure'],
      ['Chicken at Coles $12.00', 'Woolies, Coles or Aldi $ figure'],
      ['$3.99 at Aldi', 'Woolies, Coles or Aldi $ figure'],
      ['Build me a cheap high-protein shop', 'cheap'],
      ['a special shop', 'special'],
      ['Prices from public specials', 'specials'],
      ['estimated price for the trolley', 'estimated price'],
      ['25 to 31 Aug', 'catalogue date range'],
      ['week ending 3 Oct', 'catalogue week date'],
      ['Check prices at checkout', 'Check prices at checkout'],
      ['Check the shelf price', 'Check the shelf price'],
    ];
    for (const [line, reason] of banned) {
      const hits = supermarketHits('FitMunch/Views/CoachView.swift', line);
      expect(hits.some((hit) => hit.includes(reason))).toBe(true);
    }

    const allowed = supermarketHits(
      'FitMunch/Views/MealPlanView.swift',
      'Text("Prices vary by store and week.")',
    );
    expect(allowed).toEqual([]);

    const coach = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/CoachView.swift'), 'utf8');
    expect(coach).toContain('starter("Build me a high-protein week for my macros")');
    expect(coach).not.toContain('Build me a cheap high-protein Woolies shop');
    expect(coach).not.toContain('Plan a high-protein week around my meals');

    expect(scanIosTrees(__dirname)).toEqual([]);
  });

  it('flags cheap, special, and saving inside Swift string literals', () => {
    const banned = [
      'starter("Build me a cheap high-protein Woolies shop")',
      'Text("the cheapest tin")',
      'Text("a cheaper cut")',
      'Text("a special shop")',
      'Text("Weekly savings at the supermarket")',
      'print("Error saving meal: \\(error)")',
    ].join('\n');
    const hits = supermarketHits('FitMunch/Views/CoachView.swift', banned);
    expect(hits.some((hit) => hit.includes('cheap high-protein'))).toBe(true);
    expect(hits.some((hit) => hit.includes('cheapest tin'))).toBe(true);
    expect(hits.some((hit) => hit.includes('cheaper cut'))).toBe(true);
    expect(hits.some((hit) => hit.includes('a special shop'))).toBe(true);
    expect(hits.some((hit) => hit.includes('Weekly savings'))).toBe(true);
    expect(hits.some((hit) => hit.includes('Error saving meal'))).toBe(true);

    const allowed = [
      'Text("Prices vary by store and week.")',
      'Text("A personalized week around my meals")',
      'Text("Save \\(savingsPercent)%")',
      '// annual price is not actually cheaper.',
      'static func savingsPercent(monthly: Decimal, annual: Decimal) -> Int?',
    ].join('\n');
    expect(supermarketHits('FitMunch/Views/PaywallView.swift', allowed)).toEqual([]);
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
    expect(plan).toContain('Prices vary by store and week.');
    expect(plan).not.toContain('Check prices at checkout');
    expect(plan.split('Prices vary by store and week.').length - 1).toBe(1);
    expect(plan).toContain('protein per serve');
    const hits = scanIosTrees(__dirname);
    expect(hits).toEqual([]);
    for (const root of ROOTS) {
      const abs = path.join(__dirname, root);
      for (const file of walk(abs, [])) {
        const text = fs.readFileSync(file, 'utf8');
        const copies = text.split('Prices vary by store and week.').length - 1;
        expect(copies).toBeLessThanOrEqual(1);
      }
    }
  });
});
