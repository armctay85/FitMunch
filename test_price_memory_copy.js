'use strict';

const fs = require('fs');
const path = require('path');
const copy = require('./lib/price-memory-copy');

const NOW = new Date('2026-10-03T00:00:00Z');

function memo(overrides) {
  return Object.assign({
    lastPaid: {
      cents: 1100,
      storeName: 'Coles',
      purchasedOn: '2026-09-12',
      showUnitRate: false,
      unitRateCents: null,
      unitRateBasis: null,
      packQualifier: false,
      packLabel: '1 kg',
      promo: false,
    },
    range: null,
    ageBand: 'recent',
  }, overrides);
}

const BANNED = [
  /current price/i,
  /today'?s price/i,
  /price now/i,
  /now A\$/i,
  /live price/i,
  /in store now/i,
  /latest price/i,
  /catalogue/i,
  /special price/i,
  /\bdeal\b/i,
  /\bsave\b/i,
  /\bsaving\b/i,
  /cheapest/i,
  /\blowest\b/i,
  /best price/i,
  /price match/i,
  /guaranteed/i,
  /estimated price/i,
  /est\. price/i,
  /\bapprox\b/i,
  /~\$/,
  /typical price/i,
  /average price/i,
  /others paid/i,
  /community price/i,
];

function bannedHits(text, file) {
  const hits = [];
  text.split('\n').forEach((line, index) => {
    BANNED.forEach((pattern) => {
      if (pattern.test(line)) hits.push(`${file}:${index + 1} ${pattern}`);
    });
    const atStore = line.match(/\bat (Coles|Woolworths|Aldi|IGA|Harris Farm)\b/i);
    if (atStore) {
      const before = line.slice(0, atStore.index).toLowerCase();
      if (!before.includes('paid')) hits.push(`${file}:${index + 1} store name without paid`);
    }
  });
  return hits;
}

describe('price memory copy', () => {
  test('formatters match the allowed lines', () => {
    const plain = copy.formatMemo(memo(), NOW);
    expect(plain.lines[0]).toBe('Your last paid: A$11.00 at Coles (12 Sep)');
    expect(plain.footnote).toBe('From your receipts. Shelf prices change. Check at checkout.');
    const ranged = copy.formatMemo(memo({
      range: { minCents: 1050, maxCents: 1250, receipts: 4, since: '2026-04-02' },
    }), NOW);
    expect(ranged.lines[1]).toBe('You paid A$10.50 to A$12.50 (4 receipts since Apr)');
    const older = copy.formatMemo(memo({
      ageBand: 'older',
      lastPaid: Object.assign(memo().lastPaid, {
        showUnitRate: true,
        unitRateCents: 1100,
        unitRateBasis: 'per_kg',
        purchasedOn: '2026-07-03',
        storeName: 'Aldi',
      }),
    }), NOW);
    expect(older.lines[0]).toBe('Your last paid: A$11.00/kg at Aldi (3 Jul) · older than 3 months');
    const lastYear = copy.shortDate('2025-09-12', NOW);
    expect(lastYear).toBe('12 Sep 2025');
    expect(copy.voiceOver(memo(), NOW)).toBe('You last paid 11 dollars at Coles on 12 September');
    expect(copy.coverageLine(9, 14, 6340)).toBe('Your last paid covers 9 of 14 items: A$63.40');
  });

  test('banned phrases stay out of price memory copy', () => {
    const files = [
      'lib/price-memory-copy.js',
      'public/js/fm-price-memory.js',
    ];
    const swiftDir = path.join(__dirname, 'FitMunch');
    if (fs.existsSync(swiftDir)) {
      fs.readdirSync(swiftDir).forEach((name) => {
        if (/^PriceMemory.*\.swift$/.test(name) || (name === 'Views' || name === 'Utilities')) return;
      });
      function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/PriceMemory.*\.swift$/.test(entry.name)) files.push(path.relative(__dirname, full));
        });
      }
      walk(swiftDir);
    }
    const app = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const marked = app.split('<!-- pm-copy-start -->')[1];
    const region = marked ? marked.split('<!-- pm-copy-end -->')[0] : '';
    const shopper = fs.readFileSync(path.join(__dirname, 'public/shopper.html'), 'utf8');
    const emptyStart = shopper.indexOf('id="pm-empty"');
    const emptyEnd = shopper.indexOf('</section>', emptyStart);
    const empty = shopper.slice(emptyStart, emptyEnd);
    expect(empty).not.toMatch(/A?\$\d/);
    const hits = files.flatMap((file) => bannedHits(fs.readFileSync(path.join(__dirname, file), 'utf8'), file));
    hits.push(...bannedHits(region, 'app.html'));
    hits.push(...bannedHits(empty, 'shopper.html'));
    expect(hits).toEqual([]);
  });

  test('the browser formatter matches the server and renders the footnote', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'dangerously' });
    const script = dom.window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(__dirname, 'public/js/fm-price-memory.js'), 'utf8');
    dom.window.document.body.appendChild(script);
    const ui = dom.window.FitMunchPriceMemory;
    const sample = memo({
      range: { minCents: 1050, maxCents: 1250, receipts: 4, since: '2026-04-02' },
    });
    const browser = ui.formatMemo(sample, NOW);
    const server = copy.formatMemo(sample, NOW);
    expect(browser.line).toBe(server.lines[0]);
    expect(browser.range).toBe(server.lines[1]);
    expect(browser.footnote).toBe(copy.FOOTNOTE);
    const html = ui.surfaceHtml(sample);
    expect(html).toContain(copy.FOOTNOTE);
    expect(html).toContain('Your last paid');
    const card = ui.emptyCard(false);
    expect(card).not.toMatch(/A?\$\d/);
  });

  test('the privacy page states the price memory rules', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/privacy.html'), 'utf8');
    expect(html).toMatch(/id="price-memory"/);
    expect(html).toMatch(/18 months/);
    expect(html).toMatch(/Only you/);
    expect(html).toMatch(/not the store's current price/);
    expect(html).toMatch(/oaic\.gov\.au/);
    expect(html).toMatch(/2026-10/);
    expect(html).not.toMatch(/us-east-1/);
  });

  test('the iOS fixture matches the Jest fixture', () => {
    const web = fs.readFileSync(path.join(__dirname, 'test/fixtures/item-normalise.json'), 'utf8');
    const ios = fs.readFileSync(path.join(__dirname, 'FitMunch/Resources/item-normalise.json'), 'utf8');
    expect(JSON.parse(ios)).toEqual(JSON.parse(web));
  });
});
