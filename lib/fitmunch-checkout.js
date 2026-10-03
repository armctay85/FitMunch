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

const PRODUCT_IDS = {
  'pt-starter': 'prod_U1Vxyt6dURtTil',
  'pt-pro': 'prod_U1W03WWN7D7oVl',
  premium: 'prod_UoBDFNLbc6pTS4',
  coach: 'prod_VMzRQCAj09C8AW',
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
const COACH_PLAN_NAMES = ['coach-39', 'coach-79'];

function isCoachPlanName(plan) {
  return plan === 'coach-39' || plan === 'coach-79';
}

function coachPriceEnvName(plan) {
  if (plan === 'coach-39') return 'STRIPE_COACH_39_PRICE_ID';
  if (plan === 'coach-79') return 'STRIPE_COACH_79_PRICE_ID';
  return '';
}

function coachPriceIdForPlan(plan) {
  const key = coachPriceEnvName(plan);
  if (!key) return '';
  return String(process.env[key] || '').trim();
}

function coachCatalogPriceIds() {
  return COACH_PLAN_NAMES.map((plan) => coachPriceIdForPlan(plan)).filter(Boolean);
}

const FITMUNCH_PRODUCT_ENV_KEYS = [
  'STRIPE_FITMUNCH_PRODUCT_IDS',
  'STRIPE_PREMIUM_PRODUCT_ID',
  'STRIPE_PT_STARTER_PRODUCT_ID',
  'STRIPE_PT_PRO_PRODUCT_ID',
  'STRIPE_COACH_39_PRODUCT_ID',
  'STRIPE_COACH_79_PRODUCT_ID',
];

function fitmunchAllowlist() {
  const prices = new Set(
    [...Object.values(PRICE_IDS), ...coachCatalogPriceIds()].map((id) => String(id || '').trim()).filter(Boolean)
  );
  const products = new Set(Object.values(PRODUCT_IDS).filter(Boolean));
  for (const key of FITMUNCH_PRODUCT_ENV_KEYS) {
    const raw = process.env[key];
    if (!raw) continue;
    for (const part of String(raw).split(',')) {
      const id = part.trim();
      if (id) products.add(id);
    }
  }
  return { prices, products };
}

function priceProductId(price) {
  if (!price || typeof price !== 'object') return '';
  const product = price.product;
  if (!product) return '';
  if (typeof product === 'string') return product;
  return product.id || '';
}

function collectPriceProductIds(record) {
  const ids = [];
  const rows = [
    ...(record?.items?.data || []),
    ...(record?.lines?.data || []),
  ];
  for (const row of rows) {
    const price = row?.price || row?.plan;
    if (typeof price === 'string') {
      ids.push(price);
      continue;
    }
    const priceId = priceIdOf(price);
    if (priceId) ids.push(priceId);
    const productId = priceProductId(price);
    if (productId) ids.push(productId);
  }
  return ids;
}

function idsInFitMunchAllowlist(ids) {
  const allow = fitmunchAllowlist();
  return (ids || []).some((id) => id && (allow.prices.has(id) || allow.products.has(id)));
}

function subscriptionMatchesAllowlist(sub) {
  return idsInFitMunchAllowlist(collectPriceProductIds(sub));
}

function checkoutSessionIsFitMunch(session) {
  const app = String(session?.metadata?.app || '').trim().toLowerCase();
  if (app === 'fitmunch') return true;
  const ids = [];
  if (session?.metadata?.priceId) ids.push(session.metadata.priceId);
  const lines = [
    ...(session?.line_items?.data || []),
    ...(session?.display_items || []),
  ];
  for (const line of lines) {
    const price = line?.price;
    if (typeof price === 'string') ids.push(price);
    else {
      const priceId = priceIdOf(price);
      if (priceId) ids.push(priceId);
      const productId = priceProductId(price);
      if (productId) ids.push(productId);
    }
  }
  if (session?.subscription && typeof session.subscription === 'object') {
    ids.push(...collectPriceProductIds(session.subscription));
  }
  return idsInFitMunchAllowlist(ids);
}

function invoiceIsFitMunch(invoice) {
  if (!invoice) return false;
  if (invoice.subscription && typeof invoice.subscription === 'object') {
    if (subscriptionMatchesAllowlist(invoice.subscription)) return true;
  }
  return idsInFitMunchAllowlist(collectPriceProductIds(invoice));
}

function coachPlanForPriceId(priceId) {
  if (!priceId) return '';
  for (const plan of COACH_PLAN_NAMES) {
    if (coachPriceIdForPlan(plan) && coachPriceIdForPlan(plan) === priceId) return plan;
  }
  return '';
}

function safeRelativeCheckoutPath(path, fallback) {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('://')) {
    return fallback;
  }
  return path;
}

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

