'use strict';

/**
 * One row per Stripe event id. The insert is the claim.
 * A finished event is not run again. A fresh unfinished claim stays in
 * progress. A claim still unfinished after a few minutes is taken over,
 * so a crash between insert and mark does not drop the payment.
 */

const crypto = require('crypto');
const { ensureSchema, getPool } = require('./db-migrate');

const STALE_CLAIM_MS = 5 * 60 * 1000;
const EVENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

const INSERT_EVENT_SQL = `
INSERT INTO stripe_events (event_id, type, received_at)
VALUES ($1, $2, NOW())
ON CONFLICT (event_id) DO NOTHING
`;

const SELECT_EVENT_SQL = `
SELECT processed_at, received_at FROM stripe_events WHERE event_id = $1
`;

const RECLAIM_EVENT_SQL = `
UPDATE stripe_events
SET received_at = NOW()
WHERE event_id = $1
  AND processed_at IS NULL
  AND received_at < NOW() - INTERVAL '5 minutes'
`;

const MARK_EVENT_SQL = `
UPDATE stripe_events SET processed_at = NOW() WHERE event_id = $1 AND processed_at IS NULL
`;

const RELEASE_EVENT_SQL = `
DELETE FROM stripe_events WHERE event_id = $1 AND processed_at IS NULL
`;

const PRUNE_EVENTS_SQL = `
DELETE FROM stripe_events
WHERE processed_at IS NOT NULL
  AND received_at < NOW() - INTERVAL '60 days'
`;

const WELCOME_SEEN_SQL = `
SELECT 1 FROM stripe_welcome_sends WHERE send_key = $1 AND status = 'sent'
`;

const WELCOME_MARK_SQL = `
INSERT INTO stripe_welcome_sends (send_key, status, sent_at)
VALUES ($1, 'sent', NOW())
ON CONFLICT (send_key) DO NOTHING
`;

const CLAIM_SEND_SQL = `
INSERT INTO stripe_welcome_sends (send_key, status, claimed_at, claim_token)
VALUES ($1, 'pending', NOW(), $2)
ON CONFLICT (send_key) DO NOTHING
`;

const SELECT_SEND_SQL = `
SELECT status, claimed_at, claim_token FROM stripe_welcome_sends WHERE send_key = $1
`;

// Keep the interval in step with STALE_CLAIM_MS.
// A takeover replaces claim_token. Mark and release match that token, so the
// sender we replaced cannot record sent or delete the new claim.
const RECLAIM_SEND_SQL = `
UPDATE stripe_welcome_sends
SET claimed_at = NOW(), claim_token = $2
WHERE send_key = $1
  AND status = 'pending'
  AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes')
`;

const MARK_SEND_SQL = `
UPDATE stripe_welcome_sends
SET status = 'sent', sent_at = NOW()
WHERE send_key = $1 AND status = 'pending' AND claim_token = $2
`;

const RELEASE_SEND_SQL = `
DELETE FROM stripe_welcome_sends
WHERE send_key = $1 AND status = 'pending' AND claim_token = $2
`;

const memoryEvents = new Map();
const welcomeSends = new Map();

function resetStripeEventsForTests() {
  memoryEvents.clear();
  welcomeSends.clear();
}

function stripeEventCountForTests() {
  return memoryEvents.size;
}

function ageStripeEventForTests(eventId, ageMs, now = Date.now()) {
  const row = memoryEvents.get(eventId);
  if (!row) return;
  row.receivedAt = new Date(now - ageMs);
}

function newClaimToken() {
  return crypto.randomUUID();
}

function rememberSend(sendKey, status, claimedAt = Date.now(), token = '') {
  const existing = welcomeSends.get(sendKey) || {};
  welcomeSends.set(sendKey, {
    status,
    claimedAt,
    token: token || existing.token || '',
  });
}

function claimMemorySend(sendKey, now = Date.now()) {
  const existing = welcomeSends.get(sendKey);
  if (!existing) {
    const token = newClaimToken();
    rememberSend(sendKey, 'pending', now, token);
    return { claimed: true, token };
  }
  if (existing.status === 'sent') return { claimed: false, sent: true };
  const age = now - (existing.claimedAt || 0);
  if (age >= STALE_CLAIM_MS) {
    const token = newClaimToken();
    existing.claimedAt = now;
    existing.status = 'pending';
    existing.token = token;
    return { claimed: true, reclaimed: true, token };
  }
  return { claimed: false, inProgress: true };
}

