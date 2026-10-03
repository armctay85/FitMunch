'use strict';

/**
 * Client responses must not include database errors, SQL, stack traces,
 * or query parameters. Log the real error on the server and send a generic body.
 */

const GENERIC_API_ERROR = 'Internal server error';

function isInternalLeak(value) {
  const text = String(value || '');
  if (!text) return false;
  if (/failed query/i.test(text)) return true;
  if (/\bparams\s*:/i.test(text)) return true;
  if (/sqlstate/i.test(text)) return true;
  if (/invalid input syntax/i.test(text)) return true;
  if (/syntax error at or near/i.test(text)) return true;
  if (/duplicate key value/i.test(text)) return true;
  if (/violates\s+\w+\s+constraint/i.test(text)) return true;
  if (/relation\s+["']?[\w.]+["']?\s+does not exist/i.test(text)) return true;
  if (/column\s+["']?[\w.]+["']?\s+(does not exist|of relation)/i.test(text)) return true;
  if (/\binsert\s+into\s+["']?[\w.]+/i.test(text)) return true;
  if (/\bdelete\s+from\s+["']?[\w.]+/i.test(text)) return true;
  if (/\bupdate\s+["']?[\w."]+["']?\s+set\b/i.test(text)) return true;
  if (/\bselect\b[\s\S]{0,240}\bfrom\s+["']?[\w.]+/i.test(text)) return true;
  if (/\n\s*at\s+.+\.(?:js|mjs|cjs):\d+/.test(text)) return true;
  if (/\bat\s+\S+\.(?:js|mjs|cjs):\d+:\d+/.test(text)) return true;
  if (/password authentication failed/i.test(text)) return true;
  return false;
}

function sendApiError(res, err, label) {
  const where = label || 'API error';
  console.error(where, err);
  if (err && err.cause) console.error(where, 'cause:', err.cause);
  return res.status(500).json({ success: false, error: GENERIC_API_ERROR });
}

function publicClientError(value, fallback) {
  const text = value == null ? '' : String(value);
  if (!text || isInternalLeak(text)) return fallback;
  return text;
}

module.exports = {
  GENERIC_API_ERROR,
  isInternalLeak,
  sendApiError,
  publicClientError,
};
