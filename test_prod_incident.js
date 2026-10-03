const { handleIncident, shouldSendDownEmail, emailMarker, redact } = require('./scripts/lib/prod-incident');
const { runProbe } = require('./scripts/prod-uptime-probe');

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
    const github = githubDouble([{ number: 4, title: 'PROD DOWN: fitmunch.com.au smoke failing' }]);
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
      env: {},
      log: (line) => logs.push(line),
      smoke: async () => { throw new Error('should not probe'); },
    });
    expect(result.exitCode).toBe(0);
    expect(logs.join('\n')).toContain('SMOKE_TOKEN');
    expect(logs.join('\n')).toContain('::warning::');
  });
});
