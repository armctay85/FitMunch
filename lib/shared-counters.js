'use strict';
/**
 * Small counters that must hold across serverless instances.
 *
 * - Fixed-window rate limits (claim-resend per IP and per email) live in
 *   rate_limit_counters.
 * - WEBHOOK_RETRY counts per Stripe event live in stripe_webhook_retries.
 *
 * Both use Postgres when DATABASE_URL is set and the schema is ready. With no
 * database (tests, previews) or if a query fails, they fall back to memory in
 * this instance and say so in the log. Keys are SHA-256 hashed, so no IP or
 * email is stored.
 */
const crypto = require('crypto');
const { ensureSchema, getPool } = require('./db-migrate');

const memoryRate = new Map();
const memoryRetries = new Map();
let queryOverride = null;
// In-flight test reset. Counter writes wait for it so a delete cannot race an insert.
let resetTail = Promise.resolve();

function refuseResetOutsideTests() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetSharedCountersForTests refused: NODE_ENV is not test');
  }
}

function localTestDatabase() {
  const url = String(process.env.DATABASE_URL || '');
  if (!url) return false;
  if (/neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(url)) return false;
  return /localhost|127\.0\.0\.1/.test(url);
}

async function deleteCounterTable(pool, sql) {
  try {
    await pool.query(sql);
  } catch (err) {
    if (err && err.code === '42P01') return;
    throw err;
  }
}

async function clearSharedCounterRowsForTests() {
  refuseResetOutsideTests();
  // Only a local test database. A live URL must never be wiped from this helper.
  if (!localTestDatabase()) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await deleteCounterTable(pool, 'DELETE FROM rate_limit_counters');
    await deleteCounterTable(pool, 'DELETE FROM stripe_webhook_retries');
  } catch (err) {
    const message = String(err && err.message || '');
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || /timeout|ECONNRESET|connect/i.test(message))) return;
    throw err;
  }
}

async function waitForTestCounterReset() {
  if (process.env.NODE_ENV !== 'test') return;
  await resetTail;
}

function hashKey(scope, key) {
  return crypto.createHash('sha256').update(`${scope}:${String(key)}`).digest('hex');
}

async function dbQuery() {
  if (queryOverride) return queryOverride;
  if (!process.env.DATABASE_URL) return null;
  const pool = getPool();
  if (!pool) return null;
  const ready = await ensureSchema();
  if (!ready) return null;
  return (sql, params) => pool.query(sql, params);
}

const HIT_RATE_SQL = `
INSERT INTO rate_limit_counters (scope, key_hash, window_start, hits, expires_at)
VALUES ($1, $2, to_timestamp($3::double precision / 1000), 1, to_timestamp($4::double precision / 1000))
ON CONFLICT (scope, key_hash, window_start)
DO UPDATE SET hits = rate_limit_counters.hits + 1
RETURNING hits`;
const PRUNE_RATE_SQL = 'DELETE FROM rate_limit_counters WHERE expires_at < now()';

/**
 * Count one hit for (scope, key) in a fixed window and return the hit count
 * for that window, including this one.
 */
async function hitRateCounter(scope, key, { windowMs, now = Date.now(), failClosed = false } = {}) {
  await waitForTestCounterReset();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = hashKey(scope, key);
  let query = null;
  try {
    query = await dbQuery();
  } catch (_) {
    query = null;
  }
  // failClosed: with a database configured, never fall back to per-instance
  // memory. The caller turns the throw into a refusal.
  if (failClosed && !query && (process.env.DATABASE_URL || queryOverride)) {
    throw Object.assign(new Error('rate counter unavailable'), { code: 'RATE_COUNTER_UNAVAILABLE' });
  }
  if (query) {
    try {
      if (Math.random() < 0.02) query(PRUNE_RATE_SQL).catch(() => {});
      const out = await query(HIT_RATE_SQL, [scope, id, windowStart, windowStart + windowMs]);
      const hits = Number(out && out.rows && out.rows[0] && out.rows[0].hits);
      if (Number.isFinite(hits) && hits > 0) return hits;
      if (failClosed) {
        throw Object.assign(new Error('rate counter unavailable'), { code: 'RATE_COUNTER_UNAVAILABLE' });
      }
    } catch (err) {
      if (failClosed) {
        console.error('[shared-counters] RATE_COUNTER_DB_FAILED, refusing:', err && err.code);
        throw Object.assign(new Error('rate counter unavailable'), { code: 'RATE_COUNTER_UNAVAILABLE' });
      }
      console.error('[shared-counters] RATE_COUNTER_DB_FAILED, using memory:', err && err.code);
    }
  }
  const memId = `${scope}:${id}`;
  const row = memoryRate.get(memId);
  if (!row || row.windowStart !== windowStart) {
    memoryRate.set(memId, { windowStart, hits: 1, expiresAt: windowStart + windowMs });
    return 1;
  }
  row.hits += 1;
  return row.hits;
}

