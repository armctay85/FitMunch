'use strict';

/** SSL for hosted Postgres. Local and explicit disable stay plain TCP. */
function sslFor(connectionString) {
  const value = String(connectionString || '');
  if (!value) return false;
  if (/localhost|127\.0\.0\.1|sslmode=disable/i.test(value)) return false;
  return { rejectUnauthorized: false };
}

module.exports = { sslFor };
