'use strict';

/**
 * Australian supermarket receipt lines: per kg, multi-buy, and discounts.
 * Prices come from the printed line. A missing price stays unknown.
 * Nothing here invents $1.
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function finite(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '');
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    v = m[0];
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A printed one-dollar amount. "1.000 kg" is a weight, not $1.00. */
function hasOneDollar(text) {
  const s = String(text || '');
  return /\$\s*1(?:\.00)?(?!\d)/.test(s) || /(?:^|\s)1\.00(?!\d)/.test(s);
}

const STORE_ONLY_RE = /^(?:woolworths|woolies|coles|aldi|iga|harris\s*farm|foodworks|costco|drakes|spar|foodland|ritchies|supabarn)(?:\s+supermarket)?\.?$/i;

const NOISE_RE = /^[\W\d]*(sub ?-?total|total|tax|cash|credit|debit|visa|mastercard|amex|balance|payment|amount)\b|\beftpos\b|\bchange\b|\bgst\b|\brounding\b|\btender\b|\brewards\b|\bflybuys\b|\bloyalty\b|\bpoints\b|^\W*bags?\b|\b(?:shopping|reusable|carry) bags?\b|^abn\b|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i;

function isDiscountLine(line) {
  const s = String(line || '').trim();
  return /^(special|save|saved|you saved|discount|price reduction|member savings|promo)\b/i.test(s)
    || /^-\s*\$?\s*\d/.test(s);
}

function isNoise(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (STORE_ONLY_RE.test(s)) return true;
  if (NOISE_RE.test(s)) return true;
  return false;
}

function packCount(name) {
  const s = String(name || '');
  const pk = s.match(/\b(\d+)\s*(?:pk|pack)\b/i) || s.match(/\bx\s*(\d+)\b/i);
  return pk ? parseInt(pk[1], 10) : null;
}

/**
 * Fold a savings line into the previous item.
 * "YOU SAVED" is informational when the line total is already the price paid.
 * A negative amount or "SPECIAL -$2.00" is taken off.
 */
function applyDiscount(item, line) {
  if (!item || item.priceStatus !== 'known' || !(item.price > 0)) return;
  const s = String(line || '').trim();
  if (/you saved|member savings|rewards/i.test(s) && !/^-\s*\$?\s*\d/.test(s)) return;
  const neg = s.match(/^-\s*\$?\s*(\d+(?:\.\d+)?)/);
  const labelled = s.match(/(?:special|save|saved|discount|reduction|promo)\s+-?\$?\s*(\d+(?:\.\d+)?)/i);
  const amount = neg ? parseFloat(neg[1]) : (labelled ? parseFloat(labelled[1]) : null);
  if (!(amount > 0)) return;
  const next = round2(item.price - amount);
  if (next > 0) item.price = next;
  else {
    item.price = null;
    item.priceStatus = 'unknown';
  }
}

function parseWeightLine(line) {
  const m = String(line || '').match(/^(.*?)(\d+(?:\.\d+)?)\s*(kg|g)\b\s*(?:NET\s*)?(?:@\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:kg|g))?)?(?:\s+\$?\s*(\d+\.\d{2}))?\s*$/i);
  if (!m) return null;
  const unitPrice = m[4] ? round2(m[4]) : null;
  const printed = m[5] ? round2(m[5]) : null;
  if (unitPrice == null && printed == null) return null;
  const qty = parseFloat(m[2]);
  const unit = m[3].toLowerCase();
  const perKg = /\/\s*kg/i.test(line) || unit === 'kg';
  let price = printed;
  if (price == null && unitPrice != null) {
    const weightKg = unit === 'g' ? qty / 1000 : qty;
    price = round2(perKg ? weightKg * unitPrice : qty * unitPrice);
  }
  const name = m[1].replace(/[@:\s]+$/g, '').trim();
  return {
    name,
    quantity: qty,
    unit,
    unitPrice,
    price: price > 0 ? price : null,
    priceStatus: price > 0 ? 'known' : 'unknown',
  };
}

function parseMultiLine(line) {
  const text = String(line || '').trim();
  const forM = text.match(/^(.*?)(\d+)\s+for\s+\$?\s*(\d+(?:\.\d+)?)\s*(?:\$?\s*(\d+\.\d{2}))?\s*$/i);
  if (forM) {
    const deal = round2(forM[3]);
    const printed = forM[4] ? round2(forM[4]) : null;
    const price = printed != null ? printed : deal;
    return {
      name: forM[1].replace(/[:\s]+$/g, '').trim(),
      quantity: parseInt(forM[2], 10),
      unit: 'each',
      unitPrice: null,
      price: price > 0 ? price : null,
      priceStatus: price > 0 ? 'known' : 'unknown',
    };
  }
  const atM = text.match(/^(?:qty\s+)?(.*?)(\d+)\s*@\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:ea|each)?\s*(?:\$?\s*(\d+\.\d{2}))?\s*$/i);
  if (!atM) return null;
  if (/\d+(?:\.\d+)?\s*(?:kg|g)\b/i.test(text)) return null;
  const qty = parseInt(atM[2], 10);
  const unitPrice = round2(atM[3]);
  const printed = atM[4] ? round2(atM[4]) : null;
  const price = printed != null ? printed : round2(qty * unitPrice);
  return {
    name: atM[1].replace(/[:\s]+$/g, '').trim(),
    quantity: qty,
    unit: 'each',
    unitPrice,
    price: price > 0 ? price : null,
    priceStatus: price > 0 ? 'known' : 'unknown',
  };
}