function buildSubscriptionCheckoutParams({ customerId, priceId, origin, plan, email, successPath, cancelPath, userId }) {
  const host = origin || 'https://www.fitmunch.com.au';
  const success = safeRelativeCheckoutPath(successPath, '/app.html?subscribed=1');
  const cancel = safeRelativeCheckoutPath(cancelPath, '/app.html?cancelled=1');
  const coachMeta = isCoachPlanName(plan) ? { coach: '1' } : {};
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
        app: 'fitmunch',
        ...coachMeta,
      },
    },
    metadata: {
      plan: plan || '',
      email: email || '',
      product: 'fitmunch',
      brand: FITMUNCH_CHECKOUT_BRAND,
      app: 'fitmunch',
      priceId: priceId || '',
      ...coachMeta,
      ...(userId ? { userId: String(userId) } : {}),
    },
    success_url: `${host}${success}`,
    cancel_url: `${host}${cancel}`,
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
  const known = new Set([...Object.values(PRICE_IDS), ...coachCatalogPriceIds()]);
  if (!priceId || !known.has(priceId)) {
    throw new Error('Checkout must use an existing FitMunch catalog Price.');
  }
  if (params?.metadata?.plan === 'premium' && priceId !== PRICE_IDS.premium) {
    throw new Error('Premium Checkout must use the existing $19.99 AUD FitMunch Price.');
  }
  if (isCoachPlanName(params?.metadata?.plan) && priceId !== coachPriceIdForPlan(params.metadata.plan)) {
    throw new Error('Coach Checkout must use the configured Coach catalog Price.');
  }
}

async function createFitMunchCheckoutSession(stripeClient, params, options = {}) {
  assertExistingCatalogPrice(params);
  if (typeof stripeClient?.rawRequest !== 'function') {
    throw new Error('Stripe rawRequest is required for FitMunch Checkout.');
  }
  const requestOptions = { apiVersion: STRIPE_CHECKOUT_API_VERSION };
  if (options && options.idempotencyKey) {
    requestOptions.idempotencyKey = options.idempotencyKey;
  }
  const session = await stripeClient.rawRequest(
    'POST',
    '/v1/checkout/sessions',
    params,
    requestOptions
  );
  const reasons = honestyFailures(session);
  if (reasons.length) {
    await expireCheckoutSession(stripeClient, session && session.id);
    const err = new Error('Refusing Checkout session that is not FitMunch AUD: ' + reasons.join(', '));
    err.code = 'CHECKOUT_HONESTY_FAILED';
    throw err;
  }
  // After the Stripe call has succeeded. Does not change the request, the
  // session, or the response. Personal data in the Checkout params is not logged.
  try {
    const funnel = require('./funnel-events');
    const plan = params && params.metadata && params.metadata.plan;
    if (!isCoachPlanName(plan)) {
      funnel.scheduleFunnelEvent(
        funnel.checkoutStartEvent({ plan }),
        session && session.id ? `checkout:${session.id}` : ''
      );
    }
  } catch (_) {
    /* funnel log must not change checkout */
  }
  return session;
}

// Live means a FitMunch subscription we must not duplicate.
// `incomplete` is a failed first payment. Stripe leaves it for about 23 hours.
// Treating it as live blocks a retry for that whole window, so it is not live.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];
const FITMUNCH_CUSTOMER_BRAND = 'fitmunch';
const IDEMPOTENCY_BUCKET_MS = 60 * 1000;
const CHECKOUT_MEMORY_TTL_MS = 60 * 1000;

const rememberedCustomers = new Map();
const rememberedSessions = new Map();

const refundedChargeIds = new Set();

function resetCheckoutGuardsForTests() {
  rememberedCustomers.clear();
  rememberedSessions.clear();
  refundedChargeIds.clear();
}

function stripeEventIdempotencyKey(eventId, parts) {
  const raw = ['fitmunch', String(eventId || 'none'), ...(parts || []).map((part) => String(part == null ? '' : part).trim())].join(':');
  return raw.replace(/[^A-Za-z0-9:_@.+-]/g, '_').slice(0, 255);
}

