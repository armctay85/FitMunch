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
async function hitRateCounter(scope, key, { windowMs, now = Date.now() } = {}) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = hashKey(scope, key);
  let query = null;
  try {
    query = await dbQuery();
  } catch (_) {
    query = null;
  }
  if (query) {
    try {
      if (Math.random() < 0.02) query(PRUNE_RATE_SQL).catch(() => {});
      const out = await query(HIT_RATE_SQL, [scope, id, windowStart, windowStart + windowMs]);
      const hits = Number(out && out.rows && out.rows[0] && out.rows[0].hits);
      if (Number.isFinite(hits) && hits > 0) return hits;
    } catch (err) {
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
  memoryRate.clear();
  memoryRetries.clear();
  queryOverride = null;
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
