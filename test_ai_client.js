/**
 * Unit tests for lib/ai-client.js provider routing + lib/ai-usage.js limit calc.
 * Intentionally avoids network; just verifies selection and shape.
 */

const mockOpenaiCreate = jest.fn(async () => ({
  choices: [{ message: { content: 'Drink water with the meal.' } }],
  usage: { prompt_tokens: 1, completion_tokens: 2 },
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation((opts) => ({
    chat: { completions: { create: (...args) => mockOpenaiCreate(opts, ...args) } },
  }));
});

function installHttps(handler) {
  const https = require('https');
  const hosts = [];
  const spy = jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
    hosts.push(opts.hostname);
    const handlers = {};
    const req = {
      on(event, fn) {
        handlers[event] = fn;
        return req;
      },
      write() {},
      end() {
        const outcome = handler(opts, hosts.length);
        if (outcome && outcome.timeout) {
          if (handlers.timeout) handlers.timeout();
          return;
        }
        const res = {
          statusCode: outcome.status,
          on(event, fn) {
            if (event === 'data') fn(Buffer.from(JSON.stringify(outcome.body || {})));
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
  return { spy, hosts };
}

describe('lib/ai-client provider routing', () => {
  const ORIG = { ...process.env };
  function clearProviderKeys() {
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  }

  afterEach(() => {
    process.env = { ...ORIG };
    mockOpenaiCreate.mockClear();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('reports no provider when no keys set', () => {
    clearProviderKeys();
    const ai = require('./lib/ai-client');
    expect(ai.hasProvider()).toBe(false);
    expect(ai.providerName()).toBe(null);
  });

  it('ignores Gemini and prefers xAI when both keys are set', () => {
    clearProviderKeys();
    process.env.GEMINI_API_KEY = 'gem-test';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    expect(ai.hasProvider()).toBe(true);
    expect(ai.providerName()).toBe('xai');
    expect(ai.availableProviders()).toEqual(['xai', 'openai', 'anthropic']);
    expect(ai.visionProviders()).toEqual(['xai', 'openai']);
  });

  it('prefers xAI over openai when XAI_API_KEY is set', () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    expect(ai.hasProvider()).toBe(true);
    expect(ai.providerName()).toBe('xai');
  });

  it('prefers openai when only OPENAI_API_KEY is set', () => {
    clearProviderKeys();
    process.env.OPENAI_API_KEY = 'sk-test-123';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    expect(ai.hasProvider()).toBe(true);
    expect(ai.providerName()).toBe('openai');
  });

  it('falls back to anthropic when only ANTHROPIC_API_KEY is set', () => {
    clearProviderKeys();
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    expect(ai.hasProvider()).toBe(true);
    expect(ai.providerName()).toBe('anthropic');
  });

  it('openai model defaults to gpt-4o-mini, respects override', () => {
    clearProviderKeys();
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.OPENAI_CHAT_MODEL;
    jest.resetModules();
    expect(require('./lib/ai-client').openaiModel()).toBe('gpt-4o-mini');
    process.env.OPENAI_CHAT_MODEL = 'gpt-5.4';
    jest.resetModules();
    expect(require('./lib/ai-client').openaiModel()).toBe('gpt-5.4');
  });

  it('tries the next provider on the fallthrough statuses only', () => {
    const ai = require('./lib/ai-client');
    expect(ai.tryNext({ error: 'missing_key' })).toBe(true);
    expect(ai.tryNext({ error: 'missing_key', status: 401 })).toBe(true);
    for (const status of [401, 403, 404, 408, 429, 500, 502, 503, 504, 599]) {
      expect(ai.tryNext({ status, error: 'provider_error' })).toBe(true);
    }
    expect(ai.tryNext({ error: 'provider_error' })).toBe(true);
    expect(ai.tryNext({ error: 'timeout' })).toBe(true);
    expect(ai.tryNext(null)).toBe(true);
    expect(ai.tryNext({ status: 400, error: 'provider_error' })).toBe(false);
    expect(ai.tryNext({ status: 400, error: 'content_refusal' })).toBe(false);
    expect(ai.tryNext({ error: 'content_refusal' })).toBe(false);
    expect(ai.tryNext({ refusal: true })).toBe(false);
    expect(ai.tryNext({ status: 402, error: 'provider_error' })).toBe(false);
    expect(ai.tryNext({ status: 422, error: 'provider_error' })).toBe(false);
    expect(ai.tryNext({ ok: true, status: 200, text: '[]' })).toBe(false);
    expect(ai.tryNext({ ok: true, text: 'hello' })).toBe(false);
  });

  it('httpsPost uses a 20s timeout and a timeout has no HTTP status', async () => {
    const https = require('https');
    const ai = require('./lib/ai-client');
    expect(ai.REQUEST_TIMEOUT_MS).toBe(20000);
    let captured;
    const req = {
      on(event, fn) {
        req.handlers[event] = fn;
        return req;
      },
      handlers: {},
      write() {},
      end() {},
      destroy() { req.destroyed = true; },
      setTimeout() {},
    };
    jest.spyOn(https, 'request').mockImplementation((opts) => {
      captured = opts;
      return req;
    });
    const pending = ai.httpsPost('api.x.ai', '/v1/chat/completions', { Authorization: 'Bearer xai-test' }, '{}');
    expect(captured.timeout).toBe(20000);
    req.handlers.timeout();
    await expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(req.destroyed).toBe(true);
    expect(ai.tryNext({ ok: false, error: 'provider_error' })).toBe(true);
  });

  it('httpsPost destroys the request from a 20s deadline even if the socket never times out', async () => {
    jest.useFakeTimers();
    try {
      const https = require('https');
      const ai = require('./lib/ai-client');
      const req = {
        on() { return req; },
        write() {},
        end() {},
        destroy(err) { req.destroyed = err; },
        setTimeout() {},
      };
      jest.spyOn(https, 'request').mockImplementation(() => req);
      const pending = ai.httpsPost('api.x.ai', '/v1/chat/completions', {}, '{}');
      await jest.advanceTimersByTimeAsync(19999);
      expect(req.destroyed).toBeUndefined();
      const assertion = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await jest.advanceTimersByTimeAsync(1);
      expect(req.destroyed.code).toBe('ETIMEDOUT');
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('vision reports unavailable when xAI and OpenAI keys are missing', async () => {
    clearProviderKeys();
    process.env.GEMINI_API_KEY = 'gem-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unavailable');
  });

  it('chat() returns { ok:false, error:no_provider } with no keys', async () => {
    clearProviderKeys();
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_provider');
  });

  it('keeps the HTTP status, logs status=, and falls through on 403 and 404', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const secretBody = 'credit balance is too low for this key';
    const { hosts } = installHttps(() => ({
      status: 403,
      body: { error: { message: secretBody, type: 'insufficient_quota' } },
    }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await ai.chat({
      messages: [{ role: 'user', content: 'hi' }],
      route: '/ai/chat',
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.status).toBe(200);
    expect(hosts).toEqual(['api.x.ai']);
    expect(mockOpenaiCreate).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('ai_provider=xai route=/ai/chat ok=false status=403');
    expect(logged).toContain('ai_provider=openai route=/ai/chat ok=true status=200');
    expect(logged).not.toContain('xai-test');
    expect(logged).not.toContain('sk-test-123');
    expect(logged).not.toContain('ant-test');
    expect(logged).toContain(`status=403 err="${secretBody}"`);
    expect(errorLog.mock.calls.join('\n')).not.toContain(secretBody);
  });

  it('falls through when an invalid model id returns 404', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.GROK_CHAT_MODEL = 'not-a-model';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    installHttps(() => ({ status: 404, body: { error: { message: 'model not found', code: 'model_not_found' } } }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(result.provider).toBe('openai');
    expect(result.ok).toBe(true);
    const logged = info.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('status=404');
    expect(logged).toMatch(/status=404 err="[^"]*model not found/);
    expect(logged).not.toContain('xai-test');
  });

  it('does not fall through on HTTP 400 or a content refusal', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const { hosts } = installHttps(() => ({
      status: 400,
      body: { error: { message: 'bad request body', type: 'invalid_request_error' } },
    }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const refused = await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(refused.ok).toBe(false);
    expect(refused.status).toBe(400);
    expect(refused.provider).toBe('xai');
    expect(hosts).toEqual(['api.x.ai']);
    expect(mockOpenaiCreate).not.toHaveBeenCalled();
    expect(info.mock.calls.join(' ')).toContain('status=400');
    expect(info.mock.calls.join(' ')).toContain('status=400 err="invalid_request_error"');
    expect(info.mock.calls.join(' ')).not.toContain('bad request body');

    jest.resetModules();
    const ai2 = require('./lib/ai-client');
    installHttps(() => ({
      status: 200,
      body: { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] },
    }));
    const blocked = await ai2.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('content_refusal');
    expect(blocked.status).toBe(200);
    expect(mockOpenaiCreate).not.toHaveBeenCalled();
  });

  it('falls through on a timeout with no status, then uses OpenAI', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const { spy } = installHttps(() => ({ timeout: true }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
    expect(spy.mock.calls[0][0].timeout).toBe(20000);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    const logged = info.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('ai_provider=xai route=/ai/chat ok=false status=-');
    expect(logged).not.toContain('xai-test');
  });

  it('vision returns unavailable when every provider fails, and keeps each status', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const secretBody = 'vision key rejected';
    const { hosts } = installHttps((opts) => ({
      status: opts.hostname === 'api.x.ai' ? 403 : 503,
      body: { error: { message: secretBody } },
    }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', mimeType: 'image/png', prompt: 'read', route: '/receipt/scan' });
    expect(result).toMatchObject({ ok: false, code: 'unavailable', error: 'provider_error' });
    expect(hosts).toEqual(['api.x.ai', 'api.openai.com']);
    const logged = info.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('ai_provider=xai route=/receipt/scan ok=false status=403');
    expect(logged).toContain('ai_provider=openai route=/receipt/scan ok=false status=503');
    expect(logged).toContain(`err="${secretBody}"`);
    expect(logged).not.toContain('xai-test');
    expect(logged).not.toContain('sk-test-123');
  });

  it('vision returns the provider text when it answered, including after an xAI 404', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.GROK_VISION_MODEL = 'not-a-vision-model';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    installHttps((opts) => {
      if (opts.hostname === 'api.x.ai') {
        return { status: 404, body: { error: { message: 'model missing' } } };
      }
      return {
        status: 200,
        body: { choices: [{ message: { content: '[{"name":"Tofu firm 450g","quantity":1,"unit":"each","price":4.5,"category":"other"}]' } }] },
      };
    });
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.status).toBe(200);
    expect(result.text).toContain('Tofu firm 450g');
  });

  it('maps a 400 or a content refusal on a photo to unreadable', async () => {
    clearProviderKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test-123';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const { hosts } = installHttps(() => ({
      status: 400,
      body: { error: { message: 'bad image', type: 'invalid_request_error' } },
    }));
    const bad = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(bad).toMatchObject({ ok: false, code: 'unreadable', status: 400, provider: 'xai' });
    expect(hosts).toEqual(['api.x.ai']);

    jest.resetModules();
    const ai2 = require('./lib/ai-client');
    installHttps(() => ({
      status: 200,
      body: { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] },
    }));
    const refused = await ai2.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(refused).toMatchObject({ ok: false, code: 'unreadable', error: 'content_refusal', status: 200 });
  });

  it('a hung OpenAI call falls through to Anthropic within 20s', async () => {
    clearProviderKeys();
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const OpenAI = require('openai');
    const previous = mockOpenaiCreate.getMockImplementation();
    mockOpenaiCreate.mockImplementation((opts) => new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error('Request timed out.');
        err.name = 'APIConnectionTimeoutError';
        reject(err);
      }, opts.timeout);
    }));
    installHttps(() => ({
      status: 200,
      body: { content: [{ text: 'Drink water with the meal.' }], usage: { input_tokens: 1, output_tokens: 2 } },
    }));
    const started = Date.now();
    try {
      OpenAI.mockClear();
      const pending = ai.chat({ messages: [{ role: 'user', content: 'hi' }], route: '/ai/chat' });
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'sk-test-123',
        timeout: 20000,
        maxRetries: 0,
      });
      const result = await pending;
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(true);
      expect(result.provider).toBe('anthropic');
      expect(result.text).toContain('Drink water');
      expect(elapsed).toBeGreaterThanOrEqual(19000);
      expect(elapsed).toBeLessThan(25000);
    } finally {
      mockOpenaiCreate.mockImplementation(previous);
    }
  }, 30000);
});

