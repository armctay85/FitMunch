'use strict';
/**
 * Verifies a session JWT. A token only counts as a login if it is a valid
 * HS256 JWT that names a user (userId) and carries no other purpose, so a
 * token minted for something else can never act as a session.
 */
const jwt = require('jsonwebtoken');

function verifySessionToken(token, secret) {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  const id = decoded && decoded.userId;
  if (!decoded || typeof decoded !== 'object' || id === undefined || id === null || String(id).trim() === '' || decoded.p) {
    throw Object.assign(new Error('not a session token'), { name: 'JsonWebTokenError' });
  }
  return decoded;
}

module.exports = { verifySessionToken };
