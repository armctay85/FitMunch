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

function lineAt(text, index) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const lineEnd = text.indexOf('\n', index);
  return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
}

function matchIsExample(text, index) {
  return /\bExample\b/.test(lineAt(text, index));
}

function fingerprintHits(text) {
  const hits = [];
  for (const needle of FINGERPRINTS) {
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(needle, from);
      if (index === -1) break;
      if (!matchIsExample(text, index)) hits.push(needle);
      from = index + needle.length;
    }
  }
  return [...new Set(hits)];
}

function inventedPriceHits(text) {
  const hits = [];
  const patterns = [
    /Math\.random\(\)[^\n]{0,120}price/gi,
    /price[^\n]{0,80}Math\.random\(\)/gi,
    /\b(invented|fake|placeholder|random)\s+prices?\b/gi,
    /\bgetEstimatedPrice\b/g,
    /\bmockPrices\b/g,
  ];
  for (const re of patterns) {
    let match;
    const flags = re.global ? re : new RegExp(re.source, 'g');
    while ((match = flags.exec(text))) {
      if (!matchIsExample(text, match.index)) hits.push(match[0]);
    }
  }
  return hits;
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
  it('checks each fingerprint on its own line', () => {
    expect(fingerprintHits('Sarah M. lost 15kg')).toEqual(['Sarah M.']);
    expect(fingerprintHits('Example: Sarah M. is a labelled demo')).toEqual([]);
    expect(fingerprintHits('Example heading\nSarah M. is still a fake')).toEqual(['Sarah M.']);
  });

  it('flags a random or invented price on its own line', () => {
    expect(inventedPriceHits('const price = (Math.random() * 10).toFixed(2);').length).toBeGreaterThan(0);
    expect(inventedPriceHits('Example: price = Math.random()')).toEqual([]);
    expect(inventedPriceHits('const steps = Math.floor(Math.random() * 100);')).toEqual([]);
  });

  it('production source does not serve a known mock dataset without an Example label', () => {
    const hits = [];
    for (const file of walk(__dirname)) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      for (const needle of fingerprintHits(text)) hits.push(`${rel} ${needle}`);
      for (const needle of inventedPriceHits(text)) hits.push(`${rel} invented price ${needle}`);
      if (anonymisedHits(text).length) hits.push(`${rel} anonymised claim`);
    }
    expect(hits).toEqual([]);
  });

  it('privacy page says account data is identified and names the providers', () => {
    const privacy = fs.readFileSync(path.join(__dirname, 'public', 'privacy.html'), 'utf8');
    expect(privacy).toContain('this is not anonymised');
    expect(privacy).toContain('RevenueCat');
    expect(privacy).toContain('AI receipt reader');
    expect(privacy).toContain('Google Gemini');
    expect(privacy).toContain('Vercel');
    expect(privacy).toContain('processed overseas');
    expect(privacy).toContain('does not keep the original receipt photo');
    expect(privacy).toContain('None of this is used for tracking or ads');
    expect(privacy.match(/does not keep the original receipt photo/g)).toHaveLength(1);
    expect(privacy.match(/None of this is used for tracking or ads/g)).toHaveLength(1);
    expect(privacy).not.toMatch(/usage data is anonymised/i);
    expect(privacy).not.toContain('Opt out of AI');
    expect(privacy).not.toContain('Export your meal plans');
  });
});
