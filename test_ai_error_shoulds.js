/**
 * PR 67 Elite QA Shoulds: S1 redaction (harness cases from
 * desk/elite-qa/fm-pr67-r1/harness.js, ported), S2 4xx type/code only,
 * S3 whitespace-only keys count as missing.
 */
const { EventEmitter } = require('events');
let next = null; let sent = 0;
jest.mock('https', () => ({
  request: (opts, onRes) => {
    sent += 1;
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const res = new EventEmitter(); res.statusCode = next.status; onRes(res);
      res.emit('data', JSON.stringify(next.body)); res.emit('end');
    });
    return req;
  },
}));

const ORIG = { ...process.env };
let logs;
beforeEach(() => { logs = []; sent = 0; jest.spyOn(console, 'info').mockImplementation((l) => logs.push(String(l))); });
afterEach(() => { process.env = { ...ORIG }; jest.resetModules(); jest.restoreAllMocks(); });
function load(env) {
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  jest.resetModules();
  return require('./lib/ai-client');
}
const errOf = (line) => JSON.parse(line.slice(line.indexOf(' err=') + 5));

// Harness inputs (Elite QA fm-pr67-r1).
const K = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdEF';
const A = 'sk-ant-api03-AbCdEfGhIjKlMnOp_QrStUvWx-yz0123456789';
const X = 'xai-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjQyLCJlbWFpbCI6ImFAYi5jbyJ9.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHR8a';

describe('S1 errorSnippet redaction (harness cases)', () => {
  const { errorSnippet: s } = require('./lib/ai-client');
  const cases = [
    ['start', K + ' bad', [K, 'AbCdEfGhIjKl']],
    ['mid', 'Incorrect API key provided: ' + K + '.', [K, 'AbCdEfGhIjKl']],
    ['ant', 'invalid x-api-key ' + A, [A, 'AbCdEfGhIjKl']],
    ['xai', 'key ' + X, [X, 'AbCdEfGhIjKl']],
    ['split', 'x'.repeat(190) + ' ' + K, ['AbCdEfGhIjKl']],
    ['prefixPunct', 'key="' + K + '"', ['AbCdEfGhIjKl']],
    ['xapiHdr', 'headers: {"x-api-key":"' + A.slice(7) + '"}', ['AbCdEfGhIjKl', 'api03-']],
    ['authHdr', 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==', ['dXNlcjpwYXNzd29yZDEyMw']],
    ['bearer', 'Authorization: Bearer abc.def.ghi', ['abc.def.ghi']],
    ['keyNoPrefix', 'api_key=AbCdEfGhIjKl_MnOp-QrStUvWx', ['AbCdEfGhIjKl']],
    ['email', 'User drew.smith@example.com not allowed', ['drew.smith@example.com', 'drew.smith']],
    ['b64', 'data:image/jpeg;base64,' + B64, ['4AAQSkZJRgABAQ']],
    ['jwt', 'token ' + JWT, ['eyJhbGciOiJIUzI1NiJ9', 'dBjftJeZ4CVP']],
    ['hex', 'request 0123456789abcdef0123456789abcdef failed', ['0123456789abcdef0123']],
  ];
  it.each(cases)('%s leaks no secret', (_n, input, secrets) => {
    const out = s(input);
    for (const sec of secrets) expect(out).not.toContain(sec);
    expect(out.length).toBeLessThanOrEqual(200);
  });
  it.each([
    ['crlf', 'bad\r\nai_provider=xai ok=true'],
    ['u2028', 'bad\u2028ai_provider=xai ok=true'],
    ['nel', 'bad\u0085ai_provider=xai ok=true'],
    ['ansi', 'bad\u001b[2J'],
  ])('%s: no control or line-separator characters survive', (_n, input) => {
    expect(s(input)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  });
  it('each redaction runs before the 200 char cut, so a key at the edge cannot leak a fragment', () => {
    const out = s('x'.repeat(185) + ' ' + K);
    expect(out).not.toMatch(/sk-proj|AbCdEf/);
  });
  it('keeps short, useful text readable', () => {
    expect(s('model: claude-3-5-haiku-20241022 not found')).toContain('claude-3-5-haiku-20241022');
  });
});

describe('S2 other 4xx log type and code only', () => {
  const PROMPT = "Invalid prompt: 'I am 54kg, pregnant, type 2 diabetic, my name is Jane Citizen'";
  it.each([400, 402, 409, 413, 422])('%i logs type and code, never the message', async (status) => {
    const ai = load({ ANTHROPIC_API_KEY: 'ant-test' });
    next = { status, body: { error: { type: 'invalid_request_error', code: 'bad_input', message: PROMPT } } };
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(errOf(logs[0])).toBe('invalid_request_error bad_input');
    expect(logs[0]).not.toMatch(/54kg|pregnant|Jane Citizen/);
  });
  it('falls back to client_error when type and code are empty', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'ant-test' });
    next = { status: 400, body: { error: { message: PROMPT } } };
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(errOf(logs[0])).toBe('client_error');
  });
  it.each([401, 403, 404, 408, 429])('%i still logs the redacted message', async (status) => {
    const ai = load({ ANTHROPIC_API_KEY: 'ant-test' });
    next = { status, body: { error: { type: 't', message: 'quota exceeded for this account' } } };
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(errOf(logs[0])).toBe('quota exceeded for this account');
  });
});