describe('lib/ai-usage limit calc', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    jest.resetModules();
  });

  it('default free limit is 10', () => {
    delete process.env.AI_FREE_MONTHLY_LIMIT;
    jest.resetModules();
    expect(require('./lib/ai-usage').freeMonthlyLimit()).toBe(10);
  });

  it('respects AI_FREE_MONTHLY_LIMIT env', () => {
    process.env.AI_FREE_MONTHLY_LIMIT = '42';
    jest.resetModules();
    expect(require('./lib/ai-usage').freeMonthlyLimit()).toBe(42);
  });

  it('ignores garbage value and uses default', () => {
    process.env.AI_FREE_MONTHLY_LIMIT = 'not-a-number';
    jest.resetModules();
    expect(require('./lib/ai-usage').freeMonthlyLimit()).toBe(10);
  });

  it('monthKey returns YYYY-MM', () => {
    const { monthKey } = require('./lib/ai-usage');
    expect(monthKey(new Date('2026-04-19T00:00:00Z'))).toBe('2026-04');
    expect(monthKey(new Date('2025-12-31T23:59:59Z'))).toBe('2025-12');
  });

  it('checkAndConsume allows paid tier unconditionally when no DB', async () => {
    delete process.env.DATABASE_URL;
    jest.resetModules();
    const usage = require('./lib/ai-usage');
    const r = await usage.checkAndConsume({ userId: 'u1', tier: 'pro', feature: 'chat' });
    expect(r.allowed).toBe(true);
  });
});
