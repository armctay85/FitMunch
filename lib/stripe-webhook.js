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
const {
  isTransientWebhookError,
  isStripeResourceMissing,
  retryableReadError,
  webhookErrorFields,
} = require('./webhook-error');
const { userForSubscriptionEvent } = require('./fitmunch-account-link');
const { mintGuestClaimToken, sessionLoggedInUserId, claimUrlForToken } = require('./guest-claim');
const stripeEvents = require('./stripe-events');

async function invoiceBelongsToFitMunch(stripe, invoice) {
  if (invoiceIsFitMunch(invoice)) return true;
  const subscription = invoice && invoice.subscription;
  if (subscription && typeof subscription === 'object' && subscriptionMatchesAllowlist(subscription)) {
    return true;
  }
  const subscriptionId = typeof subscription === 'string' ? subscription : '';
  if (!subscriptionId || typeof stripe?.subscriptions?.retrieve !== 'function') return false;
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error('[webhook] invoice subscription retrieve failed', ...webhookErrorFields(err));
    const retry = retryableReadError(err);
    if (retry) throw retry;
    return false;
  }
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
    console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
    // Retry by default. Only an allow-listed permanent error is acked.
    const retry = retryableReadError(err);
    if (retry) throw retry;
    return null;
  }
}

function fallbackAccessSub(session, customerId) {
  const planId = session.metadata?.plan || '';
  const priceId = session.metadata?.priceId || (typeof planId === 'string' && Object.hasOwn(PRICE_IDS, planId) ? PRICE_IDS[planId] : '') || '';
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
      console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
      const retry = retryableReadError(err);
      if (retry) throw retry;
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
  if (sessionLoggedInUserId(session)) return '';
  const token = mintGuestClaimToken({ sessionId: session.id, customerId });
  if (!token) return '';
  return claimUrlForToken(token);
}

async function guestClaimUrl(stripe, session) {
  const customerId = sessionCustomerId(session);
  if (!customerId || sessionLoggedInUserId(session)) return '';
  try {
    const holder = await userForSubscriptionEvent(stripe, { customer: customerId });
    if (holder) return '';
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    return '';
  }
  return claimUrlForSession(session, customerId);
}

async function sendCheckoutWelcome(stripe, session, event, customerEmail, customerName, planLabel, opts = {}) {
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
  const claimUrl = await guestClaimUrl(stripe, session);
  let result;
  try {
    // trial '0': this email had used its trial, so Checkout charged today.
    // trialEnded: a repeat card ended the trial in this webhook (QA r2 M1).
    const trial = !(session?.metadata?.trial === '0') && !opts.trialEnded;
    result = await emailApi.sendWelcomeEmail(customerEmail, customerName, planLabel, claimUrl || undefined, {
      trial,
      trialEnded: Boolean(opts.trialEnded),
    });
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

// Elite QA PR 78 M1: the same card cannot start a second FitMunch trial on
// a new customer. Never fails the webhook; logs a fixed label only.
async function endReusedCardTrial(stripe, session, planId) {
  if (isCoachPlanName(planId)) return false;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId || !stripe?.subscriptions?.retrieve) return false;
  try {
    const sub = await stripe.subscriptions.retrieve(subId, { expand: ['default_payment_method'] });
    const { endTrialIfCardReused } = require('./trial-guard');
    const ended = await endTrialIfCardReused(stripe, sub);
    if (ended) console.log('[trial-guard] repeat card: trial ended now');
    return ended;
  } catch (_) {
    console.error('[trial-guard] card check failed');
    return false;
  }
}

function invoiceCustomerId(invoice) {
  if (!invoice) return '';
  if (typeof invoice.customer === 'string') return invoice.customer;
  return (invoice.customer && invoice.customer.id) || '';
}

function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!email || !email.includes('@')) return '';
  return email;
}

function invoiceCustomerEmail(invoice) {
  if (!invoice) return '';
  const direct = cleanEmail(invoice.customer_email);
  if (direct) return direct;
  if (invoice.customer && typeof invoice.customer === 'object') return cleanEmail(invoice.customer.email);
  return '';
}

