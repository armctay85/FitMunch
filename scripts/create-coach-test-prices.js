#!/usr/bin/env node
/**
 * Create FitMunch Coach prices in Stripe TEST mode only.
 *
 *   STRIPE_COACH_39_PRICE_ID  A$39/month, 10 active clients
 *   STRIPE_COACH_79_PRICE_ID  A$79/month, unlimited clients
 *
 * Refuses sk_live_ / rk_live_. Does not touch the consumer A$19.99 price.
 * Prints the env lines. Does not write .env.
 */
'use strict';

const Stripe = require('stripe');

const LOOKUP = {
  'coach-39': 'fitmunch_coach_39_aud_monthly',
  'coach-79': 'fitmunch_coach_79_aud_monthly',
};

const AMOUNTS = {
  'coach-39': 3900,
  'coach-79': 7900,
};

const NICKNAMES = {
  'coach-39': 'FitMunch Coach A$39',
  'coach-79': 'FitMunch Coach Unlimited A$79',
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) fail('STRIPE_SECRET_KEY is not set. Use a test secret key (sk_test_ or rk_test_).');
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
    fail('Refusing to create Coach prices with a live key. Live prices wait for the owner.');
  }
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    fail('STRIPE_SECRET_KEY is not a test key. Expected sk_test_ or rk_test_.');
  }

  const stripe = Stripe(key);

  let productId = '';
  const searched = await stripe.products.search({
    query: "active:'true' AND metadata['product']:'fitmunch-coach'",
    limit: 1,
  });
  if (searched.data && searched.data[0]) {
    productId = searched.data[0].id;
  } else {
    const created = await stripe.products.create({
      name: 'FitMunch Coach',
      description: 'Meal plans and a priced supermarket draft list for Australian personal trainers.',
      metadata: { product: 'fitmunch-coach', brand: 'fitmunch' },
    });
    productId = created.id;
  }

  const ids = {};
  for (const plan of ['coach-39', 'coach-79']) {
    const existing = await stripe.prices.list({
      lookup_keys: [LOOKUP[plan]],
      active: true,
      limit: 1,
    });
    if (existing.data && existing.data[0]) {
      const price = existing.data[0];
      if (price.livemode) fail(`Lookup ${LOOKUP[plan]} resolved a live price. Stopping.`);
      if (price.currency !== 'aud' || price.unit_amount !== AMOUNTS[plan]) {
        fail(`Existing ${LOOKUP[plan]} is ${price.unit_amount} ${price.currency}, expected ${AMOUNTS[plan]} aud.`);
      }
      ids[plan] = price.id;
      continue;
    }
    const price = await stripe.prices.create({
      currency: 'aud',
      unit_amount: AMOUNTS[plan],
      recurring: { interval: 'month' },
      product: productId,
      nickname: NICKNAMES[plan],
      lookup_key: LOOKUP[plan],
      metadata: { plan, product: 'fitmunch', brand: 'fitmunch', coach: '1' },
    });
    if (price.livemode) fail('Stripe returned a live price. Stopping.');
    ids[plan] = price.id;
  }

  console.log('Test-mode Coach prices (do not commit the secret key):');
  console.log(`STRIPE_COACH_39_PRICE_ID=${ids['coach-39']}`);
  console.log(`STRIPE_COACH_79_PRICE_ID=${ids['coach-79']}`);
  console.log(`product=${productId}`);
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
