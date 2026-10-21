'use strict';

const fs = require('fs');
const path = require('path');
const lines = require('./lib/receipt-lines');
const core = require('./lib/receipt-scan-core');

const TEXT = fs.readFileSync(path.join(__dirname, 'scripts/fixtures/receipt-au.txt'), 'utf8');
const JSON_FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'scripts/fixtures/receipt-au.json'), 'utf8'));

function byName(items, re) {
  const hit = items.find((i) => re.test(i.name));
  if (!hit) throw new Error(`missing ${re}`);
  return hit;
}

describe('AU receipt text', () => {
  const items = lines.parseReceiptText(TEXT);

  it('prices 1 kg of bananas from the per kg line, not $1', () => {
    const bananas = byName(items, /banana/i);
    expect(bananas).toMatchObject({ quantity: 1, unit: 'kg', unitPrice: 3.9, price: 3.9, priceStatus: 'known' });
    const nutrition = core.estimateNutrition(bananas.name, bananas.quantity, bananas.unit);
    expect(nutrition.calories).toBe(890);
    expect(nutrition.calories).toBeGreaterThan(800);
  });

  it('reads a 2 for $5 multi-buy as the deal total', () => {
    const cola = byName(items, /cola/i);
    expect(cola.quantity).toBe(2);
    expect(cola.price).toBe(5);
    expect(cola.priceStatus).toBe('known');
    expect(cola.price).not.toBe(1);
  });

  it('reads 3 @ $1.80 as the printed line total', () => {
    const yoghurt = byName(items, /yoghurt/i);
    expect(yoghurt).toMatchObject({ quantity: 3, unit: 'each', unitPrice: 1.8, price: 5.4, priceStatus: 'known' });
  });

  it('reads a weighted deli line and scales macros by the weight', () => {
    const ham = byName(items, /ham/i);
    expect(ham).toMatchObject({ quantity: 0.246, unit: 'kg', unitPrice: 32, price: 7.87, priceStatus: 'known' });
    const nutrition = core.estimateNutrition(ham.name, ham.quantity, ham.unit);
    expect(nutrition.calories).toBe(357);
    expect(nutrition.protein).toBe(44);
    expect(nutrition.calories).toBeGreaterThan(120);
  });

  it('takes a negative special off the previous line', () => {
    const chicken = byName(items, /chicken/i);
    expect(chicken.price).toBe(10);
    expect(chicken.unit).toBe('kg');
  });

  it('keeps a printed $1.00 and leaves an unreadable price unknown', () => {
    expect(byName(items, /mandarin/i)).toMatchObject({ price: 1, priceStatus: 'known' });
    const mystery = byName(items, /mystery/i);
    expect(mystery.price).toBeNull();
    expect(mystery.priceStatus).toBe('unknown');
    expect(items.every((i) => i.price !== 1 || i.priceStatus === 'known')).toBe(true);
  });

  it('drops the store header, totals and the informational savings line', () => {
    const names = items.map((i) => i.name).join('\n');
    expect(names).not.toMatch(/woolworths|total|eftpos|you saved/i);
  });
});

describe('vision JSON', () => {
  const payload = core.buildScanPayload(JSON_FIXTURE);

  it('replaces a placeholder $1 with the printed per kg, multi-buy and deli prices', () => {
    const bananas = byName(payload.items, /^bananas$/i);
    const cola = byName(payload.items, /cola/i);
    const ham = byName(payload.items, /ham/i);
    expect(bananas).toMatchObject({ price: 3.9, priceStatus: 'known', unit: 'kg', quantity: 1 });
    expect(bananas.nutrition.calories).toBe(890);
    expect(cola).toMatchObject({ price: 5, quantity: 2, priceStatus: 'known' });
    expect(ham).toMatchObject({ price: 7.87, unit: 'kg', priceStatus: 'known' });
    expect(ham.nutrition.calories).toBe(357);
  });

  it('marks a bare $1 with no printed amount as unknown', () => {
    const loose = byName(payload.items, /loose/i);
    expect(loose.price).toBeNull();
    expect(loose.priceStatus).toBe('unknown');
    expect(payload.unpricedCount).toBe(1);
  });

  it('scores from the real prices and reports protein per dollar without store names', () => {
    expect(payload.proteinPerDollar).toBe(3.9);
    const oneDollar = core.buildScanPayload({
      items: [{ name: 'Bananas 1kg', quantity: 1, unit: 'kg', price: 1, category: 'fruit' }],
    });
    expect(oneDollar.items[0].nutrition.calories).toBe(890);
    expect(oneDollar.items[0].priceStatus).toBe('unknown');
    expect(oneDollar.proteinPerDollar).toBeNull();
    const healthy = core.macroMatchScore([
      { name: 'CHICKEN BREAST', price: 18 },
      { name: 'BROCCOLI', price: 6 },
      { name: 'JASMINE RICE', price: 5 },
      { name: 'TIM TAM', price: 3 },
    ]);
    const junk = core.macroMatchScore([
      { name: 'CHICKEN BREAST', price: 3 },
      { name: 'BROCCOLI', price: 3 },
      { name: 'JASMINE RICE', price: 3 },
      { name: 'TIM TAM', price: 23 },
    ]);
    expect(healthy).toBeGreaterThan(junk);
    expect(JSON.stringify(payload)).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b|\biga\b|costco/i);
  });

  it('files eggs as dairy and scales a 12 pack by the piece', () => {
    const shop = core.buildScanPayload(lines.parseReceiptText(TEXT));
    const eggs = byName(shop.items, /eggs/i);
    expect(eggs.category).toBe('dairy');
    expect(eggs.quantity).toBe(12);
    expect(eggs.nutrition.calories).toBe(840);
    expect(JSON.stringify(shop)).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b/i);
  });
});

describe('scan speed path', () => {
  const scanner = fs.readFileSync(path.join(__dirname, 'receipt-scanner.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, 'lib/ai-client.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
  const first = fs.readFileSync(path.join(__dirname, 'public/js/fm-first-scan.js'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

  it('asks for one structured JSON object and never tells the model to use $1', () => {
    const prompt = require('./receipt-scanner').AI_PROMPTS.VISION_PROMPT;
    expect(prompt).toMatch(/one JSON object/i);
    expect(prompt).toMatch(/set price to null/i);
    expect(prompt).toMatch(/Never use 1 as a placeholder/);
    expect(prompt).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b/i);
    expect(scanner).toMatch(/jsonMode:\s*true/);
    expect(scanner).toMatch(/maxTokens:\s*1200/);
    expect(scanner).toMatch(/temperature:\s*0/);
    expect(client).toMatch(/response_format: \{ type: 'json_object' \}/);
  });

  it('shrinks the photo before upload and shows progress while the one call runs', () => {
    expect(app).toMatch(/compressReceiptFile\(file, maxEdge = 1200, quality = 0\.72\)/);
    expect(first).toMatch(/maxEdge = maxEdge \|\| 1200/);
    expect(first).toMatch(/quality = quality \|\| 0\.72/);
    for (const src of [app, first]) {
      expect(src).toMatch(/Preparing the photo/);
      expect(src).toMatch(/Reading prices and weights/);
      expect(src).toMatch(/Scoring the haul/);
    }
    expect(home).toMatch(/data-fs-progress/);
    expect(home).toMatch(/Preparing the photo/);
    for (const src of [app, first, home]) {
      expect(src).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b/i);
    }
  });
});
