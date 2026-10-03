'use strict';

/**
 * Link a guest FitMunch Stripe customer to a user account.
 * Matches email exactly, case-insensitive. Never links Wipper or Estimate,
 * and never replaces a stripe customer id that is already set.
 */

const { eq } = require('drizzle-orm');
const { isTransientWebhookError } = require('./webhook-error');
const {
  LIVE_SUBSCRIPTION_STATUSES,
  subscriptionMatchesAllowlist,
  subscriptionTierUpdateFromStripe,
  listCustomerSubscriptions,
  listCustomersWithEmail,
  normalizeEmail,
} = require('./fitmunch-checkout');

let stripeGetter = () => null;

function useStripeClient(getter) {
  stripeGetter = typeof getter === 'function' ? getter : () => getter;
}

function currentStripe() {
  try {
    return stripeGetter() || null;
  } catch (_) {
    return null;
  }
}

function isForeignBrandCustomer(customer) {
  const meta = (customer && customer.metadata) || {};
  const blob = [meta.brand, meta.app, meta.product, meta.plan].map((part) => String(part || '').toLowerCase()).join(' ');
  return /wipper|estimate/.test(blob);
}

function hasCustomerId(user) {
  return Boolean(user && String(user.stripeCustomerId || '').trim());
}

async function persistStripeCustomerId(storage, user, customerId) {
  await storage.db.update(storage.schema.users)
    .set({ stripeCustomerId: customerId, updatedAt: new Date() })
    .where(eq(storage.schema.users.id, user.id));
  user.stripeCustomerId = customerId;
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

async function findLinkableFitMunchCustomer(stripe, email) {
  const customers = await listCustomersWithEmail(stripe, email);
  const matches = [];
  for (const customer of customers) {
    if (!customer || isForeignBrandCustomer(customer)) continue;
    const subs = await listCustomerSubscriptions(stripe, customer.id);
    const live = (subs || []).filter((sub) =>
      sub &&
      LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) &&
      subscriptionMatchesAllowlist(sub)
    );
    if (!live.length) continue;
    live.sort((a, b) => (a.created || 0) - (b.created || 0));
    matches.push({ customer, sub: live[0], created: live[0].created || 0 });
  }
  matches.sort((a, b) => a.created - b.created || String(a.customer.id).localeCompare(String(b.customer.id)));
  return matches[0] || null;
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
 * Signup, login, and sync. Does not create a Stripe customer.
 */
async function attachGuestBilling(user) {
  const stripe = currentStripe();
  const storage = require('../server/storage.js');
  if (!user) return { linked: false, user };
  const current = await freshUser(storage, user);
  if (hasCustomerId(current)) return { linked: false, user: current, reason: 'already-linked' };
  if (!stripe) return { linked: false, user: current };
  const email = normalizeEmail(current.email);
  if (!email) return { linked: false, user: current };
  const match = await findLinkableFitMunchCustomer(stripe, email);
  if (!match) return { linked: false, user: current };
  const again = await freshUser(storage, current);
  if (hasCustomerId(again) && again.stripeCustomerId !== match.customer.id) {
    return { linked: false, user: again, reason: 'already-linked' };
  }
  if (!hasCustomerId(again)) {
    await persistStripeCustomerId(storage, again, match.customer.id);
    current.stripeCustomerId = again.stripeCustomerId;
    user.stripeCustomerId = again.stripeCustomerId;
  }
  await provisionFromSubscription(storage, again, match.sub);
  user.subscriptionTier = again.subscriptionTier;
  user.subscriptionExpiresAt = again.subscriptionExpiresAt;
  user.settings = again.settings;
  user.stripeCustomerId = again.stripeCustomerId;
  return { linked: true, user: again };
}

/**
 * Subscription webhooks. Customer-id match first. Otherwise the Stripe
 * customer's email, and only when that user has no customer id yet.
 */
async function userForSubscriptionEvent(stripe, sub) {
  const storage = require('../server/storage.js');
  const customerId = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
  if (!customerId || !storage.db || !storage.schema?.users) return null;
  const rows = await storage.db.select().from(storage.schema.users).where(
    eq(storage.schema.users.stripeCustomerId, customerId)
  );
  if (rows && rows[0]) return rows[0];
  if (typeof stripe?.customers?.retrieve !== 'function') return null;
  let customer = null;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    return null;
  }
  if (!customer || customer.deleted || isForeignBrandCustomer(customer)) return null;
  const email = normalizeEmail(customer.email);
  if (!email || typeof storage.findUserByNormalizedEmail !== 'function') return null;
  const user = await storage.findUserByNormalizedEmail(email);
  if (!user) return null;
  if (hasCustomerId(user) && user.stripeCustomerId !== customerId) return null;
  if (!hasCustomerId(user)) await persistStripeCustomerId(storage, user, customerId);
  return user;
}

module.exports = {
  useStripeClient,
  attachGuestBilling,
  userForSubscriptionEvent,
  findLinkableFitMunchCustomer,
  isForeignBrandCustomer,
};
