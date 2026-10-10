/**
 * Token spend logging, daily per-provider totals, and the smoke account cap.
 * https is mocked; ai_usage_monthly is an in-memory fake.
 */
const { EventEmitter } = require('events');
let next = []; 
jest.mock('https', () => ({
  request: (opts, onRes) => {
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const step = next.shift();
      const res = new EventEmitter(); res.statusCode = step.status; onRes(res);
      res.emit('data', JSON.stringify(step.body)); res.emit('end');
    });
    return req;
  },
}));

function fakeStore() {
  const rows = new Map();
  const q = async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/INSERT INTO ai_usage_monthly/.test(sql)) {
      const [user, period, feature] = params;
      const amount = params.length > 3 ? Number(params[3]) : 1;
      const k = `${user}|${period}|${feature}`;
      const v = (rows.get(k) || 0) + amount; rows.set(k, v);
      return { rows: [{ count: v }] };
    }
    if (/SUM\(count\)/.test(sql)) {
      const [user, period] = params; let t = 0;
      for (const [k, v] of rows) { const [u, p] = k.split('|'); if (u === user && p === period) t += v; }
      return { rows: [{ total: t }] };
    }
    if (/SELECT COALESCE\(count/.test(sql)) {
      const [user, period, feature] = params;
      return { rows: [{ total: rows.get(`${user}|${period}|${feature}`) || 0 }] };
    }
    return { rows: [] };
  };
  return { rows, q };
}

const ORIG = { ...process.env };
let logs; let store;
function load(env = {}) {
  jest.resetModules();
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SMOKE_ACCOUNT_EMAILS', 'SMOKE_DAILY_AI_CAP', 'AI_FREE_MONTHLY_LIMIT']) delete process.env[k];
  Object.assign(process.env, env);
  store = fakeStore();
  const usage = require('./lib/ai-usage');
  usage._setQueryForTests(store.q);
  return { ai: require('./lib/ai-client'), usage };
}
beforeEach(() => { logs = []; next = []; jest.spyOn(console, 'info').mockImplementation((l) => logs.push(String(l))); });
afterEach(() => { process.env = { ...ORIG }; jest.restoreAllMocks(); });

const MSG = [{ role: 'user', content: 'PROMPT-MARKER hi' }];

describe('token parsing per provider', () => {
  it('xAI uses usage.prompt_tokens and completion_tokens', async () => {
    const { ai } = load({ XAI_API_KEY: 'x' });
    next = [{ status: 200, body: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } } }];
    await ai.chat({ messages: MSG, route: '/ai/chat' });
    expect(logs[0]).toBe('ai_provider=xai route=/ai/chat ok=true status=200 tokens_in=120 tokens_out=30 tokens_day=150');
  });
  it('OpenAI vision uses usage.prompt_tokens and completion_tokens', async () => {
    const { ai } = load({ OPENAI_API_KEY: 'o' });
    next = [{ status: 200, body: { choices: [{ message: { content: '[]' } }], usage: { prompt_tokens: 900, completion_tokens: 40 } } }];
    await ai.vision({ imageBase64: 'AAAA', prompt: 'p', route: '/receipt/scan' });
    expect(logs[0]).toBe('ai_provider=openai route=/receipt/scan ok=true status=200 tokens_in=900 tokens_out=40 tokens_day=940');
  });
  it('Anthropic uses usage.input_tokens and output_tokens', async () => {
    const { ai } = load({ ANTHROPIC_API_KEY: 'a' });
    next = [{ status: 200, body: { content: [{ text: 'ok' }], usage: { input_tokens: 50, output_tokens: 7 } } }];
    await ai.chat({ messages: MSG, route: '/ai/chat' });
    expect(logs[0]).toBe('ai_provider=anthropic route=/ai/chat ok=true status=200 tokens_in=50 tokens_out=7 tokens_day=57');
  });
  it('usageFrom reads each shape and leaves others undefined', () => {
    const { ai } = load();
    expect(ai.usageFrom('anthropic', { usage: { input_tokens: 1, output_tokens: 2 } })).toEqual({ promptTokens: 1, completionTokens: 2 });
    expect(ai.usageFrom('xai', { usage: { prompt_tokens: 3, completion_tokens: 4 } })).toEqual({ promptTokens: 3, completionTokens: 4 });
    expect(ai.usageFrom('openai', {})).toEqual({ promptTokens: undefined, completionTokens: undefined });
  });
});

