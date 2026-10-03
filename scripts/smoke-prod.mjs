#!/usr/bin/env node
/**
 * Production smoke checks.
 * Exit 0 pass, 1 fail, 2 missing configuration (names only).
 * Never prints passwords, tokens, or a full Checkout URL.
 */

const REQUIRED = ['SMOKE_USER_EMAIL', 'SMOKE_USER_PASSWORD', 'SMOKE_TOKEN'];
const CHECKOUT_PREFIX = 'https://checkout.stripe.com';

function parseArgs(argv, env) {
  const out = {
    target: env.SMOKE_TARGET_URL || '',
    mode: env.SMOKE_MODE || 'probe',
    checks: env.SMOKE_CHECKS || 'full',
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--target') out.target = argv[++i] || '';
    else if (argv[i] === '--mode') out.mode = argv[++i] || out.mode;
    else if (argv[i] === '--checks') out.checks = argv[++i] || out.checks;
  }
  out.checks = String(out.checks || 'full').toLowerCase() === 'health' ? 'health' : 'full';
  return out;
}

function missingNames(env) {
  return REQUIRED.filter((name) => !String(env[name] || '').trim());
}

function backoffSchedule(env) {
  const raw = env.SMOKE_BACKOFF_MS || '5000,10000,20000';
  return raw.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
}

function redact(text) {
  return String(text == null ? '' : text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https:\/\/checkout\.stripe\.com\/\S+/g, `${CHECKOUT_PREFIX}/[redacted]`)
    .slice(0, 300);
}

function isVercelWall(status, text) {
  return status === 401 && /Protected by Vercel Authentication/i.test(text || '');
}

function hostOf(target) {
  return new URL(target).host;
}

function bypassHeaders(target, env) {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret || !hostOf(target).endsWith('.vercel.app')) return {};
  return {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  };
}

function requestTimeout() {
  const value = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

function safeErrorCode(value) {
  const text = String(value || '').trim();
  if (/^[a-z0-9_]+$/.test(text) && text.length <= 64) return text;
  return '';
}

function smokeCheckoutReason(status, errorText) {
  const code = safeErrorCode(errorText);
  if (status === 503 && code === 'smoke_misconfigured') return 'smoke-checkout 503 smoke_misconfigured';
  if (code) return `smoke-checkout ${status} ${code}`;
  return `smoke-checkout ${status}`;
}

function failureExit(name, result) {
  const reason = String((result && result.reason) || '');
  if (name === 'login' && /^login (401|403)$/.test(reason)) return 2;
  if (name === 'smoke-checkout' && /^smoke-checkout (401|403|404)(\s|$)/.test(reason)) return 2;
  if (name === 'smoke-checkout' && reason === 'smoke-checkout 503 smoke_misconfigured') return 2;
  return 1;
}

async function requestOnce(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const type = response.headers.get('content-type') || '';
    return { status: response.status, text, type };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

async function checkHealth(target, headers) {
  const response = await requestOnce(`${target}/api/health`, { method: 'GET', headers }, requestTimeout());
  if (isVercelWall(response.status, response.text)) {
    return { ok: false, reason: 'behind Vercel Authentication: set VERCEL_AUTOMATION_BYPASS_SECRET' };
  }
  const body = parseJson(response.text);
  if (response.status !== 200 || !body || body.success !== true) {
    return { ok: false, reason: `health ${response.status}` };
  }
  return { ok: true };
}

async function checkHome(target, headers) {
  const response = await requestOnce(target.endsWith('/') ? target : `${target}/`, { method: 'GET', headers }, requestTimeout());
  if (isVercelWall(response.status, response.text)) {
    return { ok: false, reason: 'behind Vercel Authentication: set VERCEL_AUTOMATION_BYPASS_SECRET' };
  }
  const html = (response.type || '').includes('text/html') && /FitMunch/.test(response.text || '');
  if (response.status !== 200 || !html) return { ok: false, reason: `home ${response.status}` };
  return { ok: true };
}

async function checkLogin(target, headers, env) {
  const response = await requestOnce(`${target}/api/auth/login`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SMOKE_USER_EMAIL, password: env.SMOKE_USER_PASSWORD }),
  }, requestTimeout());
  if (isVercelWall(response.status, response.text)) {
    return { ok: false, reason: 'behind Vercel Authentication: set VERCEL_AUTOMATION_BYPASS_SECRET' };
  }
  const body = parseJson(response.text);
  if (response.status !== 200 || !body || body.success !== true || !body.token) {
    return { ok: false, reason: `login ${response.status}` };
  }
  return { ok: true, token: body.token };
}

