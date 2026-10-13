'use strict';
/**
 * Email confirmation links. Each link carries a random 32-byte token; only its
 * SHA-256 is stored (email_verifications), bound to the user and the email at
 * send time. A link works once, for 24 hours, and stops working if the
 * account's email changes. The token goes in the URL fragment (#verify=), so
 * it is not sent to servers or analytics as part of the page URL, and it holds
 * no personal data.
 */
const crypto = require('crypto');

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function newVerifyToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashVerifyToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** A token as it arrives from the link, or null if it cannot be one of ours. */
function cleanVerifyToken(token) {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}

function verifyUrl(token) {
  return 'https://www.fitmunch.com.au/login.html#verify=' + encodeURIComponent(token);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function firstName(name) {
  const raw = String(name || '').trim().split(/\s+/)[0] || '';
  return Array.from(raw).slice(0, 40).join('') || 'there';
}

/** Welcome + verify email body. No pricing, no store names. */
function welcomeEmail({ name, url }) {
  const first = firstName(name);
  const subject = 'Welcome to FitMunch: confirm your email';
  const bodyHtml = `
<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#eef2ee;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:26px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:26px">
    <p style="font-size:15px;color:#0c1210">Hi ${esc(first)},</p>
    <p style="font-size:15px;color:#5c6d64;line-height:1.6">Welcome to FitMunch. Please confirm this is your email so we can reach you about your account and billing:</p>
    <div style="margin:24px 0">
      <a href="${esc(url)}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;padding:13px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Confirm my email</a>
    </div>
    <p style="font-size:15px;color:#5c6d64;line-height:1.6">Then, three things to try first:</p>
    <ol style="font-size:15px;color:#5c6d64;line-height:1.6;padding-left:20px">
      <li>Set your goal and targets in your profile.</li>
      <li>Ask for a week of meals, then build the shopping list from it.</li>
      <li>Scan a receipt to see how your shop matched the plan.</li>
    </ol>
    <p style="font-size:13px;color:#5c6d64">This link works once, for 24 hours. Didn't sign up? Ignore this email.</p>
    <p style="font-size:15px;color:#5c6d64">The FitMunch team</p>
  </div>
</div></body></html>`.trim();
  const bodyText = `Hi ${first},\n\nWelcome to FitMunch. Confirm your email (the link works once, for 24 hours):\n${url}\n\nThen try: set your goal, ask for a week of meals and build the shopping list, and scan a receipt.\n\nDidn't sign up? Ignore this email.\n\nThe FitMunch team`;
  return { subject, bodyHtml, bodyText };
}

module.exports = { VERIFY_TTL_MS, newVerifyToken, hashVerifyToken, cleanVerifyToken, verifyUrl, welcomeEmail };
