'use strict';
const jwt = require('jsonwebtoken');
const { sanitizeApiJson, isOpaque, isJwt, isShareToken } = require('./lib/sanitize-api-json');

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
    // Elite QA r1 + r2 strings: every casing, joiner and padding is cleaned.
    'Gemini-2.5-Pro-Preview-Experimental-0827x',
    'Grok-4-Fast-Reasoning-Beta-Build-2026-10-14',
    'x-ai/Grok-4-Fast-Reasoning-2026-10-14-Preview',
    'PoweredByGrokAndGemini2026ForFitMunchUsers',
    'GrokBot2026Edition',
    'poweredbygrokandgemini2026fitmun',
    'GROKGEMINIOPENAI2026XXXXXXXXXXXXXX',
    'grok_4_fast_reasoning_preview_2026',
    'gemini_2_5_flash_lite_preview_09_2025',
    'Grok4Fast2026000000000000000000000',
    '1234567890Gemini1234567890123456789',
    'PoweredByGROKandGEMINIviaOPENAIforYOU2026x',
    'grok-4-fast.gemini-25-pro.openai-o3-mini',
    'Answered_by_Grok.via_xAI_API.Gemini_2_5_Pro',
    'odd casings XaI gRoK GeMiNi oPeNaI AnThRoPiC',
    'aB3xAiQ9zK2mN7pR4tV8wY1cE5gH6jL0',
  ])('provider names are scrubbed in any casing or joining: %s', (text) => {
    expect(isOpaque(text)).toBe(false);
    const out = sanitizeApiJson({ label: text, list: [text], nested: { deep: [{ value: text }] }, token: text, sharePath: text });
    expect(JSON.stringify(out)).not.toMatch(/gemini|openai|grok|anthropic|xai/i);
  });

  it('a JWT look-alike is only opaque when its header decodes to JSON with alg', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const real = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ userId: 'u-1' })}.GrokXaIsig_0123456789`;
    expect(isJwt(real)).toBe(true);
    expect(sanitizeApiJson({ t: real }).t).toBe(real);
    const noAlg = `${b64({ typ: 'JWT' })}.${b64({ userId: 'u-1' })}.GrokXaIsig_0123456789`;
    const badBody = `${b64({ alg: 'HS256' })}.GrokGrokGrokGrok.GrokXaIsig_0123456789`;
    const fakeHead = 'eyJhbGciOi.eyJ1c2VySW.Grok_xAI-sig';
    for (const fake of [noAlg, badBody, fakeHead]) {
      expect(isJwt(fake)).toBe(false);
      expect(sanitizeApiJson({ t: fake }).t).not.toMatch(/grok|xai/i);
    }
  });

  it('coach share links round-trip unaltered, at any depth, even when the token holds a provider word', () => {
    const tokens = ['abcXaIdefGROKghi-_012345', 'grokgrokgrokgrokgrokgrok', 'Q9xai_GeminiOpenAI-z1234'];
    for (const token of tokens) {
      const plan = { id: 'p1', status: 'sent', token, sharePath: `/c/${token}` };
      const out = sanitizeApiJson({ success: true, plan, plans: [plan] });
      expect(out.plan).toEqual(plan);
      expect(out.plans[0]).toEqual(plan);
      expect(isShareToken('token', token)).toBe(true);
      expect(isShareToken('sharePath', `/c/${token}`)).toBe(true);
    }
    // Wrong length, wrong key or wrong path prefix is not a share token.
    expect(isShareToken('token', 'abcXaIdefGROKghi-_01234')).toBe(false);
    expect(isShareToken('token', 'abcXaIdefGROKghi-_0123456')).toBe(false);
    expect(isShareToken('id', 'abcXaIdefGROKghi-_012345')).toBe(false);
    expect(isShareToken('sharePath', '/x/abcXaIdefGROKghi-_012345')).toBe(false);
    expect(isShareToken('sharePath', 'abcXaIdefGROKghi-_012345')).toBe(false);
    expect(sanitizeApiJson({ id: 'abcXaIdefGROKghi-_012345' }).id).not.toMatch(/grok|xai/i);
  });

  it('a key named token is cleaned like any other key unless it holds an exact share token', () => {
    const plan = { plan: { meals: [{ token: 'Answered by Grok via OpenAI' }] } };
    expect(sanitizeApiJson(plan)).toEqual({ plan: { meals: [{ token: 'Answered by via' }] } });
    const out = sanitizeApiJson({ token: 'grok said hi', items: [{ claimToken: 'Gemini wrote this', TOKEN: 'xai' }] });
    expect(out).toEqual({ token: 'said hi', items: [{ claimToken: 'wrote this' }] });
  });
});
