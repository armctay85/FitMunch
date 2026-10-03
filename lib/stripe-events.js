'use strict';

/**
 * One row per Stripe event id. The insert is the claim.
 * A finished event is not run again. A fresh unfinished claim stays in
 * progress. A claim still unfinished after a few minutes is taken over,
 * so a crash between insert and mark does not drop the payment.
 */

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
SELECT 1 FROM stripe_welcome_sends WHERE send_key = $1
`;

const WELCOME_MARK_SQL = `
INSERT INTO stripe_welcome_sends (send_key) VALUES ($1)
ON CONFLICT (send_key) DO NOTHING
`;

const memoryEvents = new Map();
const welcomeSends = new Set();

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
  if (!process.env.DATABASE_URL) return welcomeSends.has(sendKey);
  const pool = getPool();
  if (!pool) return welcomeSends.has(sendKey);
  const ready = await ensureSchema();
  if (!ready) return welcomeSends.has(sendKey);
  const found = await pool.query(WELCOME_SEEN_SQL, [sendKey]);
  return Boolean(found.rows && found.rows.length);
}

async function markWelcomeSent(sendKey) {
  if (!sendKey) return;
  welcomeSends.add(sendKey);
  if (!process.env.DATABASE_URL) return;
  const pool = getPool();
  if (!pool) return;
  const ready = await ensureSchema();
  if (!ready) return;
  await pool.query(WELCOME_MARK_SQL, [sendKey]);
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
  resetStripeEventsForTests,
  stripeEventCountForTests,
  ageStripeEventForTests,
};
