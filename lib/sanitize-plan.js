'use strict';

const PRICE_NOTE = 'Prices vary by store and week.';

// `updatedAt` is listed here for nested items and lists (catalogue blocks,
// shopping lines). A timestamp on the plan itself is kept: publicPlan also
// returns the row updatedAt beside the plan so a client can show when it
// was saved. The share page and the builder do not print that field.
const DROP_KEYS = new Set([
  'total',
  'totals',
  'totalAud',
  'totalCents',
  'subtotal',
  'cost',
  'estTotal',
  'unpricedCount',
  'unpriced',
  'price',
  'unitPrice',
  'linePrice',
  'lineAud',
  'unitAud',
  'priced',
  'onSpecial',
  'assignedOnSpecial',
  'catalogue',
  'catalogueUrl',
  'sources',
  'pricesFrom',
  'sourceKind',
  'saving',
  'savings',
  'was',
  'wasAud',
  'priceCents',
  'savingAud',
  'discount',
  'promo',
  'dealEnds',
  'catalogueWeek',
  'approvedAt',
  'pricedAt',
  'validFrom',
  'validTo',
  'weekLabel',
  'updatedAt',
]);

const ITEM_KEYS = ['store', 'name', 'aisle', 'packs', 'amount', 'unit'];
const LIST_ITEM_MARKS = [
  'aisle',
  'packs',
  'priced',
  'onSpecial',
  'assignedOnSpecial',
  'linePrice',
  'unitPrice',
  'lineAud',
  'unitAud',
  'price',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
].join('|');

const DOLLAR = `A?(?:\\$|\uFF04|\uFE69)`;

const FRAGMENTS = [
  /au-public-specials(?:-\d{4})?(?:-w\d+)?/gi,
  new RegExp(`\\bwas\\s+${DOLLAR}\\s?\\d+(?:\\.\\d{1,2})?(?:\\s*ea)?\\b`, 'gi'),
  new RegExp('\\bwas\\s+\\d+(?:\\.\\d{1,2})?\\b', 'gi'),
  new RegExp(`\\b\\d+\\s+for\\s+${DOLLAR}\\s?\\d+(?:\\.\\d{1,2})?`, 'gi'),
  new RegExp(`\\bsave\\s+${DOLLAR}\\s?\\d+(?:\\.\\d{1,2})?`, 'gi'),
  /\bsave\s+\d+(?:\.\d+)?%/gi,
  /\b\d+(?:\.\d+)?%\s*off\b/gi,
  new RegExp(`${DOLLAR}\\s?\\d+(?:\\.\\d{1,2})?(?:\\s*off|\\s*ea)?\\b`, 'gi'),
  /\b\d+(?:\.\d{1,2})?\s+dollars?\b/gi,
  /\bAUD\s+\d+(?:\.\d{1,2})?\b/gi,
  /\bhalf[- ]price\b/gi,
  /\bbogo\b/gi,
  /\bbuy\s+one\s+get\s+one(?:\s+free)?\b/gi,
  /\bon\s+special\b/gi,
  /\bspecials\b/gi,
  /\bcatalogue\b/gi,
  /\bw\d+\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'),
];

