require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const { sendWelcomeEmail } = require('./server/email.js');
const { sendApiError, GENERIC_API_ERROR, isInternalLeak } = require('./lib/public-error');
// Custom domain configuration (simplified for Replit)
const configureCustomDomain = (app) => {
  // Basic configuration for Replit environment
  app.set('trust proxy', true);
};
// Initialize Stripe only if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.log('Warning: STRIPE_SECRET_KEY not found. Stripe functionality will be disabled.');
}

const app = express();

const parseAllowedOrigins = () => {
  const configured = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

  const defaults = [
    'https://fitmunch.com.au',
    'https://www.fitmunch.com.au',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://127.0.0.1:5000',
  ];

  if (process.env.VERCEL_URL) {
    defaults.push(`https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}`);
  }
  ['VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'].forEach((key) => {
    const raw = process.env[key];
    if (!raw) return;
    const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
    try {
      defaults.push(new URL(normalized).origin);
    } catch (_) {
      /* ignore */
    }
  });

  return Array.from(new Set([...defaults, ...configured]));
};

const allowedOrigins = parseAllowedOrigins();

// Security: Enhanced Helmet configuration with Replit preview support
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://checkout.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://checkout.stripe.com"],
      formAction: ["'self'", "https://checkout.stripe.com"],
      frameAncestors: ["'self'"], // Allow Replit preview
      scriptSrcAttr: ["'unsafe-inline'"], // Allow onclick="" handlers (app uses inline event handlers throughout)
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow external fonts
  frameguard: false, // Disable X-Frame-Options to allow Replit preview iframe
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Enable CORS with explicit origin allowlist (credentials-safe)
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients / same-origin requests without Origin header.
    if (!origin) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`CORS blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  maxAge: 86400
}));
// Compression must be registered before static file serving
const compression = require('compression');
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Serve only essential static files from public directory for security.
// Absolute path so Vercel serverless cwd doesn't matter.
const PUBLIC_DIR = path.join(__dirname, 'public');

function providedAnalyticsKey(req) {
  return req.query.key || req.headers['x-fm-analytics-key'] || '';
}

function analyticsKeyMatches(req) {
  const expected = process.env.FM_ANALYTICS_KEY;
  const provided = String(providedAnalyticsKey(req) || '');
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

// Private analytics UI is not a public page. Block before static so /funnel.html
// cannot be fetched without the server-side key.
app.use((req, res, next) => {
  const pathOnly = (req.path || '').replace(/\/$/, '') || '/';
  if (pathOnly !== '/funnel' && pathOnly !== '/funnel.html') return next();
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!analyticsKeyMatches(req)) {
    return res.status(401).sendFile(path.join(PUBLIC_DIR, '404.html'));
  }
  if (pathOnly === '/funnel') {
    return res.sendFile(path.join(PUBLIC_DIR, 'funnel.html'));
  }
  return next();
});

const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")';
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Explicit root — Vercel rewrites can normalize "/" so static fallthrough may miss it.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Configure custom domain support
configureCustomDomain(app);

// Stripe webhooks must see the raw request body. Register this before global JSON parsing.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Add body size limits for security and parse JSON/URL-encoded data
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Rate limiting for API endpoints
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
// Behind Railway / Vercel proxy — prefer X-Forwarded-For; normalize IPv6 for express-rate-limit v8+
const rateLimitKey = (req) => {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  return ipKeyGenerator(raw);
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

app.use('/api/', apiLimiter);

// Strict limiter ONLY on login + register — NOT on /me (called on every page load)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 min per real IP
  message: 'Too many login attempts, please try again in 15 minutes.',
  keyGenerator: rateLimitKey,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── STRIPE WEBHOOK (raw body BEFORE json parser) ──────────────────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe) return res.status(503).send('Stripe not configured');
  if (!webhookSecret) return res.status(400).send('STRIPE_WEBHOOK_SECRET not set');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook sig failed:', err && err.type, err && err.message);
    if (isInternalLeak(err && err.message)) return res.status(400).send('Webhook Error');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { updateUserSubscription, updateUserCoachBilling, effectiveTier, db, schema } = require('./server/storage.js');
  const { eq } = require('drizzle-orm');

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_details?.email || session.metadata?.email;
        const customerName = session.customer_details?.name || '';
        const planId = session.metadata?.plan || '';
        const planLabels = { 'pt-starter': 'Starter', 'pt-pro': 'Pro', 'premium': 'Premium' };
        const planLabel = planLabels[planId] || planId || 'PT';
        const sessionCustomerId = typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id;
        if (sessionCustomerId) {
          await cancelNewerDuplicateSubscriptions(stripe, sessionCustomerId);
          await cancelNewerDuplicatesAcrossCustomers(stripe, sessionCustomerId, customerEmail);
        }
        console.log(`Checkout completed: ${customerEmail} → plan ${planId}`);

        // Send welcome email asynchronously (fire-and-forget, don't block webhook response)
        if (customerEmail) {
          sendWelcomeEmail(customerEmail, customerName, planLabel).then(r => {
            console.log('Welcome email result:', r.success ? `sent (${r.messageId})` : `FAILED: ${r.error}`);
          }).catch(e => console.error('Welcome email error:', e.message));
        }
        try {
          const { isCoachPlanName } = require('./lib/fitmunch-checkout');
          if (!isCoachPlanName(planId)) {
            const { scheduleFunnelEvent, trialStartedFromCheckoutSession } = require('./lib/funnel-events');
            scheduleFunnelEvent(
              trialStartedFromCheckoutSession(session, 'webhook'),
              event && event.id ? `trial:${event.id}` : ''
            );
          }
        } catch (_) {
          /* funnel log must not change the webhook response */
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        let tierSource = sub;
        const liveNow = LIVE_SUBSCRIPTION_STATUSES.includes(sub.status);
        const runDedupe = Boolean(sub.customer) && (
          event.type === 'customer.subscription.created' ||
          (event.type === 'customer.subscription.updated' && liveNow)
        );
        if (runDedupe) {
          const deduped = await cancelNewerDuplicateSubscriptions(stripe, sub.customer, [sub]);
          if (deduped.kept) tierSource = deduped.kept;
          const across = await cancelNewerDuplicatesAcrossCustomers(stripe, sub.customer);
          const eventCancelled = (across.cancelled || []).some((row) => row.id === sub.id);
          if (eventCancelled && across.kept) tierSource = across.kept;
        }
        const users = await db.select().from(schema.users).where(eq(schema.users.stripeCustomerId, sub.customer));
        const { isCoachSubscription, coachTierUpdateFromStripe } = require('./lib/fitmunch-coach-billing');
        if (isCoachSubscription(tierSource)) {
          const coachUpdate = coachTierUpdateFromStripe(tierSource);
          if (users[0]) {
            await updateUserCoachBilling(users[0].id, coachUpdate, users[0].settings);
          }
          console.log(`Coach subscription ${event.type}: customer ${sub.customer} → ${coachUpdate.tier}`);
          break;
        }
        const { tier, expiresAt } = subscriptionTierUpdateFromStripe(tierSource);
        if (users[0]) {
          await updateUserSubscription(users[0].id, tier, expiresAt);
          if (tier === 'free' && effectiveTier({ ...users[0], subscriptionTier: 'free' }) === 'premium') {
            const until = users[0].settings && users[0].settings.compPremiumUntil;
            console.log(`[comp] ${users[0].email || users[0].id} stays Premium until ${until} after Stripe set the tier to free`);
          }
        }
        console.log(`Subscription ${event.type}: customer ${sub.customer} → ${tier}`);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const users = await db.select().from(schema.users).where(eq(schema.users.stripeCustomerId, sub.customer));
        const {
          isCoachSubscription,
          coachTierUpdateFromStripe,
          customerStillHasLiveCoachSub,
        } = require('./lib/fitmunch-coach-billing');
        if (isCoachSubscription(sub)) {
          const stillCoach = sub.customer
            ? await customerStillHasLiveCoachSub(stripe, sub.customer, sub.id)
            : false;
          if (users[0] && !stillCoach) {
            const coachUpdate = coachTierUpdateFromStripe({ ...sub, status: 'canceled' });
            await updateUserCoachBilling(users[0].id, coachUpdate, users[0].settings);
          }
          if (stillCoach) {
            console.warn(`[coach] ignored cancel for ${sub.id}; customer ${sub.customer} still has a live Coach subscription`);
          } else {
            console.log(`Coach subscription cancelled: customer ${sub.customer}`);
          }
          break;
        }
        const stillLive = sub.customer
          ? await customerStillHasLiveFitMunchSub(stripe, sub.customer, sub.id)
          : false;
        if (users[0] && !stillLive) {
          await updateUserSubscription(users[0].id, 'free', null);
          if (effectiveTier({ ...users[0], subscriptionTier: 'free' }) === 'premium') {
            const until = users[0].settings && users[0].settings.compPremiumUntil;
            console.log(`[comp] ${users[0].email || users[0].id} stays Premium until ${until} after Stripe set the tier to free`);
          }
        }
        if (stillLive) {
          console.warn(`[checkout] ignored cancel for ${sub.id}; customer ${sub.customer} still has a live FitMunch subscription`);
        } else {
          console.log(`Subscription cancelled: customer ${sub.customer}`);
        }
        break;
      }
      case 'invoice.payment_failed':
        console.warn(`Payment failed: customer ${event.data.object.customer}`);
        break;
      default:
        console.log(`Webhook: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err && err.type, err && err.message);
    return res.status(500).send('Handler error');
  }
  res.json({ received: true });
});

