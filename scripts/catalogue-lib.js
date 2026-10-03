'use strict';

/**
 * Map public catalogue offers onto the ingredient SKUs, then check the result.
 * This file does not fetch anything.
 */

const STORE_IDS = ['woolworths', 'coles', 'aldi'];

const ALIASES = {
  'chicken-breast-1kg': [/chicken breast/i],
  'chicken-thigh-1kg': [/chicken thigh/i],
  'eggs-12': [/eggs?\b/i, /free range eggs/i],
  'greek-yoghurt-1kg': [/greek yoghurt/i, /greek yogurt/i],
  'oats-750g': [/rolled oats/i, /\boats\b/i],
  'brown-rice-1kg': [/brown rice/i],
  'broccoli-2pk': [/broccoli/i],
  'spinach-120g': [/baby spinach/i, /spinach/i],
  'salmon-400g': [/salmon/i],
  'tuna-4pk': [/tuna/i],
  'beef-mince-500g': [/beef mince/i, /mince/i],
  'sweet-potato-1kg': [/sweet potato/i],
  'bananas-1kg': [/banana/i],
  'frozen-berries-500g': [/frozen mixed berries/i, /mixed berries/i],
  'milk-2l': [/light milk/i, /\bmilk\b/i],
  'cottage-cheese-250g': [/cottage cheese/i],
  'pasta-500g': [/wholemeal pasta/i, /\bpasta\b/i],
  'onion-1kg': [/brown onion/i, /\bonions?\b/i],
  'garlic-bulb': [/garlic/i],
  'olive-oil-500ml': [/olive oil/i],
  'bread-loaf': [/wholegrain/i, /\bbread\b/i, /\bloaf\b/i],
  'capsicum-2pk': [/capsicum/i],
  'zucchini-500g': [/zucchini/i],
  'tomatoes-400g': [/tomato/i],
  'peanut-butter-375g': [/peanut butter/i],
  'frozen-veg-1kg': [/frozen mixed veg/i, /mixed veg/i],
  'cheese-250g': [/tasty cheese/i, /\bcheese\b/i],
  'cucumber': [/cucumber/i],
  'carrots-1kg': [/carrot/i],
  'soy-sauce-250ml': [/soy sauce/i],
};

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function matchSku(title, items) {
  const text = String(title || '');
  const known = new Set((items || []).map((item) => item.id));
  for (const [sku, patterns] of Object.entries(ALIASES)) {
    if (!known.has(sku)) continue;
    if (patterns.some((pattern) => pattern.test(text))) return sku;
  }
  return null;
}

function shelfPrice(quote) {
  if (!quote || !(Number(quote.price) > 0)) return null;
  if (quote.onSpecial && Number(quote.was) > 0) return roundMoney(quote.was);
  return roundMoney(quote.price);
}

function applyOffers(previous, offers) {
  const next = JSON.parse(JSON.stringify(previous));
  const touched = new Set();
  for (const offer of offers || []) {
    if (!STORE_IDS.includes(offer.storeId)) continue;
    const sku = matchSku(offer.title, next.items);
    if (!sku) continue;
    const item = next.items.find((row) => row.id === sku);
    const onSpecial = Boolean(offer.onSpecial);
    item.stores = item.stores || {};
    item.stores[offer.storeId] = {
      price: roundMoney(offer.price),
      was: offer.was == null || offer.was === '' ? null : roundMoney(offer.was),
      onSpecial,
      estimate: !onSpecial,
    };
    if (offer.priceMoveFlag) item.stores[offer.storeId].priceMoveFlag = true;
    touched.add(`${sku}|${offer.storeId}`);
  }

  for (const item of next.items) {
    const prevItem = (previous.items || []).find((row) => row.id === item.id);
    item.stores = item.stores || {};
    for (const storeId of STORE_IDS) {
      if (touched.has(`${item.id}|${storeId}`)) continue;
      const shelf = shelfPrice(prevItem && prevItem.stores && prevItem.stores[storeId]);
      if (shelf == null) {
        delete item.stores[storeId];
        continue;
      }
      item.stores[storeId] = {
        price: shelf,
        was: null,
        onSpecial: false,
        estimate: true,
      };
    }
  }
  return next;
}