function isMissingStripeError(err) {
  if (!err) return false;
  if (err.code === 'resource_missing') return true;
  const status = Number(err.statusCode || err.status);
  return status === 404;
}

function remember(map, key, value, ttl = CHECKOUT_MEMORY_TTL_MS) {
  map.set(key, { value, expires: Date.now() + ttl });
}

function recall(map, key) {
  const row = map.get(key);
  if (!row) return null;
  if (row.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  return row.value;
}

function stripeIdempotencyKey(parts, now = Date.now()) {
  const bucket = Math.floor(Number(now) / IDEMPOTENCY_BUCKET_MS);
  const raw = ['fitmunch', ...parts.map((part) => String(part == null ? '' : part).trim()), String(bucket)].join(':');
  return raw.replace(/[^A-Za-z0-9:_@.+-]/g, '_').slice(0, 255);
}

function planForPriceId(priceId) {
  const coachPlan = coachPlanForPriceId(priceId);
  if (coachPlan) return coachPlan;
  for (const [plan, id] of Object.entries(PRICE_IDS)) {
    if (id === priceId) return plan;
  }
  return null;
}

function priceIdOf(price) {
  if (!price) return '';
  if (typeof price === 'string') return price;
  return price.id || '';
}

function subscriptionPriceId(sub) {
  const items = sub?.items?.data || [];
  for (const item of items) {
    const id = priceIdOf(item?.price);
    if (id) return id;
  }
  return '';
}

function metadataSaysFitMunch(meta) {
  if (!meta || typeof meta !== 'object') return false;
  const product = String(meta.product || '').trim().toLowerCase();
  const brand = String(meta.brand || '').trim().toLowerCase();
  const app = String(meta.app || '').trim().toLowerCase();
  return product === 'fitmunch' || brand === 'fitmunch' || app === 'fitmunch';
}

function isFitMunchSubscription(sub) {
  if (!sub) return false;
  if (subscriptionMatchesAllowlist(sub)) return true;
  return metadataSaysFitMunch(sub.metadata);
}

function sessionMetadata(session) {
  return {
    ...(session?.params?.metadata || {}),
    ...(session?.metadata || {}),
  };
}

function sessionMatchesCheckout(session, priceId, plan) {
  if (!session || !session.url) return false;
  if (session.status && session.status !== 'open') return false;
  const meta = sessionMetadata(session);
  if (meta.priceId && meta.priceId === priceId) return true;
  if (plan && meta.plan === plan) return true;
  const items = session.line_items?.data || session.params?.line_items || [];
  const fromItems = priceIdOf(items[0]?.price);
  return Boolean(fromItems && fromItems === priceId);
}

async function listCustomerSubscriptions(stripe, customerId) {
  if (!customerId || typeof stripe?.subscriptions?.list !== 'function') return [];
  const res = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  return res?.data || [];
}

async function listOpenCheckoutSessions(stripe, customerId) {
  if (!customerId || typeof stripe?.checkout?.sessions?.list !== 'function') return [];
  const res = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 20,
  });
  return (res?.data || []).filter((session) => session.status === 'open');
}

async function customerStillHasLiveFitMunchSub(stripe, customerId, exceptSubId) {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  return subs.some((sub) =>
    sub.id !== exceptSubId &&
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) &&
    isFitMunchSubscription(sub)
  );
}

function chargeAlreadyRefunded(invoice, chargeId) {
  if (chargeId && refundedChargeIds.has(chargeId)) return true;
  if (!invoice || typeof invoice !== 'object') return false;
  if (invoice.refunded === true) return true;
  if (Number(invoice.amount_refunded || 0) > 0) return true;
  const charge = invoice.charge;
  if (charge && typeof charge === 'object') {
    if (charge.refunded === true) return true;
    if (Number(charge.amount_refunded || 0) > 0) return true;
  }
  return false;
}

function refundIdempotencyKey(chargeId) {
  const raw = ['fitmunch', 'refund', String(chargeId || '').trim()].join(':');
  return raw.replace(/[^A-Za-z0-9:_@.+-]/g, '_').slice(0, 255);
}

