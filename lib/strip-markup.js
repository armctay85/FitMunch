'use strict';

/**
 * Food and item names are shown to other people (a trainer's plan reaches a
 * client), so they are stored without the characters that make markup:
 * < > " '. The browser escapes on render as well; this is the second layer.
 */
const NAME_KEYS = new Set(['name', 'item', 'foodName', 'food_name', 'title', 'label', 'category', 'aisle']);

function stripMarkup(v) {
  return typeof v === 'string' ? v.replace(/[<>"']/g, '') : v;
}

// Strip name-like string fields at any depth of a plan, list or meal payload.
function stripNames(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? stripMarkup(v) : stripNames(v, depth + 1)));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && NAME_KEYS.has(k)) out[k] = stripMarkup(v);
    else if (v && typeof v === 'object') out[k] = stripNames(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

module.exports = { stripMarkup, stripNames };
