const { spawn } = require('child_process');
const express = require('express');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runSmoke(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/smoke-prod.mjs', ...args], {
      env: {
        ...process.env,
        SMOKE_BACKOFF_MS: '0,0,0',
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

function resultOf(out) {
  const line = out.split('\n').reverse().find((row) => row.startsWith('SMOKE_RESULT '));
  return line ? JSON.parse(line.slice('SMOKE_RESULT '.length)) : null;
}

describe('smoke-prod script', () => {
  let server;

  afterEach((done) => {
    if (!server) return done();
    server.close(() => {
      server = null;
      done();
    });
  });

  it('passes a healthy stub and hides secrets', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));
    app.get('/', (req, res) => res.type('html').send('<html><body>FitMunch</body></html>'));
    app.post('/api/auth/login', (req, res) => res.json({ success: true, token: 'jwt-secret-token-value' }));
    app.post('/api/internal/smoke/checkout', (req, res) => {
      res.json({
        ok: true,
        mode: 'live',
        session: 'cs_live_abcd',
        url: 'https://checkout.stripe.com/c/pay/cs_live_secret',
      });
    });
    app.post('/api/quick-checkout', (req, res) => res.status(400).json({ success: false }));
    app.post('/api/coach/checkout', (req, res) => res.status(400).json({ success: false }));
    server = await listen(app);
    const port = server.address().port;
    const ran = await runSmoke(['--target', `http://127.0.0.1:${port}`, '--mode', 'probe'], {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
    });
    expect(ran.code).toBe(0);
    expect(ran.out).not.toContain('super-secret-pass');
    expect(ran.out).not.toContain('jwt-secret-token-value');
    expect(ran.out).not.toContain('smoke-token-value');
    expect(ran.out).not.toContain('cs_live_secret');
    const result = resultOf(ran.out);
    expect(result.ok).toBe(true);
    expect(result.host).toBe(`127.0.0.1:${port}`);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('treats the Vercel authentication wall as configuration, not app health', async () => {
    const app = express();
    app.get('/api/health', (req, res) => {
      res.status(401).json({ error: { message: 'Protected by Vercel Authentication' } });
    });
    server = await listen(app);
    const ran = await runSmoke(['--target', `http://127.0.0.1:${server.address().port}`], {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
    });
    expect(ran.code).toBe(1);
    expect(ran.out).toContain('behind Vercel Authentication: set VERCEL_AUTOMATION_BYPASS_SECRET');
  });

  it('fails when login returns 500', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/health', (req, res) => res.json({ success: true }));
    app.get('/', (req, res) => res.type('html').send('FitMunch'));
    app.post('/api/auth/login', (req, res) => res.status(500).json({ success: false }));
    server = await listen(app);
    const ran = await runSmoke(['--target', `http://127.0.0.1:${server.address().port}`], {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
    });
    expect(ran.code).toBe(1);
    expect(ran.out).toContain('login 500');
    expect(ran.out).not.toContain('super-secret-pass');
  });

  it('fails a test-mode checkout session', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/health', (req, res) => res.json({ success: true }));
    app.get('/', (req, res) => res.type('html').send('FitMunch'));
    app.post('/api/auth/login', (req, res) => res.json({ success: true, token: 'tok' }));
    app.post('/api/internal/smoke/checkout', (req, res) => {
      res.json({ ok: true, mode: 'test', session: 'cs_test_abcd', url: 'https://checkout.stripe.com/c/pay/cs_test_x' });
    });
    server = await listen(app);
    const ran = await runSmoke(['--target', `http://127.0.0.1:${server.address().port}`], {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
    });
    expect(ran.code).toBe(1);
    expect(ran.out).toContain('smoke-checkout');
  });

  it('exits 2 when smoke configuration is missing and names the keys', async () => {
    const ran = await runSmoke(['--target', 'https://www.fitmunch.com.au'], {
      SMOKE_USER_EMAIL: '',
      SMOKE_USER_PASSWORD: '',
      SMOKE_TOKEN: '',
    });
    expect(ran.code).toBe(2);
    expect(ran.out).toContain('SMOKE_USER_EMAIL');
    expect(ran.out).toContain('SMOKE_USER_PASSWORD');
    expect(ran.out).toContain('SMOKE_TOKEN');
    expect(ran.out).not.toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
  });

  it('retries health before failing', async () => {
    let hits = 0;
    const app = express();
    app.get('/api/health', (req, res) => {
      hits += 1;
      if (hits < 3) return res.status(500).json({ success: false });
      return res.json({ success: true });
    });
    app.get('/', (req, res) => res.type('html').send('FitMunch'));
    app.use(express.json());
    app.post('/api/auth/login', (req, res) => res.json({ success: true, token: 'tok' }));
    app.post('/api/internal/smoke/checkout', (req, res) => res.json({
      ok: true, mode: 'live', session: 'cs_live_abcd', url: 'https://checkout.stripe.com/pay/cs_live_abcd',
    }));
    app.post('/api/quick-checkout', (req, res) => res.status(400).json({}));
    app.post('/api/coach/checkout', (req, res) => res.status(400).json({}));
    server = await listen(app);
    const ran = await runSmoke(['--target', `http://127.0.0.1:${server.address().port}`], {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
    });
    expect(ran.code).toBe(0);
    expect(hits).toBeGreaterThanOrEqual(3);
  });
});
