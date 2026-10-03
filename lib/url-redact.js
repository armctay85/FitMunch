'use strict';

/**
 * Keep analytics and logs from storing password-reset secrets.
 * Paths may keep an allowlisted UTM query. Everything else is dropped.
 */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const SENSITIVE_PARAM = 'reset|token|code|key|session|email|sig|jwt|claim';
const SENSITIVE_KEY = /^(reset|token|code|key|session|email|sig|jwt|password|secret|claim)$/i;
const URL_KEY = /^(url|path|href|referrer|landing|page_url|pageurl)$/i;
const QUERY_PARAM_RE = new RegExp('([?&#\\s]|^)(' + SENSITIVE_PARAM + ')=([^&#\\s"\'<>]*)', 'gi');
const JSON_PARAM_RE = new RegExp('"(reset|token|code|key|session|email|sig|jwt|claim)"\\s*:\\s*"[^"]*"', 'gi');
const SECRET_IN_VALUE = /reset=|token=|claim=/i;

let logRedactionInstalled = false;

function splitTrackedUrl(value) {
  const raw = String(value || '');
  const hashAt = raw.indexOf('#');
  const noHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const qAt = noHash.indexOf('?');
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const utm = {};
  if (qAt >= 0) {
    const params = new URLSearchParams(noHash.slice(qAt + 1));
    for (const key of UTM_KEYS) {
      const found = params.get(key);
      if (typeof found !== 'string') continue;
      const clean = found.trim().slice(0, 80);
      if (!clean || clean.includes('?') || SECRET_IN_VALUE.test(clean)) continue;
      utm[key] = clean;
    }
  }
  return { path, utm };
}

function sanitizeUrlField(value) {
  if (typeof value !== 'string') return '';
  const split = splitTrackedUrl(value);
  if (SECRET_IN_VALUE.test(split.path)) return '';
  return split.path;
}

function sanitizeAnalyticsPayload(input, depth) {
  if (depth > 6 || input == null) return input;
  if (typeof input === 'string') {
    if (input.includes('?') || input.includes('#') || SECRET_IN_VALUE.test(input)) {
      return sanitizeUrlField(input);
    }
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
      if (clean && !clean.includes('?') && !SECRET_IN_VALUE.test(clean)) utm[key] = clean;
      continue;
    }
    if (typeof value === 'string' && (URL_KEY.test(key) || value.includes('?') || value.includes('#') || SECRET_IN_VALUE.test(value))) {
      const split = splitTrackedUrl(value);
      const path = SECRET_IN_VALUE.test(split.path) ? '' : split.path.slice(0, 300);
      if (path) out[key] = path;
      Object.assign(utm, split.utm);
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

function redactLogString(input) {
  return String(input)
    .replace(QUERY_PARAM_RE, '$1$2=[redacted]')
    .replace(JSON_PARAM_RE, '"$1":"[redacted]"');
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
  if (value && typeof value === 'object' && typeof value.url === 'string' && (value.originalUrl || value.method)) {
    const url = redactLogString(value.originalUrl || value.url);
    return { method: value.method || '', url: sanitizeUrlField(url) || redactLogString(url) };
  }
  return value;
}

function installLogRedaction() {
  if (logRedactionInstalled) return;
  logRedactionInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map(redactLogArg));
  }
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
  resetLogRedactionForTests,
};
