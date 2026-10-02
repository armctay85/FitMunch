#!/usr/bin/env node
/**
 * Checkout smoke against a FitMunch deployment.
 *
 *   FITMUNCH_SMOKE_URL=https://<preview>.vercel.app node scripts/smoke-checkout.mjs
 *
 * On GitHub Actions (pull_request or deployment_status) the URL can be omitted.
 * The script waits for a successful Vercel Preview deployment of this SHA.
 *
 * Modes (printed on the first line: "smoke mode: test" or "smoke mode: live"):
 *   test  POST /api/coach/checkout {plan:'coach-39', email} then
 *         POST /api/quick-checkout {plan:'premium', email}. Each must be 200
 *         with a url on checkout.stripe.com whose session id starts with cs_test_.
 *   live  Do not create a Checkout Session. Login must be 200 or 401.
 *         An empty JSON body to each checkout route must not be 5xx.
 *
 * A deployment is test mode only when that is proven before any checkout POST:
 *   1. FITMUNCH_SMOKE_MODE=test, or
 *   2. Vercel returns STRIPE_SECRET_KEY for this project and the prefix is
 *      sk_test_ or rk_test_ (VERCEL_TOKEN, value never printed).
 * Anything else, including a missing key, is live. Live checkout is not called.
 *
 * Preview deployments behind Vercel Authentication need
 * VERCEL_AUTOMATION_BYPASS_SECRET (sent as x-vercel-protection-bypass).
 */

import fs from 'fs';

const CHECKOUT_HOST = 'checkout.stripe.com';
const PREVIEW_POLL_MS = 15_000;
const PREVIEW_POLL_ATTEMPTS = 40;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function classifyKey(value) {
  const key = String(value || '');
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  return '';
}

function isPreviewEnvironment(name) {
  return /^preview\b/i.test(String(name || '').trim());
}

