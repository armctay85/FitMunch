'use strict';
/**
 * Secret-free record of recent receipt-vision attempts.
 *
 * Memory keeps the last 20 attempts on this instance. When DATABASE_URL is
 * set outside unit tests, the same shape is stored as one rolling JSON row in
 * vision_diag (provider, HTTP status, error class, duration). Keys, prompts,
 * and image bytes are never accepted.
 *
 * Unit tests do not open a pool: Jest sets JEST_WORKER_ID, and persistence
 * stays off unless a test injects a query function.
 */

const MAX_ATTEMPTS = 20;
const ROW_ID = 'rolling';

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS vision_diag (
  id TEXT PRIMARY KEY,
  attempts JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const READ_SQL = 'SELECT attempts FROM vision_diag WHERE id = $1';
const UPSERT_SQL = `INSERT INTO vision_diag (id, attempts, updated_at)
  VALUES ($1, $2::jsonb, now())
  ON CONFLICT (id) DO UPDATE SET attempts = EXCLUDED.attempts, updated_at = now()`;

const memory = [];
let pending = Promise.resolve();
let queryOverride = null;
let tableReady = false;

function safeToken(value) {
  const s = String(value == null ? '' : value).toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(s) ? s : '';
}

function statusCode(status) {
  if (status === undefined || status === null || status === '') return null;
  const code = Number(status);
  if (!Number.isInteger(code) || code < 100 || code > 599) return null;
  return code;
}

function isTimeoutResult(result) {
  if (!result || typeof result !== 'object') return false;
  const code = String(result.error || '');
  if (code === 'timeout' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ABORT_ERR') return true;
  const msg = String(result.errorMessage || '');
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timed out|time budget exceeded/i.test(msg)) return true;
  const status = statusCode(result.status);
  return status === 408 || status === 504;
}

/** Short class for logs and the smoke probe. Never a provider message. */
function classify(result) {
  if (!result || typeof result !== 'object') return 'unknown';
  if (result.ok) return (result.text && String(result.text).trim()) ? 'ok' : 'empty';
  if (result.error === 'content_refusal' || result.refusal === true) return 'content_refusal';
  if (result.error === 'missing_key') return 'missing_key';
  if (result.error === 'no_vision_provider' || result.error === 'no_provider') return 'no_provider';
  const status = statusCode(result.status);
  if (status === 400 || status === 422) return 'rejected';
  if (isTimeoutResult(result)) return 'timeout';
  if (status === 402) return 'payment_required';
  if (status === 413) return 'payload_too_large';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status != null && status >= 500) return 'server_error';
  if (status != null && status >= 400) return 'client_error';
  return 'network';
}

function sanitizeAttempt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const provider = safeToken(raw.provider);
  const errorClass = safeToken(raw.errorClass);
  if (!provider || !errorClass) return null;
  const duration = Number(raw.durationMs);
  const at = Number(raw.at);
  return {
    provider,
    status: statusCode(raw.status),
    errorClass,
    durationMs: Number.isFinite(duration) && duration >= 0 && duration < 600000 ? Math.round(duration) : 0,
    at: Number.isFinite(at) && at >= 0 ? Math.round(at) : 0,
  };
}

function statusKey(status) {
  return status == null ? 'none' : String(status);
}

function summaryOf(list) {
  const counts = {};
  let lastErrorClass = null;
  const durations = [];
  const ordered = (list || []).filter(Boolean).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const row of ordered) {
    const provider = safeToken(row.provider);
    const errorClass = safeToken(row.errorClass);
    if (!provider || !errorClass) continue;
    const key = statusKey(statusCode(row.status));
    if (!counts[provider]) counts[provider] = {};
    counts[provider][key] = (counts[provider][key] || 0) + 1;
    if (errorClass !== 'ok') lastErrorClass = errorClass;
    const ms = Number(row.durationMs);
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
  }
  durations.sort((a, b) => a - b);
  let p50Ms = null;
  if (durations.length) {
    if (durations.length % 2 === 1) p50Ms = durations[(durations.length - 1) / 2];
    else p50Ms = Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);
  }
  return {
    samples: ordered.length,
    counts,
    lastErrorClass,
    p50Ms,
  };
}

