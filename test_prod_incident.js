const fs = require('fs');
const { handleIncident, shouldSendDownEmail, lastEmailAt, emailMarker, redact, createGithub, BODY_CAP } = require('./scripts/lib/prod-incident');
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
        return [{ body: '<!-- fm-alert-email:2099-01-01T00:00:00Z -->' }];
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
        const issue = { number: ++n, title, body, open: true, c: Array.from({ length: 100 }, () => 'older note') };
        issues.push(issue);
        return issue;
      },
      async update(number, body) {
        issues.find((issue) => issue.number === number).body = body;
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
    expect(issues[0].c.length - 100).toBe(12);
    expect(lastEmailAt(issues[0].body, start + 12 * 60 * 60 * 1000)).toBe(start + 12 * 60 * 60 * 1000);
  });

  it('PATCHes the issue body with the email marker through the GitHub client', async () => {
    const issues = [];
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      calls.push({ method, url: String(url), body: options.body || '' });
      if (String(url).includes('api.resend.com')) return { ok: true, status: 200, text: async () => '{}' };
      if (method === 'POST' && String(url).endsWith('/labels')) {
        return { ok: false, status: 422, text: async () => '{"message":"Validation Failed"}' };
      }
      if (method === 'GET' && String(url).includes('/issues?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(issues) };
      }
      if (method === 'POST' && /\/issues$/.test(new URL(url).pathname)) {
        const payload = JSON.parse(options.body);
        const issue = { number: 41, title: payload.title, body: payload.body };
        issues.push(issue);
        return { ok: true, status: 201, text: async () => JSON.stringify(issue) };
      }
      if (method === 'GET' && String(url).includes('/comments')) {
        return { ok: true, status: 200, text: async () => '[]' };
      }
      if (method === 'PATCH' && /\/issues\/\d+$/.test(new URL(url).pathname)) {
        const payload = JSON.parse(options.body);
        issues[0].body = payload.body;
        return { ok: true, status: 200, text: async () => JSON.stringify(issues[0]) };
      }
      if (method === 'POST' && String(url).includes('/comments')) {
        return { ok: true, status: 201, text: async () => '{}' };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    const github = createGithub({ fetchImpl, token: 'ghs_test', repo: 'o/r' });
    const start = Date.parse('2026-10-03T00:00:00Z');
    const base = {
      state: 'down',
      title: 'PROD DOWN',
      body: 'down',
      github,
      fetchImpl,
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    };
    await handleIncident({ ...base, now: start });
    await handleIncident({ ...base, now: start + 60 * 60 * 1000 });
    const patches = calls.filter((call) => call.method === 'PATCH' && /\/repos\/o\/r\/issues\/41$/.test(new URL(call.url).pathname));
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0].body).body).toContain('<!-- fm-alert-email:');
    expect(JSON.parse(patches[0].body).body).toContain(new Date(start + 60 * 60 * 1000).toISOString());
  });

  it('throws on a 422 body update and still accepts an existing label', async () => {
    const fetchImpl = async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'POST' && String(url).endsWith('/labels')) {
        return { ok: false, status: 422, text: async () => '{"message":"Validation Failed"}' };
      }
      if (method === 'PATCH') return { ok: false, status: 422, text: async () => '{"message":"body is too long"}' };
      return { ok: false, status: 500, text: async () => '' };
    };
    const github = createGithub({ fetchImpl, token: 'ghs_test', repo: 'o/r' });
    await expect(github.ensureLabel()).resolves.toBeUndefined();
    await expect(github.update(41, 'body')).rejects.toThrow(/422/);
  });

  it.each([500, 422])('emails hourly for 12 hours when every body update returns %s', async (patchStatus) => {
    const issues = [];
    const comments = [];
    const calls = [];
    let clock = 0;
    const fetchImpl = async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      calls.push({ method, url: String(url) });
      if (String(url).includes('api.resend.com')) return { ok: true, status: 200, text: async () => '{}' };
      if (method === 'POST' && String(url).endsWith('/labels')) {
        return { ok: false, status: 422, text: async () => '{"message":"Validation Failed"}' };
      }
      if (method === 'GET' && String(url).includes('/issues?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(issues) };
      }
      if (method === 'POST' && /\/issues$/.test(new URL(url).pathname)) {
        const payload = JSON.parse(options.body);
        const issue = { number: 41, title: payload.title, body: payload.body };
        issues.push(issue);
        return { ok: true, status: 201, text: async () => JSON.stringify(issue) };
      }
      if (method === 'GET' && String(url).includes('/comments')) {
        const since = new URL(url).searchParams.get('since');
        if (!since) return { ok: true, status: 200, text: async () => '[]' };
        const sinceMs = Date.parse(since);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(comments.filter((comment) => comment.at >= sinceMs).map((comment) => ({ body: comment.body }))),
        };
      }
      if (method === 'POST' && String(url).includes('/comments')) {
        comments.push({ body: JSON.parse(options.body).body, at: clock });
        return { ok: true, status: 201, text: async () => '{}' };
      }
      if (method === 'PATCH') return { ok: false, status: patchStatus, text: async () => '{"message":"nope"}' };
      return { ok: false, status: 404, text: async () => '' };
    };
    const github = createGithub({ fetchImpl, token: 'ghs_test', repo: 'o/r' });
    const start = Date.parse('2026-10-03T00:00:00Z');
    const emailed = [];
    for (let minute = 0; minute <= 12 * 60; minute += 5) {
      const at = start + minute * 60 * 1000;
      clock = at;
      const result = await handleIncident({
        state: 'down',
        title: 'PROD DOWN',
        body: 'down',
        now: at,
        github,
        fetchImpl,
        resendKey: 're_test',
        resendFrom: 'FitMunch <hello@fitmunch.com.au>',
        emailTo: ['support@fitmunch.com.au'],
      });
      if (result.emailed) emailed.push(minute / 60);
    }
    expect(emailed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(calls.some((call) => call.method === 'GET' && call.url.includes('since='))).toBe(true);
  });

  it('caps the saved body at 60000 characters and keeps the marker', async () => {
    let saved = '';
    const issues = [{ number: 3, title: 'PROD DOWN', body: `down\n\n${emailMarker(0)}` }];
    const github = {
      async ensureLabel() {},
      async listOpen() { return issues.map((issue) => ({ ...issue })); },
      async listComments() { return []; },
      async update(_number, body) { saved = body; issues[0].body = body; },
      async comment() {},
      async open() { throw new Error('should update the open issue'); },
      async close() {},
    };
    await handleIncident({
      state: 'down',
      title: 'PROD DOWN',
      body: '!'.repeat(70000),
      now: 60 * 60 * 1000,
      github,
      fetchImpl: async () => ({ ok: true }),
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    });
    expect(saved.length).toBeLessThanOrEqual(BODY_CAP);
    expect(saved.length).toBeGreaterThan(50000);
    expect(saved).toContain('<!-- fm-alert-email:');
    expect(lastEmailAt(saved, 60 * 60 * 1000)).toBe(60 * 60 * 1000);
  });

  it('sends the email when the comment after a saved body update throws', async () => {
    const start = Date.parse('2026-10-03T00:00:00Z');
    const issues = [{ number: 4, title: 'PROD DOWN', body: `down\n\n${emailMarker(start)}` }];
    let mailed = 0;
    const github = {
      async ensureLabel() {},
      async listOpen() { return issues.map((issue) => ({ ...issue })); },
      async listComments() { return []; },
      async update(_number, body) { issues[0].body = body; },
      async comment() { throw new Error('comment failed'); },
      async open() { throw new Error('should keep the open issue'); },
      async close() {},
    };
    const base = {
      state: 'down',
      title: 'PROD DOWN',
      body: 'down',
      github,
      fetchImpl: async () => { mailed += 1; return { ok: true }; },
      resendKey: 're_test',
      resendFrom: 'FitMunch <hello@fitmunch.com.au>',
      emailTo: ['support@fitmunch.com.au'],
    };
    const result = await handleIncident({ ...base, now: start + 60 * 60 * 1000 });
    expect(result.emailed).toBe(true);
    expect(mailed).toBe(1);
    expect(lastEmailAt(issues[0].body, start + 60 * 60 * 1000)).toBe(start + 60 * 60 * 1000);
    const later = await handleIncident({ ...base, now: start + 90 * 60 * 1000 });
    expect(later.emailed).toBe(false);
    expect(mailed).toBe(1);
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
