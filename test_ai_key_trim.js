/** Provider keys are trimmed before they go into request headers. */
const { EventEmitter } = require('events');
const seen = [];
jest.mock('https', () => ({
  request: (opts, onRes) => {
    for (const v of Object.values(opts.headers || {})) {
      if (/[\r\n]/.test(String(v))) { const e = new TypeError('Invalid character in header content'); e.code = 'ERR_INVALID_CHAR'; throw e; }
    }
    seen.push(opts.headers);
    const req = new EventEmitter();
    req.write = () => {}; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const res = new EventEmitter(); res.statusCode = 200; onRes(res);
      res.emit('data', JSON.stringify({ choices: [{ message: { content: 'ok' } }], content: [{ text: 'ok' }] })); res.emit('end');
    });
    return req;
  },
}));
const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; jest.resetModules(); jest.restoreAllMocks(); seen.length = 0; });
beforeEach(() => jest.spyOn(console, 'info').mockImplementation(() => {}));
function load(env) {
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  jest.resetModules();
  return require('./lib/ai-client');
}
it('xAI chat works with a key that ends in a newline', async () => {
  const ai = load({ XAI_API_KEY: 'xai-test\n' });
  const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
  expect(r.ok).toBe(true);
  expect(seen[0].Authorization).toBe('Bearer xai-test');
});
it('xAI vision works with a key that ends in a newline', async () => {
  const ai = load({ XAI_API_KEY: ' xai-test\r\n' });
  const r = await ai.vision({ imageBase64: 'AAAA', prompt: 'p' });
  expect(r.ok).toBe(true);
  expect(seen[0].Authorization).toBe('Bearer xai-test');
});
it('Anthropic chat works with a key that ends in a newline', async () => {
  const ai = load({ ANTHROPIC_API_KEY: 'ant-test\n' });
  const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
  expect(r.ok).toBe(true);
  expect(seen[0]['x-api-key']).toBe('ant-test');
});
