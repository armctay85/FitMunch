'use strict';
/**
 * The one place the session JWT secret is read.
 *
 * - JWT_SECRET from the environment is the only secret ever used.
 * - Deployed (production or preview) without it: auth fails closed. No token
 *   is minted or accepted, the boot log says so, and /api/health is 503.
 * - Local runs without it get a random per-process secret, never a literal.
 * - Tokens are HS256 only, both ways.
 * - A JWT_SECRET shorter than 32 characters is refused everywhere (fail closed).
 * - A token is only a session if it carries a userId.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { isDeployedEnv: isVercelOrProd } = require('./guest-claim');

// Hosting markers that mean "not a developer's machine" even without NODE_ENV.
const HOST_MARKERS = ['VERCEL', 'RAILWAY_ENVIRONMENT', 'RENDER', 'FLY_APP_NAME', 'K_SERVICE', 'DYNO', 'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV'];
/**
 * Local only when NODE_ENV is explicitly development or test and no hosting
 * marker is set. Every other host is treated as deployed, so a server started
 * without NODE_ENV fails closed instead of minting per-instance secrets.
 */
function isDeployedEnv(env = process.env) {
  if (isVercelOrProd(env)) return true;
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return true;
  return HOST_MARKERS.some((k) => String(env[k] || '').trim() !== '');
}

const ALGORITHM = 'HS256';
const MIN_SECRET_LENGTH = 32;
// Known defaults and test values, stored as SHA-256 so no literal sits in the
// source. A JWT_SECRET equal to any of them is refused like a missing one.
const DENIED_SECRET_SHA256 = new Set([
  '7647a03cf5b6ff63223c669e3b5629c8d25f2a0b901e83950e81d25ccdbadb4d',
  'e02fea575981c1ca1e050cee1baa785370f24938d311819af8e4f8e4a487e363',
  '38c6df323c8b68ba003d4195df6d578148c02c9356e10a2d448d7e67add67338',
  '2a19eb0f81978335266c848adc2fb7aae6da22a66e94f83041a3cdafb6bf13f6',
  '3da5ba84fa96aec0a18a9808b7393cae51683876df0cd47c476c9a60076ab05e',
  // The fixed secret jest.setup.js used to set (public in this repo).
  '455f2ef0ac8b78c8ea57243646f10b5bd754702f323e53d2a0d8b69dc5b60136',
]);
function isDeniedSecret(value) {
  const h = crypto.createHash('sha256').update(String(value)).digest('hex');
  return DENIED_SECRET_SHA256.has(h) || /^(secret|changeme|password|dev|test|jwt[-_]?secret)$/i.test(value);
}
let devSecret = null;
let warned = false;

function configuredJwtSecret(env = process.env) {
  const raw = env.JWT_SECRET;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * '' when fine; 'too_short' when JWT_SECRET is set but under 32 characters
 * (anywhere); 'missing' when a deployed environment has none. Never the value.
 */
function jwtSecretProblem(env = process.env) {
  const configured = configuredJwtSecret(env);
  if (configured && (configured.length < MIN_SECRET_LENGTH || isDeniedSecret(configured))) return 'too_short';
  if (!isDeployedEnv(env)) return '';
  return configured ? '' : 'missing';
}

/** The secret, or '' when auth must fail closed. */
function jwtSecret(env = process.env) {
  const configured = configuredJwtSecret(env);
  if (configured) return configured.length >= MIN_SECRET_LENGTH && !isDeniedSecret(configured) ? configured : '';
  if (isDeployedEnv(env)) return '';
  if (!devSecret) devSecret = crypto.randomBytes(32).toString('base64url');
  return devSecret;
}

function missingSecretError() {
  return Object.assign(new Error('session signing is not configured'), { name: 'JsonWebTokenError', code: 'JWT_SECRET_MISSING' });
}

/** jwt.verify with the configured secret and HS256 only. Throws when there is no secret. */
function verifyJwt(token) {
  const secret = jwtSecret();
  if (!secret) throw missingSecretError();
  const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  // Only session tokens carry a userId. Anything else is not a login.
  const id = payload && typeof payload === 'object' ? payload.userId : undefined;
  if (!((typeof id === 'string' && id.trim()) || (typeof id === 'number' && Number.isFinite(id)))) {
    throw Object.assign(new Error('token has no user'), { name: 'JsonWebTokenError', code: 'JWT_NO_USER' });
  }
  return payload;
}

/** jwt.sign with the configured secret and HS256. Throws when there is no secret. */
function signJwt(payload, options = {}) {
  const secret = jwtSecret();
  if (!secret) throw missingSecretError();
  return jwt.sign(payload, secret, { ...options, algorithm: ALGORITHM });
}

function warnMissingJwtSecret() {
  const problem = jwtSecretProblem();
  if (warned || !problem) return;
  warned = true;
  console.error(problem === 'too_short'
    ? `[auth] CONFIG ERROR: JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Sign-in and every signed-in route are refused until it is replaced.`
    : '[auth] CONFIG ERROR: JWT_SECRET is not set. Sign-in and every signed-in route are refused until it is.');
}

module.exports = { ALGORITHM, MIN_SECRET_LENGTH, isDeployedEnv, jwtSecret, jwtSecretProblem, verifyJwt, signJwt, warnMissingJwtSecret };
