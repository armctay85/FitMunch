const fs = require('fs');
const os = require('os');
const path = require('path');
const { runStripeWebhookMonitor, DEFAULT_WEBHOOK_ENDPOINT_ID, DISABLED_EMAIL_INTERVAL_MS, EVENTS_SUMMARY } = require('./scripts/stripe-webhook-monitor');
const { emailMarker } = require('./scripts/lib/prod-incident');
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

  it('accepts an enabled FitMunch endpoint and does not query account-wide events', async () => {
    const github = githubDouble();
    const summary = [];
    const { fetchImpl, seen } = stripeFetch(
      { status: 'enabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' },
      { data: [{ id: 'evt_other_product', pending_webhooks: 0 }] }
    );
    const result = await runStripeWebhookMonitor({
      env: env(),
      fetch: fetchImpl,
      github,
      now,
      summary: (line) => summary.push(line),
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('healthy');
    expect(github.calls.some((call) => call[0] === 'open')).toBe(false);
    expect(seen.map((call) => call.url).join('\n')).not.toContain('/v1/events');
    expect(seen[0].url).toContain(`/webhook_endpoints/${ENDPOINT_ID}`);
    expect(seen[0].authorization).toBe(`Bearer ${MONITOR_KEY}`);
    expect(summary.join('\n')).toContain(EVENTS_SUMMARY);
    expect(summary.join('\n')).toContain('account-wide');
    expect(summary.join('\n')).not.toContain('evt_');
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
    expect(body).toContain('fit-munch.vercel.app');
    expect(body).toContain('www.fitmunch.com.au');
    expect(body).toContain('fitmunch.com.au');
    expect(body).not.toContain('evil.example');
    expect(body).not.toContain(ENDPOINT_ID);
  });

  it('accepts the live vercel host and alerts when the path is wrong', async () => {
    const healthy = stripeFetch(
      { status: 'enabled', url: 'https://fit-munch.vercel.app/api/stripe/webhook' },
      { data: [] }
    );
    const ok = await runStripeWebhookMonitor({
      env: env(),
      fetch: healthy.fetchImpl,
      github: githubDouble(),
      now,
    });
    expect(ok.ok).toBe(true);

    const github = githubDouble();
    const { fetchImpl } = stripeFetch({
      status: 'enabled',
      url: 'https://fit-munch.vercel.app/api/stripe-webhook',
    });
    const result = await runStripeWebhookMonitor({ env: env(), fetch: fetchImpl, github, now });
    expect(result.reason).toBe('wrong-path');
    const body = github.calls.find((call) => call[0] === 'open')[2];
    expect(body).toContain('/api/stripe/webhook');
    expect(body).not.toContain('stripe-webhook');
    expect(body).not.toContain(ENDPOINT_ID);
    expect(body).not.toContain(DEFAULT_WEBHOOK_ENDPOINT_ID);
  });

  it('uses the live endpoint id when the variable is unset', async () => {
    const { fetchImpl, seen } = stripeFetch(
      { status: 'enabled', url: 'https://fit-munch.vercel.app/api/stripe/webhook/' },
      { data: [] }
    );
    const config = env();
    delete config.STRIPE_WEBHOOK_ENDPOINT_ID;
    const result = await runStripeWebhookMonitor({
      env: config,
      fetch: fetchImpl,
      github: githubDouble(),
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('healthy');
    expect(seen[0].url).toContain(`/webhook_endpoints/${DEFAULT_WEBHOOK_ENDPOINT_ID}`);
    expect(DEFAULT_WEBHOOK_ENDPOINT_ID).toBe('we_1T3UtAGMuYRuJYDr3uqhtekB');
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

  it('does not email one hour later when the first send time is only in the issue body', async () => {
    const calls = [];
    let open = [];
    const github = {
      calls,
      async ensureLabel() {},
      async listOpen() { return open; },
      async listComments() { return []; },
      async open(title, body) {
        calls.push(['open', title, body]);
        const issue = { number: 21, title, body };
        open = [issue];
        return issue;
      },
      async comment(number, body) { calls.push(['comment', number, body]); },
      async close() {},
    };
    const disabled = stripeFetch({ status: 'disabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' });
    const opened = await runStripeWebhookMonitor({
      env: env(),
      fetch: disabled.fetchImpl,
      github,
      now,
    });
    expect(opened.incident.action).toBe('opened');
    expect(opened.incident.emailed).toBe(true);
    expect(open[0].body).toContain('fm-alert-email:');
    expect(github.calls.filter((call) => call[0] === 'comment')).toHaveLength(0);

    const hourLater = await runStripeWebhookMonitor({
      env: env(),
      fetch: disabled.fetchImpl,
      github,
      now: now + 60 * 60 * 1000,
    });
    expect(hourLater.incident.action).toBe('commented');
    expect(hourLater.incident.emailed).toBe(false);
  });

  it('sends nothing when the body time is 5 hours ago and one email at exactly 6 hours, with no comments', async () => {
    async function runAt(ageMs) {
      const calls = [];
      const open = [{
        number: 22,
        title: 'PROD STRIPE WEBHOOK DISABLED',
        body: `The FitMunch Stripe webhook endpoint is not enabled.\n\n${emailMarker(now - ageMs)}`,
      }];
      const github = {
        calls,
        async ensureLabel() {},
        async listOpen() {
          return open.map((issue) => ({ number: issue.number, title: issue.title, body: issue.body }));
        },
        async listComments() { return []; },
        async open() { throw new Error('should stay on the open issue'); },
        async comment(number, body) { calls.push(['comment', number, body]); },
        async close() {},
      };
      const disabled = stripeFetch({ status: 'disabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' });
      const result = await runStripeWebhookMonitor({
        env: env(),
        fetch: disabled.fetchImpl,
        github,
        now,
      });
      return { result, calls };
    }

    const fiveHours = await runAt(5 * 60 * 60 * 1000);
    expect(fiveHours.result.incident.emailed).toBe(false);
    expect(fiveHours.calls.filter((call) => call[0] === 'comment')).toHaveLength(0);

    const sixHours = await runAt(DISABLED_EMAIL_INTERVAL_MS);
    expect(sixHours.result.incident.action).toBe('commented');
    expect(sixHours.result.incident.emailed).toBe(true);
    expect(sixHours.calls.filter((call) => call[0] === 'comment')).toHaveLength(1);
  });

  it('closes an open incident on recovery and repeats the disabled email every 6 hours', async () => {
    const calls = [];
    let open = [{
      number: 8,
      title: 'PROD STRIPE WEBHOOK DISABLED',
      body: `The FitMunch Stripe webhook endpoint is not enabled.\n\n${emailMarker(now - 60 * 60 * 1000)}`,
    }];
    const github = {
      calls,
      async ensureLabel() { calls.push('label'); },
      async listOpen() { return open; },
      async listComments() { return []; },
      async open(title, body) {
        calls.push(['open', title, body]);
        return { number: 9, title };
      },
      async comment(number, body) { calls.push(['comment', number, body]); },
      async close(number) {
        calls.push(['close', number]);
        open = open.filter((issue) => issue.number !== number);
      },
    };
    const disabled = stripeFetch({ status: 'disabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' });
    const recent = await runStripeWebhookMonitor({ env: env(), fetch: disabled.fetchImpl, github, now });
    expect(recent.reason).toBe('disabled');
    expect(recent.incident.action).toBe('commented');
    expect(recent.incident.emailed).toBe(false);

    open[0].body = `The FitMunch Stripe webhook endpoint is not enabled.\n\n${emailMarker(now - DISABLED_EMAIL_INTERVAL_MS - 1000)}`;
    const later = await runStripeWebhookMonitor({ env: env(), fetch: disabled.fetchImpl, github, now });
    expect(later.incident.action).toBe('commented');
    expect(later.incident.emailed).toBe(true);

    const healthy = stripeFetch({ status: 'enabled', url: 'https://fit-munch.vercel.app/api/stripe/webhook' });
    const recovered = await runStripeWebhookMonitor({ env: env(), fetch: healthy.fetchImpl, github, now });
    expect(recovered.ok).toBe(true);
    expect(calls.some((call) => call[0] === 'close' && call[1] === 8)).toBe(true);
    const up = calls.find((call) => call[0] === 'comment' && String(call[2]).includes('enabled and points'));
    expect(up).toBeTruthy();
    expect(String(up[2])).not.toContain(ENDPOINT_ID);
  });

  it('rejects a secret key and any explicit port', async () => {
    const github = githubDouble();
    const secret = 'sk_live_not_a_restricted_key';
    let fetchedStripe = false;
    const badKey = await runStripeWebhookMonitor({
      env: env({ STRIPE_MONITOR_KEY: secret }),
      fetch: async (url) => {
        if (String(url).includes('api.stripe.com')) fetchedStripe = true;
        return { ok: true, text: async () => '' };
      },
      github,
      now,
    });
    expect(fetchedStripe).toBe(false);
    expect(badKey.reason).toBe('bad-key');
    const keyBody = github.calls.find((call) => call[0] === 'open')[2];
    expect(keyBody).toContain('restricted Stripe key');
    expect(keyBody).toContain('rk_');
    expect(keyBody).not.toContain(secret);

    const portGithub = githubDouble();
    const { fetchImpl } = stripeFetch({
      status: 'enabled',
      url: 'https://fit-munch.vercel.app:443/api/stripe/webhook',
    });
    const port = await runStripeWebhookMonitor({ env: env(), fetch: fetchImpl, github: portGithub, now });
    expect(port.reason).toBe('explicit-port');
    const portBody = portGithub.calls.find((call) => call[0] === 'open')[2];
    expect(portBody).toContain('includes a port');
    expect(portBody).not.toContain(':443');
    expect(portBody).not.toContain(ENDPOINT_ID);

    const oddPort = await runStripeWebhookMonitor({
      env: env(),
      fetch: stripeFetch({
        status: 'enabled',
        url: 'https://www.fitmunch.com.au:8443/api/stripe/webhook',
      }).fetchImpl,
      github: githubDouble(),
      now,
    });
    expect(oddPort.reason).toBe('explicit-port');
  });

  it('emails a disabled endpoint every 6 hours across 150 hourly runs when only the first 100 comments are listed', async () => {
    let n = 1;
    const issues = [];
    const github = {
      issues,
      async ensureLabel() {},
      async listOpen() {
        return issues
          .filter((issue) => issue.state === 'open')
          .map(({ number, title, body }) => ({ number, title, body }));
      },
      async listComments(number) {
        const issue = issues.find((item) => item.number === number);
        return issue.comments.slice(0, 100).map((body) => ({ body }));
      },
      async open(title, body) {
        const issue = { number: ++n, title, body, state: 'open', comments: [] };
        issues.push(issue);
        return { number: issue.number, title, body };
      },
      async comment(number, body) {
        issues.find((item) => item.number === number).comments.push(body);
      },
      async close() {},
    };
    const disabled = stripeFetch({ status: 'disabled', url: 'https://www.fitmunch.com.au/api/stripe/webhook' });
    const emailed = [];
    for (let hour = 0; hour < 150; hour += 1) {
      const result = await runStripeWebhookMonitor({
        env: env(),
        fetch: disabled.fetchImpl,
        github,
        now: now + hour * 60 * 60 * 1000,
      });
      if (result.incident && result.incident.emailed) emailed.push(hour);
    }
    const expected = [];
    for (let hour = 0; hour < 150; hour += 6) expected.push(hour);
    expect(emailed).toEqual(expected);
    expect(issues[0].comments).toHaveLength(expected.length - 1);
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
