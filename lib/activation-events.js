'use strict';

/**
 * Server-side activation events. One row per user per event name.
 *
 *   trial_started      checkout.session.completed, when a trial starts
 *   first_meal_logged  the user's first meal_logs insert
 *   day7_return        any authenticated /api call 7 or more days after signup
 *
 * Writes are scheduled and never awaited by the request. A database error
 * is logged and dropped. Repeat calls insert nothing (ON CONFLICT DO NOTHING).
 *
 * Signup backdate is off unless ACTIVATION_TEST_BACKDATE=1 and
 * ACTIVATION_TEST_TOKEN is set, and it only updates an account whose email
 * is activation-test@fitmunch.com.au (optional +tag).
 */

const crypto = require('crypto');

const EVENT_NAMES = ['trial_started', 'first_meal_logged', 'day7_return'];
const DAY7_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_ACCOUNT_EMAIL = /^activation-test(\+[a-z0-9._-]{1,64})?@fitmunch\.com\.au$/i;
const TEST_ACCOUNT_SQL = '^activation-test(\\+[a-z0-9._-]{1,64})?@fitmunch\\.com\\.au$';

const day7State = new Map();
let pending = new Set();
let queryOverride = null;
let generation = 0;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function compact(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function safeToken(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max || !/^[A-Za-z0-9_.:-]{1,80}$/.test(text)) return '';
  return text;
}

function safePlan(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9-]{1,40}$/.test(text) ? text : '';
}

function apiPathOf(req) {
  const raw = String((req && (req.originalUrl || req.url)) || '');
  const path = raw.split('?')[0].split('#')[0];
  if (!/^\/api\/[A-Za-z0-9/_.~-]{0,110}$/.test(path)) return '';
  return path.slice(0, 120);
}

function methodOf(req) {
  const method = String((req && req.method) || '').toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE)$/.test(method) ? method : '';
}

function sessionUserId(session) {
  if (!session) return '';
  const meta = session.metadata || {};
  return String(meta.userId || meta.user_id || session.client_reference_id || '').trim();
}

function activationTestEnabled() {
  return process.env.ACTIVATION_TEST_BACKDATE === '1';
}

