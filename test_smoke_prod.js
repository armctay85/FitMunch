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
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
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

  function smokeEnv(extra) {
    return {
      SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
      SMOKE_USER_PASSWORD: 'super-secret-pass',
      SMOKE_TOKEN: 'smoke-token-value',
      ...extra,
    };
  }

  async function readyTarget(routes) {
    const app = express();
    app.use(express.json());
    app.get('/api/health', routes.health || ((req, res) => res.json({ success: true })));
    app.get('/', routes.home || ((req, res) => res.type('html').send('FitMunch')));
    app.post('/api/auth/login', routes.login || ((req, res) => res.json({ success: true, token: 'tok' })));
    app.post('/api/internal/smoke/checkout', routes.checkout || ((req, res) => res.json({
      ok: true, mode: 'live', session: 'cs_live_abcd', url: 'https://checkout.stripe.com/pay/cs_live_abcd',
    })));
    app.post('/api/quick-checkout', routes.quick || ((req, res) => res.status(400).json({})));
    app.post('/api/coach/checkout', routes.coach || ((req, res) => res.status(400).json({})));
    server = await listen(app);
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function closeCurrent() {
    if (!server) return;
    await new Promise((resolve) => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(() => {
        server = null;
        resolve();
      });
    });
  }

  it('exits 2 for login 401 and 403', async () => {
    for (const status of [401, 403]) {
      const target = await readyTarget({
        login: (req, res) => res.status(status).json({ success: false, error: 'nope' }),
      });
      const ran = await runSmoke(['--target', target], smokeEnv());
      expect(ran.code).toBe(2);
      expect(ran.out).toContain(`login ${status}`);
      await closeCurrent();
    }
  });

  it('exits 2 for smoke-checkout 401, 403, 404, and 503 smoke_misconfigured', async () => {
    const cases = [
      [401, { ok: false, error: 'unauthorized' }],
      [403, { ok: false, error: 'forbidden' }],
      [404, { ok: false, error: 'Not found' }],
      [503, { ok: false, error: 'smoke_misconfigured', missing: ['stripe'] }],
    ];
    for (const [status, body] of cases) {
      const target = await readyTarget({
        checkout: (req, res) => res.status(status).json(body),
      });
      const ran = await runSmoke(['--target', target], smokeEnv());
      expect(ran.code).toBe(2);
      expect(ran.out).toContain(`smoke-checkout ${status}`);
      if (status === 503) expect(ran.out).toContain('smoke_misconfigured');
      expect(ran.out).not.toContain('relation');
      await closeCurrent();
    }
  });

  it('exits 1 for health failure, home failure, checkout 5xx, and timeout', async () => {
    const health = await readyTarget({
      health: (req, res) => res.status(500).json({ success: false }),
    });
    const healthRun = await runSmoke(['--target', health, '--checks', 'health'], smokeEnv({ SMOKE_BACKOFF_MS: '0' }));
    expect(healthRun.code).toBe(1);
    expect(healthRun.out).toContain('health 500');
    await closeCurrent();

    const home = await readyTarget({
      home: (req, res) => res.status(500).type('html').send('down'),
    });
    const homeRun = await runSmoke(['--target', home], smokeEnv());
    expect(homeRun.code).toBe(1);
    expect(homeRun.out).toContain('home 500');
    await closeCurrent();

    const checkout = await readyTarget({
      checkout: (req, res) => res.status(500).json({ ok: false, error: 'relation "users" does not exist' }),
    });
    const checkoutRun = await runSmoke(['--target', checkout], smokeEnv());
    expect(checkoutRun.code).toBe(1);
    expect(checkoutRun.out).toContain('smoke-checkout 500');
    expect(checkoutRun.out).not.toContain('relation');
    await closeCurrent();

    const hanging = express();
    hanging.get('/api/health', () => {});
    server = await listen(hanging);
    const timed = await runSmoke(
      ['--target', `http://127.0.0.1:${server.address().port}`, '--checks', 'health'],
      { SMOKE_REQUEST_TIMEOUT_MS: '150', SMOKE_BACKOFF_MS: '0' }
    );
    expect(timed.code).toBe(1);
    expect(timed.out).toContain('timeout');
  });

  it('checks health only and does not call login or checkout', async () => {
    let login = 0;
    let checkout = 0;
    const target = await readyTarget({
      login: (req, res) => { login += 1; res.status(500).json({}); },
      checkout: (req, res) => { checkout += 1; res.status(500).json({}); },
    });
    const ran = await runSmoke(['--target', target, '--checks', 'health'], {});
    expect(ran.code).toBe(0);
    expect(login).toBe(0);
    expect(checkout).toBe(0);
    expect(ran.out).not.toContain('login');
  });
});
