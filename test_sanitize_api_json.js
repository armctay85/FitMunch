'use strict';
const jwt = require('jsonwebtoken');
const { sanitizeApiJson, isOpaque } = require('./lib/sanitize-api-json');

describe('API JSON sanitizer leaves opaque tokens alone', () => {
  it('the CI flake: a register token whose signature held a provider word by chance now survives', () => {
    // Signed at 2026-10-13T23:26:42Z, the second the guest Coach webhook test failed in CI with a 401.
    const iat = Date.parse('2026-10-13T23:26:42Z') / 1000;
    const token = jwt.sign({ userId: 'u-1', name: 'Guest Coach', email: 'guest.coach@example.com', role: 'pt', iat }, 'fitmunch-dev-secret', { expiresIn: '30d' });
    expect(token).toMatch(/gemini|openai|grok|anthropic|xai/i);
    const out = sanitizeApiJson({ success: true, token, user: { id: 'u-1' } });
    expect(out.token).toBe(token);
    expect(() => jwt.verify(out.token, 'fitmunch-dev-secret', { algorithms: ['HS256'] })).not.toThrow();
  });

  it('no session token across 20,000 signings is altered', () => {
    let changed = 0;
    for (let i = 0; i < 20000; i += 1) {
      const t = jwt.sign({ userId: `u-${i}`, role: 'client', iat: 1760000000 + i }, 'k', { expiresIn: '30d' });
      if (sanitizeApiJson({ token: t }).token !== t || sanitizeApiJson({ list: [t] }).list[0] !== t) changed += 1;
    }
    expect(changed).toBe(0);
  });

  it('still removes provider and model names from prose and plain values', () => {
    const out = sanitizeApiJson({ message: 'Answered by Grok via xAI.', provider: 'openai', model: 'gpt-4o', note: 'gemini-2.5-flash', label: 'Gemini-2.5-Pro-Preview' });
    expect(JSON.stringify(out)).not.toMatch(/gemini|openai|grok|xai/i);
    expect(out.model).toBeUndefined();
  });

  it.each([
    'Gemini-2.5-Pro-Preview-Experimental-0827x',
    'Grok-4-Fast-Reasoning-Beta-Build-2026-10-14',
    'x-ai/Grok-4-Fast-Reasoning-2026-10-14-Preview',
    'PoweredByGrokAndGemini2026ForFitMunchUsers',
    'GrokBot2026Edition',
    'AnsweredByGrokViaOpenAIForFitMunchMembersWithoutAnyDigitsAtAll',
  ])('long or word-joined model text is not treated as a token: %s', (text) => {
    expect(isOpaque(text)).toBe(false);
    const out = sanitizeApiJson({ label: text, list: [text], nested: { deep: [{ value: text }] } });
    expect(JSON.stringify(out)).not.toMatch(/gemini|openai|grok|anthropic|xai/i);
  });

  it('only real token shapes are opaque', () => {
    expect(isOpaque('eyJhbGciOi.eyJ1c2VySW.Grok_xAI-sig')).toBe(true);
    expect(isOpaque('eyJhbGciOi.eyJ1c2VySW')).toBe(false);
    expect(isOpaque('aB3xAiQ9zK2mN7pR4tV8wY1cE5gH6jL0')).toBe(true); // 32-char random base64url run
    expect(isOpaque('aB3xAiQ9zK2mN7pR4tV8wY1cE5gH6jL')).toBe(false); // 31 chars
    expect(isOpaque('aB3xAiQ9zK2mN7pR-4tV8wY1cE5gH6jL0')).toBe(false); // delimiter breaks the run
    // Random runs that hold a provider word by chance stay intact, even with no digit at all
    // or with 41% of the run reading as Capitalised words.
    for (const id of ['hiGfvABAhAPxAiPHggKzTPQUoXvtYBiq', 's63BsvzekSpvV4gqFc9K0V9V4lAxai4T']) {
      expect(isOpaque(id)).toBe(true);
      expect(sanitizeApiJson({ id }).id).toBe(id);
    }
    // Dotted model text is not a JWT: short segments, or "/" inside a segment.
    for (const text of ['v2.Grok.4fast', 'x-ai/Grok-4.fast-preview.build-2026']) {
      expect(isOpaque(text)).toBe(false);
      expect(sanitizeApiJson({ text }).text).not.toMatch(/grok/i);
    }
    const out = sanitizeApiJson({ id: 'aB3xAiQ9zK2mN7pR4tV8wY1cE5gH6jL0' });
    expect(out.id).toBe('aB3xAiQ9zK2mN7pR4tV8wY1cE5gH6jL0');
  });

  it('a key named token is cleaned like any other key, at any depth', () => {
    const plan = { plan: { meals: [{ token: 'Answered by Grok via OpenAI' }] } };
    expect(sanitizeApiJson(plan)).toEqual({ plan: { meals: [{ token: 'Answered by via' }] } });
    const out = sanitizeApiJson({ token: 'grok said hi', items: [{ claimToken: 'Gemini wrote this', TOKEN: 'xai' }] });
    expect(out).toEqual({ token: 'said hi', items: [{ claimToken: 'wrote this' }] });
  });
});
