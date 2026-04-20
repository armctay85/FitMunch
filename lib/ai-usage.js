'use strict';
/**
 * FitMunch AI usage metering.
 * Tracks per-user AI calls by feature for the current calendar month,
 * and enforces a free-tier cap via AI_FREE_MONTHLY_LIMIT (default 10).
 *
 * Storage: Postgres table `ai_usage_monthly`. Table is auto-created on first use
 * so deployment doesn't require a migration step.
 */

const { Pool } = require('pg');

let _pool = null;
function getPool() {
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
  const { userId, tier = 'free', feature } = ctx;
  if (!userId) return { allowed: true, remaining: null };

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
  freeMonthlyLimit,
  getUsed,
  increment,
  checkAndConsume,
};
