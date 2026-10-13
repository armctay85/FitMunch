'use strict';
/**
 * Session JWTs: only JWT_SECRET signs or verifies them, HS256 only. There is
 * no built-in fallback secret. Tokens signed with the old hard-coded fallbacks
 * are refused everywhere, and a deployed environment with no JWT_SECRET
 * refuses every token (fail closed) and reports 503 on /api/health.
 */
const jwt = require('jsonwebtoken');
const request = require('supertest');
const fs = require('fs');

// The two old hard-coded fallbacks, base64 so the plain values are not repeated in the repo.
const OLD_FALLBACKS = ['Zml0bXVuY2gtZGV2LXNlY3JldA==', 'Zml0bXVuY2gtc2VjcmV0LWtleS1jaGFuZ2UtaW4tcHJvZHVjdGlvbg=='].map((b) => Buffer.from(b, 'base64').toString('utf8'));

const app = require('./server.js');
const lib = require('./lib/jwt-secret');

const payload = { userId: 'u-forge', name: 'X', role: 'pt' };
const ROUTES = [
  ['GET', '/api/meal-plans'],
  ['GET', '/api/auth/me'],
  ['POST', '/api/meal-plan/generate'],
  ['POST', '/api/receipt/scan'],
  ['GET', '/api/coach/gate'],
];
const send = (method, path, token) => request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${token}`).send({});

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

describe('no hard-coded JWT fallback', () => {
  it('no server file falls back to a literal JWT secret', () => {
    for (const f of ['api_server.js', 'meal-planner.js', 'receipt-scanner.js', 'server.js', 'coach-api.js', 'lib/fitmunch-checkout.js', 'lib/jwt-secret.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect([f, /JWT_SECRET\s*(\|\||\?\?)\s*['"`]/.test(src)]).toEqual([f, false]);
      for (const old of OLD_FALLBACKS) expect([f, src.includes(old)]).toEqual([f, false]);
    }
  });

  it.each(ROUTES)('%s %s: a forged token signed with an old fallback is 401', async (method, path) => {
    for (const old of OLD_FALLBACKS) {
      const forged = jwt.sign(payload, old);
      const r = await send(method, path, forged);
      expect(r.status).toBe(401);
    }
  });

  it('tokens must be HS256: HS512 with the real secret and alg none are refused', async () => {
    const hs512 = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS512' });
    const none = jwt.sign(payload, '', { algorithm: 'none' });
    for (const t of [hs512, none]) {
      expect(() => lib.verifyJwt(t)).toThrow();
      expect((await send('GET', '/api/meal-plans', t)).status).toBe(401);
    }
    const good = lib.signJwt(payload, { expiresIn: '1h' });
    expect(jwt.decode(good, { complete: true }).header.alg).toBe('HS256');
    expect(lib.verifyJwt(good).userId).toBe('u-forge');
  });
});

describe('JWT_SECRET unset', () => {
  it('deployed (production or preview): every token is refused, nothing is signed, health is 503', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'production' }, async () => {
      expect(lib.jwtSecret()).toBe('');
      expect(lib.jwtSecretProblem()).toBe('missing');
      expect(() => lib.signJwt(payload)).toThrow(/not configured/);
      const tokens = [...OLD_FALLBACKS, 'any-secret', 'jest-only-session-secret'].map((s) => jwt.sign(payload, s));
      for (const t of tokens) {
        expect(() => lib.verifyJwt(t)).toThrow();
        for (const [method, path] of ROUTES) expect((await send(method, path, t)).status).toBe(401);
      }
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(503);
      expect(health.text).not.toMatch(/JWT|secret/i);
    }));

  it('a preview deploy is treated the same', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'test', VERCEL_ENV: 'preview' }, () => {
      expect(lib.jwtSecret()).toBe('');
      expect(() => lib.verifyJwt(jwt.sign(payload, OLD_FALLBACKS[0]))).toThrow();
    }));

  it('local runs get a random per-process secret, so old fallback tokens still fail', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'development', VERCEL_ENV: undefined }, async () => {
      const s = lib.jwtSecret();
      expect(s.length).toBeGreaterThanOrEqual(40);
      expect(OLD_FALLBACKS).not.toContain(s);
      for (const old of OLD_FALLBACKS) {
        expect(() => lib.verifyJwt(jwt.sign(payload, old))).toThrow();
        expect((await send('GET', '/api/meal-plans', jwt.sign(payload, old))).status).toBe(401);
      }
    }));

  it('a blank or whitespace JWT_SECRET counts as unset', () =>
    withEnv({ JWT_SECRET: '   ', NODE_ENV: 'production' }, () => {
      expect(lib.jwtSecret()).toBe('');
    }));
});