async function refundPaidCharge(stripe, sub, _eventId) {
  if (typeof stripe?.refunds?.create !== 'function') return null;
  let invoice = sub?.latest_invoice || null;
  if (typeof invoice === 'string' && typeof stripe.invoices?.retrieve === 'function') {
    try {
      invoice = await stripe.invoices.retrieve(invoice);
    } catch (err) {
      const { isTransientWebhookError, webhookErrorFields } = require('./webhook-error');
      console.warn('[checkout] invoice retrieve failed', ...webhookErrorFields(err));
      if (isTransientWebhookError(err)) throw err;
      return null;
    }
  }
  if (!invoice || typeof invoice !== 'object') return null;
  const amountPaid = Number(invoice.amount_paid || 0);
  if (amountPaid <= 0) return null;
  const charge = typeof invoice.charge === 'string' ? invoice.charge : invoice.charge?.id;
  const paymentIntent = typeof invoice.payment_intent === 'string'
    ? invoice.payment_intent
    : invoice.payment_intent?.id;
  if (chargeAlreadyRefunded(invoice, charge || paymentIntent)) return null;
  if (charge && typeof stripe.charges?.retrieve === 'function') {
    try {
      const liveCharge = await stripe.charges.retrieve(charge);
      if (liveCharge && (liveCharge.refunded || Number(liveCharge.amount_refunded || 0) > 0)) {
        refundedChargeIds.add(charge);
        return null;
      }
    } catch (err) {
      const { isTransientWebhookError, webhookErrorFields } = require('./webhook-error');
      console.warn('[checkout] charge retrieve failed', ...webhookErrorFields(err));
      if (isTransientWebhookError(err)) throw err;
    }
  }
  const idempotencyKey = refundIdempotencyKey(charge || paymentIntent);
  try {
    let refund = null;
    if (charge) {
      refund = await stripe.refunds.create({ charge, reason: 'duplicate' }, { idempotencyKey });
    } else if (paymentIntent) {
      refund = await stripe.refunds.create({ payment_intent: paymentIntent, reason: 'duplicate' }, { idempotencyKey });
    }
    if (refund) {
      if (charge) refundedChargeIds.add(charge);
      if (paymentIntent) refundedChargeIds.add(paymentIntent);
      invoice.refunded = true;
      invoice.amount_refunded = amountPaid;
    }
    return refund;
  } catch (err) {
    const { isTransientWebhookError, webhookErrorFields } = require('./webhook-error');
    console.warn('[checkout] refund failed', ...webhookErrorFields(err));
    if (isTransientWebhookError(err)) throw err;
  }
  return null;
}

/**
 * If a customer has more than one live FitMunch subscription, keep the oldest
 * and cancel the newer ones immediately. The 5 Aug guard sorted newest-first
 * and cancelled the original subscription. This does the opposite.
 * Prorate the cancel and refund any charge already taken on the duplicate.
 */
function mergeSubscriptionState(listed, extraSubs) {
  const byId = new Map();
  for (const sub of listed || []) {
    if (!sub) continue;
    const key = sub.id || `anon:${byId.size}`;
    byId.set(key, sub);
  }
  for (const sub of extraSubs || []) {
    if (!sub) continue;
    const key = sub.id || `anon:${byId.size}`;
    const prior = sub.id ? byId.get(sub.id) : null;
    if (prior && !LIVE_SUBSCRIPTION_STATUSES.includes(prior.status)) continue;
    if (prior) {
      byId.set(sub.id, {
        ...sub,
        status: prior.status,
        latest_invoice: prior.latest_invoice || sub.latest_invoice,
      });
    } else {
      byId.set(key, sub);
    }
  }
  return [...byId.values()];
}

async function cancelNewerDuplicateSubscriptions(stripe, customerId, extraSubs = [], eventId) {
  const listed = await listCustomerSubscriptions(stripe, customerId);
  return cancelNewerLiveSubscriptions(stripe, mergeSubscriptionState(listed, extraSubs), customerId, eventId);
}

