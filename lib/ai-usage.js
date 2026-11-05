'use strict';
/**
 * FitMunch AI usage metering.
 * Tracks per-user AI calls by feature for the current calendar month,
 * and enforces a free-tier cap via AI_FREE_MONTHLY_LIMIT (default 10).
 *
 * Storage: Postgres table `ai_usage_monthly`. Table is auto-created on first use
 * so deployment doesn't require a migration step.
 *
 * The same table also holds two daily counters, keyed by the Sydney date
 * (AEST/AEDT) in the `month` column as `day:YYYY-MM-DD`, so they never mix
 * with the monthly rows:
 *   - provider token totals: user_id `__tokens__`, feature `in:<provider>` / `out:<provider>`
 *   - smoke account calls:   user_id <user id>, feature `smoke_calls`
 *
 * Time zones: monthly rows use monthKey(), the UTC calendar month (YYYY-MM).
 * Daily rows use dayKey(), the Sydney calendar date. Each counter is
 * consistent with itself; they are never compared with each other. Daily rows
 * older than 90 days are pruned.
 *
 * Smoke accounts (SMOKE_ACCOUNT_IDS, comma separated user ids, matched
 * exactly after trimming) skip the free monthly cap and get SMOKE_DAILY_AI_CAP
 * calls a Sydney day (SMOKE_CAP_DEFAULT 30 when unset or non-numeric,
 * clamped to SMOKE_CAP_MAX 100). A call is charged only once the provider
 * answers: failed calls are refunded atomically, and a client abort after an
 * answer (res.locals.aiAnswered) is not refunded. Emails are not matched: register
 * does not verify email, so an email allowlist could be squatted. The daily
 * cap is one atomic upsert and fails closed when the store is unavailable.
 */

const { Pool } = require('pg');

let _pool = null;
let _queryOverride = null;
/** Tests only: route every query through fn(sql, params) -> { rows }. */
function _setQueryForTests(fn) { _queryOverride = fn; _tablePromise = null; }
function getPool() {
  if (_queryOverride) return { query: (sql, params) => _queryOverride(sql, params) };
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  // On the receipt-scan path. A free scan calls getUsed first (connect,
  // ensureTable, select) and checkAndConsume after vision (select, increment).
  // 3s connect + 2s per statement keeps that under maxDuration 90 with vision
  // at 65s. The server default (statement_timeout 0) does not.
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 2000,
    allowExitOnIdle: true,
  });
  return _pool;
}

/** Tests only. Closes the usage pool so CI Postgres is not left at max_connections. */
async function endPoolForTests() {
  const p = _pool;
  _pool = null;
  _tablePromise = null;
  if (p && typeof p.end === 'function') {
    try { await p.end(); } catch (_) { /* already closed */ }
  }
}