function previewOrigin(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch (_) {
    fail(`Deployment URL is not a URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    fail(`Refusing deployment URL scheme ${url.protocol}`);
  }
  const host = url.hostname;
  const local = host === '127.0.0.1' || host === 'localhost';
  if (!local && !host.endsWith('.vercel.app') && host !== 'fitmunch.com.au' && host !== 'www.fitmunch.com.au') {
    fail(`Refusing to smoke ${host}`);
  }
  return url.origin;
}

function requestHeaders() {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'fitmunch-smoke-checkout/1.0',
  };
  const bypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  return headers;
}

async function readBody(res) {
  const text = await res.text();
  const type = String(res.headers.get('content-type') || '');
  let json = null;
  if (type.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  return { text, json, type };
}

function snippet(text) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, 240);
}

function isDeploymentProtection(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.protection && body.protection.vercel_auth_enabled) return true;
  const message = String(body.message || (body.error && body.error.message) || '');
  return /Protected by Vercel Authentication/i.test(message)
    || /Protected deployment/i.test(message);
}

async function callJson(origin, pathname, body) {
  const res = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    headers: requestHeaders(),
    body: JSON.stringify(body),
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') || '';
    fail(
      `${pathname} was redirected (${res.status} ${location}). ` +
      'Vercel Authentication is blocking this preview. Set the GitHub secret ' +
      'VERCEL_AUTOMATION_BYPASS_SECRET to the project Protection Bypass for Automation secret. ' +
      'No further checkout call was made.'
    );
  }
  const parsed = await readBody(res);
  if (!parsed.type.includes('application/json') || !parsed.json || typeof parsed.json !== 'object') {
    fail(`${pathname} did not return JSON (${res.status} ${parsed.type}): ${snippet(parsed.text)}`);
  }
  if (isDeploymentProtection(parsed.json)) {
    fail(
      `${pathname} is behind Vercel Authentication (HTTP ${res.status}). ` +
      'Set the GitHub secret VERCEL_AUTOMATION_BYPASS_SECRET to this project\'s Protection Bypass for Automation secret. ' +
      'No checkout session was created.'
    );
  }
  if (typeof parsed.json.success !== 'boolean') {
    fail(`${pathname} JSON is not a FitMunch response (${res.status}): ${snippet(JSON.stringify(parsed.json))}`);
  }
  return { status: res.status, body: parsed.json };
}

function sessionIdFromUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== CHECKOUT_HOST) return '';
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.find((part) => part.startsWith('cs_')) || '';
}

function assertCheckoutUrl(label, status, body) {
  if (status !== 200) {
    fail(`${label} returned ${status}: ${snippet(JSON.stringify(body))}`);
  }
  const raw = body && body.url;
  if (typeof raw !== 'string' || !raw) {
    fail(`${label} returned 200 without a url: ${snippet(JSON.stringify(body))}`);
  }
  let id = '';
  try {
    id = sessionIdFromUrl(raw);
  } catch (_) {
    fail(`${label} url is not on https://${CHECKOUT_HOST}`);
  }
  if (!id) fail(`${label} url is not a ${CHECKOUT_HOST} Checkout Session`);
  if (id.startsWith('cs_live_')) {
    fail(
      `${label} created a live Checkout Session (${id.slice(0, 12)}…). ` +
      'Stopping before any further checkout call. Expire that session in Stripe.'
    );
  }
  if (!id.startsWith('cs_test_')) {
    fail(`${label} session id does not start with cs_test_ (${id.slice(0, 12)}…). Stopping.`);
  }
  console.log(`${label} 200 host=${CHECKOUT_HOST} session=${id.slice(0, 12)}…`);
}

async function probeVercelStripeMode(origin) {
  const token = String(process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const host = new URL(origin).hostname;
  if (!host.endsWith('.vercel.app')) return null;
  const headers = { authorization: `Bearer ${token}` };
  const team = String(process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || '').trim();
  const teamQs = team ? `?teamId=${encodeURIComponent(team)}` : '';
  let deployment;
  try {
    const res = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}${teamQs}`, { headers });
    if (!res.ok) return null;
    deployment = await res.json();
  } catch (_) {
    return null;
  }
  const projectId = deployment && deployment.projectId;
  if (!projectId) return null;
  const join = teamQs ? '&' : '?';
  let envBody;
  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/env${teamQs}${join}decrypt=true`,
      { headers }
    );
    if (!res.ok) return null;
    envBody = await res.json();
  } catch (_) {
    return null;
  }
  const rows = (envBody.envs || []).filter((row) => row && row.key === 'STRIPE_SECRET_KEY');
  const preview = rows.find((row) => (row.target || []).includes('preview'))
    || rows.find((row) => (row.target || []).includes('production'))
    || rows[0];
  const mode = classifyKey(preview && preview.value);
  if (!mode) return null;
  return { mode, reason: 'Vercel project STRIPE_SECRET_KEY prefix for this deployment' };
}

async function detectMode(origin) {
  const explicit = String(process.env.FITMUNCH_SMOKE_MODE || '').trim().toLowerCase();
  if (explicit === 'test' || explicit === 'live') {
    return { mode: explicit, reason: 'FITMUNCH_SMOKE_MODE' };
  }
  const probed = await probeVercelStripeMode(origin);
  if (probed) return probed;
  return {
    mode: 'live',
    reason: 'deployment Stripe key was not proven to be a test key, so checkout sessions are not created',
  };
}

async function githubJson(pathname) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) fail('GITHUB_TOKEN is required to find the preview deployment');
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'fitmunch-smoke-checkout/1.0',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) fail(`GitHub ${pathname} returned ${res.status}`);
  return res.json();
}

async function successfulPreviewOrigins(repo, sha) {
  const deployments = await githubJson(`/repos/${repo}/deployments?sha=${encodeURIComponent(sha)}&per_page=100`);
  const origins = [];
  for (const deployment of deployments) {
    if (!isPreviewEnvironment(deployment.environment)) continue;
    const statuses = await githubJson(`/repos/${repo}/deployments/${deployment.id}/statuses`);
    const success = (statuses || []).find((status) => status.state === 'success' && (status.environment_url || status.target_url));
    if (!success) continue;
    origins.push(previewOrigin(success.environment_url || success.target_url));
  }
  return [...new Set(origins)];
}