function validateCatalogue(catalogue, previous) {
  const errors = [];
  if (!catalogue || !catalogue.validFrom || !catalogue.validTo || !catalogue.updatedAt) {
    errors.push('validFrom, validTo, and updatedAt must be set');
  }
  if (catalogue && catalogue.validFrom && catalogue.validTo && catalogue.validFrom > catalogue.validTo) {
    errors.push('validFrom is after validTo');
  }
  const items = (catalogue && catalogue.items) || [];
  const prevItems = new Map(((previous && previous.items) || []).map((item) => [item.id, item]));
  const seen = new Set();
  for (const item of items) {
    seen.add(item.id);
    const priced = Object.entries(item.stores || {}).filter(([, quote]) => quote && Number(quote.price) > 0);
    if (priced.length < 2) {
      errors.push(`${item.id} is priced at ${priced.length} stores`);
    }
    const prev = prevItems.get(item.id);
    for (const [storeId, quote] of Object.entries(item.stores || {})) {
      if (!quote) continue;
      const price = Number(quote.price);
      if (!(price > 0)) errors.push(`${item.id} ${storeId} price is not above 0`);
      const prevPrice = prev && prev.stores && prev.stores[storeId] && Number(prev.stores[storeId].price);
      if (prevPrice > 0 && price > prevPrice * 3 && !quote.priceMoveFlag) {
        errors.push(`${item.id} ${storeId} ${price} is more than 3x ${prevPrice} without priceMoveFlag`);
      }
    }
  }
  for (const prev of prevItems.values()) {
    if (!seen.has(prev.id)) errors.push(`missing ingredient ${prev.id}`);
  }
  return errors;
}

function summariseChange(previous, next) {
  const moves = [];
  const missing = [];
  let changed = 0;
  for (const prev of (previous && previous.items) || []) {
    const now = ((next && next.items) || []).find((item) => item.id === prev.id);
    if (!now) {
      missing.push(prev.id);
      continue;
    }
    const storeIds = new Set([
      ...Object.keys(prev.stores || {}),
      ...Object.keys(now.stores || {}),
    ]);
    for (const storeId of storeIds) {
      const before = prev.stores && prev.stores[storeId];
      const after = now.stores && now.stores[storeId];
      if (before && !after) {
        missing.push(`${prev.id} at ${storeId}`);
        continue;
      }
      if (!before && after) {
        changed += 1;
        moves.push({
          sku: prev.id,
          storeId,
          from: null,
          to: after.price,
          delta: after.price,
        });
        continue;
      }
      if (before && after && Number(before.price) !== Number(after.price)) {
        changed += 1;
        moves.push({
          sku: prev.id,
          storeId,
          from: before.price,
          to: after.price,
          delta: roundMoney(after.price - before.price),
        });
      }
    }
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { changed, moves, missing };
}

function summaryMarkdown(previous, next) {
  const summary = summariseChange(previous, next);
  const lines = [
    `# Catalogue ${next.validFrom} to ${next.validTo}`,
    '',
    `Items with a price change: ${summary.changed}.`,
    '',
    'Biggest moves:',
  ];
  const top = summary.moves.slice(0, 8);
  if (!top.length) lines.push('- No price changes.');
  for (const move of top) {
    const from = move.from == null ? 'none' : `$${Number(move.from).toFixed(2)}`;
    lines.push(`- ${move.sku} at ${move.storeId}: ${from} to $${Number(move.to).toFixed(2)}`);
  }
  lines.push('', 'Missing items:');
  if (!summary.missing.length) lines.push('- None.');
  for (const id of summary.missing) lines.push(`- ${id}`);
  lines.push(
    '',
    'Estimates are last known shelf prices where that line was not on special. Check prices at checkout. FitMunch does not pay the supermarket and does not fill a retailer trolley.',
    ''
  );
  return lines.join('\n');
}

function sydneyToday(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now || new Date());
}

function daysBefore(validTo, today) {
  const end = Date.parse(`${validTo}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((start - end) / 86400000);
}

module.exports = {
  STORE_IDS,
  ALIASES,
  matchSku,
  shelfPrice,
  applyOffers,
  validateCatalogue,
  summariseChange,
  summaryMarkdown,
  sydneyToday,
  daysBefore,
};
