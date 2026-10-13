'use strict';
/**
 * The one place the session JWT secret is read.
 *
 * - JWT_SECRET from the environment is the only secret ever used.
 * - Deployed (production or preview) without it: auth fails closed. No token
 *   is minted or accepted, the boot log says so, and /api/health is 503.
 * - Local runs without it get a random per-process secret, never a literal.
 * - Tokens are HS256 only, both ways.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { isDeployedEnv } = require('./guest-claim');

const ALGORITHM = 'HS256';
let devSecret = null;
let warned = false;

function configuredJwtSecret(env = process.env) {
  const raw = env.JWT_SECRET;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** '' when fine, 'missing' when a deployed environment has no JWT_SECRET. Never the value. */
function jwtSecretProblem(env = process.env) {
  if (!isDeployedEnv(env)) return '';
  return configuredJwtSecret(env) ? '' : 'missing';
}

/** The secret, or '' when auth must fail closed. */
function jwtSecret(env = process.env) {
  const configured = configuredJwtSecret(env);
  if (configured) return configured;
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
  return jwt.verify(token, secret, { algorithms: [ALGORITHM] });
}

/** jwt.sign with the configured secret and HS256. Throws when there is no secret. */
function signJwt(payload, options = {}) {
  const secret = jwtSecret();
  if (!secret) throw missingSecretError();
  return jwt.sign(payload, secret, { ...options, algorithm: ALGORITHM });
}

function warnMissingJwtSecret() {
  if (warned || !jwtSecretProblem()) return;
  warned = true;
  console.error('[auth] CONFIG ERROR: JWT_SECRET is not set. Sign-in and every signed-in route are refused until it is.');
}

module.exports = { ALGORITHM, jwtSecret, jwtSecretProblem, verifyJwt, signJwt, warnMissingJwtSecret };
