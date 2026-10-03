const fs = require('fs');
const { handleIncident, shouldSendDownEmail, lastEmailAt, emailMarker, redact } = require('./scripts/lib/prod-incident');
const { runProbe, buildSmokeArgs, missingNames } = require('./scripts/prod-uptime-probe');

function githubDouble(openIssues) {
  const calls = [];
  return {
    calls,
    async ensureLabel() { calls.push('label'); },
    async listOpen() { return openIssues; },
    async listComments() {
      return [{ body: `still down\n\n${emailMarker(Date.parse('2026-10-03T00:00:00Z'))}` }];
    },
    async open(title, body) {
      calls.push(['open', title, body]);
      return { number: 9, title };
    },
    async comment(number, body) { calls.push(['comment', number, body]); },
    async close(number) { calls.push(['close', number]); },
  };
}

describe('production incidents', () => {
  it('emails on the first open and not again inside 60 minutes', () => {
    expect(shouldSendDownEmail({ isNew: true, comments: [], now: 0 })).toBe(true);
    const comments = [{ body: emailMarker(0) }];
    expect(shouldSendDownEmail({ isNew: false, comments, now: 30 * 60 * 1000 })).toBe(false);
    expect(shouldSendDownEmail({ isNew: false, comments, now: 61 * 60 * 1000 })).toBe(true);
  });

  it('opens one issue and redacts secrets', async () => {
    const github = githubDouble([]);
    let mailed = 0;
    const result = await handleIncident({
      state: 'down',
      title: 'PROD DOWN: fitmunch.com.au smoke failing',
      body: 'buyer@example.com sk_live_abc123 Bearer secret-token',
      github,
      now: Date.parse('2026-10-03T01:00:00Z'),
      fetchImpl: async () => { mailed += 1; return { ok: true }; },
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    });
    expect(result.action).toBe('opened');
    expect(result.emailed).toBe(true);
    expect(mailed).toBe(1);
    const body = github.calls.find((call) => call[0] === 'open')[2];
    expect(body).not.toContain('buyer@example.com');
    expect(body).not.toContain('sk_live_');
    expect(body).not.toContain('Bearer secret-token');
    expect(redact(body)).not.toContain('@');
  });

  it('comments without another email inside the hour', async () => {
    const github = githubDouble([{
      number: 4,
      title: 'PROD DOWN: fitmunch.com.au smoke failing',
      body: `still down\n\n${emailMarker(Date.parse('2026-10-03T00:00:00Z'))}`,
    }]);
    let mailed = 0;
    const result = await handleIncident({
      state: 'down',
      title: 'PROD DOWN: fitmunch.com.au smoke failing',
      body: 'still down',
      github,
      now: Date.parse('2026-10-03T00:30:00Z'),
      fetchImpl: async () => { mailed += 1; return { ok: true }; },
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    });
    expect(result.action).toBe('commented');
    expect(result.emailed).toBe(false);
    expect(mailed).toBe(0);
    expect(github.calls.some((call) => call[0] === 'comment')).toBe(false);
  });

  it('ignores an email time more than five minutes in the future', async () => {
    const at = Date.parse('2026-10-03T00:00:00Z');
    expect(lastEmailAt('<!-- fm-alert-email:2099-01-01T00:00:00Z -->', at)).toBeNull();
    expect(lastEmailAt([{ body: '<!-- fm-alert-email:2099-01-01T00:00:00Z -->' }], at)).toBeNull();
    expect(lastEmailAt(emailMarker(at + 5 * 60 * 1000), at)).toBe(at + 5 * 60 * 1000);
    expect(lastEmailAt(emailMarker(at + 5 * 60 * 1000 + 1), at)).toBeNull();
    expect(shouldSendDownEmail({
      isNew: false,
      body: '<!-- fm-alert-email:2099-01-01T00:00:00Z -->',
      now: at,
      intervalMs: 6 * 60 * 60 * 1000,
    })).toBe(true);

    const github = {
      async ensureLabel() {},
      async listOpen() {
        return [{
          number: 5,
          title: 'PROD DOWN',
          body: `down\n\n${emailMarker(at - 6 * 60 * 60 * 1000)}`,
        }];
      },
      async listComments() {
        return [
          { body: emailMarker(at - 60 * 1000) },
          { body: '<!-- fm-alert-email:2099-01-01T00:00:00Z -->' },
        ];
      },
      async open() { throw new Error('should keep the open issue'); },
      async comment() {},
      async close() {},
    };
    const result = await handleIncident({
      state: 'down',
      title: 'PROD DOWN',
      body: 'down',
      now: at,
      intervalMs: 6 * 60 * 60 * 1000,
      github,
      fetchImpl: async () => ({ ok: true }),
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    });
    expect(result.emailed).toBe(true);
  });

  it('emails once an hour for 12 hours when the check runs every 5 minutes', async () => {
    let n = 0;
    const issues = [];
    const github = {
      async ensureLabel() {},
      async listOpen() {
        return issues.filter((issue) => issue.open).map(({ number, title, body }) => ({ number, title, body }));
      },
      async listComments(number) {
        return issues.find((issue) => issue.number === number).c.slice(0, 100).map((body) => ({ body }));
      },
      async open(title, body) {
        const issue = { number: ++n, title, body, open: true, c: [] };
        issues.push(issue);
        return issue;
      },
      async comment(number, body) {
        issues.find((issue) => issue.number === number).c.push(body);
      },
      async close() {},
    };
    const start = Date.parse('2026-10-03T00:00:00Z');
    const emailed = [];
    for (let minute = 0; minute <= 12 * 60; minute += 5) {
      const result = await handleIncident({
        state: 'down',
        title: 'PROD DOWN',
        body: 'down',
        now: start + minute * 60 * 1000,
        github,
        fetchImpl: async () => ({ ok: true }),
        resendKey: 're_test',
        resendFrom: 'FitMunch <hello@fitmunch.com.au>',
        emailTo: ['support@fitmunch.com.au'],
      });
      if (result.emailed) emailed.push(minute / 60);
    }
    expect(emailed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(issues[0].c).toHaveLength(12);
  });

  it('closes an open incident when the probe recovers', async () => {
    const github = githubDouble([{ number: 4, title: 'PROD DOWN: fitmunch.com.au smoke failing' }]);
    const result = await runProbe({
      env: {
        SMOKE_TOKEN: 'tok',
        SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
        SMOKE_USER_PASSWORD: 'pw',
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'FitMunch <hello@fitmunch.com.au>',
        ALERT_EMAIL_TO: 'support@fitmunch.com.au',
      },
      now: Date.parse('2026-10-03T02:00:00Z'),
      smoke: async () => ({ code: 0, log: '' }),
      github,
      fetch: async () => ({ ok: true }),
      log: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(github.calls.some((call) => call[0] === 'close')).toBe(true);
  });

  it('exits success and names missing configuration', async () => {
    const logs = [];
    const result = await runProbe({
      env: { SMOKE_CHECKS: 'full' },
      log: (line) => logs.push(line),
      smoke: async () => { throw new Error('should not probe'); },
    });
    expect(result.exitCode).toBe(0);
    expect(logs.join('\n')).toContain('SMOKE_TOKEN');
    expect(logs.join('\n')).toContain('::warning::');
  });

  it('defaults the uptime probe to health and keeps checkout smoke opt-in', () => {
    expect(missingNames({})).toEqual([]);
    expect(buildSmokeArgs({}).checks).toBe('health');
    expect(buildSmokeArgs({}).args).toContain('health');
    expect(buildSmokeArgs({ SMOKE_CHECKS: 'full' }).checks).toBe('full');
    expect(missingNames({ SMOKE_CHECKS: 'full' })).toEqual(expect.arrayContaining(['SMOKE_TOKEN', 'SMOKE_USER_EMAIL', 'SMOKE_USER_PASSWORD']));
    const yaml = fs.readFileSync('.github/workflows/prod-uptime-probe.yml', 'utf8');
    expect(yaml).toContain('*/5 * * * *');
    expect(yaml).toContain('12 * * * *');
    expect(yaml).toContain('checks=health');
    expect(yaml).toContain('checks=full');
    expect(yaml).toContain('PROBE_SCHEDULE:');
    expect(yaml).toContain('PROBE_CHECKS:');
    expect(yaml).toContain('STRIPE_MONITOR_KEY');
    expect(yaml).toContain('STRIPE_WEBHOOK_ENDPOINT_ID');
    expect(yaml).toContain('we_1T3UtAGMuYRuJYDr3uqhtekB');
    const run = yaml.split('run:').pop();
    expect(run).not.toContain('${{');
    const rollback = fs.readFileSync('.github/workflows/prod-smoke-rollback.yml', 'utf8');
    expect(rollback).toContain('SMOKE_AUTO_ROLLBACK');
    expect(rollback).toContain('*-armctay85s-projects.vercel.app');
  });

  it('runs a health check without smoke credentials', async () => {
    let called = false;
    const github = githubDouble([]);
    const result = await runProbe({
      env: {},
      now: Date.parse('2026-10-03T03:00:00Z'),
      smoke: async () => { called = true; return { code: 0, log: '' }; },
      github,
      fetch: async () => ({ ok: true, text: async () => '', status: 200 }),
      log: () => {},
    });
    expect(called).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