function compareSubscriptionAge(a, b) {
  const createdDelta = (a.created || 0) - (b.created || 0);
  if (createdDelta) return createdDelta;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

async function currentSubscriptionState(stripe, sub) {
  if (!sub) return null;
  if (sub.id && typeof stripe?.subscriptions?.retrieve === 'function') {
    try {
      return await stripe.subscriptions.retrieve(sub.id);
    } catch (err) {
      if (isMissingStripeError(err)) return null;
      throw err;
    }
  }
  return sub;
}

async function cancelNewerLiveSubscriptions(stripe, subs, _label, eventId) {
  const live = (subs || []).filter((sub) =>
    sub && LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) && isFitMunchSubscription(sub)
  );
  if (live.length === 0) return { kept: null, cancelled: [] };
  live.sort(compareSubscriptionAge);
  const kept = live[0];
  if (live.length === 1) return { kept, cancelled: [] };

  const cancelled = [];
  for (const dup of live.slice(1)) {
    const invoiceRef = dup.latest_invoice;
    try {
      const current = await currentSubscriptionState(stripe, dup);
      if (!current) continue;
      if (LIVE_SUBSCRIPTION_STATUSES.includes(current.status) && typeof stripe.subscriptions?.cancel === 'function' && dup.id) {
        const idempotencyKey = stripeEventIdempotencyKey(eventId, ['cancel', dup.id]);
        await stripe.subscriptions.cancel(
          dup.id,
          { prorate: true, invoice_now: true },
          { idempotencyKey }
        );
        current.status = 'canceled';
        dup.status = 'canceled';
      } else {
        dup.status = current.status || 'canceled';
      }
      const refund = await refundPaidCharge(
        stripe,
        { ...current, latest_invoice: current.latest_invoice || invoiceRef },
        eventId
      );
      cancelled.push({ id: dup.id, refunded: Boolean(refund), refundId: refund?.id || null });
      console.warn(
        '[checkout] duplicate FitMunch subscription: kept the oldest and cancelled the newer one' +
        (refund ? ', refunded the duplicate charge' : ', no charge to refund')
      );
    } catch (err) {
      const { isTransientWebhookError, webhookErrorFields } = require('./webhook-error');
      console.warn('[checkout] duplicate cancel failed', ...webhookErrorFields(err));
      if (isTransientWebhookError(err)) throw err;
      cancelled.push({ id: dup.id, refunded: false });
    }
  }
  return { kept, cancelled };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function listCustomersWithEmail(stripe, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const byId = new Map();
  const add = (customer) => {
    if (!customer || !customer.id || customer.deleted) return;
    if (normalizeEmail(customer.email) !== normalized) return;
    if (!byId.has(customer.id)) byId.set(customer.id, customer);
  };
  if (typeof stripe?.customers?.search === 'function') {
    try {
      const escaped = normalized.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const searched = await stripe.customers.search({
        query: `email:'${escaped}'`,
        limit: 100,
      });
      for (const customer of searched?.data || []) add(customer);
    } catch (err) {
      console.warn('[checkout] customer search failed', err && err.type, err && err.code);
      const { isTransientWebhookError } = require('./webhook-error');
      if (isTransientWebhookError(err)) throw err;
    }
  }
  if (typeof stripe?.customers?.list === 'function') {
    try {
      const listed = await stripe.customers.list({ email: normalized, limit: 100 });
      for (const customer of listed?.data || []) add(customer);
    } catch (err) {
      console.warn('[checkout] customer list failed', err && err.type, err && err.code);
    }
  }
  return [...byId.values()];
}

async function userIdsByStripeCustomer(customerIds) {
  const wanted = [...new Set((customerIds || []).filter(Boolean))];
  const map = new Map();
  if (!wanted.length) return map;
  const storage = require('../server/storage.js');
  if (!storage.db || typeof storage.db.select !== 'function' || !storage.schema?.users) {
    throw new Error('Cannot tell which Stripe customers are linked to FitMunch users.');
  }
  const { inArray } = require('drizzle-orm');
  const rows = await storage.db.select().from(storage.schema.users).where(
    inArray(storage.schema.users.stripeCustomerId, wanted)
  );
  for (const row of rows || []) {
    const id = row && row.stripeCustomerId;
    if (id && wanted.includes(id) && row.id) map.set(id, String(row.id));
  }
  return map;
}

function resolvedBillingUserId(customer, userByCustomer) {
  const fromDb = customer && userByCustomer.get(customer.id);
  if (fromDb) return fromDb;
  const meta = (customer && customer.metadata) || {};
  const metaUser = meta.userId || meta.user_id;
  return metaUser ? String(metaUser) : '';
}

/**
 * Same-customer duplicates are cancelled by cancelNewerDuplicateSubscriptions.
 * Across customers, cancel only when both customers are the same Stripe
 * customer or resolve to the same FitMunch user. A typed email is not that
 * proof: an unlinked guest with someone else's address is flagged, not
 * cancelled or refunded.
 */
async function cancelNewerDuplicatesAcrossCustomers(stripe, customerId, hintEmail, eventId) {
  const seed = customerId ? await loadStripeCustomer(stripe, customerId) : null;
  if (seed && !isFitMunchOwnedCustomer(seed)) return { kept: null, cancelled: [], flagged: [] };
  const email = normalizeEmail(seed?.email || hintEmail);
  if (!email) return { kept: null, cancelled: [], flagged: [] };

  const customers = await listCustomersWithEmail(stripe, email);
  if (seed && seed.id && normalizeEmail(seed.email) === email && !customers.some((customer) => customer.id === seed.id)) {
    customers.push(seed);
  }
  const fitmunch = customers.filter((customer) => isFitMunchOwnedCustomer(customer));
  const userByCustomer = await userIdsByStripeCustomer(fitmunch.map((customer) => customer.id));
  const linked = new Set(userByCustomer.keys());

  const groups = new Map();
  const unlinked = [];
  for (const customer of fitmunch) {
    const userId = resolvedBillingUserId(customer, userByCustomer);
    if (!userId) {
      unlinked.push(customer);
      continue;
    }
    if (!groups.has(userId)) groups.set(userId, []);
    groups.get(userId).push(customer);
  }

  let kept = null;
  const cancelled = [];
  for (const group of groups.values()) {
    const distinct = [...new Map(group.map((customer) => [customer.id, customer])).values()];
    if (distinct.length < 2) continue;
    const subs = [];
    for (const customer of distinct) {
      const listed = await listCustomerSubscriptions(stripe, customer.id);
      for (const sub of listed) {
        if (!sub) continue;
        if (!sub.customer) sub.customer = customer.id;
        subs.push(sub);
      }
    }
    const result = await cancelNewerLiveSubscriptions(stripe, subs, 'same-user', eventId);
    if (result.kept) kept = result.kept;
    cancelled.push(...(result.cancelled || []));
  }

  const flagged = [];
  if (unlinked.length && fitmunch.length >= 2) {
    console.warn('[checkout] guest duplicate flagged');
    for (const customer of unlinked) flagged.push(customer.id);
  }
  return { kept, cancelled, flagged, linkedPreserved: [...linked] };
}

/**
 * A linked customer id we do not recognise as FitMunch can still hold a live
 * FitMunch subscription. Do not mint a replacement customer over that sub.
 */
async function linkedCustomerHasLiveFitMunchSub(stripe, customerId) {
  if (!customerId) return false;
  const existing = await loadStripeCustomer(stripe, customerId);
  if (isFitMunchOwnedCustomer(existing)) return false;
  const subs = await listCustomerSubscriptions(stripe, customerId);
  return subs.some((sub) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) && isFitMunchSubscription(sub)
  );
}

