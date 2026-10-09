/**
 * Unit tests for lib/ai-client.js provider routing + lib/ai-usage.js limit calc.
 * Intentionally avoids network; just verifies selection and shape.
 */

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

  it('tries the next provider only on a 401 or a missing key', () => {
    const ai = require('./lib/ai-client');
    expect(ai.tryNext({ status: 401, error: 'unauthorized' })).toBe(true);
    expect(ai.tryNext({ error: 'missing_key', status: 401 })).toBe(true);
    expect(ai.tryNext({ status: 500, error: 'provider_error' })).toBe(false);
    expect(ai.tryNext({ ok: true, status: 200, text: '[]' })).toBe(false);
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
