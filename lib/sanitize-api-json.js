'use strict';

/**
 * API JSON must not name a model or an AI provider.
 * Logs can keep those names. This only cleans response bodies.
 */
const PROVIDER_WORD = /gemini|openai|grok|anthropic|xai/i;
const PROVIDER_WORD_GLOBAL = /gemini|openai|grok|anthropic|xai/ig;

// Opaque machine strings (JWTs, claim tokens, ids, base64 data) are never prose, and a
// provider word can turn up in them by chance ("...XaI..." in a signature). Scrubbing
// one corrupts it, e.g. a session token that then fails verification with a 401.
const OPAQUE_CHARS = /^[A-Za-z0-9._~+/=-]{16,}$/;
const DELIMITED_PROVIDER = /(^|[^A-Za-z])(gemini|openai|grok|anthropic|xai)([^A-Za-z]|$)/i;
function isOpaque(str) {
  if (!(OPAQUE_CHARS.test(str) && /[A-Z]/.test(str) && /[a-z]/.test(str) && /[0-9]/.test(str))) return false;
  // 40+ characters is a token or encoded data (JWTs, claim tokens), never a model name.
  return str.length >= 40 || !DELIMITED_PROVIDER.test(str);
}
const OPAQUE_KEY = /^(token|accessToken|refreshToken|claimToken|sessionToken)$/i;

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
      if (typeof child === 'string' && OPAQUE_KEY.test(String(key))) { out[key] = child; continue; }
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
  sanitizeApiJson,
  attachApiJsonSanitizer,
};
