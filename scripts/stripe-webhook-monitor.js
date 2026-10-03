/**
 * Hourly read of the live FitMunch Stripe webhook endpoint.
 *
 * Setup:
 * - GitHub secret STRIPE_MONITOR_KEY: a restricted read-only key (rk_) that
 *   can read webhook endpoints and events. It is never written to logs,
 *   issues, or email.
 * - GitHub variable STRIPE_WEBHOOK_ENDPOINT_ID: the we_ id of the FitMunch
 *   endpoint. When the variable is empty, the live endpoint id is used.
 *   The id is used only on the Stripe request, never in an alert.
 *
 * Alerts when the endpoint is not enabled, its URL host is not
 * fit-munch.vercel.app, www.fitmunch.com.au, or fitmunch.com.au, its path
 * is not /api/stripe/webhook, or events from the last 2 hours include a
 * finished delivery with delivery_success=false. A missing key notifies
 * instead of exiting quietly.
 */

const incident = require('./lib/prod-incident');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DEFAULT_WEBHOOK_ENDPOINT_ID = 'we_1T3UtAGMuYRuJYDr3uqhtekB';
const WEBHOOK_PATH = '/api/stripe/webhook';
const ALLOWED_WEBHOOK_HOSTS = new Set([
  'fit-munch.vercel.app',
  'www.fitmunch.com.au',
  'fitmunch.com.au',
]);

function webhookEndpointId(env) {
  const configured = String((env && env.STRIPE_WEBHOOK_ENDPOINT_ID) || '').trim();
  return configured || DEFAULT_WEBHOOK_ENDPOINT_ID;
}

function webhookUrlParts(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'https:') return null;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return { host: parsed.hostname.toLowerCase(), path };
}

function publicReport(reason) {
  if (reason === 'missing-key') {
    return {
      title: 'PROD STRIPE WEBHOOK MONITOR NOT CONFIGURED',
      body: 'The read-only Stripe monitor key is not set. The live webhook endpoint was not checked.',
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
  if (reason === 'failed-deliveries') {
    return {
      title: 'PROD STRIPE WEBHOOK DELIVERIES FAILING',
      body: 'Stripe reports failed webhook deliveries in the last 2 hours. Check the Stripe dashboard for the FitMunch endpoint.',
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

async function readJson(response) {
  const text = response && typeof response.text === 'function' ? await response.text() : '';
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return {}; }
}

function failedDeliveryCount(payload) {
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];
  return rows.filter((event) => event && typeof event === 'object' && !(event.pending_webhooks > 0)).length;
}

async function inspectStripeWebhook(deps) {
  const env = (deps && deps.env) || process.env;
  const fetchImpl = (deps && deps.fetch) || global.fetch;
  const now = deps && deps.now != null ? Number(deps.now) : Date.now();
  const key = String(env.STRIPE_MONITOR_KEY || '').trim();
  const endpointId = webhookEndpointId(env);
  if (!key) return { ok: false, reason: 'missing-key' };
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
  const parts = webhookUrlParts(endpoint.url);
  if (!parts || !ALLOWED_WEBHOOK_HOSTS.has(parts.host)) return { ok: false, reason: 'wrong-host' };
  if (parts.path !== WEBHOOK_PATH) return { ok: false, reason: 'wrong-path' };

  const since = Math.floor((now - TWO_HOURS_MS) / 1000);
  const params = new URLSearchParams();
  params.set('delivery_success', 'false');
  params.set('limit', '100');
  params.set('created[gte]', String(since));
  let eventsResponse;
  try {
    eventsResponse = await fetchImpl(
      `https://api.stripe.com/v1/events?${params.toString()}`,
      { headers: authHeaders(key) }
    );
  } catch (_) {
    return { ok: true, reason: 'healthy', deliveries: 'unreadable' };
  }
  if (!eventsResponse || !eventsResponse.ok) {
    return { ok: true, reason: 'healthy', deliveries: 'unreadable' };
  }
  const failed = failedDeliveryCount(await readJson(eventsResponse));
  if (failed > 0) return { ok: false, reason: 'failed-deliveries', failed };
  return { ok: true, reason: 'healthy', failed: 0 };
}

async function runStripeWebhookMonitor(deps) {
  const env = (deps && deps.env) || process.env;
  const report = await inspectStripeWebhook(deps);
  if (report.ok) return report;
  const copy = publicReport(report.reason);
  const body = incident.redact(copy.body);
  incident.appendJobSummary(env, `${copy.title}. ${body}`);
  if (deps && typeof deps.summary === 'function') deps.summary(`${copy.title}. ${body}`);
  const handler = (deps && deps.incident) || incident.handleIncident;
  try {
    report.incident = await handler({
      state: 'down',
      title: copy.title,
      body,
      now: deps && deps.now != null ? Number(deps.now) : Date.now(),
      github: deps && deps.github,
      fetchImpl: deps && deps.fetch,
      token: env.GITHUB_TOKEN,
      repo: env.GITHUB_REPOSITORY,
      resendKey: env.RESEND_API_KEY,
      resendFrom: env.RESEND_FROM,
      emailTo: String(env.ALERT_EMAIL_TO || 'support@fitmunch.com.au')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      repeatEmail: false,
    });
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
  DEFAULT_WEBHOOK_ENDPOINT_ID,
  WEBHOOK_PATH,
  ALLOWED_WEBHOOK_HOSTS,
  publicReport,
  TWO_HOURS_MS,
};
