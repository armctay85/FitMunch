'use strict';

const PRICE_NOTE = 'Prices vary by store and week.';

const DROP_KEYS = new Set([
  'total',
  'totals',
  'totalAud',
  'totalCents',
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
const DROP_STRING = /w35|au-public-specials|catalogue|special/i;

function isListItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return LIST_ITEM_MARKS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function pickItem(item) {
  const next = {};
  for (const key of ITEM_KEYS) {
    if (item[key] != null) next[key] = item[key];
  }
  return scrub(next);
}

function scrub(value) {
  if (Array.isArray(value)) {
    const next = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        if (!DROP_STRING.test(entry)) next.push(entry);
        continue;
      }
      if (isListItem(entry)) {
        next.push(pickItem(entry));
        continue;
      }
      next.push(scrub(entry));
    }
    return next;
  }
  if (!value || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (DROP_KEYS.has(key)) {
      delete value[key];
      continue;
    }
    const child = value[key];
    if (typeof child === 'string') {
      if (DROP_STRING.test(child)) delete value[key];
      continue;
    }
    if (isListItem(child)) {
      value[key] = pickItem(child);
      continue;
    }
    value[key] = scrub(child);
  }
  return value;
}

function sanitizePlan(plan) {
  const clone = plan && typeof plan === 'object' ? structuredClone(plan) : {};
  scrub(clone);
  clone.priceNote = PRICE_NOTE;
  return clone;
}

module.exports = { sanitizePlan, PRICE_NOTE };
