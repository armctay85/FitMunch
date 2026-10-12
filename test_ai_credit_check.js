const c = require('./scripts/ai-credit-check');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const resp = (totalCents, spends) => ({
  total: { val: String(totalCents) },
  changes: [
    { changeOrigin: 'PURCHASE', amount: { val: '-2500' }, createTime: day(8) },
    ...spends.map(([d, v]) => ({ changeOrigin: 'SPEND', amount: { val: String(v) }, createTime: day(d) })),
  ],
});
const res = (status, body) => ({ ok: status < 300, status, json: async () => body });

describe('balance parsing', () => {
  it('inverted ledger: negative total is positive balance', () => {
    expect(c.balanceUsd({ total: { val: '-1000' } })).toBe(10);
  });
  it('missing total is an error, not zero', () => {
    expect(() => c.balanceUsd({})).toThrow();
    expect(() => c.balanceUsd({ total: {} })).toThrow();
    expect(() => c.balanceUsd({ total: { val: 'x' } })).toThrow();
  });
});

describe('days left', () => {
  it('averages SPEND over 7 days', () => {
    const s = c.summarise(resp(-1000, [[1, 200], [3, 200], [6.5, 300]]), NOW);
    expect(s.balance).toBe(10);
    expect(s.perDay).toBeCloseTo(7 / 6.5, 5);
    expect(s.daysLeft).toBeCloseTo(10 / (7 / 6.5), 5);
    expect(s.low).toBe(false);
  });
  it('ignores spend older than the window and non-SPEND rows', () => {
    const s = c.summarise(resp(-1000, [[2, 700], [10, 99999]]), NOW);
    expect(s.perDay).toBeCloseTo(3.5, 5);
    expect(s.low).toBe(true);
  });
  it('short history divides by at least one day', () => {
    expect(c.summarise(resp(-1000, [[0.1, 300]]), NOW).perDay).toBe(3);
  });
  it('no spend means not low', () => {
    const s = c.summarise(resp(-1000, []), NOW);
    expect(s.daysLeft).toBe(Infinity);
    expect(s.low).toBe(false);
  });
  it('zero or negative balance is low', () => {
    expect(c.summarise(resp(0, []), NOW).low).toBe(true);
  });
  it('respects AI_CREDIT_WARN_DAYS', () => {
    expect(c.summarise(resp(-1000, [[1, 100]]), NOW, { warnDays: 14 }).low).toBe(true);
  });
});

describe('main', () => {
  const env = { XAI_MANAGEMENT_KEY: 'xai-mgmt-SECRETVALUE123', XAI_TEAM_ID: 'team-1', GITHUB_REPOSITORY: 'o/r', RUN_URL: 'u' };
  function deps(issues) {
    const calls = [];
    const lines = [];
    const fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body, auth: opts.headers && opts.headers.Authorization });
      if (url.startsWith('https://management-api.x.ai')) return res(200, resp(-500, [[1, 300]]));
      if (url.includes('/issues?')) return res(200, issues);
      if (url.endsWith('/comments')) return res(201, {});
      return res(201, { number: 42 });
    };
    return { fetch, now: () => NOW, log: (l) => lines.push(l), calls, lines };
  }
  it('skips without key or team', async () => {
    const d = deps([]);
    expect((await c.main({}, d)).skipped).toBe(true);
    expect(d.calls).toHaveLength(0);
  });
  it('opens one labelled issue when low', async () => {
    const d = deps([]);
    const r = await c.main(env, d);
    expect(r.issue).toEqual({ action: 'opened', number: 42 });
    const post = d.calls.find((x) => x.method === 'POST');
    expect(JSON.parse(post.body).labels).toEqual(['ai-credit-low']);
    expect(d.calls[0].url).toBe('https://management-api.x.ai/v1/billing/teams/team-1/prepaid/balance');
  });
  it('comments on the existing open issue instead of duplicating', async () => {
    const d = deps([{ number: 7, pull_request: { url: 'x' } }, { number: 9 }]);
    const r = await c.main(env, d);
    expect(r.issue).toEqual({ action: 'commented', number: 9 });
    expect(d.calls.filter((x) => x.method === 'POST')).toHaveLength(1);
    expect(d.calls.some((x) => x.url.endsWith('/repos/o/r/issues'))).toBe(false);
  });
  it('does not open an issue when credit is fine', async () => {
    const d = deps([]);
    d.fetch = async (url) => res(200, resp(-100000, [[1, 100]]));
    const r = await c.main(env, d);
    expect(r.issue).toBeNull();
  });
  it('never logs the key or puts it in the issue', async () => {
    const d = deps([]);
    await c.main(env, d);
    const text = d.lines.join('\n') + d.calls.map((x) => x.body || '').join('\n');
    expect(text).not.toContain('SECRETVALUE123');
  });
  it('balance API error fails without leaking the key', async () => {
    const d = deps([]);
    d.fetch = async () => res(403, { error: 'nope' });
    await expect(c.main(env, d)).rejects.toThrow(/^xAI balance request failed: 403$/);
  });
});
