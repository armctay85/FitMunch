'use strict';

/**
 * Link a FitMunch Stripe customer to a user only when the customer id is
 * already on the user, or when a logged-in user redeems a guest claim token.
 * Email is never enough.
 */

const { and, eq, isNull } = require('drizzle-orm');
const { isTransientWebhookError } = require('./webhook-error');
const { subscriptionTierUpdateFromStripe } = require('./fitmunch-checkout');

function hasCustomerId(user) {
  return Boolean(user && String(user.stripeCustomerId || '').trim());
}

/**
 * Set the customer id only while the account has none. Two concurrent
 * redeems for one user cannot both win: the loser updates 0 rows and is told
 * the account is already linked to different billing.
 * Returns true when this call stored the id.
 */
async function persistStripeCustomerId(storage, user, customerId) {
  const users = storage.schema.users;
  const query = storage.db.update(users)
    .set({ stripeCustomerId: customerId, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), isNull(users.stripeCustomerId)));
  const result = query && typeof query.returning === 'function'
    ? await query.returning({ id: users.id })
    : await query;
  let stored = true; // a driver with no row count still applied the IS NULL guard
  if (Array.isArray(result)) stored = result.length > 0;
  else if (result && typeof result.rowCount === 'number') stored = result.rowCount > 0;
  if (!stored) return false;
  user.stripeCustomerId = customerId;
  return true;
}

async function provisionFromSubscription(storage, user, sub) {
  const { isCoachSubscription, coachTierUpdateFromStripe } = require('./fitmunch-coach-billing');
  if (isCoachSubscription(sub)) {
    const coachUpdate = coachTierUpdateFromStripe(sub);
    const saved = await storage.updateUserCoachBilling(user.id, coachUpdate, user.settings);
    user.settings = { ...(user.settings || {}), coach: saved || coachUpdate };
    return { coach: saved || coachUpdate };
  }
  const { tier, expiresAt } = subscriptionTierUpdateFromStripe(sub);
  await storage.updateUserSubscription(user.id, tier, expiresAt);
  user.subscriptionTier = tier;
  user.subscriptionExpiresAt = expiresAt;
  return { tier, expiresAt };
}

async function freshUser(storage, user) {
  if (!user || typeof storage.getUserById !== 'function') return user;
  try {
    const fresh = await storage.getUserById(user.id);
    return fresh || user;
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    return user;
  }
}

/**
 * Subscription webhooks. Customer id only. No email fallback.
 */
async function userForSubscriptionEvent(_stripe, sub) {
  const storage = require('../server/storage.js');
  const customerId = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
  if (!customerId || !storage.db || !storage.schema?.users) return null;
  const rows = await storage.db.select().from(storage.schema.users).where(
    eq(storage.schema.users.stripeCustomerId, customerId)
  );
  if (rows && rows[0]) return rows[0];
  return null;
}

async function usersHoldingStripeCustomer(customerId) {
  const storage = require('../server/storage.js');
  if (!customerId || !storage.db || typeof storage.db.select !== 'function' || !storage.schema?.users) {
    return [];
  }
  const rows = await storage.db.select().from(storage.schema.users).where(
    eq(storage.schema.users.stripeCustomerId, customerId)
  );
  if (!Array.isArray(rows)) {
    const err = new Error('customer lookup failed');
    err.code = '08006';
    throw err;
  }
  return rows.filter(Boolean);
}

/**
 * Attach customerId to a logged-in user after a claim token has been checked.
 * Refuses when any other user already holds that Stripe customer.
 * Refuses to replace a different customer id already stored on the account.
 */
async function linkUserToStripeCustomer(user, customerId, sub) {
  const storage = require('../server/storage.js');
  if (!user || !customerId) return { linked: false, user, reason: 'missing' };
  const current = await freshUser(storage, user);
  const holders = await usersHoldingStripeCustomer(customerId);
  const others = holders.filter((row) => row && row.id && String(row.id) !== String(current.id));
  if (others.length) return { linked: false, user: current, reason: 'owned-by-other' };
  const selfHolds = holders.some((row) => row && String(row.id) === String(current.id))
    || (hasCustomerId(current) && current.stripeCustomerId === customerId);
  if (selfHolds) return { linked: true, alreadyAttached: true, user: current };
  if (hasCustomerId(current) && current.stripeCustomerId !== customerId) {
    return { linked: false, user: current, reason: 'different-customer' };
  }
  if (!hasCustomerId(current)) {
    try {
      const stored = await persistStripeCustomerId(storage, current, customerId);
      if (!stored) {
        const latest = await freshUser(storage, current);
        if (latest && latest.stripeCustomerId === customerId) {
          return { linked: true, alreadyAttached: true, user: latest };
        }
        return { linked: false, user: latest || current, reason: 'different-customer' };
      }
    } catch (err) {
      if (isTransientWebhookError(err)) throw err;
      const code = String(err && err.code || '');
      if (code === '23505' || /unique|duplicate key/i.test(String(err && err.message || ''))) {
        return { linked: false, user: current, reason: 'owned-by-other' };
      }
      throw err;
    }
  }
  if (sub) await provisionFromSubscription(storage, current, sub);
  user.stripeCustomerId = current.stripeCustomerId;
  user.subscriptionTier = current.subscriptionTier;
  user.subscriptionExpiresAt = current.subscriptionExpiresAt;
  user.settings = current.settings;
  return { linked: true, user: current };
}

module.exports = {
  usersHoldingStripeCustomer,
  userForSubscriptionEvent,
  linkUserToStripeCustomer,
};
