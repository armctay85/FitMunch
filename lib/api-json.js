/**
 * Consistent JSON error/success helpers (same shape as existing FitMunch API).
 * Pattern aligned with MentorMate-style structured API responses.
 */

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, error: message, ...extra });
}

function ok(res, body = {}) {
  return res.json({ success: true, ...body });
}

module.exports = { fail, ok };
