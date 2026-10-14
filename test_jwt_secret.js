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

// The fixed secret jest.setup.js used to set. It is public in git history, so
// it is denied everywhere; jest now generates a random secret per run.
const OLD_JEST_SECRET = 'jest-only-session-secret-0123456789abcdef';

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
      const tokens = [...OLD_FALLBACKS, 'any-secret', OLD_JEST_SECRET].map((s) => jwt.sign(payload, s));
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

describe('Elite QA r1 (#105)', () => {
  const STRONG = 'x'.repeat(16) + 'strong-test-secret-0123456789';
  const OLD_LONG = OLD_FALLBACKS[1]; // over 32 characters, still refused (deny-list)

  it.each([
    ['a', 'one character'], ['secret', 'a common default'], ['changeme', 'a common default'],
    ['x'.repeat(31), '31 characters'], [OLD_LONG, 'the old hard-coded fallback (deny-list)'],
  ])('M1: JWT_SECRET of %#: %s is refused; health 503; a token forged with it is 401', (value) =>
    withEnv({ JWT_SECRET: value, NODE_ENV: 'production' }, async () => {
      expect(lib.jwtSecret()).toBe('');
      expect(lib.jwtSecretProblem()).toBe('too_short');
      expect(() => lib.signJwt(payload)).toThrow(/not configured/);
      const forged = jwt.sign(payload, value);
      for (const [method, path] of ROUTES) expect((await send(method, path, forged)).status).toBe(401);
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(503);
      if (value.length > 3) expect(health.text).not.toContain(value);
    }));

  it('M1: a short secret is refused locally too', () =>
    withEnv({ JWT_SECRET: 'short-local', NODE_ENV: 'development', VERCEL_ENV: undefined }, () => {
      expect(lib.jwtSecret()).toBe('');
    }));

  it('M1: a 32+ character secret not on the deny-list works', () =>
    withEnv({ JWT_SECRET: STRONG, NODE_ENV: 'production' }, async () => {
      expect(lib.jwtSecretProblem()).toBe('');
      const t = lib.signJwt(payload);
      expect(lib.verifyJwt(t).userId).toBe('u-forge');
    }));

  it('M2: tokens with no userId or with a purpose field are not sessions', async () => {
    const { verifySessionToken } = require('./lib/session-token');
    const s = process.env.JWT_SECRET;
    const bad = [
      jwt.sign({ name: 'X', role: 'pt' }, s),
      jwt.sign({ userId: '', role: 'pt' }, s),
      jwt.sign({ userId: null }, s),
      jwt.sign({ userId: 'u-1', p: 'verify-email' }, s),
      jwt.sign({ email: 'a@b.co', purpose: 'verify-email' }, s),
    ];
    for (const t of bad) {
      expect(() => verifySessionToken(t)).toThrow();
      for (const [method, path] of ROUTES) expect((await send(method, path, t)).status).toBe(401);
    }
    expect(() => lib.verifyJwt(bad[0])).toThrow(/no user/);
  });

  it('M2/M4: every call site uses verifySessionToken with no secret argument', () => {
    for (const f of ['api_server.js', 'meal-planner.js', 'receipt-scanner.js', 'server.js', 'coach-api.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect([f, /verifySessionToken\([^)]*,/.test(src)]).toEqual([f, false]);
      expect([f, /jwt\.verify\(|require\('jsonwebtoken'\)/.test(src)]).toEqual([f, false]);
    }
    expect(fs.readFileSync('lib/session-token.js', 'utf8')).toMatch(/verifyJwt\(token\)/);
  });

  it('M3: /api/coach/billing-status gives a valid trainer 200 and refuses a no-userId token', async () => {
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockImplementation(async (sql) => {
      if (/FROM users/i.test(sql)) return { rows: [{ settings: {} }] };
      if (/FROM pt_clients/i.test(sql)) return { rows: [{ n: 2 }] };
      return { rows: [] };
    });
    try {
      const ok = await request(app).get('/api/coach/billing-status').set('Authorization', `Bearer ${lib.signJwt({ userId: 'pt-1', role: 'pt' })}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ success: true, activeClientCount: 2 });
      const noUser = jwt.sign({ role: 'pt' }, process.env.JWT_SECRET);
      expect((await request(app).get('/api/coach/billing-status').set('Authorization', `Bearer ${noUser}`)).status).toBe(401);
      const client = lib.signJwt({ userId: 'c-1', role: 'client' });
      expect((await request(app).get('/api/coach/billing-status').set('Authorization', `Bearer ${client}`)).status).toBe(403);
    } finally {
      spy.mockRestore();
    }
  });

  it('S1: deployed with no secret, verifyJwt throws JWT_SECRET_MISSING', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'production' }, () => {
      const t = jwt.sign(payload, 'anything-at-all-that-is-long-enough-123');
      let err;
      try { lib.verifyJwt(t); } catch (e) { err = e; }
      expect(err && err.code).toBe('JWT_SECRET_MISSING');
    }));

  it('S2: login and register give 503, not 500, when the secret is missing', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'production' }, async () => {
      for (const p of ['/api/auth/login', '/api/auth/register']) {
        const r = await request(app).post(p).send({ email: 'a@example.com', password: 'Password123!', name: 'A' });
        expect(r.status).toBe(503);
        expect(r.body.error).toBe('Sign-in is unavailable right now.');
      }
    }));

  it.each([
    [{ NODE_ENV: undefined, VERCEL_ENV: undefined }, true],
    [{ NODE_ENV: 'staging', VERCEL_ENV: undefined }, true],
    [{ NODE_ENV: 'development', VERCEL_ENV: undefined, RAILWAY_ENVIRONMENT: 'production' }, true],
    [{ NODE_ENV: 'development', VERCEL_ENV: undefined, RENDER: 'true' }, true],
    [{ NODE_ENV: 'development', VERCEL_ENV: undefined }, false],
    [{ NODE_ENV: 'test', VERCEL_ENV: undefined }, false],
  ])('L1: %j counts as deployed: %s', (env, deployed) => {
    expect(lib.isDeployedEnv({ ...env })).toBe(deployed);
  });

  it('L1: with no NODE_ENV and no secret, auth fails closed (no random secret)', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: undefined, VERCEL_ENV: undefined }, () => {
      expect(lib.jwtSecret()).toBe('');
      expect(lib.jwtSecretProblem()).toBe('missing');
    }));
});

describe('test secrets never work in prod (Elite QA #105 r2 M1)', () => {
  it('the old fixed jest secret is denied when deployed: nothing signs, forged tokens get 401', () =>
    withEnv({ JWT_SECRET: OLD_JEST_SECRET, NODE_ENV: 'production' }, async () => {
      expect(lib.jwtSecret()).toBe('');
      expect(lib.jwtSecretProblem()).toBe('too_short');
      expect(() => lib.signJwt(payload)).toThrow(/not configured/);
      const forged = jwt.sign(payload, OLD_JEST_SECRET);
      expect(() => lib.verifyJwt(forged)).toThrow();
      for (const [method, path] of ROUTES) expect((await send(method, path, forged)).status).toBe(401);
    }));

  it('the old fixed jest secret is denied locally too', () =>
    withEnv({ JWT_SECRET: OLD_JEST_SECRET, NODE_ENV: 'test' }, async () => {
      expect(lib.jwtSecret()).toBe('');
    }));

  it('jest runs with a random per-run secret, not a fixed one', () => {
    expect(process.env.JEST_JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env.JEST_JWT_SECRET).not.toBe(OLD_JEST_SECRET);
    const src = require('fs').readFileSync(require('path').join(__dirname, 'jest.setup.js'), 'utf8');
    expect(src).toMatch(/randomBytes\(32\)/);
    expect(src).not.toMatch(/JWT_SECRET\s*=\s*process\.env\.JWT_SECRET\s*\|\|\s*'/);
  });
});

describe('purpose tokens are not sessions (Elite QA #105 r2 S1)', () => {
  it('a token with {userId, purpose} gets 401 on signed-in routes', async () => {
    const t = jwt.sign({ userId: 'u-forge', purpose: 'x' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    for (const [method, path] of ROUTES) expect((await send(method, path, t)).status).toBe(401);
    const plain = jwt.sign({ userId: 'u-forge' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    expect(lib.verifyJwt(plain).userId).toBe('u-forge');
  });
});
