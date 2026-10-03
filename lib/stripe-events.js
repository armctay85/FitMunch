'use strict';

/**
 * One row per Stripe event id. The insert is the claim.
 * A second delivery sees the row and does not run side effects again.
 */

const { ensureSchema, getPool } = require('./db-migrate');

const INSERT_EVENT_SQL = `
INSERT INTO stripe_events (event_id, type, received_at)
VALUES ($1, $2, NOW())
ON CONFLICT (event_id) DO NOTHING
`;

const SELECT_EVENT_SQL = `
SELECT processed_at FROM stripe_events WHERE event_id = $1
`;

const MARK_EVENT_SQL = `
UPDATE stripe_events SET processed_at = NOW() WHERE event_id = $1 AND processed_at IS NULL
`;

const RELEASE_EVENT_SQL = `
DELETE FROM stripe_events WHERE event_id = $1 AND processed_at IS NULL
`;

const memoryEvents = new Map();

function resetStripeEventsForTests() {
  memoryEvents.clear();
}

function stripeEventCountForTests() {
  return memoryEvents.size;
}

function claimMemory(eventId, type) {
  const existing = memoryEvents.get(eventId);
  if (!existing) {
    memoryEvents.set(eventId, {
      eventId,
      type: type || '',
      receivedAt: new Date(),
      processedAt: null,
    });
    return { proceed: true };
  }
  if (existing.processedAt) return { proceed: false, alreadyProcessed: true };
  return { proceed: false, inProgress: true };
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
  const inserted = await pool.query(INSERT_EVENT_SQL, [eventId, type || '']);
  if (inserted.rowCount > 0) return { proceed: true, tracked: true };
  const existing = await pool.query(SELECT_EVENT_SQL, [eventId]);
  const row = existing.rows && existing.rows[0];
  if (row && row.processed_at) return { proceed: false, alreadyProcessed: true, tracked: true };
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

module.exports = {
  INSERT_EVENT_SQL,
  claimStripeEvent,
  markStripeEventProcessed,
  releaseStripeEvent,
  resetStripeEventsForTests,
  stripeEventCountForTests,
};
