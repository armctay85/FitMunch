/**
 * FitMunch Email Module — sends welcome/transactional emails via Gmail API.
 * Gmail OAuth2 token stored at FITMUNCH_GMAIL_TOKEN_PATH (default below).
 * Token must include `gmail.compose` or `gmail.modify` scope.
 */
const fs = require('fs');
const path = require('path');

const TOKEN_PATH =
  process.env.FITMUNCH_GMAIL_TOKEN_PATH ||
  '/mnt/c/Users/Drew/Documents/Cursor/email-agent/.tokens/armctaylor@gmail.com.token.json';

const TOKEN_CACHE = { loaded: false, token: null, ts: 0 };
const TOKEN_CACHE_MS = 55 * 60 * 1000; // re-read every 55 min

// Google OAuth2 client id/secret — hardcoded (public for desktop-app flow)
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

function loadToken() {
  const now = Date.now();
  if (TOKEN_CACHE.loaded && now - TOKEN_CACHE.ts < TOKEN_CACHE_MS && TOKEN_CACHE.token) {
    return TOKEN_CACHE.token;
  }
  // Prefer env-var (Vercel-compatible), then file (local)
  if (process.env.FITMUNCH_GMAIL_TOKEN) {
    try {
      TOKEN_CACHE.token = JSON.parse(
        Buffer.from(process.env.FITMUNCH_GMAIL_TOKEN, 'base64').toString('utf-8')
      );
      TOKEN_CACHE.loaded = true;
      TOKEN_CACHE.ts = now;
      return TOKEN_CACHE.token;
    } catch (e) {
      console.error('email.js: cannot parse FITMUNCH_GMAIL_TOKEN env var:', e.message);
    }
  }
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
    TOKEN_CACHE.token = JSON.parse(raw);
    TOKEN_CACHE.loaded = true;
    TOKEN_CACHE.ts = now;
    return TOKEN_CACHE.token;
  } catch (e) {
    console.error('email.js: cannot read Gmail token:', e.message);
    return null;
  }
}

async function refreshToken(token) {
  if (!token.refresh_token || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('email.js: missing refresh_token or client creds, cannot refresh');
    return token;
  }
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: token.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const fresh = await resp.json();
    if (!resp.ok) throw new Error(fresh.error_description || fresh.error || 'token refresh failed');
    // Merge new access_token into cached token
    token.access_token = fresh.access_token;
    token.expiry_date = Date.now() + (fresh.expires_in || 3600) * 1000;
    // Persist refreshed token back to disk
    try { fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2)); } catch (_) {}
    TOKEN_CACHE.token = token;
    return token;
  } catch (e) {
    console.error('email.js: token refresh failed:', e.message);
    return token; // return stale token, send will likely fail
  }
}

/**
 * Encode a string as base64url (RFC 4648 §5)
 */
function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build a RFC 2822 MIME message.
 */
function buildMime({ to, subject, bodyHtml, bodyText, from }) {
  const fromAddr = from || 'FitMunch PT <armctaylor@gmail.com>';
  const lines = [
    `From: ${fromAddr}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="fitmunch-boundary"',
    '',
    '--fitmunch-boundary',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    bodyText || 'This email requires an HTML-capable client.',
    '',
    '--fitmunch-boundary',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    bodyHtml,
    '',
    '--fitmunch-boundary--',
  ];
  return lines.join('\r\n');
}

/**
 * Send an email via Gmail API.
 * @param {{ to: string, subject: string, bodyHtml: string, bodyText?: string, from?: string }} opts
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendEmail(opts) {
  const { to, subject, bodyHtml, bodyText, from } = opts;
  if (!to || !subject || !bodyHtml) {
    return { success: false, error: 'Missing required fields: to, subject, bodyHtml' };
  }

  let token = loadToken();
  if (!token || !token.access_token) {
    return { success: false, error: 'Gmail token not available at ' + TOKEN_PATH };
  }

  // Refresh if token is expired
  if (token.expiry_date && Date.now() > token.expiry_date - 30_000) {
    token = await refreshToken(token);
  }

  const raw = base64url(buildMime({ to, subject, bodyHtml, bodyText, from }));

  try {
    const resp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (resp.status === 401 && token.refresh_token) {
      // Token expired mid-request — refresh once and retry
      token = await refreshToken(token);
      const retryResp = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        }
      );
      if (!retryResp.ok) {
        const errBody = await retryResp.json().catch(() => ({}));
        return { success: false, error: `Gmail API error after refresh: ${retryResp.status} ${JSON.stringify(errBody)}` };
      }
      const data = await retryResp.json();
      return { success: true, messageId: data.id };
    }

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      return { success: false, error: `Gmail API error: ${resp.status} ${JSON.stringify(errBody)}` };
    }
    const data = await resp.json();
    return { success: true, messageId: data.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Send PT welcome email after successful checkout.
 */
async function sendWelcomeEmail(customerEmail, customerName, planLabel) {
  const name = customerName || 'there';
  const dashboardUrl = 'https://www.fitmunch.com.au/app.html';

  const subject = 'Welcome to FitMunch PT 🥦';

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f7faf7;padding:0;margin:0">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

  <div style="background:#10b981;padding:32px 28px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:26px">🥦 Welcome to FitMunch PT!</h1>
    <p style="color:#d1fae5;margin:8px 0 0">Your ${planLabel} trial is live</p>
  </div>

  <div style="padding:28px">

    <p style="font-size:16px;color:#333">Hi ${name},</p>
    <p style="font-size:16px;color:#333">Thanks for starting your <strong>14-day free trial</strong> of FitMunch PT ${planLabel}. You're all set — no charges until your trial ends.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
      <p style="font-weight:700;color:#065f46;margin:0 0 8px">🚀 Getting Started</p>
      <ol style="margin:0;padding-left:20px;color:#333;line-height:1.8">
        <li><a href="${dashboardUrl}" style="color:#10b981;font-weight:600">Log in to your dashboard</a></li>
        <li>Add your clients and assign meal plans</li>
        <li>Upload receipts for instant nutrition breakdowns</li>
        <li>Track client progress with white-label reports</li>
      </ol>
    </div>

    <p style="font-size:15px;color:#555">
      <strong>Your trial ends:</strong> 14 days from today<br>
      <strong>Plan:</strong> FitMunch PT ${planLabel}<br>
      <strong>Payment:</strong> Charged after trial (cancel anytime)
    </p>

    <div style="text-align:center;margin:28px 0">
      <a href="${dashboardUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600">Go to Dashboard →</a>
    </div>

    <p style="font-size:13px;color:#999;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px">
      Questions? Reply to this email or visit <a href="https://www.fitmunch.com.au/support" style="color:#10b981">fitmunch.com.au/support</a>.<br>
      FitMunch — Nutrition tracking that works for PTs and their clients.
    </p>
  </div>
</div>
</body>
</html>`.trim();

  return sendEmail({
    to: customerEmail,
    subject,
    bodyHtml,
    bodyText: `Hi ${name},\n\nThanks for starting your 14-day free trial of FitMunch PT ${planLabel}. You're all set — no charges until your trial ends.\n\n🚀 Getting Started:\n1. Log in: ${dashboardUrl}\n2. Add your clients and assign meal plans\n3. Upload receipts for instant nutrition breakdowns\n4. Track client progress\n\nYour trial ends in 14 days. Plan: FitMunch PT ${planLabel}.\n\nGo to Dashboard: ${dashboardUrl}\n\nQuestions? fitmunch.com.au/support`,
  });
}

module.exports = { sendEmail, sendWelcomeEmail };
