'use strict';

/**
 * Trial and duplicate-subscription guard for the signed-out email-first path.
 *
 * Elite QA PR 78 M1 / Wilson's rule: a signed-out email that matches a live
 * FitMunch subscriber is routed to sign-in, never to a second Checkout. An
 * email (or card) that already had a FitMunch trial gets no second trial.
 *
 * Live subscribers get a sign-in email and no Checkout. Everyone else goes
 * straight to Stripe Checkout; a returning trial user gets no trial and is
 * told so on the page first (Wilson, PR 78 r2).
 */

const {
  isFitMunchSubscription,
  isFitMunchOwnedCustomer,
} = require('./fitmunch-checkout');

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);
const { canonicalTrialEmail } = require('./canonical-email');
const SAFE_SEARCH_VALUE = /^[A-Za-z0-9._%+@-]+$/;

function listData(result) {
  return result && Array.isArray(result.data) ? result.data : [];
}

const MAX_PAGES = 10;

/** Every page of a Stripe list or search (QA r2 S5), capped at 10 pages. */
async function allPages(fetchPage, params) {
  const out = [];
  let query = { ...params };
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(query);
    const data = listData(page);
    out.push(...data);
    if (!page || !page.has_more || !data.length) break;
    if (i === MAX_PAGES - 1) {
      console.warn('[trial-guard] pagination cap hit', { pages: MAX_PAGES, records: out.length });
      break;
    }
    query = page.next_page
      ? { ...params, page: page.next_page }
      : { ...params, starting_after: data[data.length - 1].id };
  }
  return out;
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
    add(await allPages((q) => stripe.customers.list(q), { email: value, limit: 100 }));
  }
  // Search reaches older raw spellings (Upper.Case+tag@gmail) through the
  // canonical tag we store on every new FitMunch customer.
  if (stripe.customers.search && SAFE_SEARCH_VALUE.test(canonical)) {
    try {
      add(await allPages((q) => stripe.customers.search(q), {
        query: `metadata['fm_canonical_email']:'${canonical}'`,
        limit: 100,
      }));
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
    const subs = await allPages((q) => stripe.subscriptions.list(q), { customer: customer.id, status: 'all', limit: 100 });
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
    const prior = await allPages((q) => stripe.customers.search(q), {
      query: `metadata['fm_trial_card']:'${fingerprint}'`,
      limit: 100,
    });
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
  allPages,
};
