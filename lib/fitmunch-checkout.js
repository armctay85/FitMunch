/**
 * FitMunch Stripe Checkout contract.
 * Shared by /api/checkout and /api/quick-checkout so a stranger's Premium
 * trial always opens the same AUD, card-on-file, 14-day session.
 *
 * This Stripe account is shared with other products. Session branding must
 * stay FitMunch. Do not send Wipper or Develoop names into Checkout.
 */

const PRICE_IDS = {
  'pt-starter': 'price_1T3SvgGMuYRuJYDrOyR2hYoq', // FitMunch PT Starter $59.99 AUD/mo
  'pt-pro':     'price_1T3SyDGMuYRuJYDrF8mvMrwi', // FitMunch PT Pro     $99.00 AUD/mo
  'premium':    'price_1ToYrXGMuYRuJYDrwHtvWD1c', // FitMunch Premium    $19.99 AUD/mo
};

const PRICE_TO_TIER = {
  'price_1T3SvgGMuYRuJYDrOyR2hYoq': 'starter',
  'price_1T3SyDGMuYRuJYDrF8mvMrwi': 'pro',
  'price_1ToYrXGMuYRuJYDrwHtvWD1c': 'premium',
};

const FITMUNCH_CHECKOUT_BRAND = 'FitMunch';
const PREMIUM_PRICE_AUD_CENTS = 1999;
const TRIAL_PERIOD_DAYS = 14;

function jwtSecret() {
  // Must match api_server.js register/login signing. A drifted fallback
  // verifies the new account's token as invalid and 500s checkout.
  return process.env.JWT_SECRET || 'fitmunch-dev-secret';
}

function checkoutOrigin(req) {
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : '';
  if (origin === 'https://fitmunch.com.au' || origin === 'https://www.fitmunch.com.au') {
    return origin;
  }
  if (origin && process.env.NODE_ENV !== 'production') {
    try {
      return new URL(origin).origin;
    } catch (_) {
      /* fall through */
    }
  }
  return 'https://www.fitmunch.com.au';
}

function normalizeCheckoutPlan(plan, role) {
  if (plan === 'pt-starter' || plan === 'pt-pro' || plan === 'premium') return plan;
  if (role === 'pt' && plan === 'starter') return 'pt-starter';
  if (role === 'pt' && plan === 'pro') return 'pt-pro';
  if (role !== 'pt' && plan === 'premium') return 'premium';
  if (role !== 'pt' && ['starter', 'pro'].includes(plan)) return 'premium';
  return plan;
}

function subscriptionTierUpdateFromStripe(sub) {
  const priceId = sub.items?.data[0]?.price?.id;
  const active = ['active', 'trialing'].includes(sub.status);
  if (!active) return { tier: 'free', expiresAt: null };

  const periodEnd = sub.current_period_end || sub.items?.data[0]?.current_period_end;
  return {
    tier: PRICE_TO_TIER[priceId] || 'starter',
    expiresAt: periodEnd ? new Date(periodEnd * 1000) : null,
  };
}

function buildSubscriptionCheckoutParams({ customerId, priceId, origin, plan, email }) {
  const host = origin || 'https://www.fitmunch.com.au';
  return {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_collection: 'always',
    adaptive_pricing: { enabled: false },
    branding_settings: { display_name: FITMUNCH_CHECKOUT_BRAND },
    subscription_data: {
      trial_period_days: TRIAL_PERIOD_DAYS,
      metadata: {
        plan: plan || '',
        product: 'fitmunch',
        brand: FITMUNCH_CHECKOUT_BRAND,
      },
    },
    metadata: {
      plan: plan || '',
      email: email || '',
      product: 'fitmunch',
      brand: FITMUNCH_CHECKOUT_BRAND,
    },
    custom_text: {
      submit: { message: 'Start FitMunch Premium trial' },
    },
    success_url: `${host}/app.html?subscribed=1`,
    cancel_url: `${host}/app.html?cancelled=1`,
    allow_promotion_codes: true,
  };
}

function isUnknownStripeParam(err, param) {
  const msg = String((err && err.message) || '');
  const code = err && err.code;
  return (
    code === 'parameter_unknown' ||
    (msg.toLowerCase().includes('unknown') && msg.includes(param))
  );
}

async function createFitMunchCheckoutSession(stripeClient, params) {
  try {
    return await stripeClient.checkout.sessions.create(params);
  } catch (err) {
    if (isUnknownStripeParam(err, 'branding_settings')) {
      const retry = { ...params };
      delete retry.branding_settings;
      return await stripeClient.checkout.sessions.create(retry);
    }
    throw err;
  }
}

module.exports = {
  PRICE_IDS,
  PRICE_TO_TIER,
  FITMUNCH_CHECKOUT_BRAND,
  PREMIUM_PRICE_AUD_CENTS,
  TRIAL_PERIOD_DAYS,
  jwtSecret,
  checkoutOrigin,
  normalizeCheckoutPlan,
  subscriptionTierUpdateFromStripe,
  buildSubscriptionCheckoutParams,
  createFitMunchCheckoutSession,
};