const HIT_RETRY_SQL = `
INSERT INTO stripe_webhook_retries (event_id, event_type, retries)
VALUES ($1, $2, 1)
ON CONFLICT (event_id)
DO UPDATE SET retries = stripe_webhook_retries.retries + 1, last_at = now()
RETURNING retries`;
const CLAIM_ALERT_SQL = `
UPDATE stripe_webhook_retries SET alerted_at = now()
WHERE event_id = $1 AND alerted_at IS NULL
RETURNING event_id`;
const PRUNE_RETRY_SQL = "DELETE FROM stripe_webhook_retries WHERE last_at < now() - INTERVAL '30 days'";

/**
 * Count one WEBHOOK_RETRY for a Stripe event. Returns { retries, alert },
 * where alert is true exactly once per event, from the threshold onwards.
 */
async function noteStripeEventRetry(eventId, eventType, { alertAt = 3 } = {}) {
  await waitForTestCounterReset();
  if (!eventId) return { retries: 0, alert: false };
  let query = null;
  try {
    query = await dbQuery();
  } catch (_) {
    query = null;
  }
  if (query) {
    try {
      if (Math.random() < 0.02) query(PRUNE_RETRY_SQL).catch(() => {});
      const out = await query(HIT_RETRY_SQL, [String(eventId), String(eventType || '')]);
      const retries = Number(out && out.rows && out.rows[0] && out.rows[0].retries) || 0;
      let alert = false;
      if (retries >= alertAt) {
        const claimed = await query(CLAIM_ALERT_SQL, [String(eventId)]);
        alert = Boolean(claimed && claimed.rows && claimed.rows.length);
      }
      return { retries, alert };
    } catch (err) {
      console.error('[shared-counters] RETRY_COUNTER_DB_FAILED, using memory:', err && err.code);
    }
  }
  if (memoryRetries.size > 5000) memoryRetries.clear();
  const row = memoryRetries.get(eventId) || { retries: 0, alerted: false };
  row.retries += 1;
  let alert = false;
  if (row.retries >= alertAt && !row.alerted) {
    row.alerted = true;
    alert = true;
  }
  memoryRetries.set(eventId, row);
  return { retries: row.retries, alert };
}

function setSharedCounterQueryForTests(fn) {
  queryOverride = fn || null;
}

function resetSharedCountersForTests() {
  // Memory reset is the existing test hook. Suites set NODE_ENV to production
  // or development on purpose, then call this. Only the Postgres wipe is
  // refused outside tests, and that function is not exported.
  memoryRate.clear();
  memoryRetries.clear();
  queryOverride = null;
  if (process.env.NODE_ENV !== 'test') return Promise.resolve();
  const run = resetTail.then(() => clearSharedCounterRowsForTests(), () => clearSharedCounterRowsForTests());
  resetTail = run.then(() => {}, () => {});
  return run;
}

module.exports = {
  hitRateCounter,
  noteStripeEventRetry,
  hashKey,
  setSharedCounterQueryForTests,
  resetSharedCountersForTests,
  HIT_RATE_SQL,
  HIT_RETRY_SQL,
};