async function waitForPreviewOrigins(repo, sha) {
  for (let attempt = 1; attempt <= PREVIEW_POLL_ATTEMPTS; attempt += 1) {
    const origins = await successfulPreviewOrigins(repo, sha);
    if (origins.length) return origins;
    console.log(`Waiting for a successful Vercel Preview deployment of ${sha.slice(0, 7)} (${attempt}/${PREVIEW_POLL_ATTEMPTS})`);
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_MS));
  }
  fail(`No successful Vercel Preview deployment for ${sha} after waiting`);
}

async function resolveOrigins() {
  const direct = String(process.env.FITMUNCH_SMOKE_URL || '').trim();
  if (direct) return [previewOrigin(direct)];
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const eventPath = process.env.GITHUB_EVENT_PATH || '';
  if (!eventPath || !fs.existsSync(eventPath)) fail('Set FITMUNCH_SMOKE_URL');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) fail('GITHUB_REPOSITORY is required');
  if (eventName === 'deployment_status') {
    const environment = event.deployment && event.deployment.environment;
    if (!isPreviewEnvironment(environment)) fail(`Not a preview deployment: ${environment}`);
    const state = event.deployment_status && event.deployment_status.state;
    if (state !== 'success') fail(`Deployment status is ${state}`);
    const raw = (event.deployment_status && (event.deployment_status.environment_url || event.deployment_status.target_url)) || '';
    return [previewOrigin(raw)];
  }
  if (eventName === 'pull_request') {
    const sha = event.pull_request && event.pull_request.head && event.pull_request.head.sha;
    if (!sha) fail('pull_request event has no head sha');
    return waitForPreviewOrigins(repo, sha);
  }
  fail(`Set FITMUNCH_SMOKE_URL (event ${eventName || 'none'} has no deployment URL)`);
}

async function smokeOne(origin) {
  const { mode, reason } = await detectMode(origin);
  console.log(`smoke mode: ${mode} (${reason})`);
  console.log(`url: ${origin}`);
  const stamp = Date.now();
  const email = `smoke+${stamp}@fitmunch.com.au`;

  const login = await callJson(origin, '/api/auth/login', {
    email,
    password: 'smoke-checkout-guard-not-a-password',
  });
  if (login.status !== 200 && login.status !== 401) {
    fail(`/api/auth/login returned ${login.status}, expected 200 or 401: ${snippet(JSON.stringify(login.body))}`);
  }
  console.log(`/api/auth/login ${login.status}`);

  if (mode === 'live') {
    const coach = await callJson(origin, '/api/coach/checkout', {});
    if (coach.status >= 500) fail(`/api/coach/checkout invalid payload returned ${coach.status}`);
    if (coach.body && typeof coach.body.url === 'string' && coach.body.url.includes(CHECKOUT_HOST)) {
      fail('/api/coach/checkout returned a Checkout URL for an invalid payload. Stopping.');
    }
    console.log(`/api/coach/checkout invalid payload ${coach.status}`);
    const quick = await callJson(origin, '/api/quick-checkout', {});
    if (quick.status >= 500) fail(`/api/quick-checkout invalid payload returned ${quick.status}`);
    if (quick.body && typeof quick.body.url === 'string' && quick.body.url.includes(CHECKOUT_HOST)) {
      fail('/api/quick-checkout returned a Checkout URL for an invalid payload. Stopping.');
    }
    console.log(`/api/quick-checkout invalid payload ${quick.status}`);
    console.log('live mode: skipped checkout POSTs that would create a session');
    return;
  }

  const coach = await callJson(origin, '/api/coach/checkout', { plan: 'coach-39', email });
  assertCheckoutUrl('POST /api/coach/checkout', coach.status, coach.body);
  const quick = await callJson(origin, '/api/quick-checkout', { plan: 'premium', email });
  assertCheckoutUrl('POST /api/quick-checkout', quick.status, quick.body);
}

async function main() {
  const origins = await resolveOrigins();
  for (const origin of origins) {
    await smokeOne(origin);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