async function checkSmokeCheckout(target, headers, env, bearer) {
  const response = await requestOnce(`${target}/api/internal/smoke/checkout`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      'x-fitmunch-smoke-token': env.SMOKE_TOKEN,
    },
    body: '{}',
  }, requestTimeout());
  const body = parseJson(response.text) || {};
  const url = String(body.url || '');
  const session = String(body.session || '');
  if (response.status !== 200 || body.ok !== true || body.mode !== 'live') {
    return { ok: false, reason: smokeCheckoutReason(response.status, body.error) };
  }
  if (!url.startsWith(CHECKOUT_PREFIX)) return { ok: false, reason: 'smoke-checkout url was not Checkout' };
  if (!session.startsWith('cs_live_')) return { ok: false, reason: 'smoke-checkout session was not live' };
  return { ok: true, urlPrefix: CHECKOUT_PREFIX, sessionPrefix: 'cs_live_' };
}

async function checkNegative(target, headers, path) {
  const response = await requestOnce(`${target}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  }, requestTimeout());
  if (response.status >= 500) return { ok: false, reason: `${path} returned ${response.status}` };
  if (response.status < 400) return { ok: false, reason: `${path} returned ${response.status}` };
  if (/https:\/\/checkout\.stripe\.com/i.test(response.text || '')) {
    return { ok: false, reason: `${path} returned a checkout url` };
  }
  return { ok: true };
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withColdStart(name, fn, backoffs) {
  let last = null;
  const attempts = 1 + backoffs.length;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const started = Date.now();
    try {
      last = await fn();
    } catch (err) {
      last = { ok: false, reason: err && err.name === 'AbortError' ? `${name} timeout` : `${name} failed` };
    }
    last.ms = Date.now() - started;
    if (last.ok) return last;
    if (attempt < backoffs.length) await sleep(backoffs[attempt]);
  }
  return last;
}

async function main() {
  const env = process.env;
  const args = parseArgs(process.argv, env);
  const missing = args.checks === 'health' ? [] : missingNames(env);
  if (!args.target) missing.push('SMOKE_TARGET_URL');
  if (missing.length) {
    console.log(`SMOKE not configured. Missing: ${missing.join(', ')}`);
    console.log('SMOKE_RESULT ' + JSON.stringify({ ok: false, configured: false, missing }));
    process.exit(2);
  }

  let target;
  try {
    target = new URL(args.target).origin;
  } catch (_) {
    console.log('SMOKE invalid target');
    console.log('SMOKE_RESULT ' + JSON.stringify({ ok: false, reason: 'invalid target' }));
    process.exit(1);
  }

  const headers = bypassHeaders(target, env);
  const backoffs = backoffSchedule(env);
  const checks = [];
  const host = hostOf(target);
  console.log(`SMOKE mode=${args.mode} host=${host}`);

  async function record(name, result) {
    const line = `${name} ${result.ok ? 'PASS' : 'FAIL'} ${result.ms || 0}ms`;
    console.log(result.ok ? line : `${line} ${result.reason || ''}`);
    checks.push({ name, ok: Boolean(result.ok), ms: result.ms || 0, reason: result.ok ? undefined : result.reason });
    return result.ok;
  }

  const health = await withColdStart('health', () => checkHealth(target, headers), backoffs);
  await record('health', health);
  if (!health.ok) return finish(failureExit('health', health), args, host, checks);
  if (args.checks === 'health') return finish(0, args, host, checks);

  const home = await withColdStart('home', () => checkHome(target, headers), backoffs);
  await record('home', home);
  if (!home.ok) return finish(failureExit('home', home), args, host, checks);

  const loginStarted = Date.now();
  let login;
  try { login = await checkLogin(target, headers, env); }
  catch (err) { login = { ok: false, reason: err && err.name === 'AbortError' ? 'login timeout' : 'login failed' }; }
  login.ms = Date.now() - loginStarted;
  await record('login', login);
  if (!login.ok) return finish(failureExit('login', login), args, host, checks);

  const checkoutStarted = Date.now();
  let checkout;
  try { checkout = await checkSmokeCheckout(target, headers, env, login.token); }
  catch (err) { checkout = { ok: false, reason: err && err.name === 'AbortError' ? 'smoke-checkout timeout' : 'smoke-checkout failed' }; }
  checkout.ms = Date.now() - checkoutStarted;
  await record('smoke-checkout', checkout);
  if (!checkout.ok) return finish(failureExit('smoke-checkout', checkout), args, host, checks);

  for (const path of ['/api/quick-checkout', '/api/coach/checkout']) {
    const started = Date.now();
    let negative;
    try { negative = await checkNegative(target, headers, path); }
    catch (err) { negative = { ok: false, reason: 'negative check failed' }; }
    negative.ms = Date.now() - started;
    const name = path === '/api/quick-checkout' ? 'quick-checkout' : 'coach-checkout';
    await record(name, negative);
    if (!negative.ok) return finish(failureExit(name, negative), args, host, checks);
  }

  return finish(0, args, host, checks);
}

function finish(code, args, host, checks) {
  const result = {
    ok: code === 0,
    mode: args.mode,
    host,
    checks,
  };
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  process.exit(code);
}

main().catch((err) => {
  console.log('SMOKE failed');
  console.log('SMOKE_RESULT ' + JSON.stringify({ ok: false, reason: 'runner failed' }));
  process.exit(1);
});