function fitMunchCustomerMetadata(extra = {}) {
  return {
    ...(extra || {}),
    brand: FITMUNCH_CUSTOMER_BRAND,
    product: 'fitmunch',
  };
}

/**
 * A customer may be reused only when FitMunch created it.
 * brand=fitmunch, product=fitmunch, or the legacy userId marker our own
 * customer create wrote. Any other brand on the shared Stripe account is refused.
 */
function isFitMunchOwnedCustomer(customer) {
  if (!customer || customer.deleted) return false;
  const meta = customer.metadata || {};
  const brand = String(meta.brand || '').trim().toLowerCase();
  const product = String(meta.product || '').trim().toLowerCase();
  if (brand && brand !== FITMUNCH_CUSTOMER_BRAND) return false;
  if (product && product !== 'fitmunch') return false;
  if (brand === FITMUNCH_CUSTOMER_BRAND || product === 'fitmunch') return true;
  if (meta.userId || meta.user_id) return true;
  return false;
}

async function loadStripeCustomer(stripe, customerId) {
  if (!customerId || typeof stripe?.customers?.retrieve !== 'function') return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || customer.deleted) return null;
    return customer;
  } catch (err) {
    const missing = err?.code === 'resource_missing'
      || err?.statusCode === 404
      || /no such customer/i.test(err?.message || '');
    if (missing) return null;
    throw err;
  }
}