// Add API router before auth middleware
const apiRouter = require('./api_server');
app.use('/api', apiRouter);

// Receipt scanner (multer file upload — must mount separately)
const receiptScanner = require('./receipt-scanner');
app.use('/api/receipt', receiptScanner);

// AI Meal Planner
const mealPlanner = require('./meal-planner');
app.use('/api/meal-plan', mealPlanner);

// Fitness Butler shopper (public specials, draft trolley, takeaway checkout)
const shopperApi = require('./shopper');
app.use('/api/shopper', shopperApi);

// Coach plan builder (PT). Billing and landers stay in other parts.
const coachApi = require('./coach-api');
app.use('/api/coach', coachApi.api);
app.use(coachApi.pages);

// Food Database (search + macro lookup)
const foodDb = require('./food-db');
app.use('/api/foods', foodDb);

// Health check — used by Railway to verify the app is running
// Clean URLs for SEO landing pages
app.get('/for-pts', (req, res) => res.sendFile('for-pts.html', { root: 'public' }));
app.get('/for-trainers', (req, res) => res.redirect(301, '/for-pts'));
app.get('/best-pt-software-australia', (req, res) => res.redirect(301, '/for-pts'));
app.get('/best-personal-trainer-software-australia', (req, res) => res.redirect(301, '/for-pts'));
app.get('/receipt-nutrition-scanner', (req, res) => res.sendFile('receipt-nutrition-scanner.html', { root: 'public' }));
app.get('/receipt-to-meal-plan', (req, res) => res.redirect(301, '/receipt-nutrition-scanner'));
app.get('/ai-meal-planner-australia', (req, res) => res.sendFile('ai-meal-planner-australia.html', { root: 'public' }));
app.get('/budget-meal-planner', (req, res) => res.sendFile('budget-meal-planner.html', { root: 'public' }));
app.get('/haul-teardown', (req, res) => res.sendFile('haul-teardown.html', { root: 'public' }));
app.get('/woolworths-haul-teardown', (req, res) => res.redirect(301, '/haul-teardown'));
app.get('/shopper', (req, res) => res.sendFile('shopper.html', { root: 'public' }));
app.get('/fitness-butler', (req, res) => res.redirect(301, '/shopper'));
app.get('/butler', (req, res) => res.redirect(301, '/shopper'));
app.get('/demo', (req, res) => res.sendFile('demo.html', { root: 'public' }));
app.get('/try', (req, res) => res.redirect(301, '/demo'));
// SEO pack 2 landers (new routes only)
app.get('/woolworths-meal-planner', (req, res) => res.sendFile('woolworths-meal-planner.html', { root: 'public' }));
app.get('/coles-meal-planner', (req, res) => res.sendFile('coles-meal-planner.html', { root: 'public' }));
app.get('/meal-prep-shopping-list', (req, res) => res.sendFile('meal-prep-shopping-list.html', { root: 'public' }));
// FitMunch Coach landers. Trial CTA is /for-pts#coach until Coach checkout exists.
app.get('/meal-plan-software-personal-trainers', (req, res) => res.sendFile('meal-plan-software-personal-trainers.html', { root: 'public' }));
app.get('/pt-client-meal-plans-woolworths', (req, res) => res.sendFile('pt-client-meal-plans-woolworths.html', { root: 'public' }));
app.get('/fitmunch-coach-vs-spreadsheets', (req, res) => res.sendFile('fitmunch-coach-vs-spreadsheets.html', { root: 'public' }));
// SEO pack 3 landers (new routes only; do not retarget pack 1 or pack 2)
app.get('/family-meal-plan', (req, res) => res.sendFile('family-meal-plan.html', { root: 'public' }));
app.get('/macro-meal-planner', (req, res) => res.sendFile('macro-meal-planner.html', { root: 'public' }));
app.get('/meal-plan-for-one', (req, res) => res.sendFile('meal-plan-for-one.html', { root: 'public' }));
// /funnel is gated before static files (analytics key required).

