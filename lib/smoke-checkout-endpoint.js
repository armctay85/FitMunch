/**
 * Production smoke checkout.
 *
 * Uses the server's existing Stripe client and the live Premium price.
 * Creates one live Checkout Session, checks the hosted URL, then expires it
 * before responding. No customer is created, nothing is written to the
 * database, and no funnel event is recorded.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  PRICE_IDS,
  STRIPE_CHECKOUT_API_VERSION,
  buildSubscriptionCheckoutParams,
  honestyFailures,
  jwtSecret,
} = require('./fitmunch-checkout');

const CHECKOUT_URL_PREFIX = 'https://checkout.stripe.com';
const PUBLIC_SMOKE_ERRORS = new Set([
  'smoke_would_attach_customer',
  'stripe_create_failed',
  'expire_unavailable',
  'test_session_refused',
  'live_session_required',
  'checkout_url_rejected',
  'expire_failed',
  'honesty_failed',
  'smoke_failed',
]);

function publicSmokeError(err) {
  const message = err && err.message ? String(err.message) : '';
  return PUBLIC_SMOKE_ERRORS.has(message) ? message : 'smoke_failed';
}

function tokensMatch(expected, provided) {
  if (!expected || provided == null || provided === '') return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(provided));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isSmokeStripeSession(session) {
  return Boolean(session && session.metadata && String(session.metadata.smoke) === 'true');
}

function smokeParams(email) {
  const params = buildSubscriptionCheckoutParams({
    priceId: PRICE_IDS.premium,
    origin: 'https://www.fitmunch.com.au',
    plan: 'premium',
    email,
    successPath: '/checkout/success',
    cancelPath: '/pricing',
  });
  delete params.customer;
  params.customer_email = email;
  params.metadata = { ...(params.metadata || {}), smoke: 'true' };
  delete params.metadata.email;
  if (params.subscription_data && params.subscription_data.metadata) {
    params.subscription_data.metadata = {
      ...params.subscription_data.metadata,
      smoke: 'true',
    };
  }
  return params;
}

function sessionIdOk(id) {
  return /^cs_(live|test)_[A-Za-z0-9]+$/.test(String(id || ''));
}

async function expireSession(stripeClient, sessionId) {
  if (!sessionIdOk(sessionId) || typeof stripeClient.rawRequest !== 'function') {
    throw new Error('expire_unavailable');
  }
  await stripeClient.rawRequest(
    'POST',
    `/v1/checkout/sessions/${sessionId}/expire`,
    {},
    { apiVersion: STRIPE_CHECKOUT_API_VERSION }
  );
}

function blockingHonesty(reasons) {
  return (reasons || []).filter((reason) => (
    reason === 'foreign-brand'
    || reason === 'currency-conversion'
    || reason === 'adaptive-on'
    || String(reason).startsWith('currency=')
  ));
}

async function createAndExpire(stripeClient, email) {
  const params = smokeParams(email);
  if (params.customer) {
    const err = new Error('smoke_would_attach_customer');
    err.statusCode = 500;
    throw err;
  }
  let session = null;
  let expireError = null;
  try {
    session = await stripeClient.rawRequest(
      'POST',
      '/v1/checkout/sessions',
      params,
      { apiVersion: STRIPE_CHECKOUT_API_VERSION }
    );
  } catch (err) {
    const wrapped = new Error('stripe_create_failed');
    wrapped.statusCode = 500;
    throw wrapped;
  }

  const id = session && session.id;
  const url = session && session.url;
  try {
    if (sessionIdOk(id)) await expireSession(stripeClient, id);
    else expireError = new Error('expire_unavailable');
  } catch (err) {
    expireError = err;
  }

  if (!sessionIdOk(id) || !String(id).startsWith('cs_live_')) {
    const err = new Error(String(id || '').startsWith('cs_test_') ? 'test_session_refused' : 'live_session_required');
    err.statusCode = 500;
    throw err;
  }
  if (!String(url || '').startsWith(CHECKOUT_URL_PREFIX)) {
    const err = new Error('checkout_url_rejected');
    err.statusCode = 500;
    throw err;
  }
  const reasons = honestyFailures(session);
  const blocked = blockingHonesty(reasons);
  if (blocked.length || expireError) {
    const err = new Error(expireError ? 'expire_failed' : 'honesty_failed');
    err.statusCode = 500;
    err.honesty = reasons;
    throw err;
  }
  return { session, reasons };
}

async function handleSmokeCheckout(req, res, deps) {
  try {
    const expectedToken = deps && deps.token != null
      ? deps.token
      : process.env.SMOKE_TOKEN;
    const provided = req.headers['x-fitmunch-smoke-token'];
    if (!tokensMatch(expectedToken, provided)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const expectedEmail = String(
      (deps && deps.email != null ? deps.email : process.env.SMOKE_USER_EMAIL) || ''
    ).trim().toLowerCase();
    if (!expectedEmail) {
      return res.status(503).json({ ok: false, error: 'smoke_misconfigured', missing: ['SMOKE_USER_EMAIL'] });
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(auth.slice(7), (deps && deps.jwtSecret) || jwtSecret());
    } catch (_) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const email = String(decoded.email || '').toLowerCase();
    if (email !== expectedEmail) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const getStripe = deps && deps.getStripe;
    const stripeClient = typeof getStripe === 'function' ? getStripe() : null;
    if (!stripeClient || typeof stripeClient.rawRequest !== 'function') {
      return res.status(503).json({ ok: false, error: 'smoke_misconfigured', missing: ['stripe'] });
    }

    const storage = (deps && deps.storage) || require('../server/storage.js');
    const missingFns = ['getUserById', 'withStripeCustomerLock', 'effectiveTier']
      .filter((name) => typeof storage[name] !== 'function');
    if (missingFns.length) {
      return res.status(500).json({ ok: false, error: 'storage_unavailable', missing: missingFns });
    }

    const user = await storage.getUserById(decoded.userId);
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    const tier = storage.effectiveTier(user);

    let created;
    await storage.withStripeCustomerLock(`smoke:${user.id}`, async () => {
      created = await createAndExpire(stripeClient, expectedEmail);
    });

    const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
    return res.status(200).json({
      ok: true,
      mode: 'live',
      session: String(created.session.id).slice(0, 12),
      url: created.session.url,
      storage: 'ok',
      tier,
      deployment: process.env.VERCEL_DEPLOYMENT_ID || null,
      sha: sha || null,
      expired: true,
      honesty: created.reasons,
    });
  } catch (err) {
    const code = publicSmokeError(err);
    const status = code === 'smoke_failed' ? 500 : (Number(err && err.statusCode) || 500);
    try {
      console.error('FM_SMOKE_CHECKOUT ' + JSON.stringify({
        error: code,
        detail: String(err && err.message ? err.message : 'failed').slice(0, 300),
      }));
    } catch (_) { /* ignore */ }
    if (!res.headersSent) {
      const body = { ok: false, error: code };
      if (code === 'honesty_failed' && err && err.honesty) body.honesty = err.honesty;
      return res.status(status).json(body);
    }
  }
}

function mountSmokeCheckout(app, deps) {
  app.post('/api/internal/smoke/checkout', (req, res) => handleSmokeCheckout(req, res, deps || {}));
}

module.exports = {
  mountSmokeCheckout,
  handleSmokeCheckout,
  isSmokeStripeSession,
  smokeParams,
  tokensMatch,
  publicSmokeError,
  CHECKOUT_URL_PREFIX,
};
