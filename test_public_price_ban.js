'use strict';

const fs = require('fs');
const path = require('path');

const ALLOW = new Set(['0', '0.00', '19.99', '39', '79', '39.00', '79.00']);

function walkHtml(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkHtml(abs, acc);
      continue;
    }
    if (entry.name.endsWith('.html')) acc.push(abs);
  }
  return acc;
}

function moneyHits(text) {
  const hits = [];
  const re = /(?:A\$|\$)\s?(\d+(?:\.\d{1,2})?)/g;
  let match;
  while ((match = re.exec(text))) {
    if (ALLOW.has(match[1])) continue;
    if (/^\d$/.test(match[1])) continue;
    hits.push(match[0]);
  }
  return hits;
}

describe('banned public strings', () => {
  test('public HTML has no supermarket dollars, totals, savings, catalogue dates, Pty, or inc GST', () => {
    const hits = [];
    for (const file of walkHtml(path.join(__dirname, 'public'))) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      const money = moneyHits(text);
      if (money.length) hits.push(`${rel} money ${money.join(',')}`);
      if (/\bPty\b/i.test(text)) hits.push(`${rel} Pty`);
      if (/inc\.?\s*GST/i.test(text)) hits.push(`${rel} inc GST`);
      if (/validFrom|validTo|pricedAt|2026-08-25|2026-08-31/i.test(text)) hits.push(`${rel} catalogue date`);
      if (/catalogue save|you save \$|savings of|\$\s?\d[\d.]*\s+sav/i.test(text)) hits.push(`${rel} savings`);
    }
    expect(hits).toEqual([]);
  });

  test('terms name the GST position without an entity or inc GST', () => {
    const terms = fs.readFileSync(path.join(__dirname, 'public', 'terms.html'), 'utf8');
    expect(terms).toContain('We are not registered for GST, so no GST is charged on FitMunch prices.');
    expect(terms).not.toMatch(/inc\.?\s*GST/i);
    expect(terms).not.toMatch(/\bPty\b/i);
    expect(terms).not.toMatch(/\bDrew\b/);
    expect(terms).not.toMatch(/sole trader/i);
    expect(terms).toContain('<!-- ENTITY_LINE: pending owner confirmation -->');
  });
});
