'use strict';

/**
 * API JSON must not name a model or an AI provider.
 * Logs can keep those names. This only cleans response bodies.
 *
 * Provider names are scrubbed case-insensitively wherever they appear, including inside
 * run-together, underscore, dotted, hyphenated or digit-padded text, plus the spaced and
 * punctuated forms "Open AI", "x-ai" and "x.ai".
 *
 * Nothing inside a body is ever exempt because of its shape: stored user JSON can hold
 * anything, including forged JWTs or strings that look like share tokens. The only values
 * left untouched are server-issued, top-level fields on the routes that issue them:
 *  - the session token on /api/auth/login, /api/auth/register and /api/coach/preview-session, only if it verifies as
 *    one of our session JWTs (HS256 signature with our secret, so alg:none is rejected);
 *  - the coach share token and sharePath on /api/coach/plans routes, at the top level of
 *    the server-built plan object(s) (body.plan, body.plans[i]), only in their exact
 *    minted format (24 base64url chars, sharePath = "/c/" + token).
 * Stripe Checkout and Billing Portal responses bypass this sanitizer (sendStripeJson).
 * A scrubbed token, share link or Stripe url is broken, which is why these must survive.
 */
// Matching runs on a folded copy only; the string that is sent is never rewritten unless a
// provider word is found, and then only the matched words are cut out of the original.
// Each original code point is folded on its own: NFKC (fullwidth letters become ASCII),
// invisible and formatting characters (zero-width, soft hyphen, bidi controls and isolates,
// tag characters, interlinear annotation, variation selectors, BOM) are dropped, Cyrillic and
// Greek lookalikes plus dotless i map to Latin, and any whitespace run (CR/LF included) is one
// space. Every folded character remembers the original span it came from.
// A match removes the whole word it sits in ("grokking" goes, leaving no "king"), and passes
// repeat so "Open grok AI" cannot rebuild a name. Every pass is a single left-to-right scan
// with a regex that has no nested quantifiers, so the work is linear in the string length.
const PROVIDER_SOURCE = 'gemini|openai|(?<![a-z])open[ ._-]{1,8}ai(?![a-z])|grok|anthropic|xai|(?<![a-z])x[ ._-]{1,8}ai(?![a-z])';
const PROVIDER_WORD_GLOBAL = new RegExp(PROVIDER_SOURCE, 'g');
const INVISIBLE_CP = /^[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2069\u206A-\u206F\uFE00-\uFE0F\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]$/u;
const CONFUSABLES = {
  // Cyrillic
  'а': 'a', 'А': 'a', 'в': 'b', 'В': 'b', 'с': 'c', 'С': 'c', 'ԁ': 'd', 'е': 'e', 'Е': 'e', 'ё': 'e',
  'һ': 'h', 'Н': 'h', 'н': 'h', 'і': 'i', 'І': 'i', 'ї': 'i', 'ј': 'j', 'Ј': 'j', 'к': 'k', 'К': 'k',
  'м': 'm', 'М': 'm', 'о': 'o', 'О': 'o', 'р': 'p', 'Р': 'p', 'ԛ': 'q', 'г': 'r', 'ѕ': 's', 'Ѕ': 's',
  'т': 't', 'Т': 't', 'у': 'y', 'У': 'y', 'х': 'x', 'Х': 'x', 'ԝ': 'w', 'Ԝ': 'w', 'п': 'n', 'ı': 'i',
  // Greek
  'α': 'a', 'Α': 'a', 'β': 'b', 'Β': 'b', 'ε': 'e', 'Ε': 'e', 'Ζ': 'z', 'η': 'n', 'Η': 'h', 'ι': 'i',
  'Ι': 'i', 'κ': 'k', 'Κ': 'k', 'Μ': 'm', 'ν': 'v', 'Ν': 'n', 'ο': 'o', 'Ο': 'o', 'ρ': 'p', 'Ρ': 'p',
  'τ': 't', 'Τ': 't', 'υ': 'u', 'Υ': 'y', 'χ': 'x', 'Χ': 'x', 'ω': 'w', 'ϲ': 'c', 'Ϲ': 'c', 'ϳ': 'j',
  // Latin lookalikes
  'ɡ': 'g', 'ɑ': 'a', 'ɩ': 'i', 'ɪ': 'i', 'ʀ': 'r', 'ᴏ': 'o', 'ⅰ': 'i', 'ℓ': 'l',
};
const LETTER = /[\p{L}\p{M}]/u;
const WS = /\s/;
const MAX_PASSES = 16;
// Above this length a string holding a provider word is dropped whole (one scan, no repeat
// passes), so a huge stored value cannot hold up the response. Names are capped at input.
const MAX_SCRUB_LENGTH = 65536;

