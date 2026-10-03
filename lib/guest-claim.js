'use strict';

/**
 * Guest checkout is not an account. A paying guest attaches the Stripe
 * customer only by redeeming a signed, single-use, short-lived token while
 * logged in. The token is HMAC(session id, customer id, expiry). Email is
 * not proof.
 */

const crypto = require('crypto');
const { ensureSchema, getPool } = require('./db-migrate');
const { isTransientWebhookError } = require('./webhook-error');
const { checkoutSessionIsFitMunch } = require('./fitmunch-checkout');
const { linkUserToStripeCustomer } = require('./fitmunch-account-link');

const CLAIM_TTL_SECONDS = 60 * 60;
const CLAIM_STALE_MS = 5 * 60 * 1000;

const memoryClaims = new Map();

function claimSecret() {
  return process.env.GUEST_CLAIM_SECRET || process.env.JWT_SECRET || 'fitmunch-dev-secret';
}

function resetGuestClaimsForTests() {
  memoryClaims.clear();
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function mintGuestClaimToken({ sessionId, customerId, sessionCreated } = {}) {
  const sid = String(sessionId || '').trim();
  const cus = String(customerId || '').trim();
  if (!sid || !cus) return '';
  const created = Number(sessionCreated);
  const base = Number.isFinite(created) && created > 0 ? Math.floor(created) : Math.floor(Date.now() / 1000);
  const exp = base + CLAIM_TTL_SECONDS;
  const payload = `${sid}.${cus}.${exp}`;
  const sig = crypto.createHmac('sha256', claimSecret()).update(payload).digest('base64url');
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  return `${body}.${sig}`;
}

function readGuestClaimToken(token, now = Date.now()) {
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

async function redeemGuestClaim(user, token, stripe) {
  const parsed = readGuestClaimToken(token);
  if (!parsed || parsed.expired) {
    return { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
  }
  if (!stripe || typeof stripe.checkout?.sessions?.retrieve !== 'function') {
    return { ok: false, status: 503, error: 'Billing is not available.' };
  }
  let session = null;
  try {
    session = await stripe.checkout.sessions.retrieve(parsed.sessionId);
  } catch (err) {
    if (isTransientWebhookError(err)) throw err;
    return { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
  }
  const customerId = sessionCustomerId(session);
  if (!session || session.id !== parsed.sessionId || customerId !== parsed.customerId) {
    return { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
  }
  if (session.status && session.status !== 'complete') {
    return { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
  }
  if (!checkoutSessionIsFitMunch(session)) {
    return { ok: false, status: 400, error: 'Claim link is invalid or expired.' };
  }
  const gate = await beginClaimUse(token, parsed);
  if (!gate.ok) {
    const status = gate.reason === 'in-progress' ? 409 : 409;
    const error = gate.reason === 'in-progress'
      ? 'Claim link is already being used.'
      : 'Claim link has already been used.';
    return { ok: false, status, error };
  }
  try {
    const sub = await subscriptionForClaim(stripe, session, customerId);
    const linked = await linkUserToStripeCustomer(user, customerId, sub);
    if (!linked.linked) {
      await releaseClaimUse(gate.hash);
      return {
        ok: false,
        status: 409,
        error: 'This account is already linked to different billing.',
      };
    }
    await finishClaimUse(gate.hash, user && user.id);
    return { ok: true, status: 200, user: linked.user };
  } catch (err) {
    await releaseClaimUse(gate.hash);
    throw err;
  }
}

module.exports = {
  CLAIM_TTL_SECONDS,
  mintGuestClaimToken,
  readGuestClaimToken,
  redeemGuestClaim,
  resetGuestClaimsForTests,
};
