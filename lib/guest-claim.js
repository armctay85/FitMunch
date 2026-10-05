'use strict';

/**
 * Guest checkout is not an account. A paying guest attaches the Stripe
 * customer only by redeeming a signed, single-use token while logged in.
 * The token is HMAC(session id, customer id, expiry) and works for 7 days
 * from when it is issued. Email is not proof. A guest whose link expired can
 * ask for a fresh one, which only ever goes to the Stripe customer email.
 */

const crypto = require('crypto');
const { ensureSchema, getPool } = require('./db-migrate');
const { hitRateCounter, resetSharedCountersForTests } = require('./shared-counters');
const { isTransientWebhookError } = require('./webhook-error');
const { checkoutSessionIsFitMunch } = require('./fitmunch-checkout');
const { linkUserToStripeCustomer, usersHoldingStripeCustomer } = require('./fitmunch-account-link');

const CLAIM_TTL_DAYS = 7;
const CLAIM_TTL_SECONDS = CLAIM_TTL_DAYS * 24 * 60 * 60;
const CLAIM_STALE_MS = 5 * 60 * 1000;
const MIN_CLAIM_SECRET_BYTES = 32;

const memoryClaims = new Map();
let devClaimSecret = '';
let warnedMissingClaimSecret = false;

// Vercel production and preview builds are deployed environments. A random
// per-instance secret there would mint links that fail on the next lambda.
function isDeployedEnv(env = process.env) {
  if (env.NODE_ENV === 'production') return true;
  const vercelEnv = String(env.VERCEL_ENV || '').toLowerCase();
  return vercelEnv === 'production' || vercelEnv === 'preview';
}

function configuredClaimSecret(env = process.env) {
  return String(env.GUEST_CLAIM_SECRET || '').trim();
}

/**
 * Deployed environments need GUEST_CLAIM_SECRET of at least 32 bytes.
 * Returns '' when the secret is fine, or a short reason (never the value).
 */
function guestClaimSecretProblem(env = process.env) {
  if (!isDeployedEnv(env)) return '';
  const configured = configuredClaimSecret(env);
  if (!configured) return 'missing';
  if (Buffer.byteLength(configured, 'utf8') < MIN_CLAIM_SECRET_BYTES) return 'too-short';
  return '';
}

function claimSecret() {
  const configured = configuredClaimSecret();
  // Deployed: only a dedicated secret of 32+ bytes. Never JWT_SECRET or a
  // known dev string. Without one, no links are minted or accepted.
  if (isDeployedEnv()) return guestClaimSecretProblem() ? '' : configured;
  if (configured) return configured;
  if (!devClaimSecret) devClaimSecret = crypto.randomBytes(32).toString('base64url');
  return devClaimSecret;
}

/**
 * Boot check. Loud in deployed environments; /api/health also reports 503
 * (server.js) so a missing secret cannot go unnoticed after a deploy.
 */
function warnMissingGuestClaimSecret() {
  if (warnedMissingClaimSecret) return;
  const problem = guestClaimSecretProblem();
  if (!problem) return;
  warnedMissingClaimSecret = true;
  console.error(
    `[guest-claim] CONFIG ERROR: GUEST_CLAIM_SECRET is ${problem === 'missing' ? 'not set' : 'shorter than 32 bytes'}. ` +
    'Guest claim links are disabled until it is set.'
  );
}

