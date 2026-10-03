const fs = require('fs');
const os = require('os');
const path = require('path');
const { runStripeWebhookMonitor } = require('./scripts/stripe-webhook-monitor');
const { runProbe } = require('./scripts/prod-uptime-probe');

const ENDPOINT_ID = 'we_test_endpoint_id';
const MONITOR_KEY = 'rk_test_monitor_key_value';

function json(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

function githubDouble() {
  const calls = [];
  return {
    calls,
    async ensureLabel() { calls.push('label'); },
    async listOpen() { return []; },
    async listComments() { return []; },
    async open(title, body) {
      calls.push(['open', title, body]);
      return { number: 11, title };
    },
    async comment() {},
    async close() {},
  };
}

function env(extra) {
  return {
    STRIPE_MONITOR_KEY: MONITOR_KEY,
    STRIPE_WEBHOOK_ENDPOINT_ID: ENDPOINT_ID,
    GITHUB_TOKEN: 'gh-token',
    GITHUB_REPOSITORY: 'armctay85/FitMunch',
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'FitMunch <hello@fitmunch.com.au>',
    ALERT_EMAIL_TO: 'support@fitmunch.com.au',
    ...extra,
  };
}

function stripeFetch(endpointBody, eventsBody) {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, authorization: options.headers && options.headers.Authorization });
    if (String(url).includes('/webhook_endpoints/')) return json(endpointBody);
    if (String(url).includes('/v1/events')) return json(eventsBody == null ? { data: [] } : eventsBody);
    if (String(url).includes('api.resend.com')) return { ok: true };
    return json({}, 404);
  };
  return { fetchImpl, seen };
}

describe('stripe webhook monitor', () => {
  const now = Date.parse('2026-10-03T04:00:00Z');

  it('accepts an enabled FitMunch endpoint with no failed deliveries', async () => {
    const github = githubDouble();
    const { fetchImpl, seen } = stripeFetch(
      { status: 'enabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' },
      { data: [] }
    );
    const result = await runStripeWebhookMonitor({ env: env(), fetch: fetchImpl, github, now });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('healthy');
    expect(github.calls.some((call) => call[0] === 'open')).toBe(false);
    expect(seen[0].url).toContain(`/webhook_endpoints/${ENDPOINT_ID}`);
    expect(seen[0].authorization).toBe(`Bearer ${MONITOR_KEY}`);
    expect(seen[1].url).toContain('delivery_success=false');
    const since = Math.floor((now - 2 * 60 * 60 * 1000) / 1000);
    expect(seen[1].url).toContain(String(since));
  });

  it('alerts when the endpoint is disabled, without ids or the key', async () => {
    const github = githubDouble();
    const summary = [];
    const { fetchImpl } = stripeFetch({ status: 'disabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' });
    const result = await runStripeWebhookMonitor({
      env: env(),
      fetch: fetchImpl,
      github,
      now,
      summary: (line) => summary.push(line),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.title).toBe('PROD STRIPE WEBHOOK DISABLED');
    const body = github.calls.find((call) => call[0] === 'open')[2];
    expect(body).toContain('not enabled');
    expect(body).not.toContain(ENDPOINT_ID);
    expect(body).not.toContain(MONITOR_KEY);
    expect(body).not.toContain('rk_');
    expect(summary[0]).toContain('not enabled');
    expect(summary[0]).not.toContain(ENDPOINT_ID);
  });

  it('alerts when the endpoint host is not FitMunch', async () => {
    const github = githubDouble();
    const { fetchImpl } = stripeFetch({ status: 'enabled', url: 'https://evil.example/hook' });
    const result = await runStripeWebhookMonitor({ env: env(), fetch: fetchImpl, github, now });
    expect(result.reason).toBe('wrong-host');
    const body = github.calls.find((call) => call[0] === 'open')[2];
    expect(body).toContain('FitMunch host');
    expect(body).not.toContain('evil.example');
    expect(body).not.toContain(ENDPOINT_ID);
  });

  it('notifies when the monitor key is missing', async () => {
    const github = githubDouble();
    const summaryFile = path.join(os.tmpdir(), `fm-stripe-summary-${process.pid}.txt`);
    fs.rmSync(summaryFile, { force: true });
    let fetchedStripe = false;
    const result = await runStripeWebhookMonitor({
      env: env({
        STRIPE_MONITOR_KEY: '',
        GITHUB_STEP_SUMMARY: summaryFile,
      }),
      fetch: async (url) => {
        if (String(url).includes('api.stripe.com')) fetchedStripe = true;
        return { ok: true, text: async () => '' };
      },
      github,
      now,
    });
    expect(fetchedStripe).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-key');
    expect(result.incident.action).toBe('opened');
    expect(result.incident.emailed).toBe(true);
    const body = github.calls.find((call) => call[0] === 'open')[2];
    expect(body).toContain('not set');
    expect(body).not.toContain(ENDPOINT_ID);
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('not set');
    fs.rmSync(summaryFile, { force: true });
  });

  it('alerts on finished failed deliveries and ignores still-pending events', async () => {
    const github = githubDouble();
    const pendingOnly = stripeFetch(
      { status: 'enabled', url: 'https://fitmunch.com.au/api/stripe/webhook' },
      { data: [{ id: 'evt_pending', pending_webhooks: 2 }] }
    );
    const pending = await runStripeWebhookMonitor({
      env: env(),
      fetch: pendingOnly.fetchImpl,
      github,
      now,
    });
    expect(pending.ok).toBe(true);

    const failed = stripeFetch(
      { status: 'enabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' },
      { data: [{ id: 'evt_failed_secret', pending_webhooks: 0 }] }
    );
    const githubFailed = githubDouble();
    const result = await runStripeWebhookMonitor({
      env: env(),
      fetch: failed.fetchImpl,
      github: githubFailed,
      now,
    });
    expect(result.reason).toBe('failed-deliveries');
    const body = githubFailed.calls.find((call) => call[0] === 'open')[2];
    expect(body).toContain('failed webhook deliveries');
    expect(body).not.toContain('evt_');
    expect(body).not.toContain(ENDPOINT_ID);
  });

  it('runs from the hourly probe and fails the job when the key is missing', async () => {
    const github = githubDouble();
    const result = await runProbe({
      env: {
        CHECK_STRIPE_WEBHOOK: '1',
        SMOKE_CHECKS: 'health',
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'FitMunch <hello@fitmunch.com.au>',
        ALERT_EMAIL_TO: 'support@fitmunch.com.au',
      },
      smoke: async () => ({ code: 0, log: '' }),
      github,
      fetch: async () => ({ ok: true, text: async () => '' }),
      now,
      log: () => {},
    });
    expect(result.exitCode).toBe(1);
    expect(result.stripe.reason).toBe('missing-key');
    expect(github.calls.some((call) => call[0] === 'open')).toBe(true);
  });
});
