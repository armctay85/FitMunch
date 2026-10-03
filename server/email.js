/**
 * FitMunch transactional email via Resend only.
 * Requires RESEND_API_KEY.
 * Sender: EMAIL_FROM, then RESEND_FROM. Reply-To is set only when
 * EMAIL_REPLY_TO or RESEND_REPLY_TO is configured. Do not default that
 * path to support@ (fitmunch.com.au has no MX yet).
 */
const RESEND_API = 'https://api.resend.com/emails';

function fromAddress() {
  return process.env.EMAIL_FROM || process.env.RESEND_FROM || 'FitMunch <hello@fitmunch.com.au>';
}

function replyToAddress() {
  return process.env.EMAIL_REPLY_TO || process.env.RESEND_REPLY_TO || '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
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

  try {
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: opts.subject,
        html: opts.bodyHtml,
        text: opts.bodyText || undefined,
        ...(replyToAddress() ? { reply_to: replyToAddress() } : {}),
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

/**
 * Post-checkout welcome (Premium consumer or PT).
 */
async function sendWelcomeEmail(customerEmail, customerName, planLabel) {
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
        <li>Have them scan a Woolies or Coles receipt</li>
      </ol>`
    : `<ol style="margin:0;padding-left:20px;color:#0c1210;line-height:1.8">
        <li><a href="${dashboardUrl}" style="color:#1f9d4a;font-weight:600">Open your dashboard</a></li>
        <li>Scan this week's supermarket receipt</li>
        <li>Build meals from the haul, then tighten next week's list</li>
      </ol>`;

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#eef2ee;padding:0;margin:0">
<div style="max-width:560px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:32px 28px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.03em">Fit<span style="color:#1f9d4a">Munch</span></div>
    <h1 style="font-family:system-ui,sans-serif;color:#fff;margin:16px 0 0;font-size:24px;letter-spacing:-0.03em">You're in.</h1>
    <p style="color:rgba(238,242,238,0.75);margin:8px 0 0;font-size:15px">Your ${label} trial is live. No charge until the trial ends.</p>
  </div>
  <div style="padding:28px">
    <p style="font-size:16px;color:#0c1210">Hi ${name},</p>
    <p style="font-size:16px;color:#5c6d64;line-height:1.6">Thanks for starting FitMunch ${label}. The loop is simple: receipt to macros to meals to the next shop.</p>
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

  const bodyText = `Hi ${name},

Thanks for starting FitMunch ${label}. Your trial is live.

Open dashboard: ${dashboardUrl}

1. Scan this week's receipt
2. Build meals from the haul
3. Tighten next week's list

Support: https://www.fitmunch.com.au/support
`;

  return sendEmail({ to: customerEmail, subject, bodyHtml, bodyText });
}

function trialShell({ headline, intro, rowsHtml, rowsText, manageUrl, supportUrl, logoUrl }) {
  const logo = logoUrl || 'https://www.fitmunch.com.au/assets/logo.svg';
  const manage = manageUrl || 'https://www.fitmunch.com.au/billing/manage';
  const support = supportUrl || 'https://www.fitmunch.com.au/support';
  const bodyHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@font-face{font-family:'Literata';src:url('https://www.fitmunch.com.au/fonts/literata-latin-400.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
</style>
</head>
<body style="margin:0;padding:0;background:#eef2ee">
<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border-collapse:collapse">
  <tr>
    <td style="background:#07130d;padding:28px 32px">
      <img src="${escapeHtml(logo)}" width="36" height="36" alt="FitMunch" style="display:block;border:0;width:36px;height:36px">
      <p style="margin:14px 0 0;font-family:system-ui,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.03em;color:#ffffff">Fit<span style="color:#15803D">Munch</span></p>
      <h1 style="margin:16px 0 0;font-family:Georgia,'Literata',serif;font-size:28px;line-height:1.2;font-weight:500;color:#ffffff">${escapeHtml(headline)}</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 32px;font-family:'Literata',Georgia,serif;font-size:16px;line-height:1.6;color:#0c1210">
      <p style="margin:0 0 16px">${escapeHtml(intro)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px">
        ${rowsHtml}
      </table>
      <p style="margin:0 0 20px">
        <a href="${escapeHtml(manage)}" style="display:inline-block;background:#15803D;color:#ffffff;text-decoration:none;padding:14px 22px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Manage or cancel</a>
      </p>
      <p style="margin:0;font-size:14px;color:#5c6d64">Support: <a href="${escapeHtml(support)}" style="color:#15803D">${escapeHtml(support)}</a></p>
    </td>
  </tr>
</table>
</body>
</html>`;

  const bodyText = `${headline}

${intro}

${rowsText}
Manage or cancel: ${manage}

Support: ${support}
`;
  return { bodyHtml, bodyText };
}

function trialRow(label, value) {
  return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #cfd9d2;font-family:system-ui,sans-serif;font-size:13px;color:#5c6d64;width:42%">${escapeHtml(label)}</td>
  <td style="padding:8px 0;border-bottom:1px solid #cfd9d2;font-family:'Literata',Georgia,serif;font-size:16px;color:#0c1210">${escapeHtml(value)}</td>
</tr>`;
}

/**
 * @param {{ planName: string, trialEndLabel: string, amountLabel: string, manageUrl: string, supportUrl?: string, logoUrl?: string }} details
 */
function renderTrialStartedEmail(details) {
  const planName = details.planName || 'FitMunch';
  const trialEndLabel = details.trialEndLabel || 'the date in billing';
  const amountLabel = details.amountLabel || 'the price in billing';
  const subject = 'Your 14-day trial has started';
  const rendered = trialShell({
    headline: subject,
    intro: `Your ${planName} trial is running. You will not be charged until it ends.`,
    rowsHtml: [
      trialRow('Plan', planName),
      trialRow('Trial ends', trialEndLabel),
      trialRow('Amount after the trial', amountLabel),
    ].join(''),
    rowsText: `Plan: ${planName}\nTrial ends: ${trialEndLabel}\nAmount after the trial: ${amountLabel}\n`,
    manageUrl: details.manageUrl,
    supportUrl: details.supportUrl,
    logoUrl: details.logoUrl,
  });
  return { subject, ...rendered };
}

/**
 * @param {{ planName: string, trialEndLabel: string, amountLabel: string, manageUrl: string, supportUrl?: string, logoUrl?: string }} details
 */
function renderTrialEndingEmail(details) {
  const planName = details.planName || 'FitMunch';
  const trialEndLabel = details.trialEndLabel || 'the date in billing';
  const amountLabel = details.amountLabel || 'the price in billing';
  const subject = `Your trial ends on ${trialEndLabel}`;
  const rendered = trialShell({
    headline: subject,
    intro: `Your ${planName} trial ends on ${trialEndLabel}. After that, the plan renews at ${amountLabel} unless you cancel.`,
    rowsHtml: [
      trialRow('Plan', planName),
      trialRow('Trial ends', trialEndLabel),
      trialRow('Amount after the trial', amountLabel),
    ].join(''),
    rowsText: `Plan: ${planName}\nTrial ends: ${trialEndLabel}\nAmount after the trial: ${amountLabel}\n`,
    manageUrl: details.manageUrl,
    supportUrl: details.supportUrl,
    logoUrl: details.logoUrl,
  });
  return { subject, ...rendered };
}

async function sendTrialStartedEmail(to, details) {
  const rendered = renderTrialStartedEmail(details);
  return sendEmail({ to, subject: rendered.subject, bodyHtml: rendered.bodyHtml, bodyText: rendered.bodyText });
}

async function sendTrialEndingEmail(to, details) {
  const rendered = renderTrialEndingEmail(details);
  return sendEmail({ to, subject: rendered.subject, bodyHtml: rendered.bodyHtml, bodyText: rendered.bodyText });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  fromAddress,
  replyToAddress,
  renderTrialStartedEmail,
  renderTrialEndingEmail,
  sendTrialStartedEmail,
  sendTrialEndingEmail,
};
