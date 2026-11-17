'use strict';

const { hitRateCounter } = require('./shared-counters');
const { sendSupportReceivedEmail, sendSupportTicketEmail } = require('../server/email');

const SUPPORT_CONFIRM_MAX = 3;
const SUPPORT_CONFIRM_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TOPICS = new Set(['billing', 'trial', 'cancel', 'account', 'app']);
const STORE_AND_SEND_ERROR = "We couldn't send your message just now. Please email support@fitmunch.com.au.";

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

function cleanTopic(value) {
  const topic = String(value || '').trim().toLowerCase();
  return TOPICS.has(topic) ? topic : 'app';
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

function logSupport(fields) {
  const line = {
    ts: new Date().toISOString(),
    status: fields.status,
    reason: fields.reason,
    email: fields.email ? maskEmail(fields.email) : '',
    topic: fields.topic || '',
    storeId: fields.storeId || null,
    resendId: fields.resendId || null,
    receipt: fields.receipt === true,
  };
  console.log('[support-form] ' + JSON.stringify(line));
  return line;
}

async function defaultQuery(sql, params) {
  const db = require('./db-migrate');
  if (typeof db.ensureSchema === 'function') {
    try { await db.ensureSchema(); } catch (err) {
      if (!(err && err.code === '42P01')) throw err;
    }
  }
  const pool = db.getPool();
  if (!pool) throw Object.assign(new Error('no database'), { code: 'NO_DB' });
  return pool.query(sql, params);
}

/**
 * Stores the help form message, emails it to support@, then sends the
 * customer receipt. Stored or team-sent is a 200. Both failing is a 503
 * and no receipt.
 */
async function sendSupportConfirmation(body, deps = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const email = submitterEmail(source.email);
  const topic = cleanTopic(source.topic);
  if (!email) {
    logSupport({ status: 400, reason: 'bad_email', email: typeof source.email === 'string' ? source.email : '', topic, receipt: false });
    return { status: 400, body: { success: false, error: 'Enter a valid email.' } };
  }
  const message = String(source.message || '').replace(/[\u0000]/g, '').trim();
  if (!message || message.length > 4000) {
    logSupport({ status: 400, reason: 'bad_message', email, topic, receipt: false });
    return { status: 400, body: { success: false, error: message.length > 4000 ? 'Enter a message.' : 'Enter a message.' } };
  }
  const hits = await hitRateCounter('support-confirm-email', email, { windowMs: SUPPORT_CONFIRM_WINDOW_MS });
  if (hits > SUPPORT_CONFIRM_MAX) {
    logSupport({ status: 429, reason: 'rate_limited', email, topic, receipt: false });
    return { status: 429, body: { success: false, error: 'Too many messages from this email. Try again later.' } };
  }

  const name = cleanName(source.name);
  const userId = typeof deps.userId === 'string' && deps.userId ? deps.userId : null;
  const query = deps.query || defaultQuery;
  const sendTeam = deps.sendTeam || sendSupportTicketEmail;
  const sendReceipt = deps.sendReceipt || sendSupportReceivedEmail;

  let storeId = null;
  let stored = false;
  try {
    const inserted = await query(
      `INSERT INTO support_messages (email, name, topic, message, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, name || null, topic, message, userId]
    );
    storeId = inserted && inserted.rows && inserted.rows[0] ? inserted.rows[0].id : null;
    stored = storeId != null;
  } catch (err) {
    stored = false;
    storeId = null;
  }

  let team = null;
  try {
    team = await sendTeam({ email, name, topic, message, storeId });
  } catch (err) {
    team = { success: false, error: err && err.message };
  }
  const teamSent = !!(team && team.success === true);
  const resendId = teamSent ? (team.messageId || team.id || null) : null;

  if (stored && resendId) {
    try {
      await query(
        'UPDATE support_messages SET resend_id=$1, team_sent_at=now() WHERE id=$2',
        [resendId, storeId]
      );
    } catch (_) { /* the row is already kept */ }
  }

  if (!stored && !teamSent) {
    logSupport({ status: 503, reason: stored ? 'send_failed' : 'store_failed', email, topic, storeId, receipt: false });
    return { status: 503, body: { success: false, error: STORE_AND_SEND_ERROR } };
  }

  let receipt = false;
  try {
    const result = await sendReceipt(email, { name });
    receipt = !!(result && result.success === true);
  } catch (_) {
    receipt = false;
  }
  if (stored && receipt) {
    try { await query('UPDATE support_messages SET receipt_sent_at=now() WHERE id=$1', [storeId]); }
    catch (_) { /* receipt already went out */ }
  }

  logSupport({
    status: 200,
    reason: 'ok',
    email,
    topic,
    storeId,
    resendId,
    receipt,
  });
  return { status: 200, body: { success: true, receipt, id: storeId } };
}

module.exports = {
  sendSupportConfirmation,
  submitterEmail,
  maskEmail,
  SUPPORT_CONFIRM_MAX,
  SUPPORT_CONFIRM_WINDOW_MS,
  STORE_AND_SEND_ERROR,
};