async function createFitMunchCustomer(stripe, {
  userId,
  email,
  name,
  metadata,
  idempotencyParts,
} = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const parts = idempotencyParts && idempotencyParts.length
    ? idempotencyParts
    : ['customer', userId || 'new'];
  return stripe.customers.create(
    {
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(name ? { name } : {}),
      metadata: fitMunchCustomerMetadata({
        ...(metadata || {}),
        ...(userId ? { userId: String(userId) } : {}),
      }),
    },
    { idempotencyKey: stripeIdempotencyKey(parts) }
  );
}

/**
 * Logged-in checkout only. Reuses the customer id stored on the user row when
 * that Stripe customer belongs to FitMunch. Never searches Stripe by email:
 * the account is shared with other brands.
 */
async function findOrCreateStripeCustomer(stripe, { userId, email, name, existingCustomerId, metadata } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cacheKey = userId ? `user:${userId}` : '';

  if (existingCustomerId) {
    const existing = await loadStripeCustomer(stripe, existingCustomerId);
    if (isFitMunchOwnedCustomer(existing)) {
      if (cacheKey) remember(rememberedCustomers, cacheKey, existing.id);
      return existing.id;
    }
  }

  if (cacheKey) {
    const cached = recall(rememberedCustomers, cacheKey);
    if (cached) return cached;
  }

  const created = await createFitMunchCustomer(stripe, {
    userId,
    email: normalizedEmail,
    name,
    metadata,
    idempotencyParts: ['customer', userId || 'new'],
  });
  if (cacheKey) remember(rememberedCustomers, cacheKey, created.id);
  return created.id;
}

function guestCheckoutFingerprint({ nonce, email, plan, ip, userAgent, uniquePerRequest } = {}) {
  const clientNonce = String(nonce || '').trim();
  if (clientNonce) {
    return `nonce:${clientNonce}:${plan || ''}`
      .replace(/[^A-Za-z0-9:_@.+-]/g, '_')
      .slice(0, 180);
  }
  const crypto = require('crypto');
  const salt = uniquePerRequest ? crypto.randomBytes(16).toString('hex') : '';
  const material = [
    String(ip || ''),
    String(userAgent || ''),
    String(plan || ''),
    normalizeEmail(email),
    salt,
  ].join('\n');
  return `fp:${crypto.createHash('sha256').update(material).digest('hex')}`;
}