// Stripe sets next_payment_attempt (unix seconds) when the retry schedule
// will try this invoice again, and leaves it null after the final attempt.
function stripeWillRetryInvoice(invoice) {
  const next = invoice && invoice.next_payment_attempt;
  return typeof next === 'number' && Number.isFinite(next) && next > 0;
}

// Paid access in this app is only active or trialing. past_due is stored
// as free, so a Stripe retry does not keep access unless the live
// subscription is still one of those two statuses.
function subscriptionStillGrantsAccess(subscription) {
  const status = subscription && subscription.status;
  return status === 'active' || status === 'trialing';
}

function paymentFailedCustomerFlags(invoice, subscription) {
  const willRetry = stripeWillRetryInvoice(invoice);
  return {
    willRetry,
    accessContinues: willRetry && subscriptionStillGrantsAccess(subscription),
  };
}

function paymentFailedSendKey(event, invoice, who) {
  const invoiceId = invoice && invoice.id ? String(invoice.id) : '';
  const hasAttempt = Boolean(invoice) && invoice.attempt_count != null && invoice.attempt_count !== '';
  const eventId = event && event.id ? String(event.id) : '';
  let basis = '';
  if (invoiceId && hasAttempt) basis = `${invoiceId}:${invoice.attempt_count}`;
  else if (eventId) basis = `event:${eventId}`;
  else if (invoiceId) basis = invoiceId;
  if (!basis || !who) return '';
  return `payment_failed:${basis}:${who}`;
}

function ownerAlertRecipients() {
  return String(process.env.ALERT_EMAIL_TO || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function failureFromEmailResult(result) {
  const message = String((result && result.error) || '');
  const err = new Error('payment failed email was not sent');
  const match = /Resend error:\s*(\d+)/.exec(message);
  if (match) {
    const status = Number(match[1]);
    err.statusCode = status;
    if (status === 429 || status >= 500 || status === 401 || status === 403) err.code = 'WEBHOOK_RETRY';
  } else if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|ENOTFOUND|fetch failed|socket hang up/i.test(message)) {
    err.code = 'WEBHOOK_RETRY';
  }
  return err;
}

async function releaseNotificationClaim(sendKey) {
  try {
    await stripeEvents.releaseNotificationSend(sendKey);
  } catch (err) {
    console.error('[payment-failed] send claim release failed');
    rethrowIfTransient(err);
  }
}

async function runEmailSend(send) {
  try {
    const result = await send();
    if (result && result.success === true) return { ok: true };
    return { ok: false, err: failureFromEmailResult(result) };
  } catch (err) {
    return { ok: false, err };
  }
}

async function deliverPaymentNotice(sendKey, send) {
  if (sendKey) {
    const claim = await stripeEvents.claimNotificationSend(sendKey);
    if (!claim.claimed) {
      // already is only a row marked sent. A fresh pending claim is still
      // in flight, or a release that never landed. Answer 500 so Stripe
      // comes back. claimNotificationSend already took over a stale pending row.
      if (claim.sent) return 'already';
      const err = new Error('payment notice is still in progress');
      err.code = 'WEBHOOK_RETRY';
      throw err;
    }
  }
  const outcome = await runEmailSend(send);
  if (outcome.ok) {
    if (sendKey) await stripeEvents.markNotificationSent(sendKey);
    return 'sent';
  }
  if (sendKey) await releaseNotificationClaim(sendKey);
  rethrowIfTransient(outcome.err);
  console.error('[payment-failed] send failed');
  return 'failed';
}

async function subscriptionForPaymentFailure(stripe, invoice) {
  const embedded = invoice && invoice.subscription && typeof invoice.subscription === 'object'
    ? invoice.subscription
    : null;
  const subscriptionId = typeof invoice?.subscription === 'string'
    ? invoice.subscription
    : (embedded && embedded.id) || '';
  if (!subscriptionId || typeof stripe?.subscriptions?.retrieve !== 'function') return embedded;
  try {
    const live = await stripe.subscriptions.retrieve(subscriptionId);
    return live || embedded;
  } catch (err) {
    console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
    const retry = retryableReadError(err);
    if (retry) throw retry;
    return embedded;
  }
}

async function customerEmailForInvoice(stripe, invoice) {
  const direct = invoiceCustomerEmail(invoice);
  if (direct) return direct;
  const customerId = invoiceCustomerId(invoice);
  if (!customerId || typeof stripe?.customers?.retrieve !== 'function') return '';
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return cleanEmail(customer && customer.email);
  } catch (err) {
    console.error('[webhook] customer retrieve failed', ...webhookErrorFields(err));
    const retry = retryableReadError(err);
    if (retry) throw retry;
    return '';
  }
}

