const c = require('./scripts/ai-credit-check');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const bal = (totalCents, spends = [], key = 'createTime') => ({
  total: { val: String(totalCents) },
  changes: [
    { changeOrigin: 'PURCHASE', amount: { val: '-2500' }, [key]: day(8) },
    ...spends.map(([d, v]) => ({ changeOrigin: 'SPEND', amount: { val: String(v) }, [key]: day(d) })),
  ],
});
const usage = (perDayValues) => ({ timeSeries: [{ group: ['Chat grok'], dataPoints: perDayValues.map((v) => ({ timestamp: 't', values: [v] })) }], limitReached: false });
const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
const ENV = { XAI_MANAGEMENT_KEY: 'xai-mgmt-SECRETVALUE123', XAI_TEAM_ID: 'team-1', GITHUB_REPOSITORY: 'o/r', RUN_URL: 'u' };

function deps({ balance = bal(-2500), usageResp = usage([1, 1, 1, 1, 1, 1, 1]), usageStatus = 200, balStatus = 200, issues = [] } = {}) {
  const calls = []; const lines = []; const errs = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (url.endsWith('/prepaid/balance')) return res(balStatus, balance);
    if (url.endsWith('/usage')) return res(usageStatus, usageResp);
    if (url.includes('/issues?')) return res(200, issues);
    if (url.endsWith('/comments')) return res(201, {});
    if (opts.method === 'PATCH') return res(200, {});
    return res(201, { number: 42 });
  };
  return { fetch, now: () => NOW, log: (l) => lines.push(l), error: (l) => errs.push(l), calls, lines, errs };
}

describe('parsing', () => {
  it('inverted ledger: negative total is positive balance', () => {
    expect(c.balanceUsd({ total: { val: '-1000' } })).toBe(10);
  });
  it('missing total is an error, not zero', () => {
    expect(() => c.balanceUsd({})).toThrow();
    expect(() => c.balanceUsd({ total: { val: 'x' } })).toThrow();
  });
  it('usage endpoint: sums series points over the window', () => {
    expect(c.dailySpendFromUsage(usage([0.7, 0, 0, 0, 0, 0, 0.7]), 7)).toBeCloseTo(0.2, 5);
    expect(() => c.dailySpendFromUsage({}, 7)).toThrow();
  });
  it.each(['createTime', 'createTs'])('SPEND changes read %s', (key) => {
    expect(c.dailySpendFromChanges(bal(-1000, [[2, 700]], key), NOW, 7)).toBeCloseTo(3.5, 5);
  });
  it('SPEND outside the window and non-SPEND rows are ignored', () => {
    expect(c.dailySpendFromChanges(bal(-1000, [[10, 9999]]), NOW, 7)).toBe(0);
  });
});

describe('assess', () => {
  it('low under warn days', () => {
    expect(c.assess(10, 2).low).toBe(true);
    expect(c.assess(100, 2).low).toBe(false);
  });
  it('no spend: low only under the floor (default 10)', () => {
    expect(c.assess(9.99, 0).low).toBe(true);
    expect(c.assess(25, 0).low).toBe(false);
    expect(c.assess(25, 0, { floorUsd: '30' }).low).toBe(true);
  });
  it('zero balance is low', () => { expect(c.assess(0, 0).low).toBe(true); });
});

