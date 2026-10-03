const fs = require('fs');
const { METADATA } = require('./asc-update-metadata');

const FORBIDDEN = ['barcode', 'restaurant', 'no cloud', 'Apple Health', '100,000', 'steps'];

// App Store subscription prices. Any other dollar amount is a supermarket or savings figure.
const ALLOWED_SUBSCRIPTION_PRICES = ['A$19.99', 'A$149.99'];

const CATALOGUE_DATE = new RegExp(
  [
    '\\bweek of\\s+\\d',
    '\\bvalid until\\b',
    '\\bends\\s+(?:mon|tue|wed|thu|fri|sat|sun)',
    '\\buntil\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\\d)',
    '\\b\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]\\d{2,4})?\\b',
    '\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{1,2}\\b',
    '\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b',
  ].join('|'),
  'i'
);

function storyboardHeadlines() {
  const py = fs.readFileSync('scripts/frame-appstore-screenshots.py', 'utf8');
  const start = py.indexOf('CAPTIONS = [');
  const end = py.indexOf('\n]', start);
  const block = py.slice(start, end);
  const headlines = [...block.matchAll(/"([^"]+)"\s*,\s*(?:True|False)\)/g)].map((match) => match[1]);
  if (headlines.length !== 7) {
    throw new Error(`expected 7 storyboard headlines, found ${headlines.length}`);
  }
  return headlines;
}

function listingSurfaces() {
  return [
    ['subtitle', METADATA.subtitle],
    ['promo', METADATA.promotionalText],
    ['keywords', METADATA.keywords],
    ['whatsNew', METADATA.whatsNew],
    ['description', METADATA.description],
    ...storyboardHeadlines().map((headline, index) => [`caption ${index + 1}`, headline]),
  ];
}

function withoutSubscriptionPrices(text) {
  return ALLOWED_SUBSCRIPTION_PRICES.reduce((out, price) => out.split(price).join(''), text);
}

function priceViolations(text) {
  const stripped = withoutSubscriptionPrices(text);
  const found = [];
  if (/\bspecials?\b/i.test(stripped)) found.push('specials');
  if (/\bcatalogue\b/i.test(stripped)) found.push('catalogue');
  if (/\bcatalog\b/i.test(stripped)) found.push('catalog');
  if (CATALOGUE_DATE.test(stripped)) found.push('catalogue date');
  if (/(?:A\$|\$|AUD)\s?\d|\b\d+\.\d{2}\b/i.test(stripped)) found.push('price');
  if (/\b(?:save|saves|saving|savings)\b[^.\n]{0,40}\d/i.test(stripped)) found.push('savings');
  return found;
}

describe('ASC metadata limits', () => {
  const md = fs.readFileSync('appstore-metadata.md', 'utf8');
  const listing = fs.readFileSync('docs/app-store/listing.txt', 'utf8');

  it('keeps the name, subtitle, promo, keywords, and description inside ASC limits', () => {
    expect(METADATA.name.length).toBeLessThanOrEqual(30);
    expect(METADATA.subtitle.length).toBeLessThanOrEqual(30);
    expect(METADATA.promotionalText.length).toBeLessThanOrEqual(170);
    expect(Buffer.byteLength(METADATA.keywords, 'utf8')).toBeLessThanOrEqual(100);
    expect(METADATA.description.length).toBeLessThanOrEqual(4000);
  });

  it('keeps rejected claims out of the description', () => {
    const description = METADATA.description;
    for (const phrase of FORBIDDEN) {
      expect(description.toLowerCase().includes(phrase.toLowerCase())).toBe(false);
    }
  });

  it('matches appstore-metadata.md and does not claim a shopping-list screen', () => {
    expect(md).toContain(METADATA.name);
    expect(md).toContain(METADATA.subtitle);
    expect(md).toContain(METADATA.promotionalText);
    expect(md).toContain(METADATA.keywords);
    expect(md).toContain(METADATA.whatsNew);
    expect(md).toContain(METADATA.supportUrl);
    expect(METADATA.supportUrl).toBe('https://www.fitmunch.com.au/support');
    expect(METADATA.description).toContain('support@fitmunch.com.au');
    expect(md).toContain(METADATA.description);
    expect(METADATA.keywords).toContain('shopping');
    expect(METADATA.description.toLowerCase()).not.toContain('shopping list');
    expect(METADATA.promotionalText.toLowerCase()).not.toContain('shopping list');
    expect(METADATA.description).not.toContain('[Start with a free trial');
    expect(listing).toContain(METADATA.subtitle);
    expect(listing).toContain(METADATA.promotionalText);
    expect(listing).toContain(METADATA.keywords);
    expect(listing).toContain(METADATA.description);
    for (const headline of storyboardHeadlines()) {
      expect(listing).toContain(headline);
    }
  });

  it('says the list is split by store and prices are checked at checkout', () => {
    for (const text of [METADATA.description, METADATA.promotionalText]) {
      expect(text).toContain('builds your list split by store');
      expect(text).toContain('check prices at checkout');
    }
  });

  it('does not cite supermarket prices, savings figures, specials, or catalogue dates', () => {
    const banned = [
      'Woolies specials this week',
      'On special at Coles',
      'Coles catalogue 6 October',
      'Public catalog prices',
      'Save A$12.50 on the shop',
      'Chicken was $8.40',
      'Valid until Sunday',
      'Week of 2/10',
      'Annual: A$149.99 (A$2.88 a week)',
    ];
    for (const line of banned) {
      expect(priceViolations(line).length).toBeGreaterThan(0);
    }

    for (const [label, text] of listingSurfaces()) {
      expect({ label, violations: priceViolations(text) }).toEqual({ label, violations: [] });
    }
  });
});
