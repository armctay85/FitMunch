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

function attachApiJsonSanitizer(req, res, next) {
  const url = String(req.originalUrl || req.url || '');
  if (!url.startsWith('/api')) return next();
  // Wrap once: server.js and the /api router both attach this.
  if (typeof res.jsonUnsanitized === 'function') return next();
  const sendJson = res.json.bind(res);
  // Server-built bodies whose values are exact third-party strings (Stripe Checkout and
  // Billing Portal urls and ids) go out untouched: their random parts hit a provider word
  // by chance (~1 in 116 checkouts) and a scrubbed url or id is broken.
  res.jsonUnsanitized = sendJson;
  res.json = function jsonWithoutModelNames(body) {
    return sendJson(sanitizeApiJson(body));
  };
  return next();
}

function sendStripeJson(res, body) {
  return typeof res.jsonUnsanitized === 'function' ? res.jsonUnsanitized(body) : res.json(body);
}

module.exports = {
  sendStripeJson,
  sanitizeApiJson,
  attachApiJsonSanitizer,
};
