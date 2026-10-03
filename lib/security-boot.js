'use strict';

/**
 * Idempotent boot cleanup.
 * Purges analytics rows that stored a reset or token query.
 * Invalidates outstanding password reset tokens once, using a migration
 * marker so tokens issued after this deploy stay valid.
 */

const RESET_MIGRATION_ID = 'invalidate_outstanding_password_resets_20261003';

const ANALYTICS_PURGE_SQL = `
DELETE FROM analytics_events
WHERE COALESCE(event_data::text, '') LIKE '%reset=%'
   OR COALESCE(event_data::text, '') LIKE '%token=%'
   OR COALESCE(event_data->>'url', '') LIKE '%reset=%'
   OR COALESCE(event_data->>'path', '') LIKE '%reset=%'
   OR COALESCE(event_data->>'href', '') LIKE '%reset=%'
   OR COALESCE(event_data->>'referrer', '') LIKE '%reset=%'
   OR COALESCE(event_data->'properties'->>'url', '') LIKE '%reset=%'
   OR COALESCE(event_data->'properties'->>'path', '') LIKE '%reset=%'
   OR COALESCE(event_data->'properties'->>'referrer', '') LIKE '%reset=%'
   OR COALESCE(event_data->>'url', '') LIKE '%token=%'
   OR COALESCE(event_data->>'path', '') LIKE '%token=%'
   OR COALESCE(event_data->>'href', '') LIKE '%token=%'
   OR COALESCE(event_data->>'referrer', '') LIKE '%token=%'
   OR COALESCE(event_data->'properties'->>'url', '') LIKE '%token=%'
   OR COALESCE(event_data->'properties'->>'path', '') LIKE '%token=%'
   OR COALESCE(event_data->'properties'->>'referrer', '') LIKE '%token=%'
`.trim();

function analyticsPayloadLeaks(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value == null ? {} : value);
  return text.includes('reset=') || text.includes('token=');
}

function countOf(result) {
  if (!result) return 0;
  if (typeof result.rowCount === 'number') return result.rowCount;
  if (Array.isArray(result.rows)) return result.rows.length;
  return 0;
}

async function purgeLeakedAnalytics(query) {
  const result = await query(ANALYTICS_PURGE_SQL);
  const count = countOf(result);
  console.log('[db-migrate] purged analytics rows ' + count);
  return count;
}

async function invalidateOutstandingPasswordResets(query) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const marker = await query(
    `INSERT INTO schema_migrations (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, applied_at`,
    [RESET_MIGRATION_ID]
  );
  if (!marker || !marker.rows || !marker.rows.length) {
    console.log('[db-migrate] invalidated password reset tokens 0');
    return 0;
  }
  const appliedAt = marker.rows[0].applied_at || new Date();
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
}

async function runSecurityBoot(query) {
  const purged = await purgeLeakedAnalytics(query);
  const invalidated = await invalidateOutstandingPasswordResets(query);
  return { purged, invalidated };
}

module.exports = {
  RESET_MIGRATION_ID,
  ANALYTICS_PURGE_SQL,
  analyticsPayloadLeaks,
  purgeLeakedAnalytics,
  invalidateOutstandingPasswordResets,
  runSecurityBoot,
};