// Clean auth/app URLs (marketing + IG often omit .html)
function authQuery(req) {
  return req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
}
function registerRedirectTarget(req) {
  // Preserve inbound query (plan/invite/etc). Do not default plan=premium:
  // "Start free" / /register must open a free account, not Stripe checkout.
  const q = authQuery(req);
  if (!q) return '/login.html#register';
  return `/login.html${q}#register`;
}
app.get('/login', (req, res) => res.redirect(301, '/login.html' + authQuery(req)));
app.get('/register', (req, res) => res.redirect(301, registerRedirectTarget(req)));
// Common aliases people/typeahead/bookmarks hit - must not 404
app.get('/auth', (req, res) => res.redirect(301, registerRedirectTarget(req)));
app.get('/signup', (req, res) => res.redirect(301, registerRedirectTarget(req)));
app.get('/sign-up', (req, res) => res.redirect(301, registerRedirectTarget(req)));
app.get('/app', (req, res) => res.redirect(302, '/app.html' + authQuery(req)));
app.get('/checkout', (req, res) => res.redirect(302, '/pricing'));
app.get('/support', (req, res) => res.sendFile('support.html', { root: 'public' }));
app.get('/refund', (req, res) => res.sendFile('refund.html', { root: 'public' }));
app.get('/terms', (req, res) => res.sendFile('terms.html', { root: 'public' }));
app.get('/pricing', (req, res) => res.sendFile('pricing.html', { root: 'public' }));
app.get('/coach/upgrade', (req, res) => res.sendFile('coach-upgrade.html', { root: 'public' }));
app.get('/contact', (req, res) => res.sendFile('contact.html', { root: 'public' }));
app.get('/privacy', (req, res) => res.sendFile('privacy.html', { root: 'public' }));
app.get('/checkout/success', (req, res) => res.sendFile('success.html', { root: 'public' }));