describe('main / run', () => {
  it('skips without key or team', async () => {
    const d = deps();
    expect((await c.main({}, d)).skipped).toBe(true);
    expect(d.calls).toHaveLength(0);
  });
  it('uses the usage endpoint with TIME_UNIT_DAY and a window clamped to 30 days', async () => {
    const d = deps();
    await c.main({ ...ENV, AI_CREDIT_WINDOW_DAYS: '365' }, d);
    const u = d.calls.find((x) => x.url.endsWith('/usage'));
    const body = JSON.parse(u.body).analyticsRequest;
    expect(u.method).toBe('POST');
    expect(body.timeUnit).toBe('TIME_UNIT_DAY');
    expect(body.values).toEqual([{ name: 'usd', aggregation: 'AGGREGATION_SUM' }]);
    expect(body.timeRange.startTime).toBe('2026-09-20 00:00:00');
  });
  it('falls back to SPEND changes when the usage call fails', async () => {
    const d = deps({ balance: bal(-500, [[1, 300]]), usageStatus: 500 });
    const r = await c.main(ENV, d);
    expect(r.low).toBe(true);
  });
  it('opens one labelled issue when low, with no figures', async () => {
    const d = deps({ balance: bal(-500), usageResp: usage([3, 3, 3, 3, 3, 3, 3]) });
    const r = await c.main(ENV, d);
    expect(r.issue).toEqual({ action: 'opened', number: 42 });
    const post = JSON.parse(d.calls.find((x) => x.url.endsWith('/repos/o/r/issues')).body);
    expect(post.labels).toEqual(['ai-credit-low']);
    expect(post.body).toContain('xAI prepaid credit is estimated to last under 7 days. Check xAI Console > Billing.');
    expect(post.title + post.body).not.toMatch(/\$|\d+\.\d|US\$|balance:|spend/i);
  });
  it('comments on the existing open issue instead of duplicating', async () => {
    const d = deps({ balance: bal(-500), issues: [{ number: 7, pull_request: {} }, { number: 9 }] });
    const r = await c.main(ENV, d);
    expect(r.issue).toEqual({ action: 'commented', number: 9 });
    expect(d.calls.some((x) => x.url.endsWith('/repos/o/r/issues'))).toBe(false);
  });
  it('logs only LOW or ok, never figures or the key', async () => {
    const d1 = deps({ balance: bal(-100000) });
    await c.main(ENV, d1);
    expect(d1.lines).toEqual(['xAI credit check: ok']);
    const d2 = deps({ balance: bal(-500) });
    await c.main(ENV, d2);
    expect(d2.lines[0]).toBe('xAI credit check: LOW');
    const all = [...d1.lines, ...d2.lines, ...d2.calls.map((x) => x.body || '')].join('\n');
    expect(all).not.toContain('SECRETVALUE123');
    expect(d1.lines.join(' ') + d2.lines.join(' ')).not.toMatch(/\d+\.\d|\$/);
  });
  it('on failure upserts an unknown issue and returns 1', async () => {
    const d = deps({ balStatus: 403 });
    expect(await c.run(ENV, d)).toBe(1);
    const post = JSON.parse(d.calls.find((x) => x.url.endsWith('/repos/o/r/issues')).body);
    expect(post.title).toBe('xAI credit check: unknown, check manually');
    expect(post.body).toMatch(/Status unknown, check manually/);
    expect(d.errs[0]).toBe('xAI credit check: unknown (xAI request failed: 403)');
    expect(d.errs.join(' ')).not.toContain('SECRETVALUE123');
  });
  it('run returns 0 on success', async () => {
    expect(await c.run(ENV, deps({ balance: bal(-100000) }))).toBe(0);
  });
  it('non-JSON xAI response fails with a fixed message, not the body', async () => {
    const d = deps();
    const f = d.fetch;
    d.fetch = async (url, opts) => (url.endsWith('/prepaid/balance')
      ? { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in <html>SECRET-BODY'); } }
      : f(url, opts));
    expect(await c.run(ENV, d)).toBe(1);
    expect(d.errs[0]).toBe('xAI credit check: unknown (xAI response was not valid JSON)');
  });
  it('only closes issues with our own titles', async () => {
    const d = deps({ balance: bal(-100000), issues: [{ number: 9, title: 'xAI credit low' }, { number: 10, title: 'Someone else labelled this' }, { number: 11, title: 'xAI credit check: unknown, check manually' }] });
    const r = await c.main(ENV, d);
    expect(r.closed).toEqual([9, 11]);
    expect(d.calls.some((x) => /\/issues\/10/.test(x.url))).toBe(false);
  });
  it('logs ok (could not close issue) when closing fails, and still succeeds', async () => {
    const d = deps({ balance: bal(-100000), issues: [{ number: 9, title: 'xAI credit low' }] });
    const f = d.fetch;
    d.fetch = (url, opts) => (url.endsWith('/comments') ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : f(url, opts));
    const r = await c.main(ENV, d);
    expect(r.closed).toEqual([]);
    expect(d.lines).toContain('ok (could not close issue)');
  });
  it('closes the open issue when credit is back to ok', async () => {
    const d = deps({ balance: bal(-100000), issues: [{ number: 9, title: 'xAI credit low' }] });
    const r = await c.main(ENV, d);
    expect(r.closed).toEqual([9]);
    const patch = d.calls.find((x) => x.method === 'PATCH');
    expect(patch.url).toMatch(/\/issues\/9$/);
    expect(JSON.parse(patch.body).state).toBe('closed');
  });
  it('retitles an existing low issue to unknown on failure', async () => {
    const d = deps({ balStatus: 500, issues: [{ number: 9, title: 'xAI credit low' }] });
    await c.run(ENV, d);
    const patch = d.calls.find((x) => x.method === 'PATCH');
    expect(JSON.parse(patch.body).title).toBe('xAI credit check: unknown, check manually');
  });
});
