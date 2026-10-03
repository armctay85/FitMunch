/**
 * External uptime probe. Retries the production smoke a few times, then
 * opens or updates one GitHub incident. Missing smoke configuration exits 0.
 */

const { spawn } = require('child_process');
const path = require('path');
const incident = require('./lib/prod-incident');
const { formatSydney } = require('./lib/vercel-deploy-ops');

const TITLE = 'PROD DOWN: fitmunch.com.au smoke failing';
const REQUIRED = ['SMOKE_USER_EMAIL', 'SMOKE_USER_PASSWORD', 'SMOKE_TOKEN'];

function missingNames(env) {
  return REQUIRED.filter((name) => !String(env[name] || '').trim());
}

function runSmokeOnce(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'smoke-prod.mjs'),
      '--target',
      'https://www.fitmunch.com.au',
      '--mode',
      'probe',
    ], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('close', (code) => resolve({ code: code == null ? 1 : code, log: out }));
  });
}

async function runProbe(deps) {
  const env = deps.env || process.env;
  const log = deps.log || ((line) => console.log(line));
  const missing = missingNames(env);
  if (missing.length) {
    log(`::warning::PROD probe not configured. Missing: ${missing.join(', ')}`);
    log(`Missing: ${missing.join(', ')}`);
    return { exitCode: 0, missing };
  }

  const smoke = deps.smoke || (() => runSmokeOnce(env));
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const gapMs = deps.gapMs == null ? 30000 : deps.gapMs;
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await smoke();
    if (last.code === 0 || last.code === 2) break;
    if (attempt < 3) await sleep(gapMs);
  }

  if (!last || last.code === 2) {
    log('::warning::PROD probe not configured.');
    return { exitCode: 0, missing: true };
  }

  const handler = deps.incident || incident.handleIncident;
  const now = deps.now || Date.now();
  if (last.code === 0) {
    await handler({
      state: 'up',
      title: TITLE,
      body: `Recovered at ${formatSydney(now)}.`,
      now,
      github: deps.github,
      fetchImpl: deps.fetch,
      token: env.GITHUB_TOKEN,
      repo: env.GITHUB_REPOSITORY,
      resendKey: env.RESEND_API_KEY,
      resendFrom: env.RESEND_FROM,
      emailTo: String(env.ALERT_EMAIL_TO || 'support@fitmunch.com.au').split(',').map((item) => item.trim()).filter(Boolean),
    });
    return { exitCode: 0 };
  }

  await handler({
    state: 'down',
    title: TITLE,
    body: `Production smoke failed at ${formatSydney(now)}.\n\n${incident.redact(last.log || '')}`,
    now,
    github: deps.github,
    fetchImpl: deps.fetch,
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    resendKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    emailTo: String(env.ALERT_EMAIL_TO || 'support@fitmunch.com.au').split(',').map((item) => item.trim()).filter(Boolean),
  });
  return { exitCode: 1 };
}

async function main() {
  const result = await runProbe({ env: process.env, fetch: global.fetch });
  process.exit(result.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? 'probe failed' : 'probe failed');
    process.exit(1);
  });
}

module.exports = { runProbe, TITLE, missingNames };