let _tablePromise = null;
async function ensureTable() {
  const pool = getPool();
  if (!pool) return false;
  if (!_tablePromise) {
    _tablePromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS ai_usage_monthly (
           user_id TEXT NOT NULL,
           month TEXT NOT NULL,
           feature TEXT NOT NULL,
           count INTEGER NOT NULL DEFAULT 0,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, month, feature)
         )`
      )
      .then(() => true)
      .catch((err) => {
        console.error('[ai-usage] ensureTable failed:', err.message);
        _tablePromise = null;
        return false;
      });
  }
  return _tablePromise;
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Sydney calendar date, YYYY-MM-DD (AEST or AEDT). */
function sydneyDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dayKey(d = new Date()) {
  return `day:${sydneyDay(d)}`;
}

/** SMOKE_ACCOUNT_IDS split on commas and trimmed. */
function smokeAccountIds() {
  return String(process.env.SMOKE_ACCOUNT_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The one smoke-account match used by every AI route (chat, scan, plans, usage). */
function isSmokeAccount({ userId } = {}) {
  if (userId === undefined || userId === null) return false;
  const id = String(userId).trim();
  return !!id && smokeAccountIds().includes(id);
}

const SMOKE_CAP_DEFAULT = 30;
const SMOKE_CAP_MAX = 100;
function smokeDailyCap() {
  const raw = process.env.SMOKE_DAILY_AI_CAP;
  if (raw === undefined || String(raw).trim() === '') return SMOKE_CAP_DEFAULT;
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return SMOKE_CAP_DEFAULT;
  return Math.min(parseInt(t, 10), SMOKE_CAP_MAX);
}

/**
 * Atomically take one smoke call for today. Returns the new count, or null when
 * the cap is reached. Throws when the store is unavailable (caller fails closed).
 */
async function consumeSmokeCall(userId, cap, d = new Date()) {
  const pool = getPool();
  if (!pool) throw new Error('usage store unavailable');
  await ensureTable();
  const r = await pool.query(
    `INSERT INTO ai_usage_monthly (user_id, month, feature, count, updated_at)
     VALUES ($1,$2,$3,1,now())
     ON CONFLICT (user_id, month, feature)
     DO UPDATE SET count = ai_usage_monthly.count + 1, updated_at = now()
     WHERE ai_usage_monthly.count < $4
     RETURNING count`,
    [userId, dayKey(d), 'smoke_calls', cap]
  );
  const n = Number(r && r.rows && r.rows[0] && r.rows[0].count);
  return r && r.rows && r.rows.length && Number.isFinite(n) ? n : null;
}

/** Today's smoke calls for display. null when the store can't be read. */
async function smokeUsedToday(userId, d = new Date()) {
  const pool = getPool();
  if (!pool) return null;
  await ensureTable();
  try {
    const r = await pool.query(
      'SELECT COALESCE(count,0)::int AS total FROM ai_usage_monthly WHERE user_id=$1 AND month=$2 AND feature=$3',
      [userId, dayKey(d), 'smoke_calls']
    );
    return (r.rows[0] && r.rows[0].total) || 0;
  } catch (_) {
    return null;
  }
}

/**
 * Give back one smoke call (atomic, never below 0). Used when the AI call that
 * consumed it failed. Never throws.
 */
async function refundSmokeCall(gate) {
  if (!gate || !gate.smoke || !gate.allowed || !gate.userId || !gate.day) return false;
  const pool = getPool();
  if (!pool) return false;
  try {
    const r = await pool.query(
      `UPDATE ai_usage_monthly SET count = count - 1, updated_at = now()
       WHERE user_id=$1 AND month=$2 AND feature='smoke_calls' AND count > 0
       RETURNING count`,
      [gate.userId, gate.day]
    );
    return !!(r && r.rows && r.rows.length);
  } catch (_) {
    return false;
  }
}

/**
 * Give back the credit a route consumed when it ended up not using AI (e.g.
 * the meal planner served its food-DB plan). Smoke calls use the daily
 * refund; customer calls take one off this month's feature count, never
 * below 0. Never throws.
 */
async function refundAiCall(gate, { userId, feature } = {}) {
  if (!gate || !gate.allowed) return false;
  if (gate.smoke) return refundSmokeCall(gate);
  const pool = getPool();
  if (!pool || !userId || !feature) return false;
  const params = [String(userId), monthKey(), feature];
  const readCount = () => pool.query(
    `SELECT count FROM ai_usage_monthly WHERE user_id=$1 AND month=$2 AND feature=$3`,
    params
  );
  const refund = () => pool.query(
    `UPDATE ai_usage_monthly SET count = count - 1, updated_at = now()
     WHERE user_id=$1 AND month=$2 AND feature=$3 AND count > 0
     RETURNING count`,
    params
  );
  const countOf = (r) => {
    const row = r && r.rows && r.rows[0];
    return row && row.count != null ? Number(row.count) : null;
  };
  let before = null;
  try { before = countOf(await readCount()); } catch (_) { before = null; }
  // A lost reply can hide a decrement that already committed. A second
  // failure must keep that refund and must not subtract again.
  const alreadyRefunded = async () => {
    if (before == null) return false;
    try {
      const now = countOf(await readCount());
      return now != null && now < before;
    } catch (_) {
      return false;
    }
  };
  try {
    const r = await refund();
    return !!(r && r.rows && r.rows.length);
  } catch (err) {
    console.error('[ai-usage] refund failed, retrying once:', err && err.message);
    try {
      if (await alreadyRefunded()) return true;
      const r = await refund();
      return !!(r && r.rows && r.rows.length);
    } catch (err2) {
      if (await alreadyRefunded()) return true;
      console.error('[ai-usage] refund retry failed:', err2 && err2.message);
      return false;
    }
  }
}

/**
 * Smoke accounts are only charged for answered calls: when the response ends
 * with status >= 400, or the route marks res.locals.aiFailed (e.g. a 200
 * fallback), the smoke call is refunded. Customer free-tier counting is not
 * touched.
 */
function refundSmokeOnFailure(gate, res) {
  if (!gate || !gate.smoke || !gate.allowed || !res || typeof res.once !== 'function') return;
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    const answered = !!(res.locals && res.locals.aiAnswered);
    const failed = !answered
      && (res.statusCode >= 400 || (res.locals && res.locals.aiFailed) || !res.writableFinished);
    if (failed) refundSmokeCall(gate).catch(() => {});
  };
  res.once('finish', settle);
  res.once('close', settle);
}

let _prunedDay = null;
/** Delete day: rows older than 90 days, at most once per Sydney day per process. Never throws. */
async function pruneDailyRows(d = new Date()) {
  const today = sydneyDay(d);
  if (_prunedDay === today) return;
  _prunedDay = today;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query("DELETE FROM ai_usage_monthly WHERE month LIKE 'day:%' AND updated_at < now() - interval '90 days'");
  } catch (_) {
    /* best effort */
  }
}

async function addCount(userId, period, feature, amount) {
  const pool = getPool();
  if (!pool) return null;
  await ensureTable();
  try {
    const r = await pool.query(
      `INSERT INTO ai_usage_monthly (user_id, month, feature, count, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (user_id, month, feature)
       DO UPDATE SET count = ai_usage_monthly.count + EXCLUDED.count, updated_at = now()
       RETURNING count`,
      [userId, period, feature, amount]
    );
    const n = Number(r && r.rows && r.rows[0] && r.rows[0].count);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    console.error('[ai-usage] addCount failed:', err.message);
    return null;
  }
}

/**
 * Add one successful call's tokens to today's per-provider totals and return
 * today's running total (in + out) for that provider, or null with no store.
 */
async function recordTokens(provider, tokensIn, tokensOut, d = new Date()) {
  if (!provider) return null;
  const tin = Number.isFinite(Number(tokensIn)) ? Math.max(0, Math.round(Number(tokensIn))) : 0;
  const tout = Number.isFinite(Number(tokensOut)) ? Math.max(0, Math.round(Number(tokensOut))) : 0;
  const period = dayKey(d);
  const a = await addCount('__tokens__', period, `in:${provider}`, tin);
  const b = await addCount('__tokens__', period, `out:${provider}`, tout);
  if (a === null || b === null) return null;
  return a + b;
}

const USAGE_UNAVAILABLE_ERROR = "We couldn't check your AI usage. Please try again.";
function sendUsageUnavailable(res) {
  res.set('Retry-After', '3');
  return res.status(503).json({ success: false, error: USAGE_UNAVAILABLE_ERROR });
}

function freeMonthlyLimit() {
  const raw = process.env.AI_FREE_MONTHLY_LIMIT;
  if (raw === undefined || raw === '') return 10;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

async function getUsed(userId, feature = 'any', month = monthKey()) {
  const pool = getPool();
  if (!pool) return 0;
  await ensureTable();
  const q = feature === 'any'
    ? 'SELECT COALESCE(SUM(count),0)::int AS total FROM ai_usage_monthly WHERE user_id=$1 AND month=$2'
    : 'SELECT COALESCE(count,0)::int AS total FROM ai_usage_monthly WHERE user_id=$1 AND month=$2 AND feature=$3';
  const params = feature === 'any' ? [userId, month] : [userId, month, feature];
  try {
    const r = await pool.query(q, params);
    return r.rows[0]?.total || 0;
  } catch (err) {
    console.error('[ai-usage] getUsed failed:', err.message);
    return null;
  }
}

async function increment(userId, feature, month = monthKey()) {
  const pool = getPool();
  if (!pool) return true;
  await ensureTable();
  try {
    await pool.query(
      `INSERT INTO ai_usage_monthly (user_id, month, feature, count, updated_at)
       VALUES ($1,$2,$3,1,now())
       ON CONFLICT (user_id, month, feature)
       DO UPDATE SET count = ai_usage_monthly.count + 1, updated_at = now()`,
      [userId, month, feature]
    );
    return true;
  } catch (err) {
    console.error('[ai-usage] increment failed:', err.message);
    return false;
  }
}

/**
 * @param {{ userId: string, tier?: string, feature: string }} ctx
 * @returns {Promise<{ allowed: true, remaining: number | null } | { allowed: false, limit: number, used: number, upgrade: true }>}
 */
async function checkAndConsume(ctx) {
  const { userId, tier = 'free', feature } = ctx;
  if (!userId) return { allowed: true, remaining: null };

  // Smoke accounts: no monthly cap, an atomic daily cap instead. Fails closed.
  if (isSmokeAccount({ userId })) {
    const cap = smokeDailyCap();
    pruneDailyRows().catch(() => {});
    if (cap === 0) return { allowed: false, limit: 0, used: 0, upgrade: false, smoke: true };
    let count;
    try {
      count = await consumeSmokeCall(String(userId).trim(), cap);
    } catch (err) {
      console.error('[ai-usage] smoke cap check failed:', err && err.message);
      return { allowed: false, limit: cap, used: null, upgrade: false, smoke: true, unavailable: true };
    }
    if (count === null) return { allowed: false, limit: cap, used: cap, upgrade: false, smoke: true };
    return { allowed: true, remaining: Math.max(0, cap - count), smoke: true, userId: String(userId).trim(), day: dayKey() };
  }

  // Paid tiers: no cap at this layer (tier.js may enforce finer rules later).
  if (tier && tier !== 'free') {
    await increment(userId, feature);
    return { allowed: true, remaining: null };
  }

  const limit = freeMonthlyLimit();
  const used = await getUsed(userId);
  // A cancelled statement or any other read error is not "zero used". Free accounts stop (EQA #163).
  if (used == null) return { allowed: false, unavailable: true, limit, used: null, upgrade: false };
  if (limit === 0) {
    // 0 means "no free AI" — always block free users.
    return { allowed: false, limit: 0, used, upgrade: true };
  }

  if (used >= limit) {
    return { allowed: false, limit, used, upgrade: true };
  }
  const wrote = await increment(userId, feature);
  if (wrote === false) return { allowed: false, unavailable: true, limit, used, upgrade: false };
  return { allowed: true, remaining: Math.max(0, limit - used - 1) };
}

async function _endPoolForTests() {
  const pool = _pool;
  _pool = null;
  _tablePromise = null;
  if (pool && typeof pool.end === 'function' && pool !== _queryOverride) await pool.end();
}

module.exports = {
  _endPoolForTests,
  monthKey,
  sydneyDay,
  dayKey,
  isSmokeAccount,
  smokeAccountIds,
  smokeUsedToday,
  pruneDailyRows,
  refundSmokeCall,
  refundAiCall,
  refundSmokeOnFailure,
  smokeDailyCap,
  recordTokens,
  _setQueryForTests,
  endPoolForTests,
  freeMonthlyLimit,
  USAGE_UNAVAILABLE_ERROR,
  sendUsageUnavailable,
  getUsed,
  increment,
  checkAndConsume,
};