describe('failures', () => {
  it("logs '-' for tokens, no tokens_day, and records nothing", async () => {
    const { ai } = load({ XAI_API_KEY: 'x' });
    next = [{ status: 500, body: { error: { message: 'boom' } } }];
    await ai.chat({ messages: MSG, route: '/ai/chat' });
    expect(logs[0]).toMatch(/^ai_provider=xai route=\/ai\/chat ok=false status=500 tokens_in=- tokens_out=- err="boom"$/);
    expect(logs[0]).not.toContain('tokens_day');
    expect(store.rows.size).toBe(0);
  });
  it('never logs content', async () => {
    const { ai } = load({ XAI_API_KEY: 'x' });
    next = [{ status: 200, body: { choices: [{ message: { content: 'REPLY-MARKER' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }];
    await ai.chat({ system: 'SYSTEM-MARKER', messages: MSG, route: '/ai/chat' });
    expect(logs.join('\n')).not.toMatch(/PROMPT-MARKER|SYSTEM-MARKER|REPLY-MARKER/);
  });
});

describe('daily totals', () => {
  it('increment per provider and per Sydney day', async () => {
    const { usage } = load();
    const d = new Date('2026-10-10T08:00:00Z'); // 19:00 AEDT, 10 Oct
    expect(await usage.recordTokens('xai', 100, 20, d)).toBe(120);
    expect(await usage.recordTokens('xai', 10, 5, d)).toBe(135);
    expect(await usage.recordTokens('openai', 7, 3, d)).toBe(10);
    expect(store.rows.get('__tokens__|day:2026-10-10|in:xai')).toBe(110);
    expect(store.rows.get('__tokens__|day:2026-10-10|out:xai')).toBe(25);
    const after = new Date('2026-10-10T13:30:00Z'); // 00:30 AEDT, 11 Oct
    expect(await usage.recordTokens('xai', 1, 1, after)).toBe(2);
    expect(usage.sydneyDay(after)).toBe('2026-10-11');
  });
  it('daily rows do not count toward the monthly cap', async () => {
    const { usage } = load();
    await usage.recordTokens('xai', 100, 100);
    expect(await usage.getUsed('__tokens__')).toBe(0);
  });
});

describe('smoke account cap', () => {
  it('a smoke account skips the monthly cap and is held to the daily cap', async () => {
    const { usage } = load({ SMOKE_ACCOUNT_EMAILS: ' Smoke+1@FitMunch.com.au , other-id ', SMOKE_DAILY_AI_CAP: '3', AI_FREE_MONTHLY_LIMIT: '1' });
    const ctx = { userId: 'u-smoke', email: 'smoke+1@fitmunch.com.au', tier: 'free', feature: 'chat' };
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await usage.checkAndConsume(ctx));
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3]).toMatchObject({ allowed: false, limit: 3, used: 3, smoke: true });
    expect(await usage.getUsed('u-smoke')).toBe(0);
  });
  it('matches by user id too, and defaults to 10 a day', async () => {
    const { usage } = load({ SMOKE_ACCOUNT_EMAILS: 'u-123' });
    expect(usage.smokeDailyCap()).toBe(10);
    let last;
    for (let i = 0; i < 11; i += 1) last = await usage.checkAndConsume({ userId: 'u-123', tier: 'free', feature: 'receipt_scan' });
    expect(last).toMatchObject({ allowed: false, limit: 10 });
  });
  it('customers still hit the normal monthly cap', async () => {
    const { usage } = load({ SMOKE_ACCOUNT_EMAILS: 'smoke@fitmunch.com.au', AI_FREE_MONTHLY_LIMIT: '2' });
    const ctx = { userId: 'cust-1', email: 'jane@example.com', tier: 'free', feature: 'chat' };
    const a = await usage.checkAndConsume(ctx);
    const b = await usage.checkAndConsume(ctx);
    const c = await usage.checkAndConsume(ctx);
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    expect(c).toMatchObject({ limit: 2, used: 2, upgrade: true });
    expect(c.smoke).toBeUndefined();
  });
  it('with no allowlist nobody is a smoke account', () => {
    const { usage } = load();
    expect(usage.isSmokeAccount({ userId: 'u', email: 'smoke@fitmunch.com.au' })).toBe(false);
  });
});
