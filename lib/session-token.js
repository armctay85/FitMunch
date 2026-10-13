'use strict';
/**
 * Verifies a session JWT. A token only counts as a login if it passes
 * verifyJwt (JWT_SECRET only, HS256 only, fail closed, userId required) and
 * carries no other purpose field, so a token minted for something else can
 * never act as a session. No call site passes a secret.
 */
const { verifyJwt } = require('./jwt-secret');

function verifySessionToken(token) {
  const decoded = verifyJwt(token);
  const id = decoded && decoded.userId;
  if (!decoded || typeof decoded !== 'object' || id === undefined || id === null || String(id).trim() === '' || decoded.p !== undefined || decoded.purpose !== undefined) {
    throw Object.assign(new Error('not a session token'), { name: 'JsonWebTokenError' });
  }
  return decoded;
}

module.exports = { verifySessionToken };
