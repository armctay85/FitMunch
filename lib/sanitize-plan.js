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

const FRAGMENTS = [
  /au-public-specials(?:-\d{4})?(?:-w\d+)?/gi,
  new RegExp(`\\bwas\\s+A?\\$\\s?\\d+(?:\\.\\d{1,2})?`, 'gi'),
  /\b\d+\s+for\s+A?\$\s?\d+(?:\.\d{1,2})?/gi,
  /\bsave\s+A?\$\s?\d+(?:\.\d{1,2})?/gi,
  /\bsave\s+\d+(?:\.\d+)?%/gi,
  /\b\d+(?:\.\d+)?%\s*off\b/gi,
  /A?\$\s?\d+(?:\.\d{1,2})?(?:\s*off)?/gi,
  /\bhalf\s+price\b/gi,
  /\bon\s+special\b/gi,
  /\bspecials\b/gi,
  /\bcatalogue\b/gi,
  /\bw35\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, 'gi'),
];

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
    .replace(/\s*([,.;:])\s*/g, '$1 ')
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
  return /catalogue|\bspecials\b|\bw35\b|au-public-specials|check prices|\$|\d{4}-\d{2}-\d{2}|\b\d{1,2}\s+(?:aug|august)\b/i.test(text);
}

function roundAmount(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'each') return Math.max(1, Math.ceil(n));
  if (u === 'g' || u === 'ml') {
    if (n > 1000) return Math.round(n / 10) * 10;
    return Math.round(n);
  }
  return Math.round(n);
}

function applyAmount(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'amount')) return;
  if (!Object.prototype.hasOwnProperty.call(obj, 'unit')) return;
  const rounded = roundAmount(obj.amount, obj.unit);
  if (rounded == null) return;
  obj.amount = rounded;
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
  const unit = plain(item.unit, '');
  if (item.amount == null || item.amount === '' || !Number.isFinite(Number(item.amount))) return '';
  const rounded = roundAmount(item.amount, unit);
  if (rounded == null) return '';
  return unit ? `${rounded} ${unit}` : String(rounded);
}

function lineText(line) {
  const item = line || {};
  const name = plain(item.name, 'Item');
  const packs = item.packs != null && item.packs !== '' ? `${item.packs} x ${name}` : name;
  const aisle = plain(item.aisle, '');
  const qty = qtyText(item);
  return [packs, aisle, qty].filter(Boolean).join(' ');
}

function ingredientText(ing) {
  const item = ing || {};
  const name = plain(item.name, 'Item');
  const unit = plain(item.unit, '');
  if (item.amount == null || item.amount === '' || !Number.isFinite(Number(item.amount))) return name;
  const rounded = roundAmount(item.amount, unit);
  if (rounded == null) return name;
  return unit ? `${rounded} ${unit} ${name}` : `${rounded} ${name}`;
}

module.exports = {
  sanitizePlan,
  PRICE_NOTE,
  roundAmount,
  stripFragments,
  qtyText,
  lineText,
  ingredientText,
  plain,
};