const { ok: apiOk } = require('./lib/api-json');

// Debug DB probe — disabled in production (was publicly exposing schema names).
app.get("/api/db-test", (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  return (async () => {
    try {
      const pg = require("pg");
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      await pool.query("SELECT 1 as connected");
      const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
      await pool.end();
      res.json({ ok: true, tables: tables.rows.map(r => r.table_name) });
    } catch (e) {
      console.error('[db-test]', e);
      res.status(500).json({ ok: false, error: GENERIC_API_ERROR });
    }
  })();
});
app.get('/api/health', (req, res) => {
  apiOk(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'fitmunch',
  });
});

// Old public Stripe probe. Do not publish payment-test internals.
app.get('/api/stripe-test', (_req, res) => {
  return res.status(404).json({ success: false, error: 'Not found' });
});

// Endpoint to create a Stripe checkout session
app.post('/api/stripe/checkout-sessions', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const { priceId, customerId, successUrl, cancelUrl } = req.body || {};

    if (!priceId || !customerId || !successUrl || !cancelUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters'
      });
    }

    const plan = planForPriceId(priceId);
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Unknown FitMunch price.' });
    }

    // Unauthenticated. Ignore the customer id in the body: attaching Checkout
    // to it would show that customer's saved cards and leak subscription state.
    const storage = require('./server/storage.js');
    const { nonce, ip, userAgent } = checkoutRequestParts(req, req.body || {});
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fingerprint = guestCheckoutFingerprint({
      nonce,
      email,
      plan,
      ip,
      userAgent,
      uniquePerRequest: !nonce && !email,
    });
    const result = await storage.withStripeCustomerLock(`guest:${fingerprint}:${email}:${priceId}`, () =>
      openUnauthenticatedCheckout(stripe, {
        fingerprint,
        email,
        priceId,
        plan,
        origin: checkoutOrigin(req),
      })
    );

    res.json({
      success: true,
      url: result.url,
      id: result.id
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
    });
  }
});

