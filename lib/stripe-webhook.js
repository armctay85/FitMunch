'use strict';

/**
 * FitMunch Stripe webhook dispatch.
 * Callers own the HTTP status. This module throws transient errors and
 * returns after non-retryable Stripe problems have been swallowed by the caller.
 */

const {
  LIVE_SUBSCRIPTION_STATUSES,
  PRICE_IDS,
  checkoutSessionIsFitMunch,
  invoiceIsFitMunch,
  subscriptionMatchesAllowlist,
  subscriptionTierUpdateFromStripe,
  cancelNewerDuplicateSubscriptions,
  cancelNewerDuplicatesAcrossCustomers,
  customerStillHasLiveFitMunchSub,
  isCoachPlanName,
} = require('./fitmunch-checkout');
const { isTransientWebhookError } = require('./webhook-error');
const { userForSubscriptionEvent } = require('./fitmunch-account-link');

async function invoiceBelongsToFitMunch(stripe, invoice) {
  if (invoiceIsFitMunch(invoice)) return true;
  const subscription = invoice && invoice.subscription;
  if (subscription && typeof subscription === 'object' && subscriptionMatchesAllowlist(subscription)) {
    return true;
  }
  const subscriptionId = typeof subscription === 'string' ? subscription : '';
  if (!subscriptionId || typeof stripe?.subscriptions?.retrieve !== 'function') return false;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return subscriptionMatchesAllowlist(sub);
}

async function eventIsFitMunch(event, stripe) {
  const object = event?.data?.object || {};
  const type = event?.type || '';
  if (type === 'checkout.session.completed') return checkoutSessionIsFitMunch(object);
  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
    return subscriptionMatchesAllowlist(object);
  }
  if (typeof type === 'string' && type.startsWith('invoice.')) {
    return invoiceBelongsToFitMunch(stripe, object);
  }
  return false;
}

function sessionCustomerId(session) {
  if (!session) return '';
  if (typeof session.customer === 'string') return session.customer;
  return session.customer?.id || '';
}

async function grantCheckoutAccess(session) {
  const storage = require('../server/storage.js');
  const { eq } = require('drizzle-orm');
  const customerId = sessionCustomerId(session);
  if (!customerId || !storage.db || !storage.schema?.users) return null;
  const rows = await storage.db.select().from(storage.schema.users).where(
    eq(storage.schema.users.stripeCustomerId, customerId)
  );
  const user = rows && rows[0];
  if (!user) return null;
  const planId = session.metadata?.plan || '';
  const priceId = session.metadata?.priceId || PRICE_IDS[planId] || '';
  if (isCoachPlanName(planId)) {
    const { coachTierUpdateFromStripe } = require('./fitmunch-coach-billing');
    const coachUpdate = coachTierUpdateFromStripe({
      id: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
      status: 'trialing',
      metadata: session.metadata || {},
      items: { data: [{ price: { id: priceId } }] },
    });
    await storage.updateUserCoachBilling(user.id, coachUpdate, user.settings);
    return user;
  }
  const { tier, expiresAt } = subscriptionTierUpdateFromStripe({
    status: 'trialing',
    items: { data: [{ price: { id: priceId } }] },
  });
  await storage.updateUserSubscription(user.id, tier, expiresAt);
  return user;
}

async function applySubscriptionUpdate(stripe, sub, tierSource) {
  const storage = require('../server/storage.js');
  const user = await userForSubscriptionEvent(stripe, sub.customer ? { ...tierSource, customer: sub.customer } : tierSource);
  const { isCoachSubscription, coachTierUpdateFromStripe } = require('./fitmunch-coach-billing');
  if (isCoachSubscription(tierSource)) {
    const coachUpdate = coachTierUpdateFromStripe(tierSource);
    if (user) await storage.updateUserCoachBilling(user.id, coachUpdate, user.settings);
    console.log('Coach subscription updated');
    return;
  }
  const { tier, expiresAt } = subscriptionTierUpdateFromStripe(tierSource);
  if (user) {
    await storage.updateUserSubscription(user.id, tier, expiresAt);
    if (tier === 'free' && storage.effectiveTier({ ...user, subscriptionTier: 'free' }) === 'premium') {
      console.log('[comp] premium comp remains after Stripe set the tier to free');
    }
  }
  console.log('FitMunch subscription updated');
}