function resetGuestClaimsForTests() {
  memoryClaims.clear();
  resetSharedCountersForTests();
  warnedMissingClaimSecret = false;
  devClaimSecret = '';
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// The 7-day window runs from when this link is issued (welcome email or a
// resend), not from when the checkout session was created.
function mintGuestClaimToken({ sessionId, customerId } = {}, now = Date.now()) {
  if (!claimSecret()) return '';
  const sid = String(sessionId || '').trim();
  const cus = String(customerId || '').trim();
  if (!sid || !cus) return '';
  const exp = Math.floor(now / 1000) + CLAIM_TTL_SECONDS;
  const payload = `${sid}.${cus}.${exp}`;
  const sig = crypto.createHmac('sha256', claimSecret()).update(payload).digest('base64url');
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  return `${body}.${sig}`;
}

function readGuestClaimToken(token, now = Date.now()) {
  if (!claimSecret()) return null;
  const raw = String(token || '');
  if (raw.length < 20 || raw.length > 2000) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let payload = '';
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch (_) {
    return null;
  }
  const expected = crypto.createHmac('sha256', claimSecret()).update(payload).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  const parts = payload.split('.');
  if (parts.length < 3) return null;
  const exp = Number(parts[parts.length - 1]);
  const customerId = parts[parts.length - 2];
  const sessionId = parts.slice(0, -2).join('.');
  if (!sessionId || !customerId || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= now) return { expired: true, sessionId, customerId, exp };
  return { sessionId, customerId, exp };
}

async function beginClaimUse(token, parsed, now = Date.now()) {
  const hash = tokenHash(token);
  if (!process.env.DATABASE_URL) {
    const row = memoryClaims.get(hash);
    if (row && row.usedAt) return { ok: false, reason: 'used' };
    if (row && !row.usedAt && now - row.startedAt < CLAIM_STALE_MS) {
      return { ok: false, reason: 'in-progress' };
    }
    memoryClaims.set(hash, {
      usedAt: null,
      startedAt: now,
      sessionId: parsed.sessionId,
      customerId: parsed.customerId,
    });
    return { ok: true, hash };
  }
  const pool = getPool();
  if (!pool) return beginMemoryFallback(hash, parsed, now);
  const ready = await ensureSchema();
  if (!ready) {
    const err = new Error('database unavailable');
    err.code = '08006';
    throw err;
  }
  const inserted = await pool.query(
    `INSERT INTO stripe_claim_tokens (token_hash, session_id, customer_id, expires_at)
     VALUES ($1, $2, $3, to_timestamp($4))
     ON CONFLICT (token_hash) DO NOTHING`,
    [hash, parsed.sessionId, parsed.customerId, parsed.exp]
  );
  if (inserted.rowCount > 0) return { ok: true, hash };
  const existing = await pool.query(
    `SELECT used_at, started_at FROM stripe_claim_tokens WHERE token_hash = $1`,
    [hash]
  );
  const row = existing.rows && existing.rows[0];
  if (!row) return { ok: false, reason: 'used' };
  if (row.used_at) return { ok: false, reason: 'used' };
  const reclaimed = await pool.query(
    `UPDATE stripe_claim_tokens
     SET started_at = NOW()
     WHERE token_hash = $1
       AND used_at IS NULL
       AND started_at < NOW() - INTERVAL '5 minutes'`,
    [hash]
  );
  if (reclaimed.rowCount > 0) return { ok: true, hash };
  return { ok: false, reason: 'in-progress' };
}

function beginMemoryFallback(hash, parsed, now) {
  const row = memoryClaims.get(hash);
  if (row && row.usedAt) return { ok: false, reason: 'used' };
  if (row && !row.usedAt && now - row.startedAt < CLAIM_STALE_MS) {
    return { ok: false, reason: 'in-progress' };
  }
  memoryClaims.set(hash, {
    usedAt: null,
    startedAt: now,
    sessionId: parsed.sessionId,
    customerId: parsed.customerId,
  });
  return { ok: true, hash };
}

async function finishClaimUse(hash, userId) {
  if (!process.env.DATABASE_URL) {
    const row = memoryClaims.get(hash);
    if (row) row.usedAt = Date.now();
    if (row) row.userId = userId || null;
    return;
  }
  const pool = getPool();
  if (!pool) {
    const row = memoryClaims.get(hash);
    if (row) row.usedAt = Date.now();
    return;
  }
  await pool.query(
    `UPDATE stripe_claim_tokens SET used_at = NOW(), user_id = $2 WHERE token_hash = $1 AND used_at IS NULL`,
    [hash, userId || null]
  );
  const row = memoryClaims.get(hash);
  if (row) row.usedAt = Date.now();
}

async function releaseClaimUse(hash) {
  if (!hash) return;
  if (!process.env.DATABASE_URL) {
    const row = memoryClaims.get(hash);
    if (row && !row.usedAt) memoryClaims.delete(hash);
    return;
  }
  const pool = getPool();
  if (!pool) {
    const row = memoryClaims.get(hash);
    if (row && !row.usedAt) memoryClaims.delete(hash);
    return;
  }
  await pool.query(
    `DELETE FROM stripe_claim_tokens WHERE token_hash = $1 AND used_at IS NULL`,
    [hash]
  );
}

function maskEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.indexOf('@');
  if (at <= 0 || at === raw.length - 1) return '';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const localMasked = local.slice(0, 1) + '***';
  const dot = domain.lastIndexOf('.');
  if (dot <= 0) return localMasked + '@' + domain.slice(0, 1) + '***';
  const host = domain.slice(0, dot);
  const hostMasked = host.length <= 1 ? host : host.slice(0, 1) + '***';
  return localMasked + '@' + hostMasked + domain.slice(dot);
}