function safeCounts(counts) {
  const out = {};
  if (!counts || typeof counts !== 'object') return out;
  for (const provider of Object.keys(counts)) {
    const p = safeToken(provider);
    const bucket = counts[provider];
    if (!p || !bucket || typeof bucket !== 'object') continue;
    const next = {};
    for (const status of Object.keys(bucket)) {
      if (!/^(none|\d{3})$/.test(String(status))) continue;
      const n = Number(bucket[status]);
      if (!Number.isInteger(n) || n < 0 || n > 100000) continue;
      next[String(status)] = n;
    }
    if (Object.keys(next).length) out[p] = next;
  }
  return out;
}

/** Fields safe to show to the smoke account. Drops anything else. */
function publicView(input) {
  if (!input || typeof input !== 'object') return null;
  const provider = safeToken(input.provider);
  const errorClass = safeToken(input.errorClass);
  const lastErrorClass = safeToken(input.lastErrorClass);
  const counts = safeCounts(input.counts);
  const p50 = Number(input.p50Ms);
  const p50Ms = Number.isFinite(p50) && p50 >= 0 && p50 < 600000 ? Math.round(p50) : null;
  const status = statusCode(input.status);
  if (!provider && !errorClass && !lastErrorClass && p50Ms == null && !Object.keys(counts).length && status == null) {
    return null;
  }
  return {
    provider: provider || null,
    errorClass: errorClass || null,
    status,
    counts,
    lastErrorClass: lastErrorClass || null,
    p50Ms,
  };
}

function allowPersist() {
  if (queryOverride) return true;
  if (process.env.JEST_WORKER_ID) return false;
  return Boolean(process.env.DATABASE_URL);
}

async function getQuery() {
  if (queryOverride) return queryOverride;
  if (!allowPersist()) return null;
  let getPool;
  try {
    ({ getPool } = require('./db-migrate'));
  } catch (_) {
    return null;
  }
  const pool = getPool();
  if (!pool || typeof pool.query !== 'function') return null;
  return (sql, params) => pool.query(sql, params);
}

async function ensureTable(query) {
  if (tableReady) return;
  await query(CREATE_SQL);
  tableReady = true;
}

function mergeAttempts(remote, local) {
  const seen = new Set();
  const out = [];
  for (const row of (remote || []).concat(local || [])) {
    const safe = sanitizeAttempt(row);
    if (!safe) continue;
    const key = [safe.at, safe.provider, safe.status, safe.errorClass, safe.durationMs].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(-MAX_ATTEMPTS);
}

async function readStored(query) {
  const cur = await query(READ_SQL, [ROW_ID]);
  const attempts = cur && cur.rows && cur.rows[0] && cur.rows[0].attempts;
  return Array.isArray(attempts) ? attempts : [];
}

async function persist(entry) {
  const query = await getQuery();
  if (!query) return;
  await ensureTable(query);
  const prev = await readStored(query);
  const next = mergeAttempts(prev, [entry]);
  await query(UPSERT_SQL, [ROW_ID, JSON.stringify(next)]);
}

function record(entry) {
  const safe = sanitizeAttempt(entry);
  if (!safe) return;
  memory.push(safe);
  while (memory.length > MAX_ATTEMPTS) memory.shift();
  if (!allowPersist()) return;
  pending = pending.then(() => persist(safe)).catch((err) => {
    console.error('[vision-diag] persist failed', err && err.code ? err.code : 'error');
  });
}

function summary() {
  return summaryOf(memory);
}

async function mergedSummary() {
  const local = memory.slice();
  if (!allowPersist()) return summaryOf(local);
  let remote = [];
  let timer = null;
  try {
    const query = await getQuery();
    if (query) {
      const read = (async () => {
        await ensureTable(query);
        return readStored(query);
      })();
      remote = await Promise.race([
        read,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve([]), 400);
        }),
      ]);
    }
  } catch (err) {
    console.error('[vision-diag] read failed', err && err.code ? err.code : 'error');
    remote = [];
  } finally {
    if (timer) clearTimeout(timer);
  }
  return summaryOf(mergeAttempts(remote, local));
}

function flush() {
  return pending;
}

function _resetForTests() {
  memory.length = 0;
  pending = Promise.resolve();
  queryOverride = null;
  tableReady = false;
}

function _setQueryForTests(fn) {
  queryOverride = typeof fn === 'function' ? fn : null;
  tableReady = false;
}

function _attemptsForTests() {
  return memory.slice();
}

module.exports = {
  MAX_ATTEMPTS,
  classify,
  record,
  summary,
  mergedSummary,
  publicView,
  summaryOf,
  sanitizeAttempt,
  flush,
  _resetForTests,
  _setQueryForTests,
  _attemptsForTests,
};
