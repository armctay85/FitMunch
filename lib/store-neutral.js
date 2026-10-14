'use strict';

/**
 * Public responses and emails name no supermarket chain. The internal price
 * catalogue still keys by chain, so anything built from it goes through
 * neutralise() before it leaves the server.
 */
const STORE_RE = /woolworths|woolies|\bcoles\b|\baldi\b|\biga\b|costco|harris farm|foodworks/i;
const STORE_RE_G = new RegExp(STORE_RE.source, 'gi');
const DROP = Symbol('drop');
const STORE_KEY_RE = /woolworths|woolies|coles(?!law)|aldi(?!ng)|^iga$/i;
const RETAILER_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:woolworths|coles|aldi|iga|costco)\.com(?:\.au)?(?:[/?#]|$)/i;

function neutralString(s) {
  if (RETAILER_HOST_RE.test(s)) return DROP;
  if (/^(woolworths|woolies|coles|aldi|iga)$/i.test(s.trim())) return 'Supermarket';
  return s.replace(/\b(?:a|your)\s+(?=(?:woolworths|woolies|coles|aldi|iga)\b)/gi, '')
    .replace(/(?:woolworths|woolies|coles|aldi|iga)(?:\s*(?:,|\/|or|and)\s*(?:woolworths|woolies|coles|aldi|iga))+/gi, 'supermarket')
    .replace(STORE_RE_G, 'supermarket');
}

function neutralise(value) {
  if (typeof value === 'string') return neutralString(value);
  if (Array.isArray(value)) return value.map(neutralise).filter((v) => v !== DROP);
  if (value && typeof value === 'object') {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (STORE_KEY_RE.test(k)) continue;
      const nv = neutralise(v);
      if (nv === DROP) continue;
      let key = k;
      while (Object.prototype.hasOwnProperty.call(out, key)) key = `${k}_${++n}`;
      out[key] = nv;
    }
    return out;
  }
  return value;
}

function neutralStringPublic(s) {
  const v = neutralString(s);
  return v === DROP ? '' : v;
}

module.exports = { STORE_RE, neutralise, neutralString: neutralStringPublic };
