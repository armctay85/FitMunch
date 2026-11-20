'use strict';

/**
 * (a) grok-4.3 chat sends reasoning_effort none, and the HTTP timer follows the caller.
 * No network.
 */

function installHttps(onRequest) {
  const https = require('https');
  const spy = jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
    onRequest(opts);
    const handlers = {};
    const req = {
      on(event, fn) { handlers[event] = fn; return req; },
      write() {},
      end() {
        const res = {
          statusCode: 200,
          on(event, fn) {
            if (event === 'data') fn(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } })));
            if (event === 'end') fn();
          },
        };
        cb(res);
      },
      destroy() {},
      setTimeout() {},
    };
    return req;
  });
  return spy;
}

describe('grok chat reasoning and caller timeout', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('grok-4.3 body has reasoning_effort none and another id omits it', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const bodies = [];
    installHttps((opts) => {
      opts.__capture = true;
    });
    const https = require('https');
    https.request.mockImplementation((opts, cb) => {
      const handlers = {};
      const req = {
        on() { return req; },
        write(body) { bodies.push(String(body)); },
        end() {
          const res = {
            statusCode: 200,
            on(event, fn) {
              if (event === 'data') fn(Buffer.from(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })));
              if (event === 'end') fn();
            },
          };
          cb(res);
        },
        destroy() {},
      };
      req.timeoutSeen = opts.timeout;
      bodies.timeouts = bodies.timeouts || [];
      bodies.timeouts.push(opts.timeout);
      return req;
    });
    const ai = require('./lib/ai-client');
    process.env.GROK_CHAT_MODEL = 'grok-4.3';
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }], forceProvider: 'xai', route: '/t', budgetMs: 62000 });
    const first = JSON.parse(bodies[0]);
    expect(first.reasoning_effort).toBe('none');
    expect(bodies.timeouts[0]).toBe(62000);

    bodies.length = 0;
    process.env.GROK_CHAT_MODEL = 'grok-3';
    jest.resetModules();
    // The https spy is on the original module. Re-require after reset still sees the spy
    // because https is a singleton. Set the model before the next chat.
    const ai2 = require('./lib/ai-client');
    await ai2.chat({ messages: [{ role: 'user', content: 'hi' }], forceProvider: 'xai', route: '/t' });
    const second = JSON.parse(bodies[0]);
    expect(second.reasoning_effort).toBeUndefined();
  });
});
