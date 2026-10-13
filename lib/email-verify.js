'use strict';
/**
 * Email verification links. Stateless: a short-lived JWT with its own purpose,
 * bound to the user id AND the email at signup, so a link stops working if the
 * account's email changes. The token goes in the URL fragment (#verify=) so it
 * is not sent to servers or analytics as part of the page URL.
 */
const jwt = require('jsonwebtoken');

const VERIFY_PURPOSE = 'verify-email';
const VERIFY_TTL = '7d';

function verifyToken(user, secret) {
  return jwt.sign({ p: VERIFY_PURPOSE, uid: String(user.id), em: String(user.email || '').trim().toLowerCase() }, secret, { expiresIn: VERIFY_TTL });
}

/** { userId, email } or null. Rejects session tokens and other purposes. */
function readVerifyToken(token, secret) {
  if (typeof token !== 'string' || !token || token.length > 2000) return null;
  try {
    const d = jwt.verify(token, secret);
    if (!d || d.p !== VERIFY_PURPOSE || !d.uid || !d.em) return null;
    return { userId: String(d.uid), email: String(d.em) };
  } catch (_) {
    return null;
  }
}

function verifyUrl(token) {
  return 'https://www.fitmunch.com.au/login.html#verify=' + encodeURIComponent(token);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Welcome + verify email body. No pricing, no store names. */
function welcomeEmail({ name, url }) {
  const first = name ? esc(String(name).trim().split(/\s+/)[0]).slice(0, 40) : 'there';
  const subject = 'Welcome to FitMunch: confirm your email';
  const bodyHtml = `
<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#eef2ee;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:26px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:26px">
    <p style="font-size:15px;color:#0c1210">Hi ${first},</p>
    <p style="font-size:15px;color:#5c6d64;line-height:1.6">Welcome to FitMunch. Please confirm this is your email so we can reach you about your account and billing:</p>
    <div style="margin:24px 0">
      <a href="${url}" style="display:inline-block;background:#1f9d4a;color:#fff;text-decoration:none;padding:13px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Confirm my email</a>
    </div>
    <p style="font-size:15px;color:#5c6d64;line-height:1.6">Then, three things to try first:</p>
    <ol style="font-size:15px;color:#5c6d64;line-height:1.6;padding-left:20px">
      <li>Set your goal and targets in your profile.</li>
      <li>Ask for a week of meals, then build the shopping list from it.</li>
      <li>Scan a receipt to see how your shop matched the plan.</li>
    </ol>
    <p style="font-size:13px;color:#8a9a91">This link works for 7 days. Didn't sign up? Ignore this email.</p>
  </div>
</div></body></html>`.trim();
  const bodyText = `Hi ${first},\n\nWelcome to FitMunch. Confirm your email (link valid 7 days):\n${url}\n\nThen try: set your goal, ask for a week of meals and build the shopping list, and scan a receipt.\n\nDidn't sign up? Ignore this email.`;
  return { subject, bodyHtml, bodyText };
}

module.exports = { VERIFY_PURPOSE, verifyToken, readVerifyToken, verifyUrl, welcomeEmail };
