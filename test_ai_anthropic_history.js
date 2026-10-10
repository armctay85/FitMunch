/** Anthropic coach history normalisation. https is mocked; no network. */
const { EventEmitter } = require('events');
const bodies = []; const hosts = [];
jest.mock('https', () => ({
  request: (opts, onRes) => {
    hosts.push(opts.hostname);
    const req = new EventEmitter(); let buf = '';
    req.write = (b) => { buf += b; }; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      bodies.push(JSON.parse(buf));
      const res = new EventEmitter(); res.statusCode = 200; onRes(res);
      const reply = opts.hostname === 'api.anthropic.com'
        ? { content: [{ text: 'ok' }] }
        : { choices: [{ message: { content: 'ok' } }] };
      res.emit('data', JSON.stringify(reply)); res.emit('end');
    });
    return req;
  },
}));
const ORIG = { ...process.env };
function load(env) {
  jest.resetModules();
  for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  return require('./lib/ai-client');
}
beforeEach(() => { bodies.length = 0; hosts.length = 0; jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { process.env = { ...ORIG }; jest.restoreAllMocks(); });

const HISTORY = [
  { role: 'assistant', content: 'Hi, I am your coach.' },
  { role: 'assistant', content: 'Ask me anything.' },
  { role: 'user', content: 'What should I eat?' },
  { role: 'user', content: '' },
  { role: 'user', content: 'Something high protein.' },
  { role: 'assistant', content: 'Try eggs.' },
  { role: 'assistant', content: '   ' },
  { role: 'assistant', content: 'Or Greek yoghurt.' },
  { role: 'user', content: 'Thanks' },
];

describe('normaliseAnthropicMessages', () => {
  const { normaliseAnthropicMessages: n } = load({});
  it('drops leading assistant and empty messages and merges same-role runs', () => {
    expect(n(HISTORY)).toEqual([
      { role: 'user', content: 'What should I eat?\n\nSomething high protein.' },
      { role: 'assistant', content: 'Try eggs.\n\nOr Greek yoghurt.' },
      { role: 'user', content: 'Thanks' },
    ]);
  });
  it('drops system messages and returns [] with no user text', () => {
    expect(n([{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }, { role: 'user', content: ' ' }])).toEqual([]);
  });
});

describe('Anthropic request', () => {
  it('sends the normalised history: first message user, roles alternate', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'a' });
    const r = await ai.chat({ system: 'sys', messages: HISTORY });
    expect(r.ok).toBe(true);
    const msgs = bodies[0].messages;
    expect(msgs[0].role).toBe('user');
    for (let i = 1; i < msgs.length; i += 1) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    expect(bodies[0].system).toBe('sys');
  });
  it('returns a clear error and does not call Anthropic when no user text remains', async () => {
    const ai = load({ ANTHROPIC_API_KEY: 'a' });
    const r = await ai.chat({ messages: [{ role: 'assistant', content: 'Hello from the coach' }] });
    expect(r).toMatchObject({ ok: false, error: 'no_user_message', provider: 'anthropic' });
    expect(hosts).toEqual([]);
  });
  it('xAI still gets the history unchanged', async () => {
    const ai = load({ XAI_API_KEY: 'x' });
    await ai.chat({ messages: [{ role: 'assistant', content: 'A1' }, { role: 'assistant', content: 'A2' }, { role: 'user', content: 'U' }] });
    expect(hosts).toEqual(['api.x.ai']);
    expect(bodies[0].messages.map((m) => m.role)).toEqual(['assistant', 'assistant', 'user']);
  });
});