function sessionLoggedInUserId(session) {
  if (!session) return '';
  const meta = session.metadata || {};
  return String(meta.userId || meta.user_id || session.client_reference_id || '').trim();
}

function sessionCustomerId(session) {
  if (!session) return '';
  if (typeof session.customer === 'string') return session.customer;
  return (session.customer && session.customer.id) || '';
}

function sessionSubscriptionId(session) {
  if (!session || !session.subscription) return '';
  if (typeof session.subscription === 'string') return session.subscription;
  return session.subscription.id || '';
}

async function subscriptionForClaim(stripe, session, customerId) {
  const subId = sessionSubscriptionId(session);
  if (subId && typeof stripe.subscriptions?.retrieve === 'function') {
    try {
      return await stripe.subscriptions.retrieve(subId);
    } catch (err) {
      if (isTransientWebhookError(err)) throw err;
      return null;
    }
  }
  if (typeof stripe.subscriptions?.list !== 'function') return null;
  const listed = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const { LIVE_SUBSCRIPTION_STATUSES, subscriptionMatchesAllowlist } = require('./fitmunch-checkout');
  const live = (listed.data || []).filter((sub) =>
    sub &&
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) &&
    subscriptionMatchesAllowlist(sub)
  );
  live.sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id || '').localeCompare(String(b.id || '')));
  return live[0] || null;
}

