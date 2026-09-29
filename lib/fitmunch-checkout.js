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
      priceId: priceId || '',
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
  return session;
}

// Live means the customer already has a FitMunch subscription we must not duplicate.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'incomplete'];
const IDEMPOTENCY_BUCKET_MS = 60 * 1000;
const CHECKOUT_MEMORY_TTL_MS = 60 * 1000;

const rememberedCustomers = new Map();
const rememberedSessions = new Map();

function resetCheckoutGuardsForTests() {
  rememberedCustomers.clear();
  rememberedSessions.clear();
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

function isFitMunchSubscription(sub) {
  if (!sub) return false;
  const priceId = subscriptionPriceId(sub);
  if (priceId && Object.values(PRICE_IDS).includes(priceId)) return true;
  const meta = sub.metadata || {};
  if (meta.product === 'fitmunch' || meta.brand === FITMUNCH_CHECKOUT_BRAND) return true;
  if (meta.plan && PRICE_IDS[meta.plan]) return true;
  return false;
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

async function refundPaidCharge(stripe, sub) {
  if (typeof stripe?.refunds?.create !== 'function') return null;
  let invoice = sub?.latest_invoice || null;
  if (typeof invoice === 'string' && typeof stripe.invoices?.retrieve === 'function') {
    try {
      invoice = await stripe.invoices.retrieve(invoice);
    } catch (err) {
      console.warn('[checkout] invoice retrieve failed', invoice, err.message);
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
  const idempotencyKey = stripeIdempotencyKey(['refund', sub.id, charge || paymentIntent || 'charge']);
  try {
    if (charge) {
      return await stripe.refunds.create({ charge, reason: 'duplicate' }, { idempotencyKey });
    }
    if (paymentIntent) {
      return await stripe.refunds.create({ payment_intent: paymentIntent, reason: 'duplicate' }, { idempotencyKey });
    }
  } catch (err) {
    console.warn('[checkout] refund failed', sub.id, err.message);
  }
  return null;
}

/**
 * If a customer has more than one live FitMunch subscription, keep the oldest
 * and cancel the newer ones immediately. The 5 Aug guard sorted newest-first
 * and cancelled the original subscription. This does the opposite.
 * Prorate the cancel and refund any charge already taken on the duplicate.
 */
async function cancelNewerDuplicateSubscriptions(stripe, customerId, extraSubs = []) {
  const listed = await listCustomerSubscriptions(stripe, customerId);
  const byId = new Map();
  for (const sub of [...listed, ...extraSubs]) {
    if (!sub) continue;
    const key = sub.id || `anon:${byId.size}`;
    if (!byId.has(key)) byId.set(key, sub);
  }
  const live = [...byId.values()].filter((sub) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) && isFitMunchSubscription(sub)
  );
  if (live.length === 0) return { kept: null, cancelled: [] };
  live.sort((a, b) => {
    const createdDelta = (a.created || 0) - (b.created || 0);
    if (createdDelta) return createdDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const kept = live[0];
  if (live.length === 1) return { kept, cancelled: [] };

  const cancelled = [];
  for (const dup of live.slice(1)) {
    const invoiceRef = dup.latest_invoice;
    try {
      if (typeof stripe.subscriptions?.cancel === 'function' && dup.id) {
        await stripe.subscriptions.cancel(dup.id, { prorate: true, invoice_now: true });
      }
      dup.status = 'canceled';
      const refund = await refundPaidCharge(stripe, { ...dup, latest_invoice: invoiceRef });
      cancelled.push({ id: dup.id, refunded: Boolean(refund), refundId: refund?.id || null });
      console.warn(
        `[checkout] duplicate FitMunch subscription: kept oldest ${kept.id} (created ${kept.created}), ` +
        `cancelled newer ${dup.id} for ${customerId}` +
        (refund ? `, refunded charge ${refund.id || invoiceRef?.charge || ''}` : ', no charge to refund')
      );
    } catch (err) {
      console.warn('[checkout] duplicate cancel failed', dup.id, err.message);
      cancelled.push({ id: dup.id, refunded: false, error: err.message });
    }
  }
  return { kept, cancelled };
}

async function findOrCreateStripeCustomer(stripe, { userId, email, name, existingCustomerId, metadata } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (existingCustomerId) {
    if (userId) remember(rememberedCustomers, `user:${userId}`, existingCustomerId);
    if (normalizedEmail) remember(rememberedCustomers, `email:${normalizedEmail}`, existingCustomerId);
    return existingCustomerId;
  }

  const cacheKey = userId ? `user:${userId}` : `email:${normalizedEmail}`;
  const cached = cacheKey ? recall(rememberedCustomers, cacheKey) : null;
  if (cached) return cached;
  if (userId && normalizedEmail) {
    const byEmail = recall(rememberedCustomers, `email:${normalizedEmail}`);
    if (byEmail) return byEmail;
  }

  if (typeof stripe?.customers?.list === 'function' && normalizedEmail) {
    const listed = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
    const rows = listed?.data || [];
    const byUser = userId
      ? rows.find((customer) => customer.metadata && String(customer.metadata.userId) === String(userId))
      : null;
    const byEmail = rows
      .filter((customer) => String(customer.email || '').toLowerCase() === normalizedEmail)
      .sort((a, b) => (a.created || 0) - (b.created || 0));
    const found = byUser || byEmail[0];
    if (found?.id) {
      remember(rememberedCustomers, cacheKey, found.id);
      if (normalizedEmail) remember(rememberedCustomers, `email:${normalizedEmail}`, found.id);
      return found.id;
    }
  }

  const created = await stripe.customers.create(
    {
      email: normalizedEmail || email,
      ...(name ? { name } : {}),
      metadata: {
        ...(metadata || {}),
        ...(userId ? { userId: String(userId) } : {}),
        product: 'fitmunch',
      },
    },
    { idempotencyKey: stripeIdempotencyKey(['customer', userId || normalizedEmail]) }
  );
  if (cacheKey) remember(rememberedCustomers, cacheKey, created.id);
  if (normalizedEmail) remember(rememberedCustomers, `email:${normalizedEmail}`, created.id);
  if (userId) remember(rememberedCustomers, `user:${userId}`, created.id);
  return created.id;
}

function isIdempotencyConflict(err) {
  const code = err?.code || err?.raw?.code || '';
  if (code === 'idempotency_error') return true;
  return /idempotenc/i.test(err?.message || '');
}

async function resolveSubscriptionCheckout(stripe, { customerId, priceId, plan, email, origin }) {
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
      buildSubscriptionCheckoutParams({ customerId, priceId, origin, plan, email }),
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
  IDEMPOTENCY_BUCKET_MS,
  stripeIdempotencyKey,
  planForPriceId,
  isFitMunchSubscription,
  findOrCreateStripeCustomer,
  resolveSubscriptionCheckout,
  cancelNewerDuplicateSubscriptions,
  listCustomerSubscriptions,
  customerStillHasLiveFitMunchSub,
  resetCheckoutGuardsForTests,
};