const {
  PRICE_IDS,
  PRICE_TO_TIER,
  jwtSecret,
  checkoutOrigin,
  normalizeCheckoutPlan,
  subscriptionTierUpdateFromStripe,
  findOrCreateStripeCustomer,
  resolveSubscriptionCheckout,
  cancelNewerDuplicateSubscriptions,
  customerStillHasLiveFitMunchSub,
  stripeIdempotencyKey,
  planForPriceId,
  guestCheckoutFingerprint,
  checkoutRequestParts,
  openUnauthenticatedCheckout,
  createFitMunchCustomer,
  cancelNewerDuplicatesAcrossCustomers,
  linkedCustomerHasLiveFitMunchSub,
  LIVE_SUBSCRIPTION_STATUSES,
  resetCheckoutGuardsForTests,
} = require('./lib/fitmunch-checkout');

function requireAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }
  const jwtLib = require('jsonwebtoken');
  try {
    return jwtLib.verify(authHeader.slice(7), jwtSecret());
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      const authErr = new Error('Authentication required.');
      authErr.statusCode = 401;
      throw authErr;
    }
    throw err;
  }
}

function sendAuthError(err, res) {
  if (err.statusCode === 401 || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Authentication required.' });
    return true;
  }
  return false;
}

async function loadCheckoutUser(decoded) {
  const storage = require('./server/storage.js');
  let checkoutSmokeFallback = false;
  let user = null;
  try {
    user = await storage.getUserById(decoded.userId);
  } catch (dbErr) {
    if (process.env.FITMUNCH_CHECKOUT_SMOKE_FALLBACK === 'true' && process.env.NODE_ENV !== 'production') {
      checkoutSmokeFallback = true;
      user = {
        id: decoded.userId,
        email: decoded.email || `smoke-${decoded.userId}@fitmunch.invalid`,
        name: decoded.name || 'FitMunch Smoke User',
        subscriptionTier: 'free',
        stripeCustomerId: null,
      };
    } else {
      throw dbErr;
    }
  }
  if (!user) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }
  return { storage, user, checkoutSmokeFallback };
}

function checkoutJson(result) {
  if (result.alreadySubscribed) {
    return {
      alreadySubscribed: true,
      url: null,
      message: result.message,
    };
  }
  return { url: result.url, id: result.id };
}

// ── PUBLIC CHECKOUT (no auth, creates customer on the fly, 14-day trial) ──────
app.post('/api/quick-checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured.' });

  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const plan = req.body?.plan;
    if (!email || !plan) {
      return res.status(400).json({ success: false, error: 'Email and plan are required.' });
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return res.status(400).json({ success: false, error: `Unknown plan: ${plan}. Use premium, pt-starter, or pt-pro.` });
    }

    // Same response whether or not this email already has a Stripe customer
    // or a subscription. Do not look the email up.
    const storage = require('./server/storage.js');
    const { nonce, ip, userAgent } = checkoutRequestParts(req, req.body || {});
    const fingerprint = guestCheckoutFingerprint({ nonce, email, plan, ip, userAgent });
    const result = await storage.withStripeCustomerLock(`guest:${fingerprint}`, () =>
      openUnauthenticatedCheckout(stripe, {
        fingerprint,
        email,
        priceId,
        plan,
        origin: checkoutOrigin(req),
      })
    );

    return res.json({ success: true, url: result.url, id: result.id });
  } catch (error) {
    return sendApiError(res, error, 'Quick checkout error');
  }
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });

  try {
    const decoded = requireAuthUser(req);

    const requestedPlan = typeof req.body?.plan === 'string' ? req.body.plan : null;
    if (!requestedPlan) {
      return res.status(400).json({ error: 'Plan is required.' });
    }
    const isPtPlan = ['pt-starter', 'pt-pro'].includes(requestedPlan);
    if (isPtPlan && decoded.role !== 'pt') {
      return res.status(403).json({
        error: 'PT plans are only available for trainer accounts.'
      });
    }
    const plan = normalizeCheckoutPlan(requestedPlan, decoded.role);
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return res.status(400).json({ error: `Unknown plan: ${requestedPlan}` });
    }

    const { storage, user, checkoutSmokeFallback } = await loadCheckoutUser(decoded);
    const { eq } = require('drizzle-orm');
    const result = await storage.withStripeCustomerLock(`user:${user.id}`, async () => {
      // Re-read inside the lock so a concurrent new-user submit sees the customer
      // id the first request just stored.
      let current = user;
      if (!checkoutSmokeFallback) {
        const fresh = await storage.getUserById(user.id);
        if (fresh) current = fresh;
      }
      if (current.stripeCustomerId && await linkedCustomerHasLiveFitMunchSub(stripe, current.stripeCustomerId)) {
        return {
          alreadySubscribed: true,
          url: null,
          message: 'You already have an active FitMunch subscription. Open Billing to manage it.',
        };
      }
      const customerId = await findOrCreateStripeCustomer(stripe, {
        userId: current.id,
        email: current.email,
        name: current.name,
        existingCustomerId: current.stripeCustomerId,
      });
      if (!checkoutSmokeFallback && customerId !== current.stripeCustomerId) {
        await storage.updateUserSubscription(current.id, current.subscriptionTier || 'free', null);
        await storage.db.update(storage.schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(storage.schema.users.id, current.id));
      }
      return resolveSubscriptionCheckout(stripe, {
        customerId,
        priceId,
        plan,
        email: current.email,
        origin: checkoutOrigin(req),
      });
    });

    res.json(checkoutJson(result));
  } catch (err) {
    if (sendAuthError(err, res)) return;
    if (err.statusCode === 404) return res.status(404).json({ error: 'User not found.' });
    return sendApiError(res, err, 'Checkout error');
  }
});

