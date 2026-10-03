'use strict';

const { isInternalLeak } = require('./public-error');

const STRIPE_ID = /\b(?:cus|cs|pi|sub|in|evt)_[A-Za-z0-9]+/;
const SECRET_OR_EMAIL = /sk_live_|sk_test_|rk_live_|rk_test_|whsec_|@/i;
const SAFE_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,40}$|^[0-9A-Z]{5}$/;

/**
 * Webhook handler failures log a name or a code only.
 * Query text, Stripe ids, secret-shaped labels, and email addresses stay out of the log line.
 */
function webhookHandlerErrorLabel(err) {
  if (!err || typeof err !== 'object') return 'Error';
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : null;
  const code = err.code || (cause && cause.code) || '';
  const name = err.name || err.type || (cause && (cause.name || cause.code)) || '';
  const raw = String(code || name || 'Error').trim() || 'Error';
  if (isInternalLeak(raw) || STRIPE_ID.test(raw) || raw.length > 80) return 'Error';
  if (SECRET_OR_EMAIL.test(raw) || !SAFE_LABEL.test(raw)) return 'Error';
  return raw;
}

module.exports = { webhookHandlerErrorLabel };
