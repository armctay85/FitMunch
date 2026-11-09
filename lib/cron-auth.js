'use strict';

const crypto = require('crypto');

/**
 * Vercel Cron sends Authorization: Bearer ${CRON_SECRET}.
 * Hash both sides before timingSafeEqual so length never leaks and a
 * missing header takes the same compare as a wrong one.
 * Unset CRON_SECRET is 503. The route must not run open.
 */
function cronAuthStatus(authorizationHeader) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return 503;
  const expected = crypto.createHash('sha256').update(`Bearer ${secret}`, 'utf8').digest();
  const actual = crypto.createHash('sha256').update(String(authorizationHeader || ''), 'utf8').digest();
  if (!crypto.timingSafeEqual(expected, actual)) return 401;
  return 200;
}

module.exports = { cronAuthStatus };
