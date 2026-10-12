#!/usr/bin/env node
'use strict';

/**
 * One-off backfill (Elite QA PR 78 r2 S2): write metadata.fm_canonical_email
 * on FitMunch customers that lack it, so the trial guard finds them when a
 * different spelling of the same email is typed.
 *
 * TEST MODE ONLY. Refuses any key that is not sk_test_ / rk_test_. A live run
 * needs a separate, approved change; this script never touches live data.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/backfill-canonical-email.js          # dry run
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/backfill-canonical-email.js --write  # apply
 */

const { canonicalTrialEmail } = require('../lib/canonical-email');
const { isFitMunchOwnedCustomer } = require('../lib/fitmunch-checkout');

function assertTestKey(key) {
  const k = String(key || '');
  if (!/^(sk|rk)_test_/.test(k)) {
    throw new Error('Refusing to run: STRIPE_SECRET_KEY must be a test-mode key (sk_test_ or rk_test_). Live keys are never accepted.');
  }
}

/** Customers to update: FitMunch-owned, with an email, missing or stale canonical tag. */
function plannedUpdates(customers) {
  const out = [];
  for (const c of customers) {
    if (!c || c.deleted || !c.email || !isFitMunchOwnedCustomer(c)) continue;
    const canonical = canonicalTrialEmail(c.email);
    if ((c.metadata || {}).fm_canonical_email === canonical) continue;
    out.push({ id: c.id, fm_canonical_email: canonical });
  }
  return out;
}

async function run({ stripe, key, write = false, log = console.log } = {}) {
  assertTestKey(key);
  const updates = [];
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    updates.push(...plannedUpdates([customer]));
  }
  log(`${updates.length} FitMunch customer(s) need fm_canonical_email${write ? '' : ' (dry run)'}`);
  if (write) {
    for (const u of updates) {
      await stripe.customers.update(u.id, { metadata: { fm_canonical_email: u.fm_canonical_email } });
    }
  }
  return updates;
}

if (require.main === module) {
  (async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    assertTestKey(key);
    const stripe = require('stripe')(key);
    await run({ stripe, key, write: process.argv.includes('--write') });
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { assertTestKey, plannedUpdates, run };
