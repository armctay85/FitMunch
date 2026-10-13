'use strict';

/**
 * Text saved in plans, lists, meals and favourites is shown to other people
 * (a trainer's plan reaches a client). Every string field is stored without
 * < > and backticks, at any depth, whatever the key is called. Quotes stay:
 * the page escapes them on render, and names like Kellogg's or a 6" sub must
 * survive.
 */
const MAX_DEPTH = 12;

function stripMarkup(v) {
  return typeof v === 'string' ? v.replace(/[<>`]/g, '') : v;
}

function tooDeep() {
  const err = new Error('Payload is nested too deeply');
  err.status = 400;
  err.expose = true;
  return err;
}

// Strip every string, recursively. Deeper than MAX_DEPTH throws a 400.
function stripNames(value, depth = 0) {
  if (typeof value === 'string') return stripMarkup(value);
  if (value == null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) throw tooDeep();
  if (Array.isArray(value)) return value.map((v) => stripNames(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = stripNames(v, depth + 1);
  return out;
}

module.exports = { stripMarkup, stripNames, cleanName: stripMarkup, MAX_DEPTH };
