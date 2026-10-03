'use strict';

const { isInternalLeak } = require('./public-error');

const STRIPE_ID = /\b(?:cus|cs|pi|sub|in|evt)_[A-Za-z0-9]+/;

/**
 * Webhook handler failures log a name or a code only.
 * Query text and Stripe ids stay out of the log line.
 */
function webhookHandlerErrorLabel(err) {
  if (!err || typeof err !== 'object') return 'Error';
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : null;
  const code = err.code || (cause && cause.code) || '';
  const name = err.name || err.type || (cause && (cause.name || cause.code)) || '';
  const raw = String(code || name || 'Error').trim() || 'Error';
  if (isInternalLeak(raw) || STRIPE_ID.test(raw) || raw.length > 80) return 'Error';
  return raw;
}

module.exports = { webhookHandlerErrorLabel };