const FOLD_CACHE = new Map();
function foldChar(ch) {
  if (INVISIBLE_CP.test(ch)) return '';
  if (WS.test(ch)) return ' ';
  const mapped = CONFUSABLES[ch];
  if (mapped) return mapped;
  const nf = ch.normalize('NFKC');
  if (CONFUSABLES[nf]) return CONFUSABLES[nf];
  // Accented forms read as the base letter: 'Grók', 'Gêmini', 'Ánthropic'. A lone combining mark folds to ''.
  const base = nf.normalize('NFKD').replace(/\p{M}+/gu, '');
  return (CONFUSABLES[base] || base).toLowerCase();
}

/**
 * Folded copy: str is the folded text, from[i]/to[i] the original code-unit span that folded
 * code unit i came from. Whitespace runs fold to one space.
 */
function fold(text) {
  const parts = [];
  const from = new Int32Array(text.length * 3 + 1);
  const to = new Int32Array(text.length * 3 + 1);
  let n = 0;
  let lastSpace = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const start = i;
    let out;
    if (c < 0x80) {
      i += 1;
      if (c === 32 || (c >= 9 && c <= 13)) {
        if (lastSpace) { to[n - 1] = i; continue; }
        out = ' ';
      } else out = (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : text[start];
    } else {
      const width = text.codePointAt(i) > 0xFFFF ? 2 : 1;
      const ch = width === 2 ? text.slice(i, i + 2) : text[i];
      i += width;
      out = FOLD_CACHE.get(ch);
      if (out === undefined) {
        out = foldChar(ch);
        if (FOLD_CACHE.size < 65536) FOLD_CACHE.set(ch, out);
      }
      if (out === '') continue;
      if (out === ' ' && lastSpace) { to[n - 1] = i; continue; }
    }
    lastSpace = out === ' ';
    for (let j = 0; j < out.length; j += 1) { from[n] = start; to[n] = i; n += 1; }
    parts.push(out);
  }
  return { str: parts.join(''), from: from.subarray(0, n), to: to.subarray(0, n) };
}

function isLetterAt(str, pos) {
  const c = str.charCodeAt(pos);
  if (c < 0x80) return (c | 32) >= 97 && (c | 32) <= 122;
  if (c >= 0xD800 && c <= 0xDBFF) return LETTER.test(String.fromCodePoint(str.codePointAt(pos)));
  // Step back onto a surrogate pair's lead unit so the whole code point is tested.
  if (c >= 0xDC00 && c <= 0xDFFF && pos > 0) pos -= 1;
  return LETTER.test(String.fromCodePoint(str.codePointAt(pos)));
}

/** Folded ranges [s, e) of whole words holding a provider match, in one linear scan. */
function findSpans(str) {
  const spans = [];
  PROVIDER_WORD_GLOBAL.lastIndex = 0;
  let m;
  while ((m = PROVIDER_WORD_GLOBAL.exec(str)) !== null) {
    let s = m.index;
    let e = m.index + m[0].length;
    const floor = spans.length ? spans[spans.length - 1][1] : 0;
    while (s > floor && isLetterAt(str, s - 1)) s -= 1;
    while (e < str.length && isLetterAt(str, e)) e += 1;
    spans.push([s, e]);
    // Resume after the whole word, so each char is visited a bounded number of times.
    PROVIDER_WORD_GLOBAL.lastIndex = e;
  }
  PROVIDER_WORD_GLOBAL.lastIndex = 0;
  return spans;
}

function hasProvider(value) {
  if (quickMiss(String(value))) return false;
  return findSpans(fold(String(value)).str).length > 0;
}
const PROVIDER_WORD = { test: hasProvider };

