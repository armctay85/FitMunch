/** Welcome + verification email on signup, the #verify link, and resend. */
const queries = [];
let users = {};
let verifications = [];
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO email_verifications/.test(sql)) {
        verifications.push({ user_id: params[0], token_hash: params[1], email: params[2], expires_at: params[3], used_at: null });
        return Promise.resolve({ rows: [] });
      }
      if (/UPDATE email_verifications SET used_at = now\(\)/.test(sql)) {
        const v = verifications.find((x) => x.token_hash === params[0] && !x.used_at && x.expires_at > new Date());
        if (!v) return Promise.resolve({ rows: [] });
        v.used_at = new Date();
        return Promise.resolve({ rows: [{ user_id: v.user_id, email: v.email }] });
      }
      if (/UPDATE users SET email_verified = TRUE/.test(sql)) {
        const u = users[params[0]];
        if (u && u.email.toLowerCase() === params[1]) { u.emailVerified = true; return Promise.resolve({ rows: [{ id: u.id }] }); }
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT role, pt_id FROM users/.test(sql)) return Promise.resolve({ rows: [{ role: 'client' }] });
      return Promise.resolve({ rows: [] });
    }
  },
}));
jest.mock('./server/email.js', () => ({ sendEmail: jest.fn(async () => ({ success: true })) }));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserByEmail: jest.fn(async () => null),
    createUser: jest.fn(async (email, name) => { const u = { id: 'u-new', email, name, emailVerified: false }; users[u.id] = u; return u; }),
    getUserById: jest.fn(async (id) => users[id] || null),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('./server/email.js');
const ev = require('./lib/email-verify');
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const flush = () => new Promise((r) => setTimeout(r, 20));

const counters = require('./lib/shared-counters');
let counterSql = [];
let counterDown = false;
function fakeCounterQuery() {
  const hits = new Map();
  return async (sql, params) => {
    if (counterDown) throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    if (!/INSERT INTO rate_limit_counters/.test(sql)) return { rows: [] };
    counterSql.push(params);
    const k = params.slice(0, 3).join('|');
    hits.set(k, (hits.get(k) || 0) + 1);
    return { rows: [{ hits: hits.get(k) }] };
  };
}

beforeEach(() => {
  users = {}; verifications = []; queries.length = 0; sendEmail.mockClear();
  counterSql = []; counterDown = false;
  counters.resetSharedCountersForTests();
  counters.setSharedCounterQueryForTests(fakeCounterQuery());
});
afterAll(() => counters.resetSharedCountersForTests());

