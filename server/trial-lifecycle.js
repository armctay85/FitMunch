'use strict';

const crypto = require('crypto');
const emailApi = require('./email');
const { claimEmailEvent, releaseEmailEvent } = require('../lib/db-migrate');

const PRICE_PLANS = {
  price_1ToYrXGMuYRuJYDrwHtvWD1c: { name: 'Premium', cents: 1999 },
  price_1T3SvgGMuYRuJYDrOyR2hYoq: { name: 'Solo', cents: 5999 },
  price_1T3SyDGMuYRuJYDrF8mvMrwi: { name: 'Pro', cents: 9900 },
};

const META_PLANS = {
  premium: PRICE_PLANS.price_1ToYrXGMuYRuJYDrwHtvWD1c,
  starter: PRICE_PLANS.price_1T3SvgGMuYRuJYDrOyR2hYoq,
  'pt-starter': PRICE_PLANS.price_1T3SvgGMuYRuJYDrOyR2hYoq,
  pro: PRICE_PLANS.price_1T3SyDGMuYRuJYDrF8mvMrwi,
  'pt-pro': PRICE_PLANS.price_1T3SyDGMuYRuJYDrF8mvMrwi,
};

const memorySent = new Set();

function resetTrialEmailStateForTests() {
  memorySent.clear();
}

function linkSecret() {
  return process.env.EMAIL_LINK_SECRET
    || process.env.JWT_SECRET
    || process.env.STRIPE_WEBHOOK_SECRET
    || 'fitmunch-dev-secret';
}

function publicOrigin() {
  return String(process.env.PUBLIC_BASE_URL || 'https://www.fitmunch.com.au').replace(/\/$/, '');
}

function supportContactUrl() {
  return process.env.SUPPORT_URL || `${publicOrigin()}/support`;
}

function signBillingManage(customerId, exp) {
  return crypto.createHmac('sha256', linkSecret()).update(`${customerId}.${exp}`).digest('hex');
}

function billingManageUrl(customerId, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + (60 * 60 * 24 * 30);
  const sig = signBillingManage(customerId, exp);
  const query = new URLSearchParams({ c: String(customerId), exp: String(exp), sig });
  return `${publicOrigin()}/billing/manage?${query.toString()}`;
}

function verifyBillingManage(query, nowSec = Math.floor(Date.now() / 1000)) {
  const customerId = query && query.c;
  const exp = Number(query && query.exp);
  const sig = query && query.sig ? String(query.sig) : '';
  if (!customerId || !exp || !sig) return null;
  if (exp < nowSec) return null;
  const expected = signBillingManage(customerId, exp);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return { customerId: String(customerId) };
}

function formatTrialEnd(unixSeconds) {
  if (!unixSeconds) return '';
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Sydney',
  }).format(date);
}

function formatAud(cents) {
  if (cents == null || Number.isNaN(Number(cents))) return '';
  return `A$${(Number(cents) / 100).toFixed(2)}`;
}

function planFromSubscription(sub) {
  const price = sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price;
  const priceId = typeof price === 'string' ? price : price && price.id;
  if (priceId && PRICE_PLANS[priceId]) return PRICE_PLANS[priceId];
  const meta = sub && sub.metadata && sub.metadata.plan;
  if (meta && META_PLANS[meta]) return META_PLANS[meta];
  const cents = price && price.unit_amount != null ? price.unit_amount : null;
  const name = (price && price.nickname) || meta || 'FitMunch';
  return { name, cents };
}

async function resolveRecipient(sub, deps) {
  if (deps.user && deps.user.email) return deps.user.email;
  if (sub.customer_email) return sub.customer_email;
  const customer = sub.customer;
  if (customer && typeof customer === 'object' && customer.email) return customer.email;
  const customerId = typeof customer === 'string' ? customer : customer && customer.id;
  if (!customerId || !deps.stripe || !deps.stripe.customers || !deps.stripe.customers.retrieve) return '';
  try {
    const record = await deps.stripe.customers.retrieve(customerId);
    return (record && record.email) || '';
  } catch (_) {
    return '';
  }
}

async function takeSendSlot(eventId, kind) {
  if (!eventId) return true;
  if (memorySent.has(eventId)) return false;
  memorySent.add(eventId);
  try {
    const claimed = await claimEmailEvent(eventId, kind);
    if (!claimed) return false;
  } catch (_) {
    /* in-process memory still blocks a second delivery */
  }
  return true;
}

async function releaseSendSlot(eventId) {
  if (!eventId) return;
  memorySent.delete(eventId);
  try {
    await releaseEmailEvent(eventId);
  } catch (_) {
    /* ignore */
  }
}

function customerIdOf(sub) {
  if (!sub || !sub.customer) return '';
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id || '';
}

/**
 * customer.subscription.created (trialing) and customer.subscription.trial_will_end.
 * The same Stripe event id never sends twice.
 */
async function handleSubscriptionLifecycle(event, deps = {}) {
  const type = event && event.type;
  const sub = event && event.data && event.data.object;
  if (!sub) return { skipped: true, reason: 'no-subscription' };

  const started = type === 'customer.subscription.created' && sub.status === 'trialing';
  const ending = type === 'customer.subscription.trial_will_end';
  if (!started && !ending) return { skipped: true, reason: 'not-a-trial-email' };

  const eventId = event.id || '';
  const kind = started ? 'trial_started' : 'trial_ending';
  const owned = await takeSendSlot(eventId, kind);
  if (!owned) return { skipped: true, reason: 'duplicate' };

  try {
    const to = await resolveRecipient(sub, deps);
    if (!to) {
      await releaseSendSlot(eventId);
      return { skipped: true, reason: 'no-email' };
    }
    const plan = planFromSubscription(sub);
    const trialEndLabel = formatTrialEnd(sub.trial_end) || 'the date in billing';
    const amountLabel = formatAud(plan.cents) || 'the price in billing';
    const customerId = customerIdOf(sub);
    const details = {
      planName: plan.name,
      trialEndLabel,
      amountLabel,
      manageUrl: customerId ? billingManageUrl(customerId) : `${publicOrigin()}/pricing`,
      supportUrl: supportContactUrl(),
    };
    const sendStarted = deps.sendTrialStartedEmail || emailApi.sendTrialStartedEmail;
    const sendEnding = deps.sendTrialEndingEmail || emailApi.sendTrialEndingEmail;
    const result = started
      ? await sendStarted(to, details)
      : await sendEnding(to, details);
    if (!result || result.success === false) {
      await releaseSendSlot(eventId);
      return result || { success: false, error: 'send failed' };
    }
    return { ...result, kind, to };
  } catch (error) {
    await releaseSendSlot(eventId);
    return { success: false, error: error.message };
  }
}

module.exports = {
  handleSubscriptionLifecycle,
  billingManageUrl,
  verifyBillingManage,
  publicOrigin,
  supportContactUrl,
  formatTrialEnd,
  formatAud,
  planFromSubscription,
  resetTrialEmailStateForTests,
};
