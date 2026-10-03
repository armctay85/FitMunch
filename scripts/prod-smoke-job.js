/**
 * Post-deploy production smoke and rollback.
 *
 * Smoke always runs against the public production domain once that deployment
 * is the live alias. A protection-bypass secret is optional and is only used
 * when a preview host is smoked on purpose.
 *
 * Automatic rollback targets the newest READY production deployment created
 * before the failing one. Pro can also roll back to any earlier production
 * deployment when workflow_dispatch passes deployment_id.
 */

const { spawn } = require('child_process');
const path = require('path');
const ops = require('./lib/vercel-deploy-ops');
const incident = require('./lib/prod-incident');

const PROD_ENVIRONMENTS = new Set(['Production – fit-munch', 'Production - fit-munch']);
const SMOKE_CONFIG = ['SMOKE_USER_EMAIL', 'SMOKE_USER_PASSWORD', 'SMOKE_TOKEN'];

function missingSmokeConfig(env) {
  return SMOKE_CONFIG.filter((name) => !String(env[name] || '').trim());
}

function isFitMunchProduction(environment) {
  return PROD_ENVIRONMENTS.has(String(environment || ''));
}

function eventNameOf(event) {
  return (event && (event.event_name || event.name)) || '';
}

function deploymentUrlOf(event) {
  const status = (event && event.deployment_status) || {};
  return status.environment_url || status.target_url || '';
}

function shaOf(event) {
  return String((event && event.deployment && event.deployment.sha) || '');
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7);
}

function emailTo(env) {
  const list = String(env.ALERT_EMAIL_TO || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : ['support@fitmunch.com.au'];
}

function prodUrl(env) {
  return env.PROD_URL || 'https://www.fitmunch.com.au';
}

async function runSmokeCommand(options, deps) {
  if (deps.smoke) return deps.smoke(options);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'smoke-prod.mjs'),
      '--target',
      options.target,
      '--mode',
      options.mode,
    ], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('close', (code) => {
      const line = out.split('\n').reverse().find((row) => row.startsWith('SMOKE_RESULT '));
      let result = null;
      if (line) {
        try { result = JSON.parse(line.slice('SMOKE_RESULT '.length)); } catch (_) { result = null; }
      }
      resolve({ code: code == null ? 1 : code, result, log: out });
    });
  });
}

async function notify(deps, env, details) {
  const handler = deps.incident || incident.handleIncident;
  return handler({
    state: details.state || 'down',
    title: details.title,
    body: details.body,
    now: deps.now ? deps.now() : Date.now(),
    github: deps.github,
    fetchImpl: deps.fetch,
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    resendKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    emailTo: emailTo(env),
    repeatEmail: details.repeatEmail !== false,
  });
}

async function rollbackDryRun(event, env, deps, log) {
  const client = deps.ops || ops;
  if (!env.VERCEL_TOKEN) {
    log('VERCEL_TOKEN missing. Cannot list rollback targets.');
    return { exitCode: 0, rollback: false };
  }
  const list = await client.listProductionDeployments(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
  });
  let failing = null;
  try {
    failing = await client.getProductionAlias(deps.fetch, {
      token: env.VERCEL_TOKEN,
      teamId: env.VERCEL_TEAM_ID,
    });
  } catch (_) {
    const sorted = client.priorProductionDeployments(list, { id: '', created: Date.now() + 1 });
    failing = sorted[0] || null;
  }
  const explicit = (event.inputs && event.inputs.deployment_id) || '';
  let target = client.findRollbackTarget(list, failing, explicit || undefined);
  if (explicit && !target) {
    try {
      const row = await client.getDeployment(deps.fetch, {
        token: env.VERCEL_TOKEN,
        teamId: env.VERCEL_TEAM_ID,
        deploymentId: explicit,
      });
      if (client.isEligibleRollbackTarget(row, failing)) target = row;
    } catch (_) {
      target = null;
    }
  }
  log('Rollback candidates (earlier READY production deployments, newest first):');
  client.priorProductionDeployments(list, failing).forEach((row) => {
    log(`- ${client.deploymentId(row)} sha=${client.deploymentSha(row) || 'unknown'} created=${client.formatSydney(client.deploymentCreated(row))}`);
  });
  if (!target) {
    log(explicit
      ? 'Requested deployment is not an eligible earlier production deployment.'
      : 'No earlier production deployment found.');
    return { exitCode: 0, rollback: false, target: null };
  }
  log(`Would roll back to ${client.deploymentId(target)} sha=${client.deploymentSha(target) || 'unknown'} created=${client.formatSydney(client.deploymentCreated(target))}`);
  return { exitCode: 0, rollback: false, target: client.deploymentId(target) };
}