function linkToken(call) {
  const m = call.bodyText.match(/#verify=([^\s]+)/);
  return decodeURIComponent(m[1]);
}

describe('welcome + verify', () => {
  it('signup sends one welcome email with a confirm link, after the response', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Sam Lee', email: 'Sam@Example.com', password: 'Str0ng-pass-123!' });
    expect(r.status).toBe(201);
    await flush();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe('sam@example.com');
    expect(msg.subject).toBe('Welcome to FitMunch: confirm your email');
    expect(msg.bodyHtml).toContain('https://www.fitmunch.com.au/login.html#verify=');
    expect(msg.bodyHtml + msg.bodyText).not.toMatch(/Woolworths|Coles|Aldi|Pty Ltd|GST|A\$/);
  });

  it('the link confirms the email once it matches the account', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Sam', email: 'sam@example.com', password: 'Str0ng-pass-123!' });
    await flush();
    const t = linkToken(sendEmail.mock.calls[0][0]);
    const r = await request(app).post('/api/auth/verify-email').send({ token: t });
    expect(r.status).toBe(200);
    expect(users['u-new'].emailVerified).toBe(true);
  });

  it('the token is random and opaque, stored only as a SHA-256 hash, and holds no email', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Sam', email: 'sam@example.com', password: 'Str0ng-pass-123!' });
    await flush();
    const t = linkToken(sendEmail.mock.calls[0][0]);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.split('.').length).toBe(1);
    expect(verifications).toHaveLength(1);
    expect(verifications[0].token_hash).toBe(ev.hashVerifyToken(t));
    expect(verifications[0].token_hash).not.toContain(t);
    expect(JSON.stringify(queries.map((q) => q.params))).not.toContain(t);
    const ttl = verifications[0].expires_at.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600e3);
    expect(ttl).toBeLessThanOrEqual(24 * 3600e3);
  });

  it('a link works once: replay is 400', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Sam', email: 'sam@example.com', password: 'Str0ng-pass-123!' });
    await flush();
    const t = linkToken(sendEmail.mock.calls[0][0]);
    expect((await request(app).post('/api/auth/verify-email').send({ token: t })).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-email').send({ token: t })).status).toBe(400);
  });

  it('an expired link is 400 and does not verify', async () => {
    users['u-x'] = { id: 'u-x', email: 'x@example.com', emailVerified: false };
    const t = ev.newVerifyToken();
    verifications.push({ user_id: 'u-x', token_hash: ev.hashVerifyToken(t), email: 'x@example.com', expires_at: new Date(Date.now() - 1000), used_at: null });
    expect((await request(app).post('/api/auth/verify-email').send({ token: t })).status).toBe(400);
    expect(users['u-x'].emailVerified).toBe(false);
  });

  it('a link for an old email stops working after the email changes', async () => {
    users['u-1'] = { id: 'u-1', email: 'new@example.com', emailVerified: false };
    const t = ev.newVerifyToken();
    verifications.push({ user_id: 'u-1', token_hash: ev.hashVerifyToken(t), email: 'old@example.com', expires_at: new Date(Date.now() + 3600e3), used_at: null });
    expect((await request(app).post('/api/auth/verify-email').send({ token: t })).status).toBe(400);
    expect(users['u-1'].emailVerified).toBe(false);
  });

  it('rejects session tokens, unknown tokens and junk', async () => {
    users['u-1'] = { id: 'u-1', email: 'a@example.com', emailVerified: false };
    const session = jwt.sign({ userId: 'u-1', email: 'a@example.com' }, JWT_SECRET);
    for (const token of [session, ev.newVerifyToken(), '', 123, null, 'x'.repeat(5000)]) {
      const r = await request(app).post('/api/auth/verify-email').send({ token });
      expect(r.status).toBe(400);
    }
    expect(users['u-1'].emailVerified).toBe(false);
  });

  it('a token without userId is never a session (old verify-style JWT, purpose token)', async () => {
    const noUser = jwt.sign({ p: 'verify-email', uid: 'u-1', em: 'a@example.com' }, JWT_SECRET);
    const purpose = jwt.sign({ userId: 'u-1', p: 'verify-email' }, JWT_SECRET);
    const blank = jwt.sign({ userId: '' }, JWT_SECRET);
    for (const t of [noUser, purpose, blank]) {
      expect((await request(app).get('/api/meal-plans').set('Authorization', `Bearer ${t}`)).status).toBe(401);
      expect((await request(app).post('/api/auth/resend-verification').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    }
    const { verifySessionToken } = require('./lib/session-token');
    expect(() => verifySessionToken(noUser, JWT_SECRET)).toThrow();
    expect(verifySessionToken(jwt.sign({ userId: 'u-1' }, JWT_SECRET), JWT_SECRET).userId).toBe('u-1');
  });

  it('resend: auth required, own address only, 3 an hour per account via the shared limiter', async () => {
    expect((await request(app).post('/api/auth/resend-verification')).status).toBe(401);
    users['u-r'] = { id: 'u-r', email: 'r@example.com', name: 'R', emailVerified: false };
    const t = jwt.sign({ userId: 'u-r', email: 'someone-else@example.com' }, JWT_SECRET);
    const go = () => request(app).post('/api/auth/resend-verification').set('Authorization', `Bearer ${t}`).send({ email: 'victim@example.com' });
    expect((await go()).status).toBe(200);
    expect(sendEmail.mock.calls[0][0].to).toBe('r@example.com');
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    const r = await go();
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('3600');
    expect(sendEmail).toHaveBeenCalledTimes(3);
    const scopes = new Set(counterSql.map((p) => p[0]));
    for (const s of ['verify-resend-user-hour', 'verify-resend-to-hour', 'verify-email-to-day', 'verify-email-ip-hour']) expect(scopes.has(s)).toBe(true);
    expect(JSON.stringify(counterSql)).not.toContain('r@example.com');
  });

  it('spoofed X-Forwarded-For does not reset the per-IP limit', async () => {
    const tokens = [];
    for (let i = 0; i < 25; i += 1) {
      users[`u-${i}`] = { id: `u-${i}`, email: `p${i}@example.com`, name: 'P', emailVerified: false };
      tokens.push(jwt.sign({ userId: `u-${i}` }, JWT_SECRET));
    }
    const codes = [];
    for (let i = 0; i < 25; i += 1) {
      const r = await request(app).post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${tokens[i]}`).set('X-Forwarded-For', `203.0.113.${i}`);
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(20);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(20);
  });

  it('signups cannot flood one stranger: 5 a day per address, then no more emails', async () => {
    for (let i = 0; i < 7; i += 1) {
      await request(app).post('/api/auth/register').send({ name: 'V', email: 'Victim@Example.com', password: 'Str0ng-pass-123!' });
    }
    await flush();
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });

  it('fails closed: shared counter down means 503 on resend and no email on signup', async () => {
    counterDown = true;
    users['u-r'] = { id: 'u-r', email: 'r@example.com', name: 'R', emailVerified: false };
    const t = jwt.sign({ userId: 'u-r' }, JWT_SECRET);
    expect((await request(app).post('/api/auth/resend-verification').set('Authorization', `Bearer ${t}`)).status).toBe(503);
    const reg = await request(app).post('/api/auth/register').send({ name: 'S', email: 's@example.com', password: 'Str0ng-pass-123!' });
    expect(reg.status).toBe(201);
    await flush();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('email is signed by the team; plain text uses the raw name, HTML escapes it', () => {
    const m = ev.welcomeEmail({ name: '<b>Sam</b> Lee', url: 'https://www.fitmunch.com.au/login.html#verify=abc' });
    expect(m.bodyHtml).toContain('The FitMunch team');
    expect(m.bodyText.trim().endsWith('The FitMunch team')).toBe(true);
    expect(m.bodyHtml).toContain('Hi &lt;b&gt;Sam&lt;/b&gt;,');
    expect(m.bodyHtml).not.toContain('<b>Sam');
    expect(m.bodyText).toContain('Hi <b>Sam</b>,');
    const long = ev.welcomeEmail({ name: '&'.repeat(60), url: 'u' });
    expect(long.bodyText).toContain(`Hi ${'&'.repeat(40)},`);
    expect(long.bodyHtml).toContain(`Hi ${'&amp;'.repeat(40)},`);
    expect(m.bodyHtml + m.bodyText).not.toMatch(/\u2014|\u2013/);
  });

  it('login page handles #verify= and strips it from the URL', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/login.html'), 'utf8');
    expect(html).toContain("fetch('/api/auth/verify-email'");
    expect(html).toMatch(/\.get\('verify'\)/);
    expect(html).toMatch(/history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/);
  });
});
