/**
 * Every limiter keys on req.ip. Run directly (no trust proxy), a rotating
 * X-Forwarded-For must not buy a new bucket. Behind one trusted proxy
 * (trust proxy 1, as on Vercel/Railway), the right-most hop counts.
 */
const request = require('supertest');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const app = require('./server.js');
const guestClaim = require('./lib/guest-claim');

const original = app.get('trust proxy');
afterAll(() => app.set('trust proxy', original));
beforeEach(() => guestClaim.resetGuestClaimsForTests());

function spoofed(i) {
  return `198.18.${Math.floor(i / 250)}.${i % 250}`;
}

describe('trust proxy is set only behind a known proxy', () => {
  test('behindTrustedProxy follows VERCEL, RAILWAY_ENVIRONMENT and TRUST_PROXY', () => {
    const { behindTrustedProxy } = app._private;
    expect(behindTrustedProxy({})).toBe(false);
    expect(behindTrustedProxy({ VERCEL: '1' })).toBe(true);
    expect(behindTrustedProxy({ RAILWAY_ENVIRONMENT: 'production' })).toBe(true);
    expect(behindTrustedProxy({ TRUST_PROXY: '1' })).toBe(true);
    expect(behindTrustedProxy({ VERCEL: '1', TRUST_PROXY: '0' })).toBe(false);
    expect(behindTrustedProxy({ VERCEL: '1', TRUST_PROXY: 'false' })).toBe(false);
  });

  test('no server code parses X-Forwarded-For by hand', () => {
    const fs = require('fs');
    for (const file of ['server.js', 'receipt-scanner.js', 'lib/fitmunch-checkout.js', 'api_server.js']) {
      const code = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect([file, /x-forwarded-for|x-real-ip/i.test(code)]).toEqual([file, false]);
    }
  });
});

describe('without trust proxy, rotating X-Forwarded-For still hits 429', () => {
  beforeAll(() => app.set('trust proxy', false));

  test('/api/auth/login (20 per 15 min)', async () => {
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await request(app).post('/api/auth/login').set('X-Forwarded-For', spoofed(i)).send({})).status);
    }
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  test('/api/stripe/claim-resend (5 per 15 min)', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', spoofed(100 + i)).send({ email: `r${i}@example.com` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  test('/api/receipt/first-scan', async () => {
    const max = 200; // NODE_ENV=test limit; 6 in production
    let last;
    for (let i = 0; i <= max; i += 1) {
      last = (await request(app).post('/api/receipt/first-scan').set('X-Forwarded-For', spoofed(i)).send({})).status;
      if (i < max) expect(last).not.toBe(429);
    }
    expect(last).toBe(429);
  });
});

describe('behind one trusted proxy, the right-most hop counts', () => {
  beforeAll(() => app.set('trust proxy', 1));

  test('the key is the right-most hop, not the client-supplied left-most', async () => {
    const { rateLimitKey } = app._private;
    const seen = [];
    const probe = require('express')();
    probe.set('trust proxy', 1);
    probe.get('/k', (req, res) => { seen.push(rateLimitKey(req)); res.end(); });
    await request(probe).get('/k').set('X-Forwarded-For', '203.0.113.7, 198.51.100.9');
    await request(probe).get('/k').set('X-Forwarded-For', '192.0.2.44, 198.51.100.9');
    expect(seen).toEqual(['198.51.100.9', '198.51.100.9']);
  });

  test('/api/auth/login: rotating the left-most hop stays in one bucket; another real hop is a new bucket', async () => {
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await request(app).post('/api/auth/login').set('X-Forwarded-For', `${spoofed(i)}, 198.51.100.21`).send({})).status);
    }
    expect(statuses[20]).toBe(429);
    const other = await request(app).post('/api/auth/login').set('X-Forwarded-For', `${spoofed(0)}, 198.51.100.22`).send({});
    expect(other.status).not.toBe(429);
  });

  test('/api/stripe/claim-resend: rotating the left-most hop stays in one bucket; another real hop is a new bucket', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', `${spoofed(i)}, 198.51.100.31`).send({ email: `t${i}@example.com` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const other = await request(app).post('/api/stripe/claim-resend').set('X-Forwarded-For', `${spoofed(0)}, 198.51.100.32`).send({ email: 'u@example.com' });
    expect(other.status).toBe(200);
  });
});
