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
// The spaced and punctuated forms need word edges so "open aisle" or "max-aim" survive.
const PROVIDER_SOURCE = 'gemini|openai|(?<![A-Za-z])open[\\s._-]ai(?![A-Za-z])|grok|anthropic|xai|(?<![A-Za-z])x[._-]ai(?![A-Za-z])';
const PROVIDER_WORD = new RegExp(PROVIDER_SOURCE, 'i');
const PROVIDER_WORD_GLOBAL = new RegExp(PROVIDER_SOURCE, 'ig');

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

function cleanString(value) {
  return value.replace(PROVIDER_WORD_GLOBAL, '').replace(/[ \t]{2,}/g, ' ').trim();
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
    return sendJson(sanitizeApiResponse(body, url));
  };
  return next();
}

function sendStripeJson(res, body) {
  return typeof res.jsonUnsanitized === 'function' ? res.jsonUnsanitized(body) : res.json(body);
}

module.exports = {
  sendStripeJson,
  sanitizeApiJson,
  sanitizeApiResponse,
  isOurSessionToken,
  isShareLink,
  attachApiJsonSanitizer,
};
