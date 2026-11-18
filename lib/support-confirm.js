'use strict';

const { hitRateCounter } = require('./shared-counters');
const { ensureSchema, getPool } = require('./db-migrate');
const { sendSupportReceivedEmail, sendSupportInboxEmail } = require('../server/email');

const SUPPORT_CONFIRM_MAX = 3;
const SUPPORT_CONFIRM_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * One address, nothing else. Rejects lists, display names, and header breaks
 * so the confirmation cannot be aimed at a second inbox.
 */
function submitterEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return '';
  if (/[\s,;<>()"'\\]/.test(email)) return '';
  if ((email.match(/@/g) || []).length !== 1) return '';
  if (!EMAIL_RE.test(email)) return '';
  return email;
}

function cleanName(value) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

const TOPIC_LABELS = {
  billing: 'Billing',
  trial: 'Trial',
  cancel: 'Cancel',
  account: 'Account',
  app: 'App',
};

function cleanSubject(source) {
  const preferred = source.subject != null && String(source.subject).trim() ? source.subject : source.topic;
  const text = String(preferred || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return '';
  return TOPIC_LABELS[text.toLowerCase()] || text;
}

let queryOverride = null;

function setSupportQueryForTests(fn) {
  queryOverride = typeof fn === 'function' ? fn : null;
}

function logSupport(code) {
  const safe = /^[A-Za-z0-9_]{1,40}$/.test(String(code || '')) ? String(code) : 'error';
  console.error(`[support] ${safe}`);
}

async function supportQuery(sql, params) {
  if (queryOverride) return queryOverride(sql, params);
  if (!process.env.DATABASE_URL) {
    const err = new Error('database unavailable');
    err.code = 'NO_DATABASE';
    throw err;
  }
  const ready = await ensureSchema();
  if (!ready) {
    const err = new Error('schema unavailable');
    err.code = 'SCHEMA_UNAVAILABLE';
    throw err;
  }
  const pool = getPool();
  if (!pool) {
    const err = new Error('database unavailable');
    err.code = 'NO_DATABASE';
    throw err;
  }
  return pool.query(sql, params);
}

const INSERT_SUPPORT_MESSAGE = `INSERT INTO support_messages
  (email, name, subject, message, forward_status, ack_status, forward_provider_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING id`;

async function storeSupportMessage(row) {
  try {
    const out = await supportQuery(INSERT_SUPPORT_MESSAGE, [
      row.email,
      row.name || null,
      row.subject || null,
      row.message,
      row.forwardStatus,
      row.ackStatus,
      row.forwardProviderId || null,
    ]);
    const id = out && out.rows && out.rows[0] && out.rows[0].id;
    if (!id && !(out && Number(out.rowCount) > 0)) {
      logSupport('store_failed');
      return false;
    }
    return true;
  } catch (err) {
    const code = err && err.code && /^[A-Za-z0-9_]{1,40}$/.test(String(err.code)) ? String(err.code) : '';
    logSupport(code ? `store_failed_${code}` : 'store_failed');
    return false;
  }
}

/**
 * Accepts a help-centre form. A valid submit is stored, forwarded to the
 * support inbox (reply-to is the submitter), and acknowledged to that
 * submitter. Invalid and rate-limited submits do none of those.
 */
async function sendSupportConfirmation(body) {
  const source = body && typeof body === 'object' ? body : {};
  const email = submitterEmail(source.email);
  if (!email) return { status: 400, body: { success: false, error: 'Enter a valid email.' } };
  const message = String(source.message || '').replace(/[\u0000]/g, '').trim();
  if (!message || message.length > 4000) {
    return { status: 400, body: { success: false, error: 'Enter a message.' } };
  }
  const hits = await hitRateCounter('support-confirm-email', email, { windowMs: SUPPORT_CONFIRM_WINDOW_MS });
  if (hits > SUPPORT_CONFIRM_MAX) {
    return { status: 429, body: { success: false, error: 'Too many messages from this email. Try again later.' } };
  }

  const name = cleanName(source.name);
  const subject = cleanSubject(source);

  let ack = { success: false };
  try {
    ack = await sendSupportReceivedEmail(email, { name }) || { success: false };
  } catch (_) {
    ack = { success: false };
  }
  const acked = ack.success === true;
  if (!acked) logSupport('ack_failed');

  let forward = { success: false };
  try {
    forward = await sendSupportInboxEmail({ replyTo: email, name, subject, message }) || { success: false };
  } catch (_) {
    forward = { success: false };
  }
  const forwarded = forward.success === true;
  if (!forwarded) logSupport('forward_failed');

  const stored = await storeSupportMessage({
    email,
    name,
    subject,
    message,
    forwardStatus: forwarded ? 'sent' : 'failed',
    ackStatus: acked ? 'sent' : 'failed',
    forwardProviderId: forwarded ? (forward.messageId || null) : null,
  });

  if (!stored && !forwarded) {
    return { status: 503, body: { success: false, error: 'Could not send a confirmation just now.' } };
  }
  if (!forwarded) return { status: 200, body: { success: true, forward_status: 'failed' } };
  return { status: 200, body: { success: true } };
}

module.exports = {
  sendSupportConfirmation,
  submitterEmail,
  setSupportQueryForTests,
  SUPPORT_CONFIRM_MAX,
  SUPPORT_CONFIRM_WINDOW_MS,
};
