'use strict';

/**
 * API JSON must not name a model or an AI provider.
 * Logs can keep those names. This only cleans response bodies.
 */
const PROVIDER_WORD = /gemini|openai|grok|anthropic|xai/i;
const PROVIDER_WORD_GLOBAL = /gemini|openai|grok|anthropic|xai/ig;

// Opaque machine strings (JWTs, base64url ids) are never prose, and a provider word can
// turn up in them by chance ("...XaI..." in a signature). Scrubbing one corrupts it, e.g. a
// session token that then fails verification with a 401. Only two exact shapes count:
//  1. a real JWT: three base64url segments of 8+ characters joined by dots;
//  2. one unbroken base64url run of 32+ characters (no "-", "/" or "." word delimiters)
//     that does not read as joined words. Word-joined text such as
//     "PoweredByGrokAndGemini2026ForFitMunchUsers" fits the base64url character set, so
//     the run also must not be mostly Capitalised words (an upper case letter followed by
//     2+ lower case ones): CamelCase text is 60-90% such words, random base64url about 20%.
//     At 50% a random 32-character run is misread as words ~1.9% of the time, and it is
//     only altered if it also holds a provider word, so ~1 in 100,000 such ids; JWTs,
//     which carry every session token, are matched by shape and never altered.
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const BASE64URL_RUN = /^[A-Za-z0-9_]{32,}={0,2}$/;
const MAX_WORD_SHARE = 0.5;
function readsAsWords(str) {
  const words = str.match(/[A-Z][a-z]{2,}/g) || [];
  const covered = words.reduce((sum, w) => sum + w.length, 0);
  return covered / str.length >= MAX_WORD_SHARE;
}
function isOpaque(str) {
  if (JWT_SHAPE.test(str)) return true;
  return BASE64URL_RUN.test(str) && !readsAsWords(str);
}

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
    if (isOpaque(value)) return value;
    return value.replace(PROVIDER_WORD_GLOBAL, '').replace(/[ \t]{2,}/g, ' ').trim();
  }
  return value;
}

function attachApiJsonSanitizer(req, res, next) {
  const url = String(req.originalUrl || req.url || '');
  if (!url.startsWith('/api')) return next();
  const sendJson = res.json.bind(res);
  res.json = function jsonWithoutModelNames(body) {
    return sendJson(sanitizeApiJson(body));
  };
  return next();
}

module.exports = {
  isOpaque,
  sanitizeApiJson,
  attachApiJsonSanitizer,
};