async function notifyPaymentFailed(event, stripe) {
  const invoice = (event && event.data && event.data.object) || {};
  const subscription = await subscriptionForPaymentFailure(stripe, invoice);
  const flags = paymentFailedCustomerFlags(invoice, subscription);
  const customerEmail = await customerEmailForInvoice(stripe, invoice);
  const emailApi = require('../server/email.js');
  let customerNotified = false;

  if (!customerEmail) {
    console.warn('[payment-failed] customer email skipped: no address on the invoice');
  } else {
    const outcome = await deliverPaymentNotice(
      paymentFailedSendKey(event, invoice, 'customer'),
      () => emailApi.sendPaymentFailedEmail(customerEmail, flags)
    );
    // already means a previous attempt marked the row sent. A pending claim
    // throws above and does not count as an email the customer received.
    customerNotified = outcome === 'sent' || outcome === 'already';
  }

  const recipients = ownerAlertRecipients();
  if (!recipients.length) {
    console.warn('[payment-failed] owner alert skipped: ALERT_EMAIL_TO is unset');
  } else {
    for (const to of recipients) {
      await deliverPaymentNotice(
        paymentFailedSendKey(event, invoice, `owner:${to}`),
        () => emailApi.sendPaymentFailedOwnerAlert(to, {
          invoiceId: invoice.id || '',
          customerId: invoiceCustomerId(invoice),
          attempt: invoice.attempt_count,
          willRetry: flags.willRetry,
          customerNotified,
        })
      );
    }
  }
}

async function dispatchStripeEvent(event, stripe) {
  const storage = require('../server/storage.js');
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.metadata?.email;
      const customerName = session.customer_details?.name || '';
      const planId = session.metadata?.plan || '';
      const planLabels = { 'pt-starter': 'Starter', 'pt-pro': 'Pro', 'premium': 'Premium', 'premium-annual': 'Premium (yearly)' };
      const planLabel = planLabels[planId] || planId || 'PT';
      const customerId = sessionCustomerId(session);
      await grantCheckoutAccess(stripe, session);
      if (customerId) await runDuplicateCleanup(stripe, customerId, customerEmail, event.id, []);
      const ended = await endReusedCardTrial(stripe, session, planId);
      console.log('Checkout completed');
      await sendCheckoutWelcome(stripe, session, event, customerEmail, customerName, planLabel, { trialEnded: ended });
      try {
        // No trial_started when no trial applies (repeat card or trial used).
        if (!isCoachPlanName(planId) && !ended && session.metadata?.trial !== '0') {
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
          console.error('[webhook] subscription retrieve failed', ...webhookErrorFields(err));
          const retry = retryableReadError(err);
          if (retry) throw retry;
          // Permanent. A deleted subscription is a real cancel; any other
          // rejected read changes nothing.
          if (isStripeResourceMissing(err)) {
            sub = { ...snapshot, status: 'canceled' };
          } else {
            return;
          }
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
      await notifyPaymentFailed(event, stripe);
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
  endReusedCardTrial,
  dispatchStripeEvent,
  invoiceBelongsToFitMunch,
  paymentFailedCustomerFlags,
  paymentFailedSendKey,
  rethrowIfTransient,
};
