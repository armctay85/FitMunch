'use strict';

const list = require('../public/js/fm-plan-list');

const PRICE_NOTE = 'Prices vary by store and week.';

// Drop money and catalogue keys at every depth, any case, including meals.
// The pattern is the public rule (price, cost, rrp, saving, discount,
// special, promo, total) plus deal, catalog, and a leading "was", because
// catalogueId, cataloguePage, and wasPrice were surviving an exact-name list.
// Allowlist: none. Root `updatedAt` does not match and is kept so a client
// can show when the plan was saved. `priceNote` matches `price`, so scrub
// removes it and sanitizePlan writes the public note back. That note is not
// a supermarket price. Nested `updatedAt` is still removed.
const DROP_KEY = /price|cost|rrp|saving|discount|special|promo|total|deal|catalog|^was/i;
const DROP_EXACT = new Set([
  'lineaud',
  'unitaud',
  'sources',
  'sourcekind',
  'approvedat',
  'validfrom',
  'validto',
  'weeklabel',
  'updatedat',
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

const WORD_NUM = '(?:\\d+(?:[.,]\\d{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten)';

const GUARDS = [
  [/rewards\s+bars/gi, ''],
  [/special\s+fried\s+rice/gi, ''],
  [/special\s+k\b/gi, ''],
  [/specialty/gi, ''],
  [/save-a-lot/gi, ''],
  [/half\s+and\s+half/gi, ''],
  [/wasabi/gi, ''],
];

const FRAGMENTS = [
  /au-public-specials(?:-\d{4})?(?:-w\d+)?/gi,
  /\bwas\s*:?\s*\$?\s?\d+(?:[.,]\d{1,2})?(?:\s*ea)?\b/gi,
  new RegExp(`\\b${WORD_NUM}\\s+for\\s+(?:\\$\\s?)?${WORD_NUM}(?!\\s*(?:packs?|kg|g|ml|l|x)\\b)(?:\\s+dollars?)?\\b`, 'gi'),
  /(?<![\w-])save(?![\w-])\s+\d+(?:\.\d+)?%/gi,
  /(?<![\w-])save(?![\w-])\s+\$?\s?\d+(?:[.,]\d{1,2})?(?!%)/gi,
  /\b\d+(?:[.,]\d+)?%\s*off\b/gi,
  /\b\d+(?:[.,]\d+)?%\s*cheaper\b/gi,
  /\bAU\s?\$\s?\d+(?:[.,]\d{1,2})?\b/g,
  /\bA\$\s?\d+(?:[.,]\d{1,2})?(?:\s*(?:off|ea))?\b/gi,
  /\$\s?\d+(?:[.,]\d{1,2})?(?:\s*(?:off|ea))?\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s*\$/g,
  /\b\d+(?:[.,]\d{1,2})?\s*ea\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s+dollars?\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s+bucks?\b/gi,
  /\b(?:USD|EUR|GBP|AUD|NZD|CAD|JPY|CNY)\s*\$?\s*\d+(?:[.,]\d{1,2})?\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s*(?:USD|EUR|GBP|AUD|NZD|CAD|JPY|CNY)\b/gi,
  /[€£¥₹₩]\s?\d+(?:[.,]\d{1,2})?/g,
  /\d+(?:[.,]\d{1,2})?\s*[€£¥₹₩]/g,
  /\brrp\s*\$?\s*\d+(?:[.,]\d{1,2})?\b/gi,
  /\b(?:from|now)\s+\$?\s?\d+(?:[.,]\d{1,2})?\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s*c\s*\/\s*(?:100\s*)?(?:kg|g|ml|l)\b/gi,
  /(?:\$\s?)?\d+(?:[.,]\d{1,2})?\s*\/\s*(?:100\s*)?(?:kg|g|ml|l)\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s*cents?\b/gi,
  /\b\d+(?:[.,]\d{1,2})?\s*c\b/gi,
  /\bhalf[- ]price!?/gi,
  /\b1\s*\/\s*2\s*price\b/gi,
  /\bbogo\b/gi,
  /\bbuy\s+one\s+get\s+one(?:\s+free)?\b/gi,
  /\bon\s+speci[a4]ls?\b/gi,
  /\bspeci[a4]ls?\b/gi,
  /\bcatalogue\b/gi,
  /\brollback\b/gi,
  /\bprices?\s+dropped\b/gi,
  /\bdown\s+down\b/gi,
  /\beveryday\s+low\s+price\b/gi,
  /\bmember\s+price\b/gi,
  /\bclearance\b/gi,
  /\bprice\s+drops?\b/gi,
  /\bcheapest\b/gi,
  /\bcheaper\b/gi,
  /\brewards(?:\s+bonus(?:\s+points?)?)?\b/gi,
  /\bwk\s?\d+\b/gi,
  /\bweek\s+\d+\b/gi,
  /\bw(?:[1-9]\d|[2-9])\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g,
  new RegExp(`\\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun)(?:day|nesday|sday|rsday|urday)?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?(?!\\s*[A-Za-z])`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*-\\s*\\d{1,2})?(?:,?\\s+\\d{4})?\\b`, 'gi'),
];

function shouldDropKey(key, isRoot) {
  if (isRoot && key === 'updatedAt') return false;
  if (DROP_KEY.test(key)) return true;
  return DROP_EXACT.has(String(key).toLowerCase());
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d{1,7});?/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : _;
    })
    .replace(/&dollar;/gi, '$')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ');
}

function normaliseText(value) {
  let text = String(value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  text = text.replace(/\p{Cf}/gu, '');
  text = text.replace(/\uFE69/g, '$');
  text = text.replace(/💲/g, '$');
  for (let i = 0; i < 2; i += 1) {
    const next = decodeEntities(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

function guard(text) {
  const saved = [];
  let next = text;
  for (const [pattern] of GUARDS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, (match) => {
      saved.push(match);
      return `\u0000${saved.length - 1}\u0000`;
    });
  }
  return { text: next, saved };
}

function unguard(text, saved) {
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => saved[Number(index)]);
}

function stripLeftovers(text) {
  return text
    .replace(/\bvalid\s+until\b/gi, ' ')
    .replace(/\buntil\b/gi, ' ')
    .replace(/\bends\b/gi, ' ')
    .replace(/\bwas\b/gi, ' ')
    .replace(/\bAU\b/g, ' ')
    .replace(/\/\s*(?:100\s*)?(?:kg|g|ml|l)\b/gi, ' ')
    .replace(/(?:^|\s)-\d{1,2}\b/g, ' ')
    .replace(/!+/g, ' ');
}

function tidy(text) {
  return String(text)
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/\s*\.(?!\d)\s*/g, '. ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s,.;:|/\\!-]+/, '')
    .replace(/[\s,.;:|/\\!-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFragments(value) {
  let text = normaliseText(list.plain(value, ''));
  if (!text) return '';
  const guarded = guard(text);
  text = guarded.text;
  let prev;
  for (let pass = 0; pass < 4 && text !== prev; pass += 1) {
    prev = text;
    for (const pattern of FRAGMENTS) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, ' ');
    }
    text = stripLeftovers(text);
  }
  text = unguard(text, guarded.saved);
  return tidy(text);
}

function isPriceNote(text) {
  const cleaned = stripFragments(text);
  return cleaned !== tidy(normaliseText(text));
}

function applyAmount(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'amount')) return;
  if (!Object.prototype.hasOwnProperty.call(obj, 'unit')) return;
  const next = list.measure(obj.amount, obj.unit);
  if (!next) {
    const n = Number(obj.amount);
    if (!Number.isFinite(n) || n <= 0) {
      delete obj.amount;
      delete obj.unit;
    }
    return;
  }
  obj.amount = next.amount;
  obj.unit = next.unit;
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
  // An empty unit must stay empty. Copying the food name into it rendered
  // "0 Rice Rice" when a SKU had no unit.
  if (key === 'unit') {
    obj[key] = '';
    return;
  }
  delete obj[key];
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
    if (shouldDropKey(key, isRoot)) delete value[key];
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

module.exports = {
  sanitizePlan,
  PRICE_NOTE,
  roundAmount: list.roundAmount,
  stripFragments,
  qtyText: list.qtyText,
  needText: list.needText,
  lineText: list.lineText,
  ingredientText: list.ingredientText,
  ingredientParts: list.ingredientParts,
  formatQty: list.formatQty,
  displayName: list.displayName,
  groupShopping: list.groupShopping,
  macroParts: list.macroParts,
  plain: list.plain,
  measure: list.measure,
};
