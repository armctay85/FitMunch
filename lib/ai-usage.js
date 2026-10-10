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
 * Smoke accounts (SMOKE_ACCOUNT_EMAILS, comma separated emails or user ids)
 * skip the free monthly cap and get SMOKE_DAILY_AI_CAP calls a day (default 10).
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
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
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

function smokeAccounts() {
  return String(process.env.SMOKE_ACCOUNT_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function isSmokeAccount({ userId, email } = {}) {
  const list = smokeAccounts();
  if (!list.length) return false;
  const id = userId ? String(userId).trim().toLowerCase() : '';
  const mail = email ? String(email).trim().toLowerCase() : '';
  return (!!id && list.includes(id)) || (!!mail && list.includes(mail));
}

function smokeDailyCap() {
  const raw = process.env.SMOKE_DAILY_AI_CAP;
  if (raw === undefined || raw === '') return 10;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
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
    return 0;
  }
}

async function increment(userId, feature, month = monthKey()) {
  const pool = getPool();
  if (!pool) return;
  await ensureTable();
  try {
    await pool.query(
      `INSERT INTO ai_usage_monthly (user_id, month, feature, count, updated_at)
       VALUES ($1,$2,$3,1,now())
       ON CONFLICT (user_id, month, feature)
       DO UPDATE SET count = ai_usage_monthly.count + 1, updated_at = now()`,
      [userId, month, feature]
    );
  } catch (err) {
    console.error('[ai-usage] increment failed:', err.message);
  }
}

/**
 * @param {{ userId: string, tier?: string, feature: string }} ctx
 * @returns {Promise<{ allowed: true, remaining: number | null } | { allowed: false, limit: number, used: number, upgrade: true }>}
 */
async function checkAndConsume(ctx) {
  const { userId, tier = 'free', feature, email } = ctx;
  if (!userId) return { allowed: true, remaining: null };

  // Smoke accounts: no monthly cap, a small daily cap instead.
  if (isSmokeAccount({ userId, email })) {
    const cap = smokeDailyCap();
    const period = dayKey();
    const used = await getUsed(userId, 'smoke_calls', period);
    if (used >= cap) return { allowed: false, limit: cap, used, upgrade: false, smoke: true };
    await addCount(userId, period, 'smoke_calls', 1);
    return { allowed: true, remaining: Math.max(0, cap - used - 1), smoke: true };
  }

  // Paid tiers: no cap at this layer (tier.js may enforce finer rules later).
  if (tier && tier !== 'free') {
    await increment(userId, feature);
    return { allowed: true, remaining: null };
  }

  const limit = freeMonthlyLimit();
  if (limit === 0) {
    // 0 means "no free AI" — always block free users.
    const used = await getUsed(userId);
    return { allowed: false, limit: 0, used, upgrade: true };
  }

  const used = await getUsed(userId);
  if (used >= limit) {
    return { allowed: false, limit, used, upgrade: true };
  }
  await increment(userId, feature);
  return { allowed: true, remaining: Math.max(0, limit - used - 1) };
}

module.exports = {
  monthKey,
  sydneyDay,
  dayKey,
  isSmokeAccount,
  smokeDailyCap,
  recordTokens,
  _setQueryForTests,
  freeMonthlyLimit,
  getUsed,
  increment,
  checkAndConsume,
};
