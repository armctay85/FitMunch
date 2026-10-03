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
]);

function isTransientWebhookError(err) {
  if (!err) return false;
  const code = String(err.code || err.errno || '');
  if (TRANSIENT_CODES.has(code)) return true;
  const type = String(err.type || '');
  if (type === 'StripeConnectionError' || type === 'StripeRateLimitError') return true;
  const status = Number(err.statusCode || err.status);
  if (type === 'StripeAPIError' && status >= 500) return true;
  return false;
}

function webhookErrorFields(err) {
  return [err && err.type, err && err.code];
}

module.exports = {
  isTransientWebhookError,
  webhookErrorFields,
};