// FitMunch Coach. Separate from consumer Premium (A$19.99). Price IDs are env-only.
app.post('/api/coach/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured.' });
  const coachBilling = require('./lib/fitmunch-coach-billing');
  try {
    const plan = typeof req.body?.plan === 'string' ? req.body.plan.trim() : '';
    if (!coachBilling.isCoachPlan(plan)) {
      return res.status(400).json({
        success: false,
        error: 'Unknown Coach plan. Use coach-39 or coach-79.',
      });
    }
    const priceId = coachBilling.coachPriceId(plan);
    if (!priceId) {
      const envName = plan === 'coach-39' ? 'STRIPE_COACH_39_PRICE_ID' : 'STRIPE_COACH_79_PRICE_ID';
      return res.status(503).json({
        success: false,
        error: `Coach price is not configured. Set ${envName}.`,
      });
    }

    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const decoded = requireAuthUser(req);
      if (decoded.role !== 'pt') {
        return res.status(403).json({
          success: false,
          error: 'Coach plans are only available for trainer accounts.',
        });
      }
      const { storage, user, checkoutSmokeFallback } = await loadCheckoutUser(decoded);
      const { eq } = require('drizzle-orm');
      const result = await storage.withStripeCustomerLock(`user:${user.id}`, async () => {
        let current = user;
        if (!checkoutSmokeFallback) {
          const fresh = await storage.getUserById(user.id);
          if (fresh) current = fresh;
        }
        if (current.stripeCustomerId && await linkedCustomerHasLiveFitMunchSub(stripe, current.stripeCustomerId)) {
          return coachBilling.openCoachBilling(stripe, {
            customerId: current.stripeCustomerId,
            priceId,
            plan,
            email: current.email,
            origin: checkoutOrigin(req),
          });
        }
        const customerId = await findOrCreateStripeCustomer(stripe, {
          userId: current.id,
          email: current.email,
          name: current.name,
          existingCustomerId: current.stripeCustomerId,
        });
        if (!checkoutSmokeFallback && customerId !== current.stripeCustomerId) {
          await storage.updateUserSubscription(current.id, current.subscriptionTier || 'free', null);
          await storage.db.update(storage.schema.users)
            .set({ stripeCustomerId: customerId })
            .where(eq(storage.schema.users.id, current.id));
        }
        return coachBilling.openCoachBilling(stripe, {
          customerId,
          priceId,
          plan,
          email: current.email,
          origin: checkoutOrigin(req),
        });
      });
      if (result.upgraded) {
        return res.json({
          success: true,
          upgraded: true,
          url: null,
          id: result.id,
          message: result.message,
        });
      }
      return res.json({ success: true, ...checkoutJson(result) });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email and plan are required.' });
    }
    const storage = require('./server/storage.js');
    const { nonce, ip, userAgent } = checkoutRequestParts(req, req.body || {});
    const fingerprint = guestCheckoutFingerprint({ nonce, email, plan, ip, userAgent });
    const result = await storage.withStripeCustomerLock(`guest:coach:${fingerprint}`, () =>
      openUnauthenticatedCheckout(stripe, {
        fingerprint,
        email,
        priceId,
        plan,
        origin: checkoutOrigin(req),
        successPath: coachBilling.COACH_SUCCESS_PATH,
        cancelPath: coachBilling.COACH_CANCEL_PATH,
      })
    );
    return res.json({ success: true, url: result.url, id: result.id });
  } catch (err) {
    if (sendAuthError(err, res)) return;
    if (err.statusCode === 404) return res.status(404).json({ success: false, error: 'User not found.' });
    const status = Number(err.statusCode);
    const code = status >= 400 && status < 500 ? status : 500;
    if (code >= 500 || isInternalLeak(err && err.message)) {
      console.error('Coach checkout error:', err);
      return res.status(500).json({ success: false, error: 'Coach checkout failed.' });
    }
    return res.status(code).json({ success: false, error: err.message || 'Coach checkout failed.' });
  }
});

