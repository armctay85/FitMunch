const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function runSmoke(url, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'scripts/smoke-checkout.mjs')], {
      env: {
        ...process.env,
        FITMUNCH_SMOKE_URL: url,
        FITMUNCH_SMOKE_MODE: '',
        VERCEL_TOKEN: '',
        VERCEL_ACCESS_TOKEN: '',
        VERCEL_AUTOMATION_BYPASS_SECRET: '',
        STRIPE_SECRET_KEY: '',
        STRIPE_READONLY_KEY: '',
        ...extraEnv,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe('checkout smoke', () => {
  test('defaults to live mode and never creates a checkout session', async () => {
    const seen = [];
    const server = await listen(async (req, res) => {
      const body = await readJson(req);
      seen.push({ url: req.url, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/auth/login') {
        res.statusCode = 401;
        res.end(JSON.stringify({ success: false, error: 'Invalid email or password.' }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'Email and plan are required.' }));
    });
    try {
      const { port } = server.address();
      const result = await runSmoke(`http://127.0.0.1:${port}`, {});
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('smoke mode: live');
      expect(result.stdout).toContain('not proven to be a test key');
      expect(result.stdout).toContain('/api/auth/login 401');
      expect(result.stdout).toContain('skipped checkout POSTs');
      const checkouts = seen.filter((hit) => hit.url.includes('checkout'));
      expect(checkouts).toHaveLength(2);
      for (const hit of checkouts) {
        expect(hit.body.plan).toBeUndefined();
        expect(hit.body.email).toBeUndefined();
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);

  test('test mode posts coach-39 then premium and requires a test Checkout URL', async () => {
    const seen = [];
    const server = await listen(async (req, res) => {
      const body = await readJson(req);
      seen.push({ url: req.url, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/auth/login') {
        res.statusCode = 401;
        res.end(JSON.stringify({ success: false, error: 'Invalid email or password.' }));
        return;
      }
      const id = req.url === '/api/coach/checkout' ? 'cs_test_coach' : 'cs_test_quick';
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, url: `https://checkout.stripe.com/c/pay/${id}` }));
    });
    try {
      const { port } = server.address();
      const result = await runSmoke(`http://127.0.0.1:${port}`, { FITMUNCH_SMOKE_MODE: 'test' });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('smoke mode: test');
      expect(result.stdout).toContain('POST /api/coach/checkout 200');
      expect(result.stdout).toContain('POST /api/quick-checkout 200');
      const coach = seen.find((hit) => hit.url === '/api/coach/checkout');
      const quick = seen.find((hit) => hit.url === '/api/quick-checkout');
      expect(coach.body.plan).toBe('coach-39');
      expect(coach.body.email).toMatch(/^smoke\+\d+@fitmunch\.com\.au$/);
      expect(quick.body.plan).toBe('premium');
      expect(quick.body.email).toBe(coach.body.email);
      expect(seen.findIndex((hit) => hit.url === '/api/coach/checkout'))
        .toBeLessThan(seen.findIndex((hit) => hit.url === '/api/quick-checkout'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);

  test('a live session id fails the smoke and skips the next checkout', async () => {
    const seen = [];
    const server = await listen(async (req, res) => {
      await readJson(req);
      seen.push(req.url);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/auth/login') {
        res.statusCode = 401;
        res.end(JSON.stringify({ success: false, error: 'Invalid email or password.' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        url: 'https://checkout.stripe.com/c/pay/cs_live_should_not_happen',
      }));
    });
    try {
      const { port } = server.address();
      const result = await runSmoke(`http://127.0.0.1:${port}`, { FITMUNCH_SMOKE_MODE: 'test' });
      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/live Checkout Session/);
      expect(seen).not.toContain('/api/quick-checkout');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);

  test('Vercel Authentication 401 is not a passing login', async () => {
    const server = await listen(async (req, res) => {
      await readJson(req);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 401;
      res.end(JSON.stringify({
        message: 'Protected by Vercel Authentication',
        error: { code: '401', message: 'Protected deployment' },
        protection: { vercel_auth_enabled: true },
      }));
    });
    try {
      const { port } = server.address();
      const result = await runSmoke(`http://127.0.0.1:${port}`, {});
      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/Vercel Authentication/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);

  test('login 500 fails', async () => {
    const server = await listen(async (req, res) => {
      await readJson(req);
      res.setHeader('content-type', 'application/json');
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: 'effectiveTier is not a function' }));
    });
    try {
      const { port } = server.address();
      const result = await runSmoke(`http://127.0.0.1:${port}`, { FITMUNCH_SMOKE_MODE: 'live' });
      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/\/api\/auth\/login returned 500/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);
});