const AISLE_ORDER = ['produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'other'];
const AISLE_LABELS = {
  produce: 'Produce',
  meat: 'Meat',
  dairy: 'Dairy',
  bakery: 'Bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  other: 'Other',
};

function plain(value, fallback) {
  if (value == null || value === '' || value === 'undefined' || value === 'null') {
    return fallback == null ? '' : String(fallback);
  }
  return String(value);
}

function tidy(text) {
  return String(text)
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/\s*\.(?!\d)\s*/g, '. ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s,.;:|/\\-]+/, '')
    .replace(/[\s,.;:|/\\-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFragments(value) {
  let text = plain(value, '');
  if (!text) return '';
  for (const pattern of FRAGMENTS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, ' ');
  }
  return tidy(text);
}

function isPriceNote(text) {
  return /catalogue|\bspecials\b|\bw\d+\b|au-public-specials|check prices|\$|＄|﹩|\d{4}-\d{2}-\d{2}|\bhalf[- ]price\b|\bbogo\b|buy one get one|\bdollars?\b|\bAUD\s+\d|\bwas\s+\d/i.test(text);
}

function measure(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const raw = String(unit == null ? '' : unit).trim();
  const u = raw.toLowerCase();
  if (u === 'each') return { amount: Math.max(1, Math.ceil(n)), unit: raw || 'each' };
  if (u === 'g' || u === 'ml') {
    const rounded = n > 1000 ? Math.round(n / 10) * 10 : Math.round(n);
    return { amount: rounded, unit: raw };
  }
  if (u === 'kg' || u === 'l') {
    if (n > 0 && n < 1) {
      const scaled = n * 1000;
      let small = scaled > 1000 ? Math.round(scaled / 10) * 10 : Math.round(scaled);
      if (small < 1) small = 1;
      return { amount: small, unit: u === 'kg' ? 'g' : 'ml' };
    }
    const one = Math.round(n * 10) / 10;
    if (n > 0 && one === 0) return { amount: 1, unit: u === 'kg' ? 'g' : 'ml' };
    return { amount: one, unit: raw };
  }
  if (!raw) return { amount: Math.round(n), unit: '' };
  return { amount: Math.round(n), unit: raw };
}

function roundAmount(amount, unit) {
  const next = measure(amount, unit);
  return next ? next.amount : null;
}

function applyAmount(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'amount')) return;
  if (!Object.prototype.hasOwnProperty.call(obj, 'unit')) return;
  const next = measure(obj.amount, obj.unit);
  if (!next) return;
  obj.amount = next.amount;
  obj.unit = next.unit;
}

function trimPlaces(value, places) {
  return value.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function formatQty(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const raw = String(unit == null ? '' : unit).trim();
  const u = raw.toLowerCase();
  if (u === 'g') {
    if (Math.abs(n) >= 1000) return `${trimPlaces(n / 1000, 2)} kg`;
    return `${Math.round(n)} g`;
  }
  if (u === 'ml') {
    if (Math.abs(n) >= 1000) return `${trimPlaces(n / 1000, 2)} L`;
    return `${Math.round(n)} ml`;
  }
  if (u === 'kg') {
    if (n > 0 && n < 1) return `${Math.max(1, Math.round(n * 1000))} g`;
    return `${trimPlaces(n, 1)} kg`;
  }
  if (u === 'l') {
    if (n > 0 && n < 1) return `${Math.max(1, Math.round(n * 1000))} ml`;
    return `${trimPlaces(n, 1)} L`;
  }
  if (u === 'each') return `${Math.max(1, Math.ceil(n))} each`;
  if (!raw) return String(Math.round(n));
  return `${Math.round(n)} ${raw}`;
}

function isListItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return LIST_ITEM_MARKS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function cleanStringField(obj, key) {
  const original = obj[key];
  if (typeof original !== 'string') return;
  if ((key === 'note' || key === 'priceNote') && isPriceNote(original)) {
    delete obj[key];
    return;
  }
  const cleaned = stripFragments(original);
  if (cleaned) {
    obj[key] = cleaned;
    return;
  }
  if (key === 'name') {
    obj[key] = 'Item';
    return;
  }
  const name = stripFragments(obj.name || '');
  if (name) obj[key] = name;
  else delete obj[key];
}

function scrub(value, isRoot) {
  if (Array.isArray(value)) {
    const next = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        const cleaned = stripFragments(entry);
        if (cleaned) next.push(cleaned);
        continue;
      }
      if (isListItem(entry)) {
        next.push(pickItem(entry));
        continue;
      }
      next.push(scrub(entry, false));
    }
    return next;
  }
  if (!value || typeof value !== 'object') return value;
  const rootUpdatedAt = isRoot ? value.updatedAt : undefined;
  for (const key of Object.keys(value)) {
    if (DROP_KEYS.has(key)) {
      if (isRoot && key === 'updatedAt') continue;
      delete value[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'name')) cleanStringField(value, 'name');
  for (const key of Object.keys(value)) {
    if (key === 'name') continue;
    if (isRoot && key === 'updatedAt') continue;
    const child = value[key];
    if (typeof child === 'string') {
      cleanStringField(value, key);
      continue;
    }
    if (isListItem(child)) {
      value[key] = pickItem(child);
      continue;
    }
    value[key] = scrub(child, false);
  }
  if (isRoot && rootUpdatedAt !== undefined) value.updatedAt = rootUpdatedAt;
  applyAmount(value);
  return value;
}

function pickItem(item) {
  const next = {};
  for (const key of ITEM_KEYS) {
    if (item[key] != null && item[key] !== 'undefined') next[key] = item[key];
  }
  return scrub(next, false);
}

function sanitizePlan(plan) {
  const clone = plan && typeof plan === 'object' ? structuredClone(plan) : {};
  scrub(clone, true);
  clone.priceNote = PRICE_NOTE;
  return clone;
}

function qtyText(line) {
  const item = line || {};
  if (item.amount == null || item.amount === '' || !Number.isFinite(Number(item.amount))) return '';
  return formatQty(item.amount, item.unit);
}

function lineText(line) {
  const item = line || {};
  const name = plain(item.name, 'Item');
  if (item.packs != null && item.packs !== '') return `${item.packs} x ${name}`;
  return name;
}

function ingredientText(ing) {
  const item = ing || {};
  const name = plain(item.name, 'Item');
  const next = measure(item.amount, item.unit);
  if (!next) return name;
  return next.unit ? `${next.amount} ${next.unit} ${name}` : `${next.amount} ${name}`;
}

function aisleKey(value) {
  const key = plain(value, '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(AISLE_LABELS, key)) return key;
  return 'other';
}

function groupShopping(lines) {
  const buckets = new Map();
  for (const line of lines || []) {
    const key = aisleKey(line && line.aisle);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(line);
  }
  return AISLE_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: AISLE_LABELS[key],
    lines: buckets.get(key),
  }));
}

module.exports = {
  sanitizePlan,
  PRICE_NOTE,
  roundAmount,
  stripFragments,
  qtyText,
  lineText,
  ingredientText,
  formatQty,
  groupShopping,
  plain,
};