async function promoteFlow(event, env, deps, log) {
  const client = deps.ops || ops;
  const deploymentId = event.inputs && event.inputs.deployment_id;
  if (!deploymentId) {
    log('deployment_id is required to promote.');
    return { exitCode: 1, rollback: false };
  }
  if (!env.VERCEL_TOKEN) {
    log('VERCEL_TOKEN missing. Cannot promote.');
    return { exitCode: 1, rollback: false };
  }
  const deployment = await client.getDeployment(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    deploymentId,
  });
  const host = String(deployment.url || deploymentId);
  const preview = host.endsWith('.vercel.app') || host.includes('.vercel.app');
  if (preview && !env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    log('Cannot smoke this deployment URL without optional VERCEL_AUTOMATION_BYPASS_SECRET. Not promoting.');
    return { exitCode: 1, rollback: false, promoted: false };
  }
  const target = preview ? `https://${host.replace(/^https?:\/\//, '')}` : prodUrl(env);
  const smoke = await runSmokeCommand({ target, mode: 'deploy', env }, deps);
  if (smoke.code !== 0) {
    log('Smoke failed. Not promoting.');
    return { exitCode: smoke.code === 2 ? 0 : 1, rollback: false, promoted: false };
  }
  await client.requestPromote(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
    deploymentId,
  });
  log(`Promoted ${deploymentId}`);
  return { exitCode: 0, rollback: false, promoted: true };
}

async function explicitRollback(event, env, deps, log) {
  const client = deps.ops || ops;
  const deploymentId = event.inputs && event.inputs.deployment_id;
  if (!env.VERCEL_TOKEN || !deploymentId) {
    log('rollback requires VERCEL_TOKEN and deployment_id.');
    return { exitCode: 1, rollback: false };
  }
  const list = await client.listProductionDeployments(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
  });
  const alias = await client.getProductionAlias(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
  });
  let target = client.findRollbackTarget(list, alias, deploymentId);
  if (!target) {
    const row = await client.getDeployment(deps.fetch, {
      token: env.VERCEL_TOKEN,
      teamId: env.VERCEL_TEAM_ID,
      deploymentId,
    });
    if (client.isEligibleRollbackTarget(row, alias)) target = row;
  }
  if (!target) {
    log('Requested deployment is not an eligible earlier production deployment. No rollback.');
    return { exitCode: 1, rollback: false };
  }
  await client.requestRollback(deps.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
    deploymentId: client.deploymentId(target),
    description: 'manual rollback to an earlier production deployment',
  });
  log(`Rolled back to ${client.deploymentId(target)}`);
  return { exitCode: 0, rollback: true, target: client.deploymentId(target) };
}

