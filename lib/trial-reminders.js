'use strict';

/**
 * Daily reminder for FitMunch subscriptions whose trial ends within 72 hours.
 * One email per subscription per trial_end. The claim row is the record of
 * (subscription id, trial_end) and is taken before the send.
 */

const { subscriptionMatchesAllowlist } = require('./fitmunch-checkout');
const { trialEndInReminderWindow, formatTrialEndSydney } = require('./trial-dates');
const { priceLabelForSubscription } = require('./trial-price');
const stripeEvents = require('./stripe-events');

const LIST_PAGE_CAP = 20;

function reminderSendKey(subscriptionId, trialEnd) {
  return `trial_reminder:${subscriptionId}:${trialEnd}`;
}

function customerIdOf(sub) {
  if (!sub) return '';
  if (typeof sub.customer === 'string') return sub.customer;
  return (sub.customer && sub.customer.id) || '';
}

function emailFromCustomer(customer) {
  const email = customer && typeof customer.email === 'string' ? customer.email.trim() : '';
  if (!email || !email.includes('@')) return '';
  return email;
}

function nameFromCustomer(customer) {
  return customer && typeof customer.name === 'string' ? customer.name : '';
}

async function listTrialingSubscriptions(stripe) {
  const out = [];
  if (!stripe || typeof stripe.subscriptions?.list !== 'function') return out;
  let startingAfter = '';
  for (let page = 0; page < LIST_PAGE_CAP; page += 1) {
    const query = { status: 'trialing', limit: 100 };
    if (startingAfter) query.starting_after = startingAfter;
    const res = await stripe.subscriptions.list(query);
    const data = (res && res.data) || [];
    out.push(...data);
    if (!res || !res.has_more || !data.length) break;
    startingAfter = data[data.length - 1] && data[data.length - 1].id;
    if (!startingAfter) break;
  }
  return out;
}

async function contactForSubscription(stripe, sub) {
  const embedded = sub && sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
  let email = emailFromCustomer(embedded);
  let name = nameFromCustomer(embedded);
  if (email) return { email, name };
  const customerId = customerIdOf(sub);
  if (!customerId || typeof stripe.customers?.retrieve !== 'function') return { email: '', name };
  const customer = await stripe.customers.retrieve(customerId);
  return {
    email: emailFromCustomer(customer),
    name: name || nameFromCustomer(customer),
  };
}

async function runTrialReminders(stripe, nowMs = Date.now()) {
  const subs = await listTrialingSubscriptions(stripe);
  const emailApi = require('../server/email.js');
  let checked = 0;
  let sent = 0;
  let skipped = 0;

  for (const sub of subs) {
    if (!subscriptionMatchesAllowlist(sub)) continue;
    checked += 1;
    if (!sub || !sub.id || !trialEndInReminderWindow(sub.trial_end, nowMs)) {
      skipped += 1;
      continue;
    }
    const phrase = formatTrialEndSydney(sub.trial_end);
    if (!phrase) {
      skipped += 1;
      continue;
    }
    let contact;
    try {
      contact = await contactForSubscription(stripe, sub);
    } catch (err) {
      console.error('[trial-reminders] customer read failed');
      throw err;
    }
    if (!contact.email) {
      skipped += 1;
      continue;
    }
    const sendKey = reminderSendKey(sub.id, sub.trial_end);
    const claim = await stripeEvents.claimNotificationSend(sendKey);
    if (!claim.claimed) {
      skipped += 1;
      continue;
    }
    let result;
    try {
      result = await emailApi.sendTrialReminderEmail(contact.email, {
        name: contact.name,
        trialEndPhrase: phrase,
        priceLabel: priceLabelForSubscription(sub),
        idempotencyKey: sendKey,
      });
    } catch (err) {
      await stripeEvents.releaseNotificationSend(sendKey, claim.token);
      throw err;
    }
    if (!result || result.success !== true) {
      await stripeEvents.releaseNotificationSend(sendKey, claim.token);
      skipped += 1;
      continue;
    }
    await stripeEvents.markNotificationSent(sendKey, claim.token);
    sent += 1;
  }

  return { checked, sent, skipped };
}

module.exports = {
  reminderSendKey,
  listTrialingSubscriptions,
  runTrialReminders,
};
