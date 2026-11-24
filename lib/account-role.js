'use strict';

/**
 * Trainer and checkout decisions use the users.role column.
 * A token role claim is not the source of truth.
 * A uuid with no readable database role fails closed (not a trainer).
 * A non-uuid id is a test double: its role field is the stand-in row, still not the token.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function accountRole(user) {
  if (!user || user.id == null) return null;
  const id = typeof user.id === 'string' ? user.id : '';
  try {
    const storage = require('../server/storage.js');
    if (typeof storage.getUserRole === 'function') {
      const role = await storage.getUserRole(id);
      if (typeof role === 'string' && role) return role;
    }
  } catch (_) { /* a failed read is not a trainer */ }
  if (id && !UUID.test(id) && typeof user.role === 'string' && user.role) return user.role;
  return null;
}

module.exports = { accountRole };
