/**
 * FitMunch transactional email via Resend only.
 * Requires RESEND_API_KEY. Optional RESEND_FROM (default hello@fitmunch.com.au).
 */
const RESEND_API = 'https://api.resend.com/emails';

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

module.exports = { sendEmail, sendWelcomeEmail };
