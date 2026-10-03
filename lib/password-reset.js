'use strict';

const crypto = require('crypto');

/** Reset links expire within 60 minutes. */
const RESET_TTL_MS = 60 * 60 * 1000;

function resetExpiresAt(now) {
  return new Date((now instanceof Date ? now.getTime() : Date.now()) + RESET_TTL_MS);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function tokenHashesEqual(stored, computed) {
  if (typeof stored !== 'string' || typeof computed !== 'string') return false;
  const left = Buffer.from(stored);
  const right = Buffer.from(computed);
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function queryOf(queryable) {
  if (typeof queryable === 'function') return queryable;
  if (queryable && typeof queryable.query === 'function') {
    return (sql, params) => queryable.query(sql, params);
  }
  throw new Error('password reset query is not available');
}

/**
 * Claim a reset token once. The stored hash is compared in constant time.
 * A second call, or a token past its expiry, does not return a user id.
 */
async function consumePasswordReset(queryable, token, now = new Date()) {
  if (!token || typeof token !== 'string') return { ok: false };
  const query = queryOf(queryable);
  const tokenHash = hashResetToken(token);
  const found = await query(
    `SELECT id, user_id, token_hash, used, expires_at
     FROM password_resets
     WHERE token_hash = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash]
  );
  const row = found && found.rows && found.rows[0];
  if (!row || !tokenHashesEqual(row.token_hash, tokenHash)) return { ok: false };
  if (row.used === true) return { ok: false };
  const expiresMs = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) return { ok: false };
  const claimed = await query(
    `UPDATE password_resets
     SET used = TRUE
     WHERE id = $1 AND used = FALSE AND expires_at > $2
     RETURNING id, user_id`,
    [row.id, now]
  );
  const next = claimed && claimed.rows && claimed.rows[0];
  if (!next) return { ok: false };
  return { ok: true, id: next.id, userId: next.user_id };
}

function passwordResetUrl(token) {
  return 'https://www.fitmunch.com.au/login.html#reset=' + encodeURIComponent(String(token));
}

module.exports = {
  RESET_TTL_MS,
  resetExpiresAt,
  hashResetToken,
  tokenHashesEqual,
  consumePasswordReset,
  passwordResetUrl,
};
