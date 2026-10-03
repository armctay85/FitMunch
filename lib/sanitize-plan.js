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
  'wasPrice',
  'salePrice',
  'priceAud',
  'priceCents',
  'specialsUrl',
  'retailerLink',
  'tips',
  'coachNote',
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
  /\bbuy\s+one\s+get\s+one(?:\s+free)?\b/gi,
  /\bbogo\b/gi,
  /\bdown\s+down\b/gi,
  /\bhalf[-\s]+price\b/gi,
  /\b1\s*\/\s*2\s*-?\s*price\b/gi,
  /\bspecial\s+buys\b/gi,
  /\bspecial-buys\b/gi,
  /\bon\s+special\b/gi,
  /\bpercent-off\b/gi,
  /\bpercent\s+off\b/gi,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b`, 'gi'),
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{4}-?W\d{2}\b/gi,
  /\bweek\s+\d{1,2}\b/gi,
  /\bwk\s?\d{1,2}\b/gi,
  /\bw\d{2}\b/gi,
  /\b\d+\s+for\s+(?:(?:A?\$|€|£|AUD)\s?)?\d+(?:\.\d{1,2})?\b/gi,
  /\bsave\s+\d+(?:\.\d{1,2})?\s*c\b/gi,
  /\bwas\s+(?:(?:A?\$|€|£|AUD)\s?\$?\s?)?\d+(?:\.\d{1,2})?\b/gi,
  /\bsave\s+(?:(?:A?\$|€|£|AUD)\s?\$?\s?)?\d+(?:\.\d{1,2})?\s*(?:%|percent)(?:\s+off)?/gi,
  /\bsave\s+(?:(?:A?\$|€|£|AUD)\s?\$?\s?)?\d+(?:\.\d{1,2})?\b/gi,
  /\b\d+(?:\.\d+)?\s*%\s*-?\s*off\b/gi,
  /\b\d+(?:\.\d+)?\s+percent(?:\s+off)?\b/gi,
  /\b\d+(?:\.\d+)?%/g,
  /\bAUD\s?\$?\s?\d+(?:\.\d{1,2})?\b/gi,
  /\b\d+(?:\.\d{1,2})?\s*c\b/gi,
  /(?:A?\$|€|£)\s?\d+(?:\.\d{1,2})?(?:\s*off)?/gi,
  /\bdeals?\b/gi,
  /\bcatalogues?\b/gi,
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
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])(?=[A-Za-z])/g, '$1 ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s,.;:|/\\-]+/, '')
    .replace(/[\s,;:|/\\-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFragments(value) {
  let text = plain(value, '');
  if (!text) return '';
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  for (const pattern of FRAGMENTS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, ' ');
  }
  return tidy(text);
}

function isPriceNote(text) {
  return /catalogue|au-public-specials|\bw\d{2}\b|check prices|\$|€|£|\bAUD\b|\b\d+(?:\.\d+)?\s*c\b|\d{4}-\d{2}-\d{2}|\b\d{1,2}\s+(?:aug|august)\b|\b(?:aug|august)\s+\d{1,2}\b|half[-\s]price|buy one get one|\bbogo\b|\bspecial\s+buys\b|percent-off|\bpercent\b/i.test(text);
}

function roundAmount(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').trim().toLowerCase();
  let rounded;
  if (u === 'each') rounded = Math.max(1, Math.ceil(n));
  else if (u === 'g' || u === 'ml') rounded = n > 1000 ? Math.round(n / 10) * 10 : Math.round(n);
  else rounded = Math.round(n);
  if (rounded === 0 && n > 0) return 1;
  return rounded;
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

function withoutUrls(text) {
  return String(text).replace(/https?:\/\/\S+/gi, ' ');
}

function cleanStringField(obj, key) {
  const original = obj[key];
  if (typeof original !== 'string') return;
  if ((key === 'note' || key === 'priceNote') && isPriceNote(original)) {
    delete obj[key];
    return;
  }
  if (/^\s*https?:\/\/\S+\s*$/i.test(original)) {
    delete obj[key];
    return;
  }
  const cleaned = stripFragments(withoutUrls(original));
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

const PLAN_KEYS = ['days', 'dayCount', 'targets', 'flags', 'shopping', 'householdSize', 'storeId', 'priceNote', 'dietitianLine', 'honesty', 'updatedAt'];
const SHOPPING_KEYS = ['lines', 'storeName', 'note', 'storeId', 'store'];
const DAY_KEYS = ['day', 'meals', 'kcal', 'protein', 'carbs', 'fat'];
const MEAL_KEYS = ['slot', 'name', 'ingredients', 'kcal', 'protein', 'carbs', 'fat'];
const INGREDIENT_KEYS = ['name', 'amount', 'unit', 'sku'];
const HONESTY_KEYS = ['paysWoolworths', 'paysColes', 'paysAldi', 'trolleyApi', 'ordersPlaced', 'stripeLinkGrocery', 'healthKit', 'appleWatch', 'checkoutKind'];
const TARGET_KEYS = ['kcal', 'protein', 'carbs', 'fat'];

function pickKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const next = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) next[key] = obj[key];
  }
  return next;
}

function allowPlan(plan) {
  const next = pickKeys(plan, PLAN_KEYS);
  if (Array.isArray(next.days)) {
    next.days = next.days.map((day) => {
      const row = pickKeys(day, DAY_KEYS);
      if (Array.isArray(row.meals)) {
        row.meals = row.meals.map((meal) => {
          const item = pickKeys(meal, MEAL_KEYS);
          if (Array.isArray(item.ingredients)) {
            item.ingredients = item.ingredients.map((ing) => pickKeys(ing, INGREDIENT_KEYS));
          }
          return item;
        });
      }
      return row;
    });
  }
  if (next.targets && typeof next.targets === 'object') next.targets = pickKeys(next.targets, TARGET_KEYS);
  if (next.shopping && typeof next.shopping === 'object') {
    const shopping = pickKeys(next.shopping, SHOPPING_KEYS);
    if (Array.isArray(shopping.lines)) shopping.lines = shopping.lines.map((line) => pickKeys(line, ITEM_KEYS));
    next.shopping = shopping;
  }
  if (next.honesty && typeof next.honesty === 'object') next.honesty = pickKeys(next.honesty, HONESTY_KEYS);
  if (Array.isArray(next.flags)) {
    next.flags = next.flags.filter((flag) => typeof flag === 'string');
  }
  return next;
}

function sanitizePlan(plan) {
  const clone = plan && typeof plan === 'object' ? structuredClone(plan) : {};
  scrub(clone, true);
  const allowed = allowPlan(clone);
  allowed.priceNote = PRICE_NOTE;
  return allowed;
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
