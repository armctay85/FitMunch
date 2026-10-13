'use strict';
const jwt = require('jsonwebtoken');
const { sanitizeApiJson } = require('./lib/sanitize-api-json');

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
});