async function dispatchStripeEvent(event, stripe) {
  const storage = require('../server/storage.js');
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.metadata?.email;
      const customerName = session.customer_details?.name || '';
      const planId = session.metadata?.plan || '';
      const planLabels = { 'pt-starter': 'Starter', 'pt-pro': 'Pro', 'premium': 'Premium' };
      const planLabel = planLabels[planId] || planId || 'PT';
      const customerId = sessionCustomerId(session);
      if (customerId) {
        await cancelNewerDuplicateSubscriptions(stripe, customerId, [], event.id);
        await cancelNewerDuplicatesAcrossCustomers(stripe, customerId, customerEmail, event.id);
      }
      console.log('Checkout completed');
      await grantCheckoutAccess(session);
      if (customerEmail) {
        const emailApi = require('../server/email.js');
        const result = await emailApi.sendWelcomeEmail(customerEmail, customerName, planLabel);
        if (!result || result.success !== true) console.error('Welcome email failed');
        else console.log('Welcome email sent');
      }
      try {
        if (!isCoachPlanName(planId)) {
          const { scheduleFunnelEvent, trialStartedFromCheckoutSession } = require('./funnel-events');
          scheduleFunnelEvent(
            trialStartedFromCheckoutSession(session, 'webhook'),
            event && event.id ? `trial:${event.id}` : ''
          );
        }
      } catch (_) {
        /* funnel log must not change the webhook response */
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      let tierSource = sub;
      const liveNow = LIVE_SUBSCRIPTION_STATUSES.includes(sub.status);
      const runDedupe = Boolean(sub.customer) && (
        event.type === 'customer.subscription.created' ||
        (event.type === 'customer.subscription.updated' && liveNow)
      );
      if (runDedupe) {
        const deduped = await cancelNewerDuplicateSubscriptions(stripe, sub.customer, [sub], event.id);
        if (deduped.kept) tierSource = deduped.kept;
        const across = await cancelNewerDuplicatesAcrossCustomers(stripe, sub.customer, undefined, event.id);
        const eventCancelled = (across.cancelled || []).some((row) => row.id === sub.id);
        if (eventCancelled && across.kept) tierSource = across.kept;
      }
      await applySubscriptionUpdate(stripe, sub, tierSource);
      return;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = await userForSubscriptionEvent(stripe, sub);
      const {
        isCoachSubscription,
        coachTierUpdateFromStripe,
        customerStillHasLiveCoachSub,
      } = require('./fitmunch-coach-billing');
      if (isCoachSubscription(sub)) {
        const stillCoach = sub.customer
          ? await customerStillHasLiveCoachSub(stripe, sub.customer, sub.id)
          : false;
        if (user && !stillCoach) {
          const coachUpdate = coachTierUpdateFromStripe({ ...sub, status: 'canceled' });
          await storage.updateUserCoachBilling(user.id, coachUpdate, user.settings);
        }
        if (stillCoach) console.warn('[coach] ignored cancel; a live Coach subscription remains');
        else console.log('Coach subscription cancelled');
        return;
      }
      const stillLive = sub.customer
        ? await customerStillHasLiveFitMunchSub(stripe, sub.customer, sub.id)
        : false;
      if (user && !stillLive) {
        await storage.updateUserSubscription(user.id, 'free', null);
        if (storage.effectiveTier({ ...user, subscriptionTier: 'free' }) === 'premium') {
          console.log('[comp] premium comp remains after Stripe set the tier to free');
        }
      }
      if (stillLive) console.warn('[checkout] ignored cancel; a live FitMunch subscription remains');
      else console.log('FitMunch subscription cancelled');
      return;
    }
    case 'invoice.payment_failed':
      console.warn('Payment failed');
      return;
    default:
      return;
  }
}

function rethrowIfTransient(err) {
  if (isTransientWebhookError(err)) throw err;
}

module.exports = {
  eventIsFitMunch,
  dispatchStripeEvent,
  invoiceBelongsToFitMunch,
  rethrowIfTransient,
};
