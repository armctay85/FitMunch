'use strict';

const { hitRateCounter } = require('./shared-counters');
const { ensureSchema, getPool } = require('./db-migrate');
const emailLib = require('../server/email');

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

/** j***@g***.com. A .com.au address keeps the .com.au suffix. */
function maskEmail(email) {
  const raw = String(email || '');
  const at = raw.indexOf('@');
  if (at < 1) return '***';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const parts = domain.split('.').filter(Boolean);
  if (!parts.length) return `${local.slice(0, 1)}***@***`;
  let suffix;
  let label;
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) {
    suffix = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    label = parts.slice(0, -2).join('.') || parts[0];
  } else {
    suffix = parts[parts.length - 1];
    label = parts.slice(0, -1).join('.') || parts[0];
  }
  return `${local.slice(0, 1)}***@${label.slice(0, 1)}***.${suffix}`;
}

function ownFitmunchAddress(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return domain === 'fitmunch.com.au' || domain.endsWith('.fitmunch.com.au');
}

function topicCode(source) {
  const raw = source && source.topic != null ? String(source.topic) : '';
  const text = raw.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 20);
  return text || null;
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
    const params = [
      row.email,
      row.name || null,
      row.subject || null,
      row.message,
      row.forwardStatus,
      row.ackStatus,
      row.forwardProviderId || null,
    ];
    let sql = INSERT_SUPPORT_MESSAGE;
    if (row.userId) {
      params.push(row.userId, row.topic || null);
      sql = `INSERT INTO support_messages
  (email, name, subject, message, forward_status, ack_status, forward_provider_id, user_id, topic)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id`;
    }
    const out = await supportQuery(sql, params);
    const id = out && out.rows && out.rows[0] && out.rows[0].id;
    if (id) return String(id);
    if (out && Number(out.rowCount) > 0) return true;
    logSupport('store_failed');
    return null;
  } catch (err) {
    const code = err && err.code && /^[A-Za-z0-9_]{1,40}$/.test(String(err.code)) ? String(err.code) : '';
    logSupport(code ? `store_failed_${code}` : 'store_failed');
    return null;
  }
}

const UPDATE_SUPPORT_DELIVERY = `UPDATE support_messages
  SET forward_status = $2, ack_status = $3, forward_provider_id = $4
  WHERE id = $1`;

async function recordSupportDelivery(id, row) {
  try {
    await supportQuery(UPDATE_SUPPORT_DELIVERY, [
      id,
      row.forwardStatus,
      row.ackStatus,
      row.forwardProviderId || null,
    ]);
    return true;
  } catch (err) {
    const code = err && err.code && /^[A-Za-z0-9_]{1,40}$/.test(String(err.code)) ? String(err.code) : '';
    logSupport(code ? `status_update_failed_${code}` : 'status_update_failed');
    return false;
  }
}

/**
 * Accepts a help-centre form. A valid submit is stored, forwarded to the
 * support inbox (reply-to is the submitter), then acknowledged to that
 * submitter. The acknowledgement is sent only after the store or the forward
 * succeeded. If both fail, nothing is acknowledged. Invalid and rate-limited
 * submits do none of those.
 */
async function sendSupportConfirmation(body, options) {
  const source = body && typeof body === 'object' ? body : {};
  const email = submitterEmail(source.email);
  if (!email || ownFitmunchAddress(email)) return { status: 400, body: { success: false, error: 'Enter a valid email.' } };
  const message = String(source.message || '').replace(/[\u0000]/g, '').trim();
  if (!message || message.length > 4000) {
    return { status: 400, body: { success: false, error: 'Enter a message.' } };
  }
  const opts = options && typeof options === 'object' ? options : {};
  const userId = typeof opts.userId === 'string' ? opts.userId.trim() : '';
  console.log(`[support] received ${maskEmail(email)}`);
  const hits = await hitRateCounter('support-confirm-email', email, { windowMs: SUPPORT_CONFIRM_WINDOW_MS });
  if (hits > SUPPORT_CONFIRM_MAX) {
    return { status: 429, body: { success: false, error: 'Too many messages from this email. Try again later.' } };
  }

  const name = cleanName(source.name);
  const subject = cleanSubject(source);

  // Keep the message before any email. Delivery columns start as failed, then
  // the real forward and acknowledgement results replace them.
  const storedId = await storeSupportMessage({
    email,
    name,
    subject,
    message,
    forwardStatus: 'failed',
    ackStatus: 'failed',
    forwardProviderId: null,
    userId,
    topic: topicCode(source),
  });
  const stored = Boolean(storedId);

  let forward = { success: false };
  try {
    forward = await emailLib.sendSupportInboxEmail({ replyTo: email, name, subject, message }) || { success: false };
  } catch (_) {
    forward = { success: false };
  }
  const forwarded = forward.success === true;
  if (!forwarded) logSupport('forward_failed');

  if (!stored && !forwarded) {
    return { status: 503, body: { success: false, error: 'Could not send a confirmation just now.' } };
  }

  let ack = { success: false };
  try {
    ack = await emailLib.sendSupportReceivedEmail(email, { name }) || { success: false };
  } catch (_) {
    ack = { success: false };
  }
  const acked = ack.success === true;
  if (!acked) logSupport('ack_failed');

  if (typeof storedId === 'string') {
    await recordSupportDelivery(storedId, {
      forwardStatus: forwarded ? 'sent' : 'failed',
      ackStatus: acked ? 'sent' : 'failed',
      forwardProviderId: forwarded ? (forward.messageId || null) : null,
    });
  } else if (stored) {
    logSupport('status_update_skipped');
  }

  if (!forwarded) return { status: 200, body: { success: true, forward_status: 'failed' } };
  return { status: 200, body: { success: true } };
}

module.exports = {
  sendSupportConfirmation,
  submitterEmail,
  maskEmail,
  setSupportQueryForTests,
  SUPPORT_CONFIRM_MAX,
  SUPPORT_CONFIRM_WINDOW_MS,
};