// ── SUBSCRIPTION SYNC (webhook-independent) ───────────────────────────────────
// Called by the app when returning from Stripe checkout (?subscribed=1) and
// available any time from Billing. Reads the customer's subscriptions straight
// from Stripe and updates the tier — so a missed/misrouted webhook can never
// leave a paying customer stuck on free.
app.post('/api/stripe/sync-subscription', async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured.' });
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    const jwtLib = require('jsonwebtoken');
    const decoded = jwtLib.verify(authHeader.slice(7), jwtSecret());

    const { getUserById, updateUserSubscription, updateUserCoachBilling, effectiveTier } = require('./server/storage.js');
    const { isCoachSubscription, coachTierUpdateFromStripe } = require('./lib/fitmunch-coach-billing');
    const user = await getUserById(decoded.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (!user.stripeCustomerId) {
      return res.json({ success: true, tier: effectiveTier(user), synced: false });
    }

    const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: 'all', limit: 10 });
    const liveRows = (subs.data || []).filter(s => ['active', 'trialing'].includes(s.status));
    const liveCoach = liveRows.find(s => isCoachSubscription(s));
    const live = liveRows.find(s => !isCoachSubscription(s));
    let coach = null;
    if (liveCoach) {
      const coachUpdate = coachTierUpdateFromStripe(liveCoach);
      coach = await updateUserCoachBilling(user.id, coachUpdate, user.settings);
      user.settings = { ...(user.settings || {}), coach };
    }
    let tier = user.subscriptionTier || 'free';
    let expiresAt = null;
    if (live) {
      const priceId = live.items?.data[0]?.price?.id;
      tier = PRICE_TO_TIER[priceId] || 'starter';
      const periodEnd = live.current_period_end || live.items?.data[0]?.current_period_end;
      expiresAt = periodEnd ? new Date(periodEnd * 1000) : null;
    } else if (!liveCoach) {
      tier = 'free';
      expiresAt = null;
    }
    const previousTier = user.subscriptionTier || 'free';
    const accessTier = effectiveTier({ ...user, subscriptionTier: tier });
    if (previousTier !== tier) {
      await updateUserSubscription(user.id, tier, expiresAt);
      console.log(`[sync-subscription] ${user.email}: ${previousTier} → ${tier}`);
      if (tier === 'free' && accessTier === 'premium') {
        const until = user.settings && user.settings.compPremiumUntil;
        console.log(`[comp] ${user.email} stays Premium until ${until} after Stripe sync set the tier to free`);
      }
    }
    return res.json({
      success: true,
      tier: accessTier,
      status: (live || liveCoach)?.status || 'none',
      synced: true,
      ...(coach ? { coach } : {}),
    });
  } catch (err) {
    return sendApiError(res, err, '[sync-subscription]');
  }
});

// Endpoint to complete subscription after payment success
app.post('/api/complete-subscription', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID is required'
      });
    }

    // Retrieve the session to verify payment
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer']
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    // Return subscription details
    res.json({
      success: true,
      message: 'Subscription completed successfully',
      subscription: session.subscription,
      customer: session.customer
    });

  } catch (error) {
    console.error('Error completing subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete subscription',
    });
  }
});

