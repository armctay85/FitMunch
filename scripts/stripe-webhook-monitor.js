/**
 * Hourly read of the live FitMunch Stripe webhook endpoint.
 *
 * Setup:
 * - GitHub secret STRIPE_MONITOR_KEY: a restricted key (rk_) that can read
 *   webhook endpoints. A secret key (sk_) is rejected. The key is never
 *   written to logs, issues, or email.
 * - GitHub variable STRIPE_WEBHOOK_ENDPOINT_ID: the we_ id of the FitMunch
 *   endpoint. When the variable is empty, the live endpoint id is used.
 *   The id is used only on the Stripe request, never in an alert.
 *
 * Alerts when the endpoint is not enabled, its URL host is not
 * fit-munch.vercel.app, www.fitmunch.com.au, or fitmunch.com.au, its path
 * is not /api/stripe/webhook, or the URL includes a port. A missing or
 * non-restricted key notifies instead of exiting quietly.
 *
 * Account-wide Stripe events are not queried. That list is shared with
 * other products. A healthy run closes an open incident. While the
 * endpoint stays disabled, the email repeats every 6 hours.
 */

const incident = require('./lib/prod-incident');

const DEFAULT_WEBHOOK_ENDPOINT_ID = 'we_1T3UtAGMuYRuJYDr3uqhtekB';
const WEBHOOK_PATH = '/api/stripe/webhook';
const DISABLED_EMAIL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EVENTS_SUMMARY = 'Stripe events were not read. Delivery history is account-wide and is not checked.';
const ALLOWED_WEBHOOK_HOSTS = new Set([
  'fit-munch.vercel.app',
  'www.fitmunch.com.au',
  'fitmunch.com.au',
]);
const RECOVERY_TITLES = [
  'PROD STRIPE WEBHOOK DISABLED',
  'PROD STRIPE WEBHOOK WRONG HOST',
  'PROD STRIPE WEBHOOK WRONG PATH',
  'PROD STRIPE WEBHOOK EXPLICIT PORT',
  'PROD STRIPE WEBHOOK MONITOR NOT CONFIGURED',
  'PROD STRIPE WEBHOOK MONITOR UNREADABLE',
  'PROD STRIPE WEBHOOK DELIVERIES FAILING',
];

function webhookEndpointId(env) {
  const configured = String((env && env.STRIPE_WEBHOOK_ENDPOINT_ID) || '').trim();
  return configured || DEFAULT_WEBHOOK_ENDPOINT_ID;
}

function explicitPort(value) {
  const match = String(value || '').trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return Boolean(match && match[1].includes(':'));
}

function webhookUrlParts(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (explicitPort(value)) return { host: parsed.hostname.toLowerCase(), path: '', port: true };
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return { host: parsed.hostname.toLowerCase(), path, port: false };
}

function isRestrictedKey(value) {
  return /^rk_/.test(String(value || '').trim());
}

function publicReport(reason) {
  if (reason === 'missing-key') {
    return {
      title: 'PROD STRIPE WEBHOOK MONITOR NOT CONFIGURED',
      body: 'The read-only Stripe monitor key is not set. The live webhook endpoint was not checked.',
    };
  }
  if (reason === 'bad-key') {
    return {
      title: 'PROD STRIPE WEBHOOK MONITOR NOT CONFIGURED',
      body: 'STRIPE_MONITOR_KEY must be a restricted Stripe key starting with rk_. A secret key is not accepted. Create a restricted key that can read webhook endpoints, store it as that GitHub secret, and run this check again.',
    };
  }
  if (reason === 'missing-endpoint') {
    return {
      title: 'PROD STRIPE WEBHOOK MONITOR NOT CONFIGURED',
      body: 'The Stripe webhook endpoint id is not set. The live webhook endpoint was not checked.',
    };
  }
  if (reason === 'disabled') {
    return {
      title: 'PROD STRIPE WEBHOOK DISABLED',
      body: 'The FitMunch Stripe webhook endpoint is not enabled. New payments may not update accounts until it is turned back on in Stripe.',
    };
  }
  if (reason === 'wrong-host') {
    return {
      title: 'PROD STRIPE WEBHOOK WRONG HOST',
      body: 'The FitMunch Stripe webhook endpoint does not point at fit-munch.vercel.app, www.fitmunch.com.au, or fitmunch.com.au. Payments may not reach production.',
    };
  }
  if (reason === 'wrong-path') {
    return {
      title: 'PROD STRIPE WEBHOOK WRONG PATH',
      body: 'The FitMunch Stripe webhook endpoint path is not /api/stripe/webhook. Payments may not reach production.',
    };
  }
  if (reason === 'explicit-port') {
    return {
      title: 'PROD STRIPE WEBHOOK EXPLICIT PORT',
      body: 'The FitMunch Stripe webhook URL includes a port. Use the default HTTPS port on an allowed host.',
    };
  }
  return {
    title: 'PROD STRIPE WEBHOOK MONITOR UNREADABLE',
    body: 'The Stripe webhook endpoint could not be read. The monitor did not confirm that it is enabled.',
  };
}

function authHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    'User-Agent': 'fitmunch-stripe-webhook-monitor',
  };
}

function emailTo(env) {
  return String(env.ALERT_EMAIL_TO || 'support@fitmunch.com.au')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function writeSummary(env, deps, line) {
  incident.appendJobSummary(env, line);
  if (deps && typeof deps.summary === 'function') deps.summary(line);
}

async function readJson(response) {
  const text = response && typeof response.text === 'function' ? await response.text() : '';
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return {}; }
}

async function inspectStripeWebhook(deps) {
  const env = (deps && deps.env) || process.env;
  const fetchImpl = (deps && deps.fetch) || global.fetch;
  const key = String(env.STRIPE_MONITOR_KEY || '').trim();
  const endpointId = webhookEndpointId(env);
  if (!key) return { ok: false, reason: 'missing-key' };
  if (!isRestrictedKey(key)) return { ok: false, reason: 'bad-key' };
  if (!endpointId) return { ok: false, reason: 'missing-endpoint' };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'unreadable' };

  let endpointResponse;
  try {
    endpointResponse = await fetchImpl(
      `https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`,
      { headers: authHeaders(key) }
    );
  } catch (_) {
    return { ok: false, reason: 'unreadable' };
  }
  if (!endpointResponse || !endpointResponse.ok) return { ok: false, reason: 'unreadable' };
  const endpoint = await readJson(endpointResponse);
  if (String(endpoint.status || '').toLowerCase() !== 'enabled') {
    return { ok: false, reason: 'disabled' };
  }
  if (explicitPort(endpoint.url)) return { ok: false, reason: 'explicit-port' };
  const parts = webhookUrlParts(endpoint.url);
  if (!parts || parts.port || !ALLOWED_WEBHOOK_HOSTS.has(parts.host)) {
    return { ok: false, reason: 'wrong-host' };
  }
  if (parts.path !== WEBHOOK_PATH) return { ok: false, reason: 'wrong-path' };
  return { ok: true, reason: 'healthy' };
}

function incidentOptions(deps, env, extra) {
  return {
    now: deps && deps.now != null ? Number(deps.now) : Date.now(),
    github: deps && deps.github,
    fetchImpl: deps && deps.fetch,
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    resendKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    emailTo: emailTo(env),
    ...extra,
  };
}

async function closeRecoveredIncidents(deps, env) {
  const handler = (deps && deps.incident) || incident.handleIncident;
  const closed = [];
  for (const title of RECOVERY_TITLES) {
    try {
      const result = await handler(incidentOptions(deps, env, {
        state: 'up',
        title,
        body: 'The FitMunch Stripe webhook endpoint is enabled and points at an allowed host and path.',
      }));
      if (result && result.action === 'closed') closed.push(title);
    } catch (_) {
      if (deps && typeof deps.log === 'function') deps.log('Stripe webhook recovery notice could not be delivered.');
    }
  }
  return closed;
}

async function runStripeWebhookMonitor(deps) {
  const env = (deps && deps.env) || process.env;
  const report = await inspectStripeWebhook(deps);
  if (report.ok) {
    writeSummary(env, deps, EVENTS_SUMMARY);
    report.closed = await closeRecoveredIncidents(deps, env);
    return report;
  }
  const copy = publicReport(report.reason);
  const body = incident.redact(copy.body);
  writeSummary(env, deps, `${copy.title}. ${body}`);
  writeSummary(env, deps, EVENTS_SUMMARY);
  const handler = (deps && deps.incident) || incident.handleIncident;
  const down = {
    state: 'down',
    title: copy.title,
    body,
    repeatEmail: false,
  };
  if (report.reason === 'disabled') {
    down.repeatEmail = true;
    down.intervalMs = DISABLED_EMAIL_INTERVAL_MS;
  }
  try {
    report.incident = await handler(incidentOptions(deps, env, down));
  } catch (_) {
    if (deps && typeof deps.log === 'function') deps.log('Stripe webhook alert could not be delivered.');
  }
  return { ...report, title: copy.title, body };
}

module.exports = {
  inspectStripeWebhook,
  runStripeWebhookMonitor,
  webhookEndpointId,
  webhookUrlParts,
  explicitPort,
  isRestrictedKey,
  publicReport,
  closeRecoveredIncidents,
  DEFAULT_WEBHOOK_ENDPOINT_ID,
  WEBHOOK_PATH,
  ALLOWED_WEBHOOK_HOSTS,
  DISABLED_EMAIL_INTERVAL_MS,
  EVENTS_SUMMARY,
  RECOVERY_TITLES,
};
