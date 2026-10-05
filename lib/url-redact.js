'use strict';

/**
 * Keep analytics and logs from storing password-reset secrets.
 * Paths may keep an allowlisted UTM query. Everything else is dropped.
 * Ordinary text that contains ? or # is left as written.
 */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const SECRET_CORE = 'access_token|id_token|session_id|reset|token|code|key|session|email|sig|jwt|otp|invite|claim';
const PARAM_NAME = '(?:[a-z_]*(?:' + SECRET_CORE + ')|t)';
const SENSITIVE_KEY = /^(reset|token|code|key|session|email|sig|jwt|password|secret|otp|access_token|id_token|invite|claim)$/i;
const URL_KEY = /^(url|path|href|referrer|landing|page_url|pageurl)$/i;
const QUERY_PARAM_RE = new RegExp('(^|[?&#\\s])(' + PARAM_NAME + ')=([^&#\\s"\'<>]*)', 'gi');
const JSON_PARAM_RE = new RegExp('"(' + PARAM_NAME + ')"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"', 'gi');

const LOG_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
let logRedactionInstalled = false;
const logForwarders = Object.create(null);

function percentDecode(input) {
  let current = String(input);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.replace(/%[0-9a-fA-F]{2}/g, (hex) => {
      try {
        return decodeURIComponent(hex);
      } catch (err) {
        return hex;
      }
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

function looksLikeUrl(value) {
  const text = String(value || '').trim();
  return text.startsWith('/') || /^https?:\/\//i.test(text);
}

function hasSensitiveParam(value) {
  const re = new RegExp(QUERY_PARAM_RE.source, 'i');
  return re.test(percentDecode(value));
}

function redactLogString(input) {
  const decoded = percentDecode(input);
  return decoded
    .replace(QUERY_PARAM_RE, (match, lead, name) => lead + name + '=[redacted]')
    .replace(JSON_PARAM_RE, (match, name) => '"' + name + '":"[redacted]"');
}

function splitTrackedUrl(value) {
  const raw = String(value || '');
  if (!looksLikeUrl(raw)) {
    return { path: raw, utm: {} };
  }
  const decoded = percentDecode(raw);
  const hashAt = decoded.indexOf('#');
  const noHash = hashAt >= 0 ? decoded.slice(0, hashAt) : decoded;
  const qAt = noHash.indexOf('?');
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const utm = {};
  if (qAt >= 0) {
    const params = new URLSearchParams(noHash.slice(qAt + 1));
    for (const key of UTM_KEYS) {
      const found = params.get(key);
      if (typeof found !== 'string') continue;
      const clean = found.trim().slice(0, 80);
      if (!clean || clean.includes('?') || /reset=|token=|claim=/i.test(clean) || hasSensitiveParam(clean)) continue;
      utm[key] = clean;
    }
  }
  return { path, utm };
}

function sanitizeUrlField(value) {
  if (typeof value !== 'string') return '';
  if (!looksLikeUrl(value)) {
    if (hasSensitiveParam(value)) return redactLogString(value);
    return value;
  }
  const split = splitTrackedUrl(value);
  if (/reset=|token=|claim=/i.test(split.path)) return '';
  return split.path;
}

function storeString(out, utm, key, value) {
  if (looksLikeUrl(value)) {
    const split = splitTrackedUrl(value);
    const path = /reset=|token=|claim=/i.test(split.path) ? '' : split.path.slice(0, 300);
    if (path) out[key] = path;
    Object.assign(utm, split.utm);
    return;
  }
  if (hasSensitiveParam(value)) {
    out[key] = redactLogString(value).slice(0, 300);
    return;
  }
  out[key] = value;
}

function sanitizeAnalyticsPayload(input, depth) {
  if (depth > 6 || input == null) return input;
  if (typeof input === 'string') {
    if (looksLikeUrl(input)) return sanitizeUrlField(input);
    if (hasSensitiveParam(input)) return redactLogString(input);
    return input;
  }
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => sanitizeAnalyticsPayload(item, (depth || 0) + 1));
  }
  const out = {};
  const utm = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (UTM_KEYS.includes(key) && typeof value === 'string') {
      const clean = value.trim().slice(0, 80);
      if (clean && !clean.includes('?') && !/reset=|token=|claim=/i.test(clean) && !hasSensitiveParam(clean)) utm[key] = clean;
      continue;
    }
    if (typeof value === 'string' && (URL_KEY.test(key) || looksLikeUrl(value) || hasSensitiveParam(value))) {
      storeString(out, utm, key, value);
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = sanitizeAnalyticsPayload(value, (depth || 0) + 1);
      continue;
    }
    out[key] = value;
  }
  for (const [key, value] of Object.entries(utm)) {
    if (!out[key]) out[key] = value;
  }
  return out;
}

function redactLogArg(value) {
  if (typeof value === 'string') return redactLogString(value);
  if (value instanceof Error) {
    const wrapped = new Error(redactLogString(value.message));
    wrapped.name = value.name;
    wrapped.stack = value.stack ? redactLogString(value.stack) : value.stack;
    if (value.cause) wrapped.cause = redactLogArg(value.cause);
    return wrapped;
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.parse(redactLogString(JSON.stringify(value)));
    } catch (err) {
      return '[redacted]';
    }
  }
  return value;
}

function installLogRedaction() {
  if (logRedactionInstalled) return;
  logRedactionInstalled = true;
  for (const method of LOG_METHODS) {
    logForwarders[method] = console[method].bind(console);
    console[method] = (...args) => {
      const forward = logForwarders[method];
      if (typeof forward === 'function') forward(...args.map(redactLogArg));
    };
  }
}

function setLogForwarderForTests(method, fn) {
  const previous = logForwarders[method];
  logForwarders[method] = fn;
  return previous;
}

function resetLogRedactionForTests() {
  logRedactionInstalled = false;
}

module.exports = {
  UTM_KEYS,
  splitTrackedUrl,
  sanitizeUrlField,
  sanitizeAnalyticsPayload,
  redactLogString,
  redactLogArg,
  installLogRedaction,
  setLogForwarderForTests,
  resetLogRedactionForTests,
};