async function runProdSmokeJob(event, deps) {
  const env = (deps && deps.env) || process.env;
  const log = (deps && deps.log) || ((line) => console.log(line));
  const helpers = deps || {};
  const name = eventNameOf(event);
  const inputs = (event && event.inputs) || {};
  const action = inputs.action || 'smoke';

  if (name === 'deployment_status' && !isFitMunchProduction(event.deployment && event.deployment.environment)) {
    log('Skipping: not a successful fit-munch production deployment.');
    return { exitCode: 0, skipped: true, rollback: false };
  }
  if (name === 'deployment_status' && event.deployment_status && event.deployment_status.state !== 'success') {
    log('Skipping: deployment status is not success.');
    return { exitCode: 0, skipped: true, rollback: false };
  }

  if (name === 'workflow_dispatch' && action === 'rollback-dry-run') {
    return rollbackDryRun(event, env, helpers, log);
  }
  if (name === 'workflow_dispatch' && action === 'promote') {
    return promoteFlow(event, env, helpers, log);
  }
  if (name === 'workflow_dispatch' && action === 'rollback') {
    return explicitRollback(event, env, helpers, log);
  }

  const sha = shaOf(event);
  const postStatus = async (state, description) => {
    if (!sha || typeof helpers.postStatus !== 'function') return;
    await helpers.postStatus({
      sha,
      state,
      context: 'prod-smoke',
      description: String(description || '').slice(0, 140),
    });
  };

  const missing = missingSmokeConfig(env);
  if (missing.length) {
    const description = `not configured: ${missing.join(', ')}`;
    log(description);
    await postStatus('error', description);
    return { exitCode: 0, rollback: false, missing };
  }

  await postStatus('pending', 'Production smoke running');
  const client = helpers.ops || ops;
  let failing = null;
  if (name === 'deployment_status' && env.VERCEL_TOKEN) {
    const url = deploymentUrlOf(event);
    if (url) {
      try {
        failing = await client.getDeployment(helpers.fetch, {
          token: env.VERCEL_TOKEN,
          teamId: env.VERCEL_TEAM_ID,
          deploymentUrl: url,
        });
      } catch (err) {
        log(`Could not resolve the new deployment (${err.status || 'error'}).`);
      }
    }
    if (failing) {
      const live = await client.waitForProductionAlias(helpers.fetch, {
        token: env.VERCEL_TOKEN,
        teamId: env.VERCEL_TEAM_ID,
        deploymentId: client.deploymentId(failing),
        prodUrl: prodUrl(env),
        sleep: helpers.sleep,
        attempts: helpers.aliasAttempts || 36,
        intervalMs: helpers.intervalMs == null ? 5000 : helpers.intervalMs,
      });
      if (!live) {
        const description = 'New deployment did not become the production alias';
        log(description);
        await postStatus('failure', description);
        await notify(helpers, env, {
          title: `PROD DEPLOY NOT LIVE: ${shortSha(sha)}`,
          body: `${description}. Smoke was not run against the previous deployment, and nothing was rolled back.`,
          repeatEmail: false,
        });
        return { exitCode: 1, rollback: false, reason: 'alias-timeout' };
      }
    }
  }

  const smokeTarget = (name === 'workflow_dispatch' && inputs.deployment_url) || prodUrl(env);
  const smoke = await runSmokeCommand({
    target: smokeTarget,
    mode: name === 'deployment_status' ? 'deploy' : 'probe',
    env,
  }, helpers);

  if (smoke.code === 2) {
    await postStatus('error', 'not configured');
    return { exitCode: 0, rollback: false, missing: true };
  }
  if (smoke.code === 0) {
    await postStatus('success', 'Production smoke passed');
    if (name === 'deployment_status' && env.VERCEL_TOKEN && failing) {
      try {
        const alias = await client.getProductionAlias(helpers.fetch, {
          token: env.VERCEL_TOKEN,
          teamId: env.VERCEL_TEAM_ID,
        });
        if (client.deploymentId(alias) && client.deploymentId(alias) !== client.deploymentId(failing)) {
          await notify(helpers, env, {
            title: `Prod is rolled back; deployment ${client.deploymentId(failing)} passed smoke; run workflow 'promote' to go live`,
            body: 'Smoke passed, but the production domain does not point at this deployment. Nothing was promoted.',
            repeatEmail: false,
          });
        }
      } catch (_) {
        /* alias read is informational after a pass */
      }
    }
    return { exitCode: 0, rollback: false };
  }

  if (name !== 'deployment_status') {
    await postStatus('failure', 'Production smoke failed');
    return { exitCode: 1, rollback: false };
  }

  const resultJson = smoke.result ? JSON.stringify(smoke.result) : '{}';
  if (!env.VERCEL_TOKEN) {
    const description = 'AUTO-ROLLBACK NOT CONFIGURED - roll back manually in Vercel > fit-munch > Deployments';
    log(description);
    await postStatus('failure', 'Smoke failed, auto-rollback not configured');
    await notify(helpers, env, {
      title: `PROD DEPLOY FAILED SMOKE: ${shortSha(sha)} auto-rollback not configured`,
      body: `${description}\n\n${resultJson}`,
      repeatEmail: false,
    });
    return { exitCode: 1, rollback: false, reason: 'no-token' };
  }

  const list = await client.listProductionDeployments(helpers.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
  });
  const target = client.findRollbackTarget(list, failing || { id: '', created: Date.now() });
  if (!target) {
    log('No earlier production deployment to roll back to.');
    await postStatus('failure', 'Smoke failed and no rollback target was found');
    await notify(helpers, env, {
      title: `PROD DEPLOY FAILED SMOKE: ${shortSha(sha)} no rollback target`,
      body: resultJson,
      repeatEmail: false,
    });
    return { exitCode: 1, rollback: false };
  }

  await client.requestRollback(helpers.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
    deploymentId: client.deploymentId(target),
    description: `prod smoke failed for ${shortSha(sha)}`,
  });
  await client.waitForProductionAlias(helpers.fetch, {
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    deploymentId: client.deploymentId(target),
    prodUrl: prodUrl(env),
    sleep: helpers.sleep,
    attempts: helpers.aliasAttempts || 36,
    intervalMs: helpers.intervalMs == null ? 5000 : helpers.intervalMs,
  });
  const confirm = await runSmokeCommand({ target: prodUrl(env), mode: 'probe', env }, helpers);
  await postStatus('failure', `Rolled back to ${client.deploymentSha(target) || client.deploymentId(target)}`);
  await notify(helpers, env, {
    title: `PROD DEPLOY FAILED SMOKE: ${shortSha(sha)} rolled back to ${client.deploymentSha(target) || 'previous'}`,
    body: [
      `Failing sha: ${shortSha(sha)}`,
      `Rolled back to: ${client.deploymentId(target)} (${client.deploymentSha(target) || 'unknown'})`,
      `Confirm smoke: ${confirm.code === 0 ? 'passed' : 'failed'}`,
      resultJson,
      `Logs: https://vercel.com/armctay85s-projects/fit-munch/logs`,
    ].join('\n'),
    repeatEmail: false,
  });
  return { exitCode: 1, rollback: true, target: client.deploymentId(target), confirmCode: confirm.code };
}

async function main() {
  const fs = require('fs');
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : {};
  event.event_name = process.env.GITHUB_EVENT_NAME || event.event_name;
  const result = await runProdSmokeJob(event, {
    env: process.env,
    fetch: global.fetch,
    postStatus: async ({ sha, state, description, context }) => {
      const repo = process.env.GITHUB_REPOSITORY;
      const token = process.env.GITHUB_TOKEN;
      if (!repo || !token) return;
      await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'fitmunch-prod-smoke',
        },
        body: JSON.stringify({ state, context, description }),
      });
    },
  });
  process.exit(result.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message.split('\n')[0] : 'prod smoke job failed');
    process.exit(1);
  });
}

module.exports = {
  runProdSmokeJob,
  missingSmokeConfig,
  isFitMunchProduction,
  PROD_ENVIRONMENTS,
};