const CLAIM_INVALID = { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
const CLAIM_OWNED = {
  ok: false,
  status: 409,
  error: 'This purchase is already attached to another account.',
};

async function loadClaimSession(token, stripe) {
  const parsed = readGuestClaimToken(token);
  if (!parsed || parsed.expired) return { ...CLAIM_INVALID };
  if (!stripe || typeof stripe.checkout?.sessions?.retrieve !== 'function') {
    return { ok: false, status: 503, error: 'Billing is not available.' };
  }
  let session = null;
  try {
    session = await stripe.checkout.sessions.retrieve(parsed.sessionId);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    return { ...CLAIM_INVALID };
  }
  const customerId = sessionCustomerId(session);
  if (!session || session.id !== parsed.sessionId || customerId !== parsed.customerId) {
    return { ...CLAIM_INVALID };
  }
  if (session.status && session.status !== 'complete') return { ...CLAIM_INVALID };
  if (!checkoutSessionIsFitMunch(session)) return { ...CLAIM_INVALID };
  return { ok: true, parsed, session, customerId };
}

function payerEmail(session) {
  if (!session) return '';
  return session.customer_details?.email || session.customer_email || session.metadata?.email || '';
}

async function previewGuestClaim(user, token, stripe) {
  const loaded = await loadClaimSession(token, stripe);
  if (!loaded.ok) return loaded;
  const sessionUser = sessionLoggedInUserId(loaded.session);
  if (sessionUser) return { ...CLAIM_INVALID };
  return {
    ok: true,
    status: 200,
    payerEmailMasked: maskEmail(payerEmail(loaded.session)),
    accountEmailMasked: maskEmail(user && user.email),
  };
}

async function redeemGuestClaim(user, token, stripe) {
  const loaded = await loadClaimSession(token, stripe);
  if (!loaded.ok) return loaded;
  const { parsed, session, customerId } = loaded;
  const gate = await beginClaimUse(token, parsed);
  if (!gate.ok) {
    const error = gate.reason === 'in-progress'
      ? 'Claim link is already being used.'
      : 'Claim link has already been used.';
    return { ok: false, status: 409, error };
  }
  try {
    const sessionUser = sessionLoggedInUserId(session);
    if (sessionUser && String(user && user.id || '') !== sessionUser) {
      await finishClaimUse(gate.hash, user && user.id);
      return { ...CLAIM_OWNED };
    }
    const sub = await subscriptionForClaim(stripe, session, customerId);
    const linked = await linkUserToStripeCustomer(user, customerId, sub);
    if (!linked.linked) {
      if (linked.reason === 'owned-by-other') {
        await finishClaimUse(gate.hash, user && user.id);
        return { ...CLAIM_OWNED };
      }
      await releaseClaimUse(gate.hash);
      return {
        ok: false,
        status: 409,
        error: 'This account is already linked to different billing.',
      };
    }
    await finishClaimUse(gate.hash, user && user.id);
    return {
      ok: true,
      status: 200,
      alreadyAttached: Boolean(linked.alreadyAttached),
      user: linked.user,
    };
  } catch (err) {
    await releaseClaimUse(gate.hash);
    throw err;
  }
}

// ── "Email me a new link" ─────────────────────────────────────────────────
// Anyone can ask. The reply is the same for every input, and a link is only
// ever sent to the Stripe customer email of a complete, FitMunch, guest
// checkout whose customer no account holds yet.
const RESEND_GENERIC_REPLY = 'If that email paid for FitMunch before it had an account, a new link is on its way. It works once, within 7 days.';
const RESEND_PER_EMAIL_MAX = 3;
const RESEND_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000;
const RESEND_MAX_EMAIL_LENGTH = 254;

function normaliseEmail(input) {
  if (typeof input !== 'string') return '';
  const email = input.trim().toLowerCase();
  if (!email || email.length > RESEND_MAX_EMAIL_LENGTH) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

// Per-email limit, shared across instances through Postgres (memory when
// there is no database). Keyed by a hash of the normalised email.
async function resendAllowed(email, now = Date.now()) {
  const hits = await hitRateCounter('claim-resend-email', email, { windowMs: RESEND_PER_EMAIL_WINDOW_MS, now });
  return hits <= RESEND_PER_EMAIL_MAX;
}

function sessionCheckoutEmail(session) {
  const recorded = (session && session.customer_details && session.customer_details.email) ||
    (session && session.customer_email) || '';
  return String(recorded).trim().toLowerCase();
}

function sessionPaid(session) {
  // A trial checkout completes with no_payment_required; the card is on file.
  return session && session.status === 'complete' &&
    (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
}

async function listCustomersByEmail(stripe, email, typed) {
  const seen = new Map();
  const variants = [...new Set([email, String(typed || '').trim()].filter(Boolean))];
  for (const variant of variants) {
    const listed = await stripe.customers.list({ email: variant, limit: 10 });
    for (const customer of (listed && listed.data) || []) {
      if (customer && customer.id && !customer.deleted) seen.set(customer.id, customer);
    }
  }
  return [...seen.values()];
}

/**
 * Find the newest unclaimed FitMunch guest checkout for this email.
 * Returns { session, customerId, to } or null.
 */
async function findUnclaimedGuestCheckout(stripe, email, typed) {
  const customers = await listCustomersByEmail(stripe, email, typed);
  let best = null;
  for (const customer of customers) {
    const customerEmail = String(customer.email || '').trim().toLowerCase();
    if (customerEmail !== email) continue;
    const listed = await stripe.checkout.sessions.list({ customer: customer.id, limit: 20 });
    for (const session of (listed && listed.data) || []) {
      if (!sessionPaid(session)) continue;
      // Owner check: the customer's current Stripe email must still equal the
      // email recorded at checkout (customer_details.email, else
      // customer_email), case-insensitively. If the Stripe email was changed
      // since checkout, neither the old nor the new address gets a link; the
      // caller still sees the generic reply. Support can attach it by hand.
      if (sessionCheckoutEmail(session) !== email) continue;
      if (!checkoutSessionIsFitMunch(session)) continue;
      if (sessionLoggedInUserId(session)) continue;
      if (sessionCustomerId(session) !== customer.id) continue;
      if (!best || (session.created || 0) > (best.session.created || 0)) {
        best = { session, customerId: customer.id, to: String(customer.email).trim() };
      }
    }
  }
  if (!best) return null;
  const holders = await usersHoldingStripeCustomer(best.customerId);
  if (holders.length) return null;
  return best;
}

function claimUrlForToken(token) {
  return `https://www.fitmunch.com.au/login.html#claim=${encodeURIComponent(token)}`;
}

function withDeadline(promise, deadlineAt, label) {
  if (!deadlineAt) return promise;
  const ms = deadlineAt - Date.now();
  if (ms <= 0) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(Object.assign(new Error(`${label} timed out`), { code: 'CLAIM_RESEND_TIMEOUT', label }));
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'CLAIM_RESEND_TIMEOUT', label })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Always resolves to the generic reply. Errors are logged by type only.
 *
 * options.lookupDeadlineAt / options.sendDeadlineAt (epoch ms) put a hard cap
 * on the Stripe lookup and on the email send, so the caller can reply at one
 * fixed time whatever the outcome (server.js claim-resend).
 */
async function resendGuestClaimLink(input, stripe, options = {}) {
  const reply = { ok: true, status: 200, message: RESEND_GENERIC_REPLY, sent: false };
  const email = normaliseEmail(input);
  if (!email) return reply;
  if (!stripe || typeof stripe.customers?.list !== 'function' ||
      typeof stripe.checkout?.sessions?.list !== 'function') {
    return reply;
  }
  if (!claimSecret()) return reply;
  try {
    const allowed = await withDeadline(resendAllowed(email, options.now), options.lookupDeadlineAt, 'rate check');
    if (!allowed) return reply;
    const found = await withDeadline(findUnclaimedGuestCheckout(stripe, email, input), options.lookupDeadlineAt, 'lookup');
    if (!found) return reply;
    const token = mintGuestClaimToken({ sessionId: found.session.id, customerId: found.customerId }, options.now);
    if (!token) return reply;
    const emailApi = options.emailApi || require('../server/email.js');
    const sent = await withDeadline(
      emailApi.sendClaimLinkEmail(found.to, claimUrlForToken(token)),
      options.sendDeadlineAt,
      'send'
    );
    if (!sent || sent.success !== true) console.error('[claim-resend] send failed');
    else {
      reply.sent = true;
      console.log('[claim-resend] link sent');
    }
  } catch (err) {
    if (err && err.code === 'CLAIM_RESEND_TIMEOUT') console.error(`[claim-resend] CLAIM_RESEND_TIMEOUT: ${err.label} hit its deadline`);
    else console.error('[claim-resend] failed', err && err.type, err && err.code);
  }
  return reply;
}

module.exports = {
  CLAIM_TTL_DAYS,
  CLAIM_TTL_SECONDS,
  MIN_CLAIM_SECRET_BYTES,
  RESEND_GENERIC_REPLY,
  isDeployedEnv,
  guestClaimSecretProblem,
  resendGuestClaimLink,
  claimUrlForToken,
  mintGuestClaimToken,
  readGuestClaimToken,
  previewGuestClaim,
  redeemGuestClaim,
  resetGuestClaimsForTests,
  warnMissingGuestClaimSecret,
  maskEmail,
  sessionLoggedInUserId,
};