function checkoutRequestParts(req, body = {}) {
  const source = body || {};
  const headerNonce = req && typeof req.get === 'function'
    ? (req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '')
    : '';
  const nonce = String(source.nonce || source.idempotencyKey || headerNonce || '').trim();
  const forwarded = req?.headers?.['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req?.ip || '';
  const userAgent = (req && typeof req.get === 'function' && req.get('user-agent')) || '';
  return { nonce, ip, userAgent };
}

function withoutSavedPaymentMethods(params) {
  const next = { ...(params || {}) };
  delete next.saved_payment_method_options;
  delete next.allow_redisplay;
  if (next.payment_method_options && typeof next.payment_method_options === 'object') {
    const options = { ...next.payment_method_options };
    if (options.card && typeof options.card === 'object') {
      const card = { ...options.card };
      delete card.allow_redisplay;
      options.card = card;
    }
    delete options.allow_redisplay;
    next.payment_method_options = options;
  }
  if (next.subscription_data && typeof next.subscription_data === 'object') {
    const subscriptionData = { ...next.subscription_data };
    delete subscriptionData.saved_payment_method_options;
    next.subscription_data = subscriptionData;
  }
  return next;
}

/**
 * Checkout for a caller who is not logged in.
 * Always creates a new FitMunch customer. Does not list or search customers
 * by email, does not reuse an open session on someone else's customer, and
 * does not report whether that email already subscribes.
 * Subscription mode has no customer_creation parameter (that is payment mode
 * only), so the fresh Customer is created first and tagged brand=fitmunch.
 * Idempotency is the client nonce or a browser fingerprint, not a Stripe
 * customer looked up by email.
 */
async function openUnauthenticatedCheckout(stripe, { fingerprint, email, priceId, plan, origin, successPath, cancelPath }) {
  const normalizedEmail = normalizeEmail(email);
  // Email is part of the 60s key so a replayed nonce cannot return another
  // person's Checkout session.
  const cacheKey = `guest:${fingerprint}:${normalizedEmail}:${priceId}`;
  const cached = recall(rememberedSessions, cacheKey);
  if (cached?.url && cached?.id) return { url: cached.url, id: cached.id };
  const idempotencyParts = ['guest', fingerprint, normalizedEmail, priceId, plan || ''];
  const customer = await createFitMunchCustomer(stripe, {
    email: normalizedEmail,
    idempotencyParts: ['guest-customer', ...idempotencyParts],
  });
  const params = withoutSavedPaymentMethods(buildSubscriptionCheckoutParams({
    customerId: customer.id,
    priceId,
    origin,
    plan,
    email: normalizedEmail,
    successPath,
    cancelPath,
  }));
  const session = await createFitMunchCheckoutSession(stripe, params, {
    idempotencyKey: stripeIdempotencyKey(['guest-checkout', ...idempotencyParts]),
  });
  const result = { url: session.url, id: session.id };
  remember(rememberedSessions, cacheKey, result);
  return result;
}

function isIdempotencyConflict(err) {
  const code = err?.code || err?.raw?.code || '';
  if (code === 'idempotency_error') return true;
  return /idempotenc/i.test(err?.message || '');
}

async function resolveSubscriptionCheckout(stripe, { customerId, priceId, plan, email, origin, successPath, cancelPath, userId }) {
  const deduped = await cancelNewerDuplicateSubscriptions(stripe, customerId);
  const sessionKey = `${customerId}:${priceId}`;
  if (deduped.kept) {
    rememberedSessions.delete(sessionKey);
    return {
      alreadySubscribed: true,
      url: null,
      id: null,
      message: 'You already have an active FitMunch subscription. Open Billing to manage it.',
    };
  }

  const open = await listOpenCheckoutSessions(stripe, customerId);
  const matching = open.filter((session) => sessionMatchesCheckout(session, priceId, plan));
  if (matching.length) {
    matching.sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id)));
    const keep = matching[0];
    for (const extra of matching.slice(1)) {
      await expireCheckoutSession(stripe, extra.id);
    }
    remember(rememberedSessions, sessionKey, { id: keep.id, url: keep.url });
    return { url: keep.url, id: keep.id, reused: true };
  }

  const cached = recall(rememberedSessions, sessionKey);
  if (cached?.url) return { url: cached.url, id: cached.id, reused: true };

  const idempotencyKey = stripeIdempotencyKey(['checkout', customerId, priceId, plan || '']);
  try {
    const session = await createFitMunchCheckoutSession(
      stripe,
      buildSubscriptionCheckoutParams({ customerId, priceId, origin, plan, email, successPath, cancelPath, userId }),
      { idempotencyKey }
    );
    remember(rememberedSessions, sessionKey, { id: session.id, url: session.url });
    return { url: session.url, id: session.id };
  } catch (err) {
    if (isIdempotencyConflict(err)) {
      const again = await listOpenCheckoutSessions(stripe, customerId);
      const hit = again.find((session) => sessionMatchesCheckout(session, priceId, plan));
      const fallback = hit || recall(rememberedSessions, sessionKey);
      if (fallback?.url) return { url: fallback.url, id: fallback.id, reused: true };
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
  LIVE_SUBSCRIPTION_STATUSES,
  FITMUNCH_CUSTOMER_BRAND,
  IDEMPOTENCY_BUCKET_MS,
  stripeIdempotencyKey,
  planForPriceId,
  subscriptionPriceId,
  isCoachPlanName,
  coachPriceIdForPlan,
  coachPlanForPriceId,
  coachCatalogPriceIds,
  fitmunchAllowlist,
  subscriptionMatchesAllowlist,
  checkoutSessionIsFitMunch,
  invoiceIsFitMunch,
  isFitMunchSubscription,
  isFitMunchOwnedCustomer,
  findOrCreateStripeCustomer,
  createFitMunchCustomer,
  guestCheckoutFingerprint,
  checkoutRequestParts,
  openUnauthenticatedCheckout,
  withoutSavedPaymentMethods,
  resolveSubscriptionCheckout,
  cancelNewerDuplicateSubscriptions,
  cancelNewerDuplicatesAcrossCustomers,
  linkedCustomerHasLiveFitMunchSub,
  listCustomerSubscriptions,
  listCustomersWithEmail,
  normalizeEmail,
  customerStillHasLiveFitMunchSub,
  resetCheckoutGuardsForTests,
};
