/**
 * ai_provider= failure lines carry a short, redacted err= snippet and never
 * the prompt. https.request is mocked; no network.
 */
const { EventEmitter } = require('events');
let next = null;
jest.mock('https', () => ({
  request: (opts, onRes) => {
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const step = next;
      if (step.throwErr) return req.emit('error', step.throwErr);
      const res = new EventEmitter(); res.statusCode = step.status; onRes(res);
      res.emit('data', JSON.stringify(step.body)); res.emit('end');
    });
    return req;
  },
}));

const ORIG = { ...process.env };
let logs;
function load() {
  jest.resetModules();
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = 'ant-test';
  return require('./lib/ai-client');
}
beforeEach(() => { logs = []; jest.spyOn(console, 'info').mockImplementation((l) => logs.push(String(l))); });
afterEach(() => { process.env = { ...ORIG }; jest.restoreAllMocks(); });

const PROMPT = 'PROMPT-MARKER my weight is 82kg and my email is drew@example.com';
const errOf = (line) => JSON.parse(line.slice(line.indexOf(' err=') + 5));

describe('errorSnippet', () => {
  const { errorSnippet } = require('./lib/ai-client');
  it('truncates to 200 chars and strips newlines', () => {
    const s = errorSnippet('line one\nline two\r\n' + 'word '.repeat(100));
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).not.toMatch(/[\r\n]/);
    expect(s.startsWith('line one line two')).toBe(true);
  });
  it.each([
    ['sk-', 'bad key sk-proj-abcDEF123456', 'sk-proj-abcDEF123456'],
    ['sk-ant-', 'bad key sk-ant-api03-abcDEF123', 'sk-ant-api03-abcDEF123'],
    ['xai-', 'bad key xai-AbC123dEf456', 'xai-AbC123dEf456'],
    ['Bearer', 'header Bearer abc.def.ghi rejected', 'abc.def.ghi'],
    ['base64 run', 'img QUJDREVGR0hJSktMTU5PUFFSU1RVVldY== bad', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY'],
    ['hex run', 'request 0123456789abcdef0123456789abcdef failed', '0123456789abcdef0123456789abcdef'],
  ])('redacts %s', (_label, input, secret) => {
    const s = errorSnippet(input);
    expect(s).not.toContain(secret);
    expect(s).toMatch(/\[redacted/);
  });
  it('keeps a normal model id readable', () => {
    expect(errorSnippet('model: claude-3-5-haiku-20241022 not found')).toContain('claude-3-5-haiku-20241022');
  });
});

describe('ai_provider= failure line', () => {
  it('adds err= from the provider body message, never the prompt', async () => {
    const ai = load();
    next = { status: 429, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low. key sk-ant-api03-SECRET123' } } };
    await ai.chat({ system: 'SYSTEM-MARKER', messages: [{ role: 'user', content: PROMPT }], route: '/ai/chat' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^ai_provider=anthropic route=\/ai\/chat ok=false status=429 err="/);
    expect(errOf(logs[0])).toBe('Your credit balance is too low. key [redacted-key]');
    expect(logs[0]).not.toMatch(/PROMPT-MARKER|SYSTEM-MARKER|82kg|drew@example\.com|SECRET123/);
  });
  it('uses the exception code and message when there is no status', async () => {
    const ai = load();
    const e = new Error('getaddrinfo ENOTFOUND api.anthropic.com'); e.code = 'ENOTFOUND';
    next = { throwErr: e };
    await ai.chat({ messages: [{ role: 'user', content: PROMPT }], route: '/ai/chat' });
    expect(logs[0]).toBe('ai_provider=anthropic route=/ai/chat ok=false status=- err="ENOTFOUND getaddrinfo ENOTFOUND api.anthropic.com"');
  });
  it('leaves the success line unchanged', async () => {
    const ai = load();
    next = { status: 200, body: { content: [{ text: 'hi' }] } };
    await ai.chat({ messages: [{ role: 'user', content: PROMPT }], route: '/ai/chat' });
    expect(logs[0]).toBe('ai_provider=anthropic route=/ai/chat ok=true status=200');
  });
});
