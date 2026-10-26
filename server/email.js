/**
 * FitMunch transactional email via Resend only.
 * Requires RESEND_API_KEY. Optional RESEND_FROM (default hello@fitmunch.com.au).
 */
const crypto = require('crypto');
const RESEND_API = 'https://api.resend.com/emails';

// Resend stores this header for 24 hours. A repeat with the same key returns
// the original email instead of sending another. A different body with the
// same key is rejected. Over 256 characters is hashed so the header stays valid.
function resendIdempotencyKey(value) {
  const key = String(value || '').trim().replace(/[\r\n]/g, '');
  if (!key) return '';
  if (key.length <= 256) return key;
  return crypto.createHash('sha256').update(key).digest('hex');
}

function fromAddress() {
  return process.env.RESEND_FROM || 'FitMunch <hello@fitmunch.com.au>';
}

/**
 * @param {{ to: string, subject: string, bodyHtml: string, bodyText?: string }} opts
 */
async function sendEmail(opts) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  const to = opts.to;
  if (!to) return { success: false, error: 'Missing to address' };

  const idempotencyKey = resendIdempotencyKey(opts.idempotencyKey);
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  try {
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: opts.subject,
        html: opts.bodyHtml,
        text: opts.bodyText || undefined,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        success: false,
        error: `Resend error: ${resp.status} ${JSON.stringify(data)}`,
      };
    }
    return { success: true, messageId: data.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Resend click and open tracking are set per sending domain, not per email
// (the send API has no tracking field). Claim links must never be rewritten
// through a tracking redirect, so keep tracking off for the FitMunch domain.
// Claim emails carry no tracking pixel or redirect of our own.
const CLAIM_LINK_WINDOW_COPY = 'This link works once, within 7 days.';

/**
 * Post-checkout welcome (Premium consumer or PT).
 */
const REUSED_CARD_COPY = {
  premium: 'This card already had a FitMunch trial, so Premium started today at A$19.99 a month. Cancel anytime from Billing.',
  'premium-annual': 'This card already had a FitMunch trial, so Premium started today at A$149.99 a year. Cancel anytime from Billing.',
};

async function sendWelcomeEmail(customerEmail, customerName, planLabel, claimUrl, { trial = true, trialEnded = false } = {}) {
  if (trialEnded) trial = false;
  const reusedCopy = /year/i.test(String(planLabel || '')) ? REUSED_CARD_COPY['premium-annual'] : REUSED_CARD_COPY.premium;
  const name = customerName || 'there';
  const dashboardUrl = 'https://www.fitmunch.com.au/app.html';
  const isPt = /starter|pro/i.test(String(planLabel || '')) && !/premium/i.test(String(planLabel || ''));
  const label = planLabel || (isPt ? 'PT' : 'Premium');

  const subject = isPt
    ? `Welcome to FitMunch ${label}`
    : 'Welcome to FitMunch Premium';

  const nextSteps = isPt
    ? `<ol style="margin:0;padding-left:20px;color:#0c1210;line-height:1.8">
        <li><a href="${dashboardUrl}" style="color:#1f9d4a;font-weight:600">Open your dashboard</a></li>
        <li>Invite clients and assign a meal plan</li>
        <li>Have them scan their supermarket receipt</li>
      </ol>`
    : `<ol style="margin:0;padding-left:20px;color:#0c1210;line-height:1.8">
        <li><a href="${dashboardUrl}" style="color:#1f9d4a;font-weight:600">Open your dashboard</a></li>
        <li>Scan this week's supermarket receipt</li>
        <li>Build meals from the haul, then tighten next week's list</li>
      </ol>`;

  const attachHtml = claimUrl
    ? `<p style="font-size:16px;color:#0c1210;line-height:1.6">${trial ? 'Your trial has started.' : 'Premium has started.'} Set a password to finish your FitMunch account, or sign in if you already have one. ${CLAIM_LINK_WINDOW_COPY}</p>
    <p style="margin:20px 0">
      <a href="${claimUrl}" style="display:inline-block;background:#1f9d4a;color:#ffffff;text-decoration:none;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Set your password</a>
    </p>`
    : '';

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#eef2ee;padding:0;margin:0">
<div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:32px 28px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.03em">Fit<span style="color:#1f9d4a">Munch</span></div>
    <h1 style="font-family:system-ui,sans-serif;color:#fff;margin:16px 0 0;font-size:24px;letter-spacing:-0.03em">You're in.</h1>
    <p style="color:rgba(238,242,238,0.75);margin:8px 0 0;font-size:15px">${trial ? `Your ${label} trial is live. No charge until the trial ends.` : `Your ${label} subscription has started. Your first charge is today.`}</p>
  </div>
  <div style="padding:28px">
    <p style="font-size:16px;color:#0c1210">Hi ${name},</p>
    ${trialEnded ? `<p style="font-size:16px;color:#0c1210;line-height:1.6;font-weight:700">${reusedCopy}</p>` : ''}
    <p style="font-size:16px;color:#5c6d64;line-height:1.6">Thanks for starting FitMunch ${label}. The loop is simple: receipt to macros to meals to the next shop.</p>
    ${attachHtml}
    <div style="background:rgba(31,157,74,0.08);border:1px solid rgba(31,157,74,0.28);padding:16px;margin:20px 0">
      <p style="font-family:system-ui,sans-serif;font-weight:700;color:#16803c;margin:0 0 8px">Next steps</p>
      ${nextSteps}
    </div>
    <div style="text-align:left;margin:28px 0">
      <a href="${dashboardUrl}" style="display:inline-block;background:#1f9d4a;color:#fff;text-decoration:none;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Go to dashboard</a>
    </div>
    <p style="font-size:13px;color:#8a9a91;border-top:1px solid #cfd9d2;padding-top:16px;margin-top:24px">
      Questions? <a href="https://www.fitmunch.com.au/support" style="color:#16803c">fitmunch.com.au/support</a><br>
      FitMunch. Made in Australia for Australian shops.
    </p>
  </div>
</div>
</body>
</html>`.trim();

  const attachText = claimUrl
    ? `\nSet a password to finish your FitMunch account. ${CLAIM_LINK_WINDOW_COPY}\n${claimUrl}\n`
    : '';

  const bodyText = `Hi ${name},

${trialEnded ? reusedCopy + '\n\n' : ''}Thanks for starting FitMunch ${label}. ${trial ? 'Your trial is live.' : 'Your subscription has started and your first charge is today.'}
${attachText}

Open dashboard: ${dashboardUrl}

1. Scan this week's receipt
2. Build meals from the haul
3. Tighten next week's list

Support: https://www.fitmunch.com.au/support
`;

  return sendEmail({ to: customerEmail, subject, bodyHtml, bodyText });
}

/**
 * A fresh guest claim link, sent only to the Stripe customer email.
 */
async function sendClaimLinkEmail(customerEmail, claimUrl) {
  const subject = 'Your new FitMunch link';
  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#eef2ee;padding:0;margin:0">
<div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:28px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.03em">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:28px">
    <p style="font-size:16px;color:#0c1210;line-height:1.6">Here is a new link to attach your FitMunch subscription to the account you choose. ${CLAIM_LINK_WINDOW_COPY}</p>
    <p style="margin:20px 0">
      <a href="${claimUrl}" style="display:inline-block;background:#16803c;color:#ffffff;text-decoration:none;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Attach this subscription</a>
    </p>
    <p style="font-size:14px;color:#5c6d64;line-height:1.6">Did not ask for this? You can ignore this email. Nothing changes unless someone signs in and confirms.</p>
    <p style="font-size:13px;color:#8a9a91;border-top:1px solid #cfd9d2;padding-top:16px;margin-top:24px">
      Questions? <a href="https://www.fitmunch.com.au/support" style="color:#16803c">fitmunch.com.au/support</a>
    </p>
  </div>
</div>
</body>
</html>`.trim();
  const bodyText = `Here is a new link to attach your FitMunch subscription to the account you choose. ${CLAIM_LINK_WINDOW_COPY}

${claimUrl}

Did not ask for this? You can ignore this email. Nothing changes unless someone signs in and confirms.

Support: https://www.fitmunch.com.au/support
`;
  return sendEmail({ to: customerEmail, subject, bodyHtml, bodyText });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function simpleEmail({ lead, buttonUrl, buttonLabel, footer }) {
  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#eef2ee;padding:0;margin:0">
<div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:28px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.03em">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:28px">
    ${lead.map((line) => `<p style="font-size:16px;color:#0c1210;line-height:1.6">${escapeHtml(line)}</p>`).join('\n    ')}
    <p style="margin:20px 0">
      <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#16803c;color:#ffffff;text-decoration:none;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">${escapeHtml(buttonLabel)}</a>
    </p>
    <p style="font-size:14px;color:#5c6d64;line-height:1.6">${escapeHtml(footer)}</p>
    <p style="font-size:13px;color:#8a9a91;border-top:1px solid #cfd9d2;padding-top:16px;margin-top:24px">
      Questions? <a href="https://www.fitmunch.com.au/support" style="color:#16803c;display:inline-block;padding:14px 8px;line-height:20px">fitmunch.com.au/support</a>
    </p>
  </div>
</div>
</body>
</html>`.trim();
  const bodyText = `${lead.join('\n\n')}\n\n${buttonLabel}: ${buttonUrl}\n\n${footer}\n\nSupport: https://www.fitmunch.com.au/support\n`;
  return { bodyHtml, bodyText };
}

const TRIAL_USED_COPY = {
  premium: 'Your trial was used; Premium starts today at A$19.99 a month.',
  'premium-annual': 'Your trial was used; Premium starts today at A$149.99 a year.',
};

/** Signed-in Billing. The app opens /api/billing-portal from that page. */
const BILLING_CARD_URL = 'https://www.fitmunch.com.au/app.html#billing';

/**
 * Card charge failed. accessContinues is true only when the caller has
 * checked the live subscription. willRetry is Stripe's next_payment_attempt.
 */
async function sendPaymentFailedEmail(customerEmail, options = {}) {
  const accessContinues = Boolean(options.accessContinues);
  const willRetry = Boolean(options.willRetry);
  const lead = ['Your latest FitMunch payment did not go through.'];
  if (accessContinues) lead.push('Your access continues for now.');
  if (willRetry) lead.push('Stripe will try the charge again. Update your card so that try can go through.');
  else lead.push('Update your card in Billing.');
  const { bodyHtml, bodyText } = simpleEmail({
    lead,
    buttonUrl: BILLING_CARD_URL,
    buttonLabel: 'Update your card',
    footer: "Sign in and open Billing. That page updates your card through Stripe. If you can't sign in, email support@fitmunch.com.au.",
  });
  return sendEmail({
    to: customerEmail,
    subject: 'Your FitMunch payment did not go through',
    bodyHtml,
    bodyText,
    idempotencyKey: options.idempotencyKey,
  });
}

function paymentFailedOwnerLines({ invoiceId, customerId, attempt, willRetry, customerNotified }) {
  const attemptLabel = attempt == null || attempt === '' ? 'unknown' : String(attempt);
  return [
    'A FitMunch payment did not go through.',
    `Invoice ${invoiceId || 'unknown'} for customer ${customerId || 'unknown'}.`,
    `Attempt ${attemptLabel}. ${willRetry ? 'Stripe will try the charge again.' : 'Stripe will not try this charge again.'}`,
    customerNotified
      ? 'The customer was emailed a link to update their card in Billing.'
      : 'The customer was not emailed.',
  ];
}

/** Operator alert. Caller chooses the address (ALERT_EMAIL_TO). No default recipient. */
async function sendPaymentFailedOwnerAlert(to, details) {
  const info = details || {};
  const lines = paymentFailedOwnerLines(info);
  const bodyHtml = lines.map((line) => `<p style="font-size:16px;color:#0c1210;line-height:1.6">${escapeHtml(line)}</p>`).join('');
  return sendEmail({
    to,
    subject: 'FitMunch: a payment did not go through',
    bodyHtml,
    bodyText: lines.join('\n\n'),
    idempotencyKey: info.idempotencyKey,
  });
}

/** Email-first trial: the Stripe Checkout link goes to the typed address only. */
/** A live subscriber typed their email on the signed-out trial page. */
async function sendSignInToManageEmail(customerEmail) {
  const { bodyHtml, bodyText } = simpleEmail({
    lead: ['You already have FitMunch Premium on this email, so we did not start a second subscription or trial.', 'Sign in to use FitMunch or manage your subscription from Billing.'],
    buttonUrl: 'https://www.fitmunch.com.au/login.html#login',
    buttonLabel: 'Sign in to manage',
    footer: 'Forgot your password? Use "Forgot password" on the sign-in page. Did not ask for this? You can ignore this email.',
  });
  return sendEmail({ to: customerEmail, subject: 'Sign in to FitMunch', bodyHtml, bodyText });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendClaimLinkEmail,
  sendSignInToManageEmail,
  sendPaymentFailedEmail,
  sendPaymentFailedOwnerAlert,
  BILLING_CARD_URL,
  CLAIM_LINK_WINDOW_COPY,
  TRIAL_USED_COPY,
  REUSED_CARD_COPY,
};