describe('S3 whitespace-only keys count as missing', () => {
  it('provider selection ignores blank keys', () => {
    const ai = load({ XAI_API_KEY: '   ', OPENAI_API_KEY: '\n', ANTHROPIC_API_KEY: 'ant-test' });
    expect(ai.providerName()).toBe('anthropic');
    expect(ai.hasProvider()).toBe(true);
    expect(ai.availableProviders()).toEqual(['anthropic']);
    expect(ai.visionProviders()).toEqual([]);
  });
  it('hasProvider is false when every key is blank', () => {
    const ai = load({ XAI_API_KEY: ' ', OPENAI_API_KEY: '\t', ANTHROPIC_API_KEY: '\r\n' });
    expect(ai.hasProvider()).toBe(false);
    expect(ai.providerName()).toBe(null);
  });
  it('grokChat and anthropicChat return missing_key 401 for a blank key and send nothing', async () => {
    const ai = load({});
    process.env.XAI_API_KEY = '  ';
    const x = await ai.chat({ messages: [{ role: 'user', content: 'hi' }], forceProvider: 'xai' });
    expect(x).toMatchObject({ ok: false, error: 'missing_key', status: 401, provider: 'xai' });
    process.env.ANTHROPIC_API_KEY = ' ';
    const a = await ai.chat({ messages: [{ role: 'user', content: 'hi' }], forceProvider: 'anthropic' });
    expect(a).toMatchObject({ ok: false, error: 'missing_key', status: 401, provider: 'anthropic' });
    expect(sent).toBe(0);
  });
});

describe('S2 exception: billing and quota 4xx log the message', () => {
  const run = async (status, body) => {
    const ai = load({ ANTHROPIC_API_KEY: 'ant-test' });
    next = { status, body };
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    return errOf(logs[0]);
  };
  it.each([
    'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    'You have no credits remaining. Add credits to continue using the API.',
    'You exceeded your current quota, please check your plan and billing details.',
    'Your team f24645b4-4437-42f5-83e8-92c9d493510a has either used all available credits or reached its monthly spending limit.',
  ])('logs provider billing message: %s', async (msg) => {
    // The S1 redactions replace the xAI team UUID; the rest of the text is kept.
    const want = msg.replace('f24645b4-4437-42f5-83e8-92c9d493510a', '[redacted]');
    expect(await run(400, { type: 'error', error: { type: 'invalid_request_error', message: msg } })).toBe(want);
  });
  it('xAI team message with only spending limit is logged', async () => {
    const msg = 'Your team abc has reached its monthly spending limit.';
    expect(await run(400, { error: { type: 'invalid_request_error', message: msg } })).toBe(msg);
  });
  it('leading whitespace before a provider phrase is allowed', async () => {
    const e = await run(400, { error: { type: 'invalid_request_error', message: '  You have no credits remaining.' } });
    expect(e).toContain('You have no credits remaining.');
  });
  it.each([
    ['echoed user text mentioning credit', 'Invalid input: my credit card is 4111 and my quota and billing are wrong'],
    ['phrase mid-string', 'Invalid prompt: Your credit balance is too low to access the Anthropic API.'],
    ['xAI team prefix without keyword', 'Your team abc sent a malformed request body.'],
    ['lowercase phrase (case-sensitive match)', 'your credit balance is too low to access the Anthropic API.'],
  ])('%s logs type and code only', async (_label, msg) => {
    expect(await run(400, { error: { type: 'invalid_request_error', code: 'bad_input', message: msg } })).toBe('invalid_request_error bad_input');
  });
  it('logs the message when type is billing_error', async () => {
    expect(await run(402, { type: 'error', error: { type: 'billing_error', message: 'Account suspended pending payment.' } }))
      .toBe('Account suspended pending payment.');
  });
  it('billing message with a key-like string is still redacted and capped', async () => {
    const key = 'sk-ant-api03-' + 'A'.repeat(40);
    const e = await run(400, { error: { type: 'invalid_request_error', message: `Your credit balance is too low for key ${key}. ` + 'x'.repeat(300) } });
    expect(e).toMatch(/credit balance is too low/);
    expect(e).not.toContain(key);
    expect(e).not.toMatch(/AAAAAAAAAAAAAAAAAAAA/);
    expect(e.length).toBeLessThanOrEqual(200);
  });
});
