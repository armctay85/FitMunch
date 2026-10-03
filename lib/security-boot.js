'use strict';

/**
 * Idempotent boot cleanup.
 * Invalidates outstanding password reset tokens once, using a migration
 * marker so tokens issued after this deploy stay valid.
 * Purges analytics rows that stored a reset or token query once, behind
 * a separate marker, in batches. The purge must not block login.
 */

const RESET_MIGRATION_ID = 'invalidate_outstanding_password_resets_20261003';
const PURGE_MIGRATION_ID = 'purge_leaked_reset_token_analytics_20261003';
const PURGE_BATCH_LIMIT = 5000;

const PERCENT_DECODES = [
  ['%3d', '='],
  ['%3f', '?'],
  ['%23', '#'],
  ['%26', '&'],
  ['%72', 'r'],
  ['%65', 'e'],
  ['%73', 's'],
  ['%74', 't'],
  ['%6f', 'o'],
  ['%6e', 'n'],
  ['%6b', 'k'],
];

function normalizedSql(expr) {
  let out = `lower(${expr})`;
  for (const [from, to] of PERCENT_DECODES) {
    out = `replace(${out}, '${from}', '${to}')`;
  }
  return out;
}

const NORMALIZED_EVENT = normalizedSql(`COALESCE(event_data::text, '')`);

const ANALYTICS_PURGE_SQL = `
DELETE FROM analytics_events
WHERE id IN (
  SELECT id FROM analytics_events
  WHERE ${NORMALIZED_EVENT} ILIKE '%reset=%'
     OR ${NORMALIZED_EVENT} ILIKE '%token=%'
  LIMIT ${PURGE_BATCH_LIMIT}
)
`.trim();

function decodeLeakText(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value == null ? {} : value);
  text = text.toLowerCase();
  for (let pass = 0; pass < 2; pass += 1) {
    const next = text.replace(/%[0-9a-f]{2}/g, (hex) => {
      try {
        return decodeURIComponent(hex);
      } catch (err) {
        return hex;
      }
    });
    if (next === text) break;
    text = next.toLowerCase();
  }
  return text;
}

function analyticsPayloadLeaks(value) {
  const text = decodeLeakText(value);
  return text.includes('reset=') || text.includes('token=');
}

function countOf(result) {
  if (!result) return 0;
  if (typeof result.rowCount === 'number') return result.rowCount;
  if (Array.isArray(result.rows)) return result.rows.length;
  return 0;
}

async function ensureMigrations(query) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

async function claimMarker(query, id) {
  await ensureMigrations(query);
  const marker = await query(
    `INSERT INTO schema_migrations (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, applied_at`,
    [id]
  );
  if (!marker || !marker.rows || !marker.rows.length) return null;
  return marker.rows[0];
}

async function purgeLeakedAnalytics(query) {
  const claimed = await claimMarker(query, PURGE_MIGRATION_ID);
  if (!claimed) {
    console.log('[db-migrate] purged analytics rows 0');
    return 0;
  }
  let total = 0;
  try {
    for (let batch = 0; batch < 200; batch += 1) {
      const result = await query(ANALYTICS_PURGE_SQL);
      const count = countOf(result);
      total += count;
      if (count < PURGE_BATCH_LIMIT) break;
    }
  } catch (err) {
    try {
      await query('DELETE FROM schema_migrations WHERE id = $1', [PURGE_MIGRATION_ID]);
    } catch (clearErr) {
      console.error('[db-migrate] analytics purge marker clear failed:', clearErr.message);
    }
    throw err;
  }
  console.log('[db-migrate] purged analytics rows ' + total);
  return total;
}

async function invalidateOutstandingPasswordResets(query) {
  const claimed = await claimMarker(query, RESET_MIGRATION_ID);
  if (!claimed) {
    console.log('[db-migrate] invalidated password reset tokens 0');
    return 0;
  }
  const appliedAt = claimed.applied_at || new Date();
  try {
    const cleared = await query(
      `UPDATE password_resets
       SET used = TRUE,
           token_hash = 'revoked',
           expires_at = created_at
       WHERE used = FALSE
         AND created_at <= $1
       RETURNING id`,
      [appliedAt]
    );
    const count = countOf(cleared);
    console.log('[db-migrate] invalidated password reset tokens ' + count);
    return count;
  } catch (err) {
    try {
      await query('DELETE FROM schema_migrations WHERE id = $1', [RESET_MIGRATION_ID]);
    } catch (clearErr) {
      console.error('[db-migrate] password reset marker clear failed:', clearErr.message);
    }
    throw err;
  }
}

async function runSecurityBoot(query, options = {}) {
  let invalidated = 0;
  try {
    invalidated = await invalidateOutstandingPasswordResets(query);
  } catch (err) {
    console.error('[db-migrate] password reset invalidation failed:', err.message);
  }

  const purgePromise = purgeLeakedAnalytics(query).catch((err) => {
    console.error('[db-migrate] analytics purge failed:', err.message);
    return 0;
  });

  if (options.detachPurge) {
    return { invalidated, purged: 0, purge: purgePromise };
  }

  const purged = await purgePromise;
  return { invalidated, purged, purge: purgePromise };
}

function scheduleSecurityBoot(query) {
  return runSecurityBoot(query, { detachPurge: true });
}

module.exports = {
  RESET_MIGRATION_ID,
  PURGE_MIGRATION_ID,
  PURGE_BATCH_LIMIT,
  ANALYTICS_PURGE_SQL,
  analyticsPayloadLeaks,
  purgeLeakedAnalytics,
  invalidateOutstandingPasswordResets,
  runSecurityBoot,
  scheduleSecurityBoot,
};