async function ageNotificationSendForTests(sendKey, ageMs, now = Date.now()) {
  const row = welcomeSends.get(sendKey);
  if (row && row.status !== 'sent') row.claimedAt = now - ageMs;
  if (!sendKey || !process.env.DATABASE_URL) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE stripe_welcome_sends
     SET claimed_at = NOW() - ($2::bigint * INTERVAL '1 millisecond')
     WHERE send_key = $1 AND status = 'pending'`,
    [sendKey, ageMs]
  );
}

function pruneMemory(now = Date.now()) {
  const cutoff = now - EVENT_RETENTION_MS;
  for (const [eventId, row] of memoryEvents) {
    if (row.processedAt && row.receivedAt && row.receivedAt.getTime() < cutoff) {
      memoryEvents.delete(eventId);
    }
  }
}

function claimMemory(eventId, type, now = Date.now()) {
  pruneMemory(now);
  const existing = memoryEvents.get(eventId);
  if (!existing) {
    memoryEvents.set(eventId, {
      eventId,
      type: type || '',
      receivedAt: new Date(now),
      processedAt: null,
    });
    return { proceed: true };
  }
  if (existing.processedAt) return { proceed: false, alreadyProcessed: true };
  const age = now - (existing.receivedAt ? existing.receivedAt.getTime() : now);
  if (age >= STALE_CLAIM_MS) {
    existing.receivedAt = new Date(now);
    existing.type = type || existing.type;
    return { proceed: true, reclaimed: true };
  }
  return { proceed: false, inProgress: true };
}

async function pruneStripeEvents(now = Date.now()) {
  pruneMemory(now);
  if (!process.env.DATABASE_URL) return;
  const pool = getPool();
  if (!pool) return;
  try {
    const ready = await ensureSchema();
    if (!ready) return;
    await pool.query(PRUNE_EVENTS_SQL);
  } catch (_) {
    console.error('[stripe-events] prune failed');
  }
}

async function claimStripeEvent(eventId, type) {
  if (!eventId) return { proceed: true, tracked: false };
  if (!process.env.DATABASE_URL) return { ...claimMemory(eventId, type), tracked: true };

  const pool = getPool();
  if (!pool) return { ...claimMemory(eventId, type), tracked: true };
  const ready = await ensureSchema();
  if (!ready) {
    const err = new Error('database unavailable');
    err.code = '08006';
    throw err;
  }
  try {
    await pool.query(PRUNE_EVENTS_SQL);
  } catch (_) {
    console.error('[stripe-events] prune failed');
  }
  const inserted = await pool.query(INSERT_EVENT_SQL, [eventId, type || '']);
  if (inserted.rowCount > 0) return { proceed: true, tracked: true };
  const existing = await pool.query(SELECT_EVENT_SQL, [eventId]);
  const row = existing.rows && existing.rows[0];
  if (row && row.processed_at) return { proceed: false, alreadyProcessed: true, tracked: true };
  const reclaimed = await pool.query(RECLAIM_EVENT_SQL, [eventId]);
  if (reclaimed.rowCount > 0) return { proceed: true, reclaimed: true, tracked: true };
  return { proceed: false, inProgress: true, tracked: true };
}

async function markStripeEventProcessed(eventId) {
  if (!eventId) return;
  if (!process.env.DATABASE_URL) {
    const row = memoryEvents.get(eventId);
    if (row) row.processedAt = new Date();
    return;
  }
  const pool = getPool();
  if (!pool) {
    const row = memoryEvents.get(eventId);
    if (row) row.processedAt = new Date();
    return;
  }
  await pool.query(MARK_EVENT_SQL, [eventId]);
}

async function releaseStripeEvent(eventId) {
  if (!eventId) return;
  if (!process.env.DATABASE_URL) {
    const row = memoryEvents.get(eventId);
    if (row && !row.processedAt) memoryEvents.delete(eventId);
    return;
  }
  const pool = getPool();
  if (!pool) {
    const row = memoryEvents.get(eventId);
    if (row && !row.processedAt) memoryEvents.delete(eventId);
    return;
  }
  await pool.query(RELEASE_EVENT_SQL, [eventId]);
}

async function welcomeAlreadySent(sendKey) {
  if (!sendKey) return false;
  if (!process.env.DATABASE_URL) {
    const row = welcomeSends.get(sendKey);
    return Boolean(row && row.status === 'sent');
  }
  const pool = getPool();
  if (!pool) {
    const row = welcomeSends.get(sendKey);
    return Boolean(row && row.status === 'sent');
  }
  const ready = await ensureSchema();
  if (!ready) {
    const row = welcomeSends.get(sendKey);
    return Boolean(row && row.status === 'sent');
  }
  const found = await pool.query(WELCOME_SEEN_SQL, [sendKey]);
  return Boolean(found.rows && found.rows.length);
}

async function markWelcomeSent(sendKey) {
  if (!sendKey) return;
  rememberSend(sendKey, 'sent');
  if (!process.env.DATABASE_URL) return;
  const pool = getPool();
  if (!pool) return;
  const ready = await ensureSchema();
  if (!ready) return;
  await pool.query(WELCOME_MARK_SQL, [sendKey]);
}

function sendStoreReady() {
  if (!process.env.DATABASE_URL) return null;
  const pool = getPool();
  return pool || null;
}

async function requireSendStore() {
  const pool = sendStoreReady();
  if (!pool) return null;
  const ready = await ensureSchema();
  if (!ready) {
    const err = new Error('database unavailable');
    err.code = '08006';
    throw err;
  }
  return pool;
}

/**
 * Claim a one-time send (payment-failed customer mail and owner alert).
 * The insert is a pending claim, same table as welcome sends, different key.
 * A row already marked sent is not sent again. A fresh pending claim stays
 * in progress. A pending claim older than a few minutes is taken over, so a
 * crash or a failed release does not drop the email forever. Takeover sets a
 * new claim token. Mark sent and release match that token, so the sender we
 * replaced cannot record sent or delete the new claim. Mark sent only after
 * the provider accepts the send. Release deletes a pending row when the send
 * failed and this holder still owns the row.
 */
async function claimNotificationSend(sendKey) {
  if (!sendKey) return { claimed: false, tracked: false };
  const pool = await requireSendStore();
  if (!pool) return { ...claimMemorySend(sendKey), tracked: true };
  const token = newClaimToken();
  const inserted = await pool.query(CLAIM_SEND_SQL, [sendKey, token]);
  if (inserted.rowCount > 0) {
    rememberSend(sendKey, 'pending', Date.now(), token);
    return { claimed: true, tracked: true, token };
  }
  const reclaimToken = newClaimToken();
  const reclaimed = await pool.query(RECLAIM_SEND_SQL, [sendKey, reclaimToken]);
  if (reclaimed.rowCount > 0) {
    rememberSend(sendKey, 'pending', Date.now(), reclaimToken);
    return { claimed: true, tracked: true, reclaimed: true, token: reclaimToken };
  }
  const existing = await pool.query(SELECT_SEND_SQL, [sendKey]);
  const row = existing.rows && existing.rows[0];
  if (row && row.status === 'sent') {
    rememberSend(sendKey, 'sent', Date.now(), row.claim_token || '');
    return { claimed: false, tracked: true, sent: true };
  }
  if (row) {
    const claimedAt = row.claimed_at ? new Date(row.claimed_at).getTime() : Date.now();
    rememberSend(sendKey, 'pending', claimedAt, row.claim_token || '');
    return { claimed: false, tracked: true, inProgress: true };
  }
  const err = new Error('payment notice claim lost');
  err.code = 'WEBHOOK_RETRY';
  throw err;
}

async function markNotificationSent(sendKey, claimToken) {
  if (!sendKey) return;
  const pool = await requireSendStore();
  if (!pool) {
    const row = welcomeSends.get(sendKey);
    if (row && row.status === 'sent') return;
    if (!row || row.status !== 'pending' || !claimToken || row.token !== claimToken) {
      const err = new Error('payment notice sent mark failed');
      err.code = 'WEBHOOK_RETRY';
      throw err;
    }
    row.status = 'sent';
    return;
  }
  const updated = await pool.query(MARK_SEND_SQL, [sendKey, claimToken]);
  if (!updated.rowCount) {
    const existing = await pool.query(SELECT_SEND_SQL, [sendKey]);
    const row = existing.rows && existing.rows[0];
    if (row && row.status === 'sent') {
      rememberSend(sendKey, 'sent', Date.now(), row.claim_token || '');
      return;
    }
    const err = new Error('payment notice sent mark failed');
    err.code = 'WEBHOOK_RETRY';
    throw err;
  }
  rememberSend(sendKey, 'sent', Date.now(), claimToken);
}

async function releaseNotificationSend(sendKey, claimToken) {
  if (!sendKey || !claimToken) return;
  const pool = await requireSendStore();
  if (!pool) {
    const row = welcomeSends.get(sendKey);
    if (row && row.status !== 'sent' && row.token === claimToken) welcomeSends.delete(sendKey);
    return;
  }
  await pool.query(RELEASE_SEND_SQL, [sendKey, claimToken]);
  const row = welcomeSends.get(sendKey);
  if (row && row.status !== 'sent' && row.token === claimToken) welcomeSends.delete(sendKey);
}

module.exports = {
  INSERT_EVENT_SQL,
  STALE_CLAIM_MS,
  EVENT_RETENTION_MS,
  claimStripeEvent,
  markStripeEventProcessed,
  releaseStripeEvent,
  pruneStripeEvents,
  welcomeAlreadySent,
  markWelcomeSent,
  claimNotificationSend,
  markNotificationSent,
  releaseNotificationSend,
  ageNotificationSendForTests,
  resetStripeEventsForTests,
  stripeEventCountForTests,
  ageStripeEventForTests,
};
