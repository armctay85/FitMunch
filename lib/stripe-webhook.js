'use strict';

/**
 * FitMunch Stripe webhook dispatch.
 * Access is granted from the subscription Stripe has now, then duplicate
 * cleanup runs. A non-temporary cleanup failure is logged and does not
 * undo the grant. Callers own the HTTP status.
 */

const {
  LIVE_SUBSCRIPTION_STATUSES,
  PRICE_IDS,
  TRIAL_PERIOD_DAYS,
  checkoutSessionIsFitMunch,
  invoiceIsFitMunch,
  subscriptionMatchesAllowlist,
  subscriptionTierUpdateFromStripe,
  cancelNewerDuplicateSubscriptions,
  cancelNewerDuplicatesAcrossCustomers,
  customerStillHasLiveFitMunchSub,
  isCoachPlanName,
} = require('./fitmunch-checkout');
const { isTransientWebhookError, webhookErrorFields } = require('./webhook-error');
const { userForSubscriptionEvent } = require('./fitmunch-account-link');
const { mintGuestClaimToken } = require('./guest-claim');
const stripeEvents = require('./stripe-events');

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

function customerIdOf(sub) {
  if (!sub) return '';
  if (typeof sub.customer === 'string') return sub.customer;
  return sub.customer?.id || '';
}

async function subscriptionForEvent(stripe, sub) {
  if (!sub) return null;
  if (!sub.id || typeof stripe?.subscriptions?.retrieve !== 'function') return sub;
  try {
    const live = await stripe.subscriptions.retrieve(sub.id);
    return live || null;
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
    return null;
  }
}

function fallbackAccessSub(session, customerId) {
  const planId = session.metadata?.plan || '';
  const priceId = session.metadata?.priceId || PRICE_IDS[planId] || '';
  const periodEnd = Math.floor(Date.now() / 1000) + TRIAL_PERIOD_DAYS * 24 * 60 * 60;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || '';
  return {
    id: subId,
    customer: customerId,
    status: 'trialing',
    metadata: session.metadata || {},
    current_period_end: periodEnd,
    items: { data: [{ price: { id: priceId } }] },
  };
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

async function grantCheckoutAccess(stripe, session) {
  const customerId = sessionCustomerId(session);
  if (!customerId) return null;
  const user = await userForSubscriptionEvent(stripe, { customer: customerId });
  if (!user) return null;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || '';
  if (subId && typeof stripe?.subscriptions?.retrieve === 'function') {
    try {
      const live = await stripe.subscriptions.retrieve(subId);
      if (live) {
        await applySubscriptionUpdate(stripe, live, live);
        return user;
      }
    } catch (err) {
      if (isTransientWebhookError(err)) throw err;
      console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
      return user;
    }
  }
  const fallback = fallbackAccessSub(session, customerId);
  await applySubscriptionUpdate(stripe, fallback, fallback);
  return user;
}

async function runDuplicateCleanup(stripe, customerId, hintEmail, eventId, extraSubs) {
  if (!customerId) return;
  try {
    await cancelNewerDuplicateSubscriptions(stripe, customerId, extraSubs || [], eventId);
    await cancelNewerDuplicatesAcrossCustomers(stripe, customerId, hintEmail, eventId);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    console.error('[checkout] duplicate cleanup failed');
  }
}

function claimUrlForSession(session, customerId) {
  if (!session || !session.id || !customerId) return '';
  const token = mintGuestClaimToken({
    sessionId: session.id,
    customerId,
    sessionCreated: session.created,
  });
  if (!token) return '';
  return `https://www.fitmunch.com.au/login.html?claim=${encodeURIComponent(token)}`;
}

async function sendCheckoutWelcome(session, event, customerEmail, customerName, planLabel) {
  if (!customerEmail) return;
  const sendKey = session && session.id ? `session:${session.id}` : (event && event.id ? `event:${event.id}` : '');
  let already = false;
  try {
    already = await stripeEvents.welcomeAlreadySent(sendKey);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    already = false;
  }
  if (already) return;
  const emailApi = require('../server/email.js');
  const claimUrl = claimUrlForSession(session, sessionCustomerId(session));
  let result;
  try {
    result = claimUrl
      ? await emailApi.sendWelcomeEmail(customerEmail, customerName, planLabel, claimUrl)
      : await emailApi.sendWelcomeEmail(customerEmail, customerName, planLabel);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    console.error('[welcome] send failed');
    return;
  }
  if (!result || result.success !== true) {
    console.error('Welcome email failed');
    return;
  }
  try {
    await stripeEvents.markWelcomeSent(sendKey);
  } catch (_) {
    console.error('[welcome] sent marker failed');
  }
  console.log('Welcome email sent');
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
      await grantCheckoutAccess(stripe, session);
      if (customerId) await runDuplicateCleanup(stripe, customerId, customerEmail, event.id, []);
      console.log('Checkout completed');
      await sendCheckoutWelcome(session, event, customerEmail, customerName, planLabel);
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
      const snapshot = event.data.object;
      const live = await subscriptionForEvent(stripe, snapshot);
      if (live) await applySubscriptionUpdate(stripe, live, live);
      const customerId = customerIdOf(snapshot);
      const statusNow = live ? live.status : snapshot.status;
      const runDedupe = Boolean(customerId) && (
        event.type === 'customer.subscription.created' ||
        (event.type === 'customer.subscription.updated' && LIVE_SUBSCRIPTION_STATUSES.includes(statusNow))
      );
      if (runDedupe) {
        await runDuplicateCleanup(stripe, customerId, undefined, event.id, [live || snapshot]);
      }
      return;
    }
    case 'customer.subscription.deleted': {
      const snapshot = event.data.object;
      let sub = snapshot;
      if (snapshot && snapshot.id && typeof stripe?.subscriptions?.retrieve === 'function') {
        try {
          const live = await stripe.subscriptions.retrieve(snapshot.id);
          if (live && LIVE_SUBSCRIPTION_STATUSES.includes(live.status)) {
            console.log('FitMunch subscription cancel ignored; subscription is still live');
            return;
          }
          if (live) sub = live;
        } catch (err) {
          if (isTransientWebhookError(err)) throw err;
          console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
          sub = { ...snapshot, status: 'canceled' };
        }
      }
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