function parsePricedName(line) {
  const m = String(line || '').match(/^(.+?[A-Za-z].*?)\s+\$?\s*(\d+\.\d{2})\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || isNoise(name) || isDiscountLine(name)) return null;
  const price = round2(m[2]);
  const pack = packCount(name);
  return {
    name,
    quantity: pack || 1,
    unit: pack ? 'each' : 'each',
    unitPrice: null,
    price: price > 0 ? price : null,
    priceStatus: price > 0 ? 'known' : 'unknown',
  };
}

function withPack(item) {
  if (!item) return item;
  if (item.quantity && item.quantity !== 1) return item;
  const pack = packCount(item.name);
  if (!pack) return item;
  return { ...item, quantity: pack, unit: item.unit || 'each' };
}

/**
 * Parse receipt text into grocery lines.
 * @param {string} text
 * @returns {Array<{name:string,quantity:number,unit:string,unitPrice:number|null,price:number|null,priceStatus:'known'|'unknown'}>}
 */
function parseReceiptText(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const items = [];
  let pending = null;

  function takePendingUnknown() {
    if (!pending) return;
    const pack = packCount(pending);
    items.push({
      name: pending,
      quantity: pack || 1,
      unit: pack ? 'each' : 'each',
      unitPrice: null,
      price: null,
      priceStatus: 'unknown',
    });
    pending = null;
  }

  for (const line of lines) {
    if (isDiscountLine(line)) {
      if (items.length) applyDiscount(items[items.length - 1], line);
      continue;
    }
    if (isNoise(line)) continue;

    const weight = parseWeightLine(line);
    if (weight && (weight.unitPrice != null || weight.price != null)) {
      const name = weight.name || pending;
      pending = null;
      if (!name) continue;
      items.push(withPack({ ...weight, name }));
      continue;
    }

    const multi = parseMultiLine(line);
    if (multi) {
      const name = multi.name || pending;
      pending = null;
      if (!name) continue;
      items.push({ ...multi, name });
      continue;
    }

    const priced = parsePricedName(line);
    if (priced) {
      takePendingUnknown();
      items.push(priced);
      continue;
    }

    takePendingUnknown();
    pending = line;
  }
  takePendingUnknown();
  return items.filter((i) => i && i.name && !isNoise(i.name));
}

function isPlaceholderDollar(price, item) {
  if (price == null || Math.abs(price - 1) > 0.001) return false;
  if (item && item.priceStatus === 'known') return false;
  const blob = `${(item && item.line) || ''} ${(item && item.raw) || ''} ${(item && item.name) || ''}`;
  if (hasOneDollar(blob)) return false;
  const qty = finite(item && item.quantity);
  const unitPrice = finite(item && item.unitPrice);
  if (unitPrice != null && qty != null && Math.abs(round2(unitPrice * qty) - 1) < 0.02) return false;
  // No printed one-dollar amount. A bare 1 is a placeholder, not a price we read.
  return true;
}

function normaliseOne(item) {
  if (!item || typeof item !== 'object') return null;
  const line = String(item.line || item.raw || item.rawLine || '').trim();
  if (line) {
    const parsed = parseReceiptText(line);
    const hit = parsed.find((p) => p.priceStatus === 'known') || parsed[0];
    if (hit && hit.priceStatus === 'known') {
      return {
        ...item,
        name: hit.name && hit.name !== 'Grocery item' ? hit.name : item.name,
        quantity: hit.quantity,
        unit: hit.unit || item.unit,
        unitPrice: hit.unitPrice,
        price: hit.price,
        priceStatus: 'known',
        line,
      };
    }
  }

  const qty = finite(item.quantity);
  const unit = item.unit || '';
  const unitPrice = finite(item.unitPrice);
  const discount = finite(item.discount) || 0;
  let price = finite(item.price);

  if (unitPrice != null && qty != null && /kg/i.test(unit)) {
    const computed = round2(qty * unitPrice - (discount > 0 ? discount : 0));
    if (computed > 0 && (price == null || isPlaceholderDollar(price, item))) price = computed;
  } else if (unitPrice != null && qty != null && qty > 1 && (price == null || isPlaceholderDollar(price, item))) {
    const computed = round2(qty * unitPrice - (discount > 0 ? discount : 0));
    if (computed > 0) price = computed;
  }

  if (price == null || !(price > 0) || isPlaceholderDollar(price, item)) {
    return {
      ...item,
      quantity: qty == null ? 1 : qty,
      unit,
      unitPrice,
      price: null,
      priceStatus: 'unknown',
      line,
    };
  }
  return {
    ...item,
    quantity: qty == null ? 1 : qty,
    unit,
    unitPrice,
    price: round2(price),
    priceStatus: 'known',
    line,
  };
}

/**
 * Accept receipt text, a JSON string, `{items:[]}`, or an item array.
 * Re-reads printed lines. A bare price of 1 with no printed $1.00 is unknown.
 */
function normaliseReceiptItems(raw) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return normaliseReceiptItems(JSON.parse(trimmed));
      } catch (_) {
        return parseReceiptText(raw);
      }
    }
    return parseReceiptText(raw);
  }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.items)) return normaliseReceiptItems(raw.items);
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    if (isDiscountLine(name)) {
      if (out.length) applyDiscount(out[out.length - 1], `${name} ${item.price != null ? item.price : ''}`);
      continue;
    }
    if (isNoise(name)) continue;
    const one = normaliseOne(item);
    if (one && one.name) out.push(one);
  }
  return out;
}

module.exports = {
  parseReceiptText,
  normaliseReceiptItems,
  hasOneDollar,
  round2,
};
