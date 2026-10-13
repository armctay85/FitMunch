/** Welcome + verification email on signup, the #verify link, and resend. */
const queries = [];
let users = {};
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      queries.push({ sql, params });
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
const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { users = {}; queries.length = 0; sendEmail.mockClear(); });

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

  it('rejects a session token, a forged token, another purpose and a changed email', async () => {
    users['u-1'] = { id: 'u-1', email: 'a@example.com', emailVerified: false };
    const session = jwt.sign({ userId: 'u-1', email: 'a@example.com' }, JWT_SECRET);
    const forged = ev.verifyToken(users['u-1'], 'wrong-secret');
    const otherPurpose = jwt.sign({ p: 'reset', uid: 'u-1', em: 'a@example.com' }, JWT_SECRET);
    const stale = ev.verifyToken({ id: 'u-1', email: 'old@example.com' }, JWT_SECRET);
    for (const token of [session, forged, otherPurpose, stale, '', 123]) {
      const r = await request(app).post('/api/auth/verify-email').send({ token });
      expect(r.status).toBe(400);
    }
    expect(users['u-1'].emailVerified).toBe(false);
  });

  it('resend: auth required, own address only, 3 an hour', async () => {
    expect((await request(app).post('/api/auth/resend-verification')).status).toBe(401);
    users['u-r'] = { id: 'u-r', email: 'r@example.com', name: 'R', emailVerified: false };
    const t = jwt.sign({ userId: 'u-r', email: 'someone-else@example.com' }, JWT_SECRET);
    const go = () => request(app).post('/api/auth/resend-verification').set('Authorization', `Bearer ${t}`).send({ email: 'victim@example.com' });
    expect((await go()).status).toBe(200);
    expect(sendEmail.mock.calls[0][0].to).toBe('r@example.com');
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(429);
  });

  it('login page handles #verify= and strips it from the URL', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/login.html'), 'utf8');
    expect(html).toContain("fetch('/api/auth/verify-email'");
    expect(html).toMatch(/\.get\('verify'\)/);
    expect(html).toMatch(/history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/);
  });
});
