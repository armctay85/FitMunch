'use strict';

/**
 * API JSON must not name a model or an AI provider.
 * Logs can keep those names. This only cleans response bodies.
 */
const PROVIDER_WORD = /gemini|openai|grok|anthropic|xai/i;
const PROVIDER_WORD_GLOBAL = /gemini|openai|grok|anthropic|xai/ig;

// Provider names are scrubbed case-insensitively wherever they appear, including inside
// run-together, underscore, dotted or digit-padded text. A string is left untouched only if
// it is one of our machine tokens, because scrubbing a token corrupts it (a session token
// whose signature held "XaI" by chance then failed verification with a 401):
//  1. a real JWT: three base64url segments whose first decodes to a JSON header with "alg"
//     and whose second decodes to a JSON object. Look-alikes such as
//     "grok-4-fast.gemini-25-pro.openai-o3-mini" fail the decode and are scrubbed.
//  2. a coach share token, by exact key and format only: `token` holding exactly the 24
//     base64url characters coach-store mints (randomBytes(18)), or `sharePath` holding
//     "/c/" plus that token. Prose under those keys does not match and is scrubbed.
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{24}$/;
const SHARE_PATH = /^\/c\/[A-Za-z0-9_-]{24}$/;
function decodeJsonObject(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}
function isJwt(str) {
  if (!JWT_SHAPE.test(str)) return false;
  const [head, body] = str.split('.');
  const header = decodeJsonObject(head);
  return Boolean(header && typeof header.alg === 'string' && decodeJsonObject(body));
}
function isShareToken(key, str) {
  if (key === 'token') return SHARE_TOKEN.test(str);
  if (key === 'sharePath') return SHARE_PATH.test(str);
  return false;
}
function isOpaque(str, key) {
  return isJwt(str) || isShareToken(key, str);
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
      if (typeof child === 'string' && isShareToken(key, child)) { out[key] = child; continue; }
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
  isJwt,
  isShareToken,
  sanitizeApiJson,
  attachApiJsonSanitizer,
};
