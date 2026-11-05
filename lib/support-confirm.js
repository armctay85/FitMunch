'use strict';

const { hitRateCounter } = require('./shared-counters');
const { sendSupportReceivedEmail } = require('../server/email');

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

/**
 * Confirms a help-centre form. The only email sent is the automatic
 * receipt, and it goes only to the validated submitter address.
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
  const result = await sendSupportReceivedEmail(email, { name: cleanName(source.name) });
  if (!result || result.success !== true) {
    return { status: 503, body: { success: false, error: 'Could not send a confirmation just now.' } };
  }
  return { status: 200, body: { success: true } };
}

module.exports = {
  sendSupportConfirmation,
  submitterEmail,
  SUPPORT_CONFIRM_MAX,
  SUPPORT_CONFIRM_WINDOW_MS,
};
