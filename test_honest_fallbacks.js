'use strict';

const fs = require('fs');
const path = require('path');

const FINGERPRINTS = [
  'Chicken Breast 1kg',
  'Free Range Eggs 12pk',
  'sample-fallback',
  'Sarah M.',
  'lose 15kg in 6 months',
  'mockPrices',
  'AU_PRICES',
  'via.placeholder.com',
  'user@example.com',
  'google_user@example.com',
];

const SKIP_DIRS = new Set(['node_modules', 'coverage', '.git', 'dist']);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, acc);
      continue;
    }
    if (!/\.(js|html|swift)$/.test(entry.name)) continue;
    if (/^test_.*\.js$/.test(entry.name)) continue;
    acc.push(abs);
  }
  return acc;
}

function fingerprintHits(text) {
  return FINGERPRINTS.filter((needle) => text.includes(needle) && !/\bExample\b/.test(text));
}

function anonymisedHits(text) {
  const hits = [];
  const re = /anonymised/gi;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 4), match.index);
    if (!/not\s+$/i.test(before)) hits.push(match[0]);
  }
  return hits;
}

describe('honest fallbacks', () => {
  it('flags a known mock dataset that is not labelled Example', () => {
    expect(fingerprintHits('Sarah M. lost 15kg')).toEqual(['Sarah M.']);
    expect(fingerprintHits('Example: Sarah M. is a labelled demo')).toEqual([]);
  });

  it('production source does not serve a known mock dataset without an Example label', () => {
    const hits = [];
    for (const file of walk(__dirname)) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      for (const needle of fingerprintHits(text)) hits.push(`${rel} ${needle}`);
      if (anonymisedHits(text).length) hits.push(`${rel} anonymised claim`);
    }
    expect(hits).toEqual([]);
  });

  it('privacy page says account data is identified and names the providers', () => {
    const privacy = fs.readFileSync(path.join(__dirname, 'public', 'privacy.html'), 'utf8');
    expect(privacy).toContain('this is not anonymised');
    expect(privacy).toContain('RevenueCat');
    expect(privacy).toContain('AI receipt reader');
    expect(privacy).toContain('does not keep the original receipt photo');
    expect(privacy).toContain('None of this is used for tracking or ads');
    expect(privacy).not.toMatch(/usage data is anonymised/i);
  });
});
