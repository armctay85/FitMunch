/**
 * FitMunch Stripe Checkout contract.
 * File that creates the session: lib/fitmunch-checkout.js
 * (called from POST /api/checkout and POST /api/quick-checkout in server.js).
 *
 * Session only. Do not rename the shared Stripe account. Do not create or
 * edit Stripe Prices/Products. Pin FitMunch + AUD on the Checkout Session.
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
const STRIPE_CHECKOUT_API_VERSION = '2026-03-25.dahlia';
const STRIPE_CHECKOUT_LOCALE = 'en-GB';

function jwtSecret() {
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
    locale: STRIPE_CHECKOUT_LOCALE,
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
    success_url: `${host}/app.html?subscribed=1`,
    cancel_url: `${host}/app.html?cancelled=1`,
    allow_promotion_codes: true,
  };
}

function sessionBrand(session) {
  return (
    session?.branding_settings?.display_name ||
    session?.branding_settings?.displayName ||
    ''
  );
}

function honestyFailures(session) {
  const reasons = [];
  if (!session || !session.id || !session.url) reasons.push('missing-session');
  const currency = String(session?.currency || '').toLowerCase();
  if (!currency) reasons.push('currency-missing');
  if (currency && currency !== 'aud') reasons.push(`currency=${currency}`);
  if (session?.currency_conversion) reasons.push('currency-conversion');
  if (session?.adaptive_pricing && session.adaptive_pricing.enabled === true) {
    reasons.push('adaptive-on');
  }
  const brand = sessionBrand(session);
  if (!brand) reasons.push('brand-missing');
  if (brand && brand !== FITMUNCH_CHECKOUT_BRAND) reasons.push(`brand=${brand}`);
  const locale = session?.locale || '';
  if (locale === 'en-AU') reasons.push('locale=en-AU');
  const blob = JSON.stringify(session || {});
  if (/Develoop|Wipper/i.test(blob)) reasons.push('foreign-brand');
  return reasons;
}

async function expireCheckoutSession(stripeClient, sessionId) {
  if (!sessionId || typeof stripeClient?.rawRequest !== 'function') return;
  try {
    await stripeClient.rawRequest(
      'POST',
      `/v1/checkout/sessions/${sessionId}/expire`,
      {},
      { apiVersion: STRIPE_CHECKOUT_API_VERSION }
    );
  } catch (err) {
    console.warn('[checkout] expire failed', sessionId, err.message);
  }
}

function assertExistingCatalogPrice(params) {
  const blob = JSON.stringify(params || {});
  if (/price_data|prices\.create|products\.create/i.test(blob)) {
    throw new Error('Checkout must use an existing catalog Price. Do not create Prices or Products.');
  }
  const priceId = params?.line_items?.[0]?.price;
  const known = new Set(Object.values(PRICE_IDS));
  if (!priceId || !known.has(priceId)) {
    throw new Error('Checkout must use an existing FitMunch catalog Price.');
  }
  if (params?.metadata?.plan === 'premium' && priceId !== PRICE_IDS.premium) {
    throw new Error('Premium Checkout must use the existing $19.99 AUD FitMunch Price.');
  }
}

async function createFitMunchCheckoutSession(stripeClient, params) {
  assertExistingCatalogPrice(params);
  if (typeof stripeClient?.rawRequest !== 'function') {
    throw new Error('Stripe rawRequest is required for FitMunch Checkout.');
  }
  const session = await stripeClient.rawRequest(
    'POST',
    '/v1/checkout/sessions',
    params,
    { apiVersion: STRIPE_CHECKOUT_API_VERSION }
  );
  const reasons = honestyFailures(session);
  if (reasons.length) {
    await expireCheckoutSession(stripeClient, session && session.id);
    const err = new Error('Refusing Checkout session that is not FitMunch AUD: ' + reasons.join(', '));
    err.code = 'CHECKOUT_HONESTY_FAILED';
    throw err;
  }
  return session;
}

module.exports = {
  PRICE_IDS,
  PRICE_TO_TIER,
  FITMUNCH_CHECKOUT_BRAND,
  PREMIUM_PRICE_AUD_CENTS,
  TRIAL_PERIOD_DAYS,
  STRIPE_CHECKOUT_API_VERSION,
  STRIPE_CHECKOUT_LOCALE,
  jwtSecret,
  checkoutOrigin,
  normalizeCheckoutPlan,
  subscriptionTierUpdateFromStripe,
  buildSubscriptionCheckoutParams,
  honestyFailures,
  expireCheckoutSession,
  assertExistingCatalogPrice,
  createFitMunchCheckoutSession,
};