// Endpoint to create or get Stripe customer
app.post('/api/stripe/customers', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = req.body?.name || '';
    const metadata = req.body?.metadata || {};

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required'
      });
    }

    // Unauthenticated. Never look up an existing customer by email.
    const storage = require('./server/storage.js');
    const { nonce, ip, userAgent } = checkoutRequestParts(req, req.body || {});
    const fingerprint = guestCheckoutFingerprint({ nonce, email, plan: 'customer', ip, userAgent });
    const safeMeta = { ...(metadata || {}) };
    delete safeMeta.userId;
    delete safeMeta.user_id;
    const customer = await storage.withStripeCustomerLock(`guest-customer:${fingerprint}`, () =>
      createFitMunchCustomer(stripe, {
        email,
        name,
        metadata: safeMeta,
        idempotencyParts: ['public-customer', fingerprint, email],
      })
    );

    res.json({ 
      success: true, 
      id: customer.id,
      email
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
    });
  }
});

// ── SESSION LOOKUP (used by success page) ─────────────────────────────────────
app.get('/api/checkout/session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json({
      plan: session.metadata?.plan || null,
      planLabel: session.metadata?.plan || null,
      email: session.customer_details?.email || null,
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
      paymentStatus: session.payment_status,
    });
  } catch (e) {
    res.status(404).json({ error: 'Session not found.' });
  }
});

// ── STRIPE CUSTOMER PORTAL (billing / cancel) ─────────────────────────────────
app.post('/api/billing-portal', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  try {
    const decoded = requireAuthUser(req);
    const { user } = await loadCheckoutUser(decoded);
    // Never trust a customer id from the browser. A logged-in user can only
    // open the portal for the Stripe customer stored on their own account.
    const customerId = user.stripeCustomerId;
    if (!customerId) return res.status(400).json({ error: 'No billing account for this user.' });

    const origin = checkoutOrigin(req);
    const portal = await stripe.billingPortal.sessions.create(
      {
        customer: customerId,
        return_url: `${origin}/pricing`,
      },
      { idempotencyKey: stripeIdempotencyKey(['portal', user.id, customerId]) }
    );
    res.json({ success: true, url: portal.url });
  } catch (e) {
    if (sendAuthError(e, res)) return;
    if (e.statusCode === 404) return res.status(404).json({ error: 'User not found.' });
    return sendApiError(res, e, 'Billing portal error');
  }
});

// Legacy pass-through: runs only for requests no earlier route handled.
// /api/* auth is enforced in api_server.js (authMiddleware), not here.
app.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, jwtSecret());
      req.user = { id: decoded.userId, name: decoded.name };
    } catch (e) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
});

// Unmatched /api/* → JSON 404 (consistent for clients and tools)
app.use((req, res, next) => {
  if ((req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) && !res.headersSent) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  next();
});

// Central error handler — JSON for /api, otherwise fall through to Express default
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const isApi = req.path.startsWith('/api') || req.originalUrl.startsWith('/api');
  if (!isApi) {
    return next(err);
  }
  const jsonParseError = err && (
    err.type === 'entity.parse.failed'
    || (err instanceof SyntaxError && Number(err.status || err.statusCode) === 400)
  );
  if (jsonParseError) {
    console.error('Invalid JSON body');
    return res.status(400).json({ success: false, error: 'Invalid JSON' });
  }
  console.error(err);
  let code = Number(err.status || err.statusCode);
  if (!Number.isFinite(code) || code < 400 || code >= 600) code = 500;
  if (code >= 500 || isInternalLeak(err && err.message)) {
    return res.status(code >= 500 ? code : 500).json({ success: false, error: GENERIC_API_ERROR });
  }
  res.status(code).json({ success: false, error: err.message || 'Error' });
});

// Catch-all for unmatched non-API routes → custom 404 page
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const port = process.env.PORT || 5000;

// Vercel (and tests) load this module without listening; `node server.js` / Railway start the server.
if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 FitMunch running on port ${port}`);
  }).on('error', (err) => {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

function setStripeForTests(next) {
  stripe = next;
  resetCheckoutGuardsForTests();
}

module.exports = app;
module.exports._private = {
  subscriptionTierUpdateFromStripe,
  setStripeForTests,
  PRICE_IDS,
  jwtSecret,
};
