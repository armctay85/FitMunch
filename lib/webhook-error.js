'use strict';

/**
 * Webhook failures Stripe should retry, and failures it should not.
 * Logs elsewhere must pass only err.type and err.code.
 */

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '53300',
  '53400',
  '40001',
  '40P01',
  '55P03',
  '57014',
  'WEBHOOK_RETRY',
]);

const TRANSIENT_MESSAGES = [
  'Connection terminated unexpectedly',
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'canceling statement due to statement timeout',
];

function isStripeResourceMissing(err) {
  const code = String((err && (err.code || (err.raw && err.raw.code))) || '');
  return code === 'resource_missing';
}

function isTransientWebhookError(err, depth) {
  if (!err || (depth || 0) > 3) return false;
  const code = String(err.code || err.errno || '');
  if (code && TRANSIENT_CODES.has(code)) return true;
  const type = String(err.type || '');
  if (
    type === 'StripeConnectionError' ||
    type === 'StripeRateLimitError' ||
    type === 'StripeAuthenticationError' ||
    type === 'StripePermissionError'
  ) {
    return true;
  }
  const status = Number(err.statusCode || err.status || (err.raw && err.raw.statusCode));
  if (status === 401 || status === 403) return true;
  if (status >= 500) return true;
  const message = String(err.message || '');
  if (TRANSIENT_MESSAGES.some((part) => message.includes(part))) return true;
  // node-pg pool failures often have neither code nor errno.
  const stripeType = type.startsWith('Stripe');
  if (!err.code && !err.errno && !stripeType) {
    if (err.severity || err.routine || err.schema) return true;
    if (/pool|remaining connection|too many clients|Connection terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|client has encountered a connection error/i.test(message)) {
      return true;
    }
  }
  if (err.cause && isTransientWebhookError(err.cause, (depth || 0) + 1)) return true;
  if (Array.isArray(err.errors)) {
    for (const item of err.errors) {
      if (isTransientWebhookError(item, (depth || 0) + 1)) return true;
    }
  }
  return false;
}

/**
 * Re-reading Stripe during a webhook (subscription, invoice brand check).
 * Only these failures are permanent, so the event is acked and dropped:
 * the object is gone (resource_missing), or Stripe rejected the request
 * itself (4xx invalid request, which a retry cannot fix). Everything else,
 * including bugs such as a TypeError, is retried so an update is never
 * silently lost.
 */
function isPermanentStripeReadError(err) {
  if (!err || typeof err !== 'object') return false;
  if (isStripeResourceMissing(err)) {
    const status = Number(err.statusCode || err.status || (err.raw && err.raw.statusCode));
    return !(status >= 500);
  }
  const type = String(err.type || (err.raw && err.raw.type) || '');
  if (type !== 'StripeInvalidRequestError' && type !== 'invalid_request_error') return false;
  const status = Number(err.statusCode || err.status || (err.raw && err.raw.statusCode));
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 409 && status !== 429;
}

/**
 * Wrap a re-read failure that is not on the permanent allow-list so the
 * webhook answers 500 and Stripe retries it.
 */
function retryableReadError(err) {
  if (isPermanentStripeReadError(err)) return null;
  if (isTransientWebhookError(err)) return err;
  const wrapped = new Error('webhook re-read failed; retrying');
  wrapped.code = 'WEBHOOK_RETRY';
  wrapped.type = 'WebhookRetry';
  wrapped.cause = err;
  return wrapped;
}

function webhookErrorFields(err) {
  return [err && err.type, err && err.code];
}

module.exports = {
  isTransientWebhookError,
  isStripeResourceMissing,
  isPermanentStripeReadError,
  retryableReadError,
  webhookErrorFields,
};
