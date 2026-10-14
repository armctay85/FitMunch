'use strict';

/**
 * API JSON must not name a model or an AI provider.
 * Logs can keep those names. This only cleans response bodies.
 */
const PROVIDER_WORD = /gemini|openai|grok|anthropic|xai/i;
const PROVIDER_WORD_GLOBAL = /gemini|openai|grok|anthropic|xai/ig;

function dropKey(key, original, sanitized) {
  const name = String(key);
  if (/^model$/i.test(name)) return true;
  if (PROVIDER_WORD.test(name)) return true;
  if (typeof original === 'string' && sanitized === '' && PROVIDER_WORD.test(original)) return true;
  if (/^provider(name)?$/i.test(name) && typeof original === 'string' && PROVIDER_WORD.test(original)) return true;
  return false;
}

function sanitizeApiJson(value) {
  // Serialise like JSON.stringify would first: Dates become ISO strings (invalid ones null),
  // and any other toJSON() value is used, instead of walking the object's own keys ({}).
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON();
  if (Array.isArray(value)) return value.map((item) => sanitizeApiJson(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const next = sanitizeApiJson(child);
      if (dropKey(key, child, next)) continue;
      out[key] = next;
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.replace(PROVIDER_WORD_GLOBAL, '').replace(/[ \t]{2,}/g, ' ').trim();
  }
  return value;
}

// Stripe Checkout and Billing Portal urls and ids carry long random parts that
// hit a provider word by chance (about 1 in 94 bodies on main, Elite QA #122),
// and a scrubbed url or id is broken. Only these exact top-level fields, with
// these exact Stripe shapes, skip the scrub. Every other key in the same body
// (and any non-Stripe value under url or id) is still sanitized.
const STRIPE_EXACT = {
  url: /^https:\/\/(?:checkout|billing)\.stripe\.com\/[A-Za-z0-9/_\-.%#?=&]+$/,
  id: /^cs_(?:live|test)_[A-Za-z0-9]+$/,
};

function stripeExactFields(body) {
  const keep = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return keep;
  for (const [key, shape] of Object.entries(STRIPE_EXACT)) {
    const v = body[key];
    if (typeof v === 'string' && v.length <= 2048 && shape.test(v)) keep[key] = v;
  }
  return keep;
}

// Runtime check, on every /api JSON reply: the allowlist is applied inside the
// res.json wrapper itself, so a Stripe route that uses plain res.json is as
// safe as one that calls sendStripeJson. No route list or source scan needed.
function sanitizeApiBody(body) {
  const keep = stripeExactFields(body);
  const out = sanitizeApiJson(body);
  if (Object.keys(keep).length && out && typeof out === 'object') Object.assign(out, keep);
  return out;
}

function attachApiJsonSanitizer(req, res, next) {
  const url = String(req.originalUrl || req.url || '');
  if (!url.startsWith('/api')) return next();
  // Wrap once: server.js and the /api router both attach this.
  if (res.apiJsonSanitized) return next();
  res.apiJsonSanitized = true;
  const sendJson = res.json.bind(res);
  res.json = function jsonWithoutModelNames(body) {
    return sendJson(sanitizeApiBody(body));
  };
  return next();
}

// Kept for the Stripe routes' readability; identical to res.json on /api.
function sendStripeJson(res, body) {
  return res.json(body);
}

module.exports = {
  sendStripeJson,
  sanitizeApiBody,
  stripeExactFields,
  STRIPE_EXACT,
  sanitizeApiJson,
  attachApiJsonSanitizer,
};