function activationTestTokenOk(presented) {
  const expected = String(process.env.ACTIVATION_TEST_TOKEN || '');
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (b.length < 16 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function activationTestRequestOk(req) {
  if (!activationTestEnabled()) return false;
  const header = req && typeof req.get === 'function' ? req.get('x-activation-test-token') : '';
  return activationTestTokenOk(header || '');
}

function parseDaysAgo(value) {
  let n = null;
  if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else if (typeof value === 'string' && /^\d{1,4}$/.test(value)) n = Number(value);
  if (n == null || n < 0 || n > 3650) return null;
  return n;
}

async function query(sql, params) {
  if (queryOverride) return queryOverride(sql, params);
  const { ensureSchema, getPool } = require('./db-migrate');
  const ready = await ensureSchema();
  if (!ready) return { rows: [], rowCount: 0 };
  const pool = getPool();
  if (!pool) return { rows: [], rowCount: 0 };
  return pool.query(sql, params);
}

function enqueue(work) {
  const gen = generation;
  const job = new Promise((resolve) => {
    setImmediate(() => {
      if (gen !== generation) {
        resolve();
        return;
      }
      Promise.resolve()
        .then(work)
        .then(() => resolve(), (err) => {
          console.error('[activation] write failed', err && err.code ? err.code : 'error');
          resolve();
        });
    });
  });
  pending.add(job);
  job.finally(() => pending.delete(job));
}

function scheduleActivationEvent({ userId, eventName, source, metadata } = {}) {
  if (!isUuid(userId) || !EVENT_NAMES.includes(eventName)) return;
  const src = safeToken(source, 64) || '';
  const meta = compact(metadata);
  enqueue(() => query(
    `INSERT INTO activation_events (user_id, event_name, source, metadata)
     VALUES ($1::uuid, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, event_name) DO NOTHING`,
    [userId, eventName, src, JSON.stringify(meta)]
  ));
}

function scheduleFirstMealLogged(userId, mealId) {
  const id = Number(mealId);
  if (!isUuid(userId) || !Number.isInteger(id) || id <= 0) return;
  enqueue(() => query(
    `INSERT INTO activation_events (user_id, event_name, source, metadata)
     SELECT $1::uuid, 'first_meal_logged', 'meal_log', $3::jsonb
     WHERE EXISTS (
       SELECT 1 FROM meal_logs WHERE user_id = $1::uuid AND id = $2::int
     )
     AND NOT EXISTS (
       SELECT 1 FROM meal_logs WHERE user_id = $1::uuid AND id < $2::int
     )
     ON CONFLICT (user_id, event_name) DO NOTHING`,
    [userId, id, JSON.stringify({ mealId: id })]
  ));
}

function rememberDay7(userId, state) {
  if (day7State.size > 50000) {
    const first = day7State.keys().next().value;
    day7State.delete(first);
  }
  day7State.set(userId, state);
}

function clearDay7Cache(userId) {
  if (userId) day7State.delete(userId);
}

async function runDay7(userId, metadata) {
  try {
    const result = await query(
      `WITH candidate AS (
         SELECT id, created_at,
                (created_at <= now() - interval '7 days') AS due
         FROM users
         WHERE id = $1::uuid
       ),
       ins AS (
         INSERT INTO activation_events (user_id, event_name, source, metadata)
         SELECT id, 'day7_return', 'api', $2::jsonb
         FROM candidate
         WHERE due
         ON CONFLICT (user_id, event_name) DO NOTHING
       )
       SELECT created_at, due FROM candidate`,
      [userId, JSON.stringify(metadata || {})]
    );
    const row = result && result.rows && result.rows[0];
    if (!row) {
      rememberDay7(userId, { dueAt: Date.now() + 60 * 60 * 1000 });
      return;
    }
    if (row.due) {
      rememberDay7(userId, 'recorded');
      return;
    }
    const created = new Date(row.created_at).getTime();
    const dueAt = Number.isFinite(created) ? created + DAY7_MS : Date.now() + 60 * 60 * 1000;
    rememberDay7(userId, { dueAt });
  } catch (err) {
    day7State.delete(userId);
    console.error('[activation] day7_return', err && err.code ? err.code : 'write failed');
  }
}

function scheduleDay7Return(userId, metadata) {
  if (!isUuid(userId)) return;
  const state = day7State.get(userId);
  if (state === 'recorded') return;
  if (state && state.inflight) return;
  if (state && state.dueAt > Date.now()) return;
  day7State.set(userId, { inflight: true });
  enqueue(() => runDay7(userId, metadata));
}

function noteAuthenticatedRequest(req) {
  try {
    const header = req && req.headers && req.headers.authorization;
    if (typeof header !== 'string' || header.length > 4096 || !header.startsWith('Bearer ')) return;
    const path = apiPathOf(req);
    if (!path) return;
    const token = header.slice(7).trim();
    if (!token) return;
    const secret = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    const decoded = require('./session-token').verifySessionToken(token, secret);
    const userId = decoded && decoded.userId;
    if (!isUuid(String(userId || ''))) return;
    scheduleDay7Return(String(userId), compact({
      method: methodOf(req),
      path,
    }));
  } catch (_) {
    /* not a session token: not an authenticated call */
  }
}

function recordTrialStartedForCheckout(session, user, stripeEventId, opts) {
  try {
    const plan = safePlan(session && session.metadata && session.metadata.plan);
    const userId = (user && user.id) ? String(user.id) : sessionUserId(session);
    scheduleActivationEvent({
      userId,
      eventName: 'trial_started',
      source: 'stripe_webhook',
      metadata: compact({
        plan,
        checkoutEventId: safeToken(stripeEventId, 80),
        fixture: opts && opts.fixture === true ? true : undefined,
      }),
    });
  } catch (_) {
    console.error('[activation] trial_started schedule');
  }
}

async function backdateActivationTestSignup(userId, daysAgo) {
  if (!activationTestEnabled()) return { ok: false, status: 404, error: 'Not found' };
  if (!isUuid(userId)) return { ok: false, status: 400, error: 'Invalid account' };
  const days = parseDaysAgo(daysAgo);
  if (days == null) {
    return { ok: false, status: 400, error: 'daysAgo must be a whole number from 0 to 3650.' };
  }
  const found = await query('SELECT email FROM users WHERE id = $1::uuid', [userId]);
  const row = found && found.rows && found.rows[0];
  if (!row) return { ok: false, status: 404, error: 'Not found' };
  if (!TEST_ACCOUNT_EMAIL.test(String(row.email || ''))) {
    return { ok: false, status: 403, error: 'Not a test account' };
  }
  const updated = await query(
    `UPDATE users
        SET created_at = now() - ($2::int * interval '1 day')
      WHERE id = $1::uuid
        AND email ~* $3
      RETURNING created_at`,
    [userId, days, TEST_ACCOUNT_SQL]
  );
  const next = updated && updated.rows && updated.rows[0];
  if (!next) return { ok: false, status: 403, error: 'Not a test account' };
  clearDay7Cache(userId);
  return { ok: true, status: 200, createdAt: next.created_at };
}

function whenActivationIdle() {
  return Promise.all([...pending]);
}

function setActivationQueryForTests(fn) {
  queryOverride = typeof fn === 'function' ? fn : null;
}

function resetActivationForTests() {
  generation += 1;
  queryOverride = null;
  day7State.clear();
  pending = new Set();
}

module.exports = {
  EVENT_NAMES,
  DAY7_MS,
  TEST_ACCOUNT_EMAIL,
  scheduleActivationEvent,
  scheduleFirstMealLogged,
  scheduleDay7Return,
  noteAuthenticatedRequest,
  recordTrialStartedForCheckout,
  backdateActivationTestSignup,
  activationTestEnabled,
  activationTestRequestOk,
  clearDay7Cache,
  whenActivationIdle,
  setActivationQueryForTests,
  resetActivationForTests,
};