const SHARE_TOKEN = /^[A-Za-z0-9_-]{24}$/;
const AUTH_TOKEN_ROUTE = /^\/api\/(auth\/(login|register)|coach\/preview-session)(?:[/?#]|$)/;
const COACH_PLAN_ROUTE = /^\/api\/coach\/plans(?:[/?#]|$)/;

function sessionSecret() {
  // The same secret the auth routes sign with. Never logged.
  return require('./fitmunch-checkout').jwtSecret();
}

function isOurSessionToken(value) {
  if (typeof value !== 'string') return false;
  try {
    require('./session-token').verifySessionToken(value, sessionSecret());
    return true;
  } catch (_) {
    return false;
  }
}

function isShareLink(plan) {
  return Boolean(plan && typeof plan === 'object' && typeof plan.token === 'string'
    && SHARE_TOKEN.test(plan.token) && plan.sharePath === `/c/${plan.token}`);
}

function dropKey(key, original, sanitized) {
  const name = String(key);
  if (/^model$/i.test(name)) return true;
  if (PROVIDER_WORD.test(name)) return true;
  if (typeof original === 'string' && sanitized === '' && PROVIDER_WORD.test(original)) return true;
  if (/^provider(name)?$/i.test(name) && typeof original === 'string' && PROVIDER_WORD.test(original)) return true;
  return false;
}

/**
 * Returns value unchanged (same string) unless a provider word is found; then the matched
 * words are removed from the original text, spaces left doubled by a cut are collapsed and
 * the ends trimmed.
 */
function quickMiss(value) {
  // Plain ASCII with no provider word: nothing to fold, nothing to cut.
  if (/[^\x00-\x7F]/.test(value)) return false;
  PROVIDER_WORD_GLOBAL.lastIndex = 0;
  const hit = PROVIDER_WORD_GLOBAL.test(value.toLowerCase().replace(/\s+/g, ' '));
  PROVIDER_WORD_GLOBAL.lastIndex = 0;
  return !hit;
}

function cleanString(value) {
  if (quickMiss(value)) return value;
  let { str, from, to } = fold(value);
  if (value.length > MAX_SCRUB_LENGTH) return findSpans(str).length ? '' : value;
  const cut = new Uint8Array(value.length + 1);
  let found = false;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const spans = findSpans(str);
    if (!spans.length) break;
    found = true;
    if (pass === MAX_PASSES - 1) return ''; // fail closed if names keep rebuilding
    for (const [s, e] of spans) cut.fill(1, from[s], to[e - 1]);
    // Rebuild the folded copy without the cut spans; join the gap's spaces into one.
    const parts = [];
    const nf = new Int32Array(str.length);
    const nt = new Int32Array(str.length);
    let n = 0;
    let at = 0;
    const take = (a, b) => {
      // A gap's leading space merges into a space already kept before it.
      if (a < b && str.charCodeAt(a) === 32 && n && lastWasSpace) { nt[n - 1] = to[a]; a += 1; }
      if (a >= b) return;
      nf.set(from.subarray(a, b), n); nt.set(to.subarray(a, b), n);
      n += b - a;
      parts.push(str.slice(a, b));
      lastWasSpace = str.charCodeAt(b - 1) === 32;
    };
    let lastWasSpace = false;
    for (const [s, e] of spans) { take(at, s); at = e; }
    take(at, str.length);
    str = parts.join(''); from = nf.subarray(0, n); to = nt.subarray(0, n);
  }
  if (!found) return value;
  let out = '';
  let runStart = -1;
  for (let j = 0; j <= value.length; j += 1) {
    if (j < value.length && !cut[j]) { if (runStart < 0) runStart = j; continue; }
    if (runStart >= 0) { out += value.slice(runStart, j); runStart = -1; }
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** keep: top-level keys whose original value is put back after cleaning. */
function sanitizeApiJson(value, keep) {
  // Serialise like JSON.stringify would first (Dates become ISO strings, not {}).
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON();
  if (Array.isArray(value)) return value.map((item) => sanitizeApiJson(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (keep && keep.has(key)) { out[key] = child; continue; }
      const next = sanitizeApiJson(child);
      if (dropKey(key, child, next)) continue;
      out[key] = next;
    }
    return out;
  }
  if (typeof value === 'string') return cleanString(value);
  return value;
}

function sanitizePlanObject(plan) {
  return sanitizeApiJson(plan, isShareLink(plan) ? new Set(['token', 'sharePath']) : null);
}

/** Cleans a response body for the given request path, keeping only route-issued fields. */
function sanitizeApiResponse(body, path = '') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sanitizeApiJson(body);
  const url = String(path);
  if (AUTH_TOKEN_ROUTE.test(url) && isOurSessionToken(body.token)) {
    return sanitizeApiJson(body, new Set(['token']));
  }
  if (COACH_PLAN_ROUTE.test(url) && (body.plan || Array.isArray(body.plans))) {
    const rest = { ...body };
    delete rest.plan;
    delete rest.plans;
    const out = sanitizeApiJson(rest);
    if ('plan' in body) out.plan = sanitizePlanObject(body.plan);
    if (Array.isArray(body.plans)) out.plans = body.plans.map(sanitizePlanObject);
    // Keep the original key order.
    return Object.fromEntries(Object.keys(body).filter((k) => k in out).map((k) => [k, out[k]]));
  }
  return sanitizeApiJson(body);
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
function sanitizeApiBody(body, url = '') {
  const keep = stripeExactFields(body);
  const out = sanitizeApiResponse(body, url);
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
    return sendJson(sanitizeApiBody(body, url));
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
  sanitizeApiResponse,
  isOurSessionToken,
  isShareLink,
  attachApiJsonSanitizer,
};
