'use strict';

/**
 * Trial and duplicate-subscription guard for the signed-out email-first path.
 *
 * Elite QA PR 78 M1 / Wilson's rule: a signed-out email that matches a live
 * FitMunch subscriber is routed to sign-in, never to a second Checkout. An
 * email (or card) that already had a FitMunch trial gets no second trial.
 *
 * The browser never learns which case applied. /api/quick-checkout always
 * answers the same body after the same minimum time, and the outcome travels
 * by email to the address that was typed.
 */

const {
  isFitMunchSubscription,
  isFitMunchOwnedCustomer,
} = require('./fitmunch-checkout');

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const SAFE_SEARCH_VALUE = /^[A-Za-z0-9._%+@-]+$/;

/** lower-case, drop +tag, drop dots in gmail/googlemail local parts. */
function canonicalTrialEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return raw;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

function listData(result) {
  return result && Array.isArray(result.data) ? result.data : [];
}

async function customersForEmail(stripe, email) {
  const lower = String(email || '').trim().toLowerCase();
  const canonical = canonicalTrialEmail(lower);
  const found = new Map();
  const add = (list) => {
    for (const c of list) if (c && c.id && !c.deleted) found.set(c.id, c);
  };
  for (const value of new Set([lower, canonical])) {
    if (!value) continue;
    add(listData(await stripe.customers.list({ email: value, limit: 100 })));
  }
  // Search reaches older raw spellings (Upper.Case+tag@gmail) through the
  // canonical tag we store on every new FitMunch customer.
  if (stripe.customers.search && SAFE_SEARCH_VALUE.test(canonical)) {
    try {
      add(listData(await stripe.customers.search({
        query: `metadata['fm_canonical_email']:'${canonical}'`,
        limit: 100,
      })));
    } catch (_) {
      /* search lag or outage: list results above still apply */
    }
  }
  // Only the customers that really carry this email (search fakes and lag
  // can return extras).
  return [...found.values()].filter((c) => {
    const meta = c.metadata || {};
    return canonicalTrialEmail(c.email) === canonical || meta.fm_canonical_email === canonical;
  });
}

/**
 * { live, trialUsed } for an email across every FitMunch customer that
 * carries it. Other brands on the shared Stripe account are ignored.
 */
async function trialHistoryForEmail(stripe, email) {
  const out = { live: false, trialUsed: false };
  const customers = await customersForEmail(stripe, email);
  for (const customer of customers) {
    const meta = customer.metadata || {};
    if (meta.fm_trial_used === '1' && isFitMunchOwnedCustomer(customer)) out.trialUsed = true;
    const subs = listData(await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 100 }));
    for (const sub of subs) {
      if (!isFitMunchSubscription(sub)) continue;
      if (LIVE_STATUSES.has(sub.status)) out.live = true;
      if (sub.trial_start || sub.trial_end || sub.status === 'trialing') out.trialUsed = true;
    }
  }
  return out;
}

function paymentMethodId(sub) {
  const pm = sub && sub.default_payment_method;
  if (!pm) return '';
  return typeof pm === 'string' ? pm : pm.id || '';
}

/**
 * Webhook side: a trialing subscription whose card already backed a FitMunch
 * trial on another customer ends its trial now. Returns true when it did.
 */
async function endTrialIfCardReused(stripe, sub) {
  if (!sub || sub.status !== 'trialing' || !isFitMunchSubscription(sub)) return false;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let pm = sub.default_payment_method;
  if (pm && typeof pm === 'string') pm = await stripe.paymentMethods.retrieve(pm);
  const fingerprint = pm && pm.card && pm.card.fingerprint;
  if (!customerId || !fingerprint || !SAFE_SEARCH_VALUE.test(fingerprint)) return false;
  let reused = false;
  try {
    const prior = listData(await stripe.customers.search({
      query: `metadata['fm_trial_card']:'${fingerprint}'`,
      limit: 10,
    }));
    reused = prior.some((c) => c && c.id !== customerId);
  } catch (_) {
    reused = false;
  }
  if (reused) {
    await stripe.subscriptions.update(sub.id, { trial_end: 'now', proration_behavior: 'none' });
  }
  await stripe.customers.update(customerId, {
    metadata: { fm_trial_card: fingerprint, fm_trial_used: '1' },
  });
  return reused;
}

module.exports = {
  canonicalTrialEmail,
  trialHistoryForEmail,
  endTrialIfCardReused,
  paymentMethodId,
  LIVE_STATUSES,
};
