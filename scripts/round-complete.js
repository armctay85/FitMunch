'use strict';
/**
 * Wait until every other check on this pull request head has completed.
 * Read-only. Skipped and neutral checks do not block. Zero other checks is a failure.
 */
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const sha = process.env.HEAD_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const selfJob = process.env.GITHUB_JOB || 'round-complete';
const selfRun = String(process.env.GITHUB_RUN_ID || '');
const WAIT_MS = 20000;
const GRACE_MS = 90000;
const DEADLINE_MS = 40 * 60 * 1000;
const IGNORE = new Set(['success', 'skipped', 'neutral']);
const BAD = ['failure', 'cancelled', 'timed_out', 'action_required'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'round-complete',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github ${res.status} ${path} ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listCheckRuns() {
  const all = [];
  for (let page = 1; page < 20; page += 1) {
    const data = await gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}&filter=latest`);
    const batch = data.check_runs || [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function listWorkflowRuns() {
  const all = [];
  for (let page = 1; page < 20; page += 1) {
    const data = await gh(`/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`);
    const batch = data.workflow_runs || [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function listCommitStatuses() {
  const data = await gh(`/repos/${repo}/commits/${sha}/status`);
  return Array.isArray(data.statuses) ? data.statuses : [];
}

function belongsToThisRun(check) {
  const url = String(check.details_url || check.html_url || '');
  return Boolean(selfRun) && url.includes(`/runs/${selfRun}/`);
}

function isWaitingStatus(status) {
  return status === 'queued' || status === 'in_progress' || status === 'pending' || status === 'waiting' || status === 'requested';
}

function badConclusion(conclusion) {
  if (!conclusion || IGNORE.has(conclusion)) return false;
  return BAD.includes(conclusion) || conclusion !== 'success';
}

async function main() {
  if (!token || !sha || !repo) {
    console.error('no other checks: missing token, head sha, or repository');
    process.exit(1);
  }
  const started = Date.now();
  const deadline = started + DEADLINE_MS;
  while (Date.now() < deadline) {
    const checks = await listCheckRuns();
    const runs = await listWorkflowRuns();
    const contexts = await listCommitStatuses();
    const otherChecks = checks.filter((check) => check.name !== selfJob && !belongsToThisRun(check));
    const otherRuns = runs.filter((run) => run.id !== selfRun && String(run.id) !== selfRun);
    if (otherChecks.length === 0 && otherRuns.length === 0 && contexts.length === 0) {
      if (Date.now() - started >= GRACE_MS) {
        console.error('no other checks');
        process.exit(1);
      }
      console.log('no other checks yet; waiting for the head to register');
      await sleep(WAIT_MS);
      continue;
    }
    const waitingChecks = otherChecks.filter((check) => isWaitingStatus(check.status));
    const waitingRuns = otherRuns.filter((run) => isWaitingStatus(run.status));
    const waitingContexts = contexts.filter((item) => item.state === 'pending');
    const failedChecks = otherChecks.filter((check) => check.status === 'completed' && badConclusion(check.conclusion));
    const failedRuns = otherRuns.filter((run) => run.status === 'completed' && badConclusion(run.conclusion));
    const failedContexts = contexts.filter((item) => item.state === 'failure' || item.state === 'error');
    if (failedChecks.length || failedRuns.length || failedContexts.length) {
      for (const check of failedChecks) console.error(`check ${check.name} ${check.conclusion}`);
      for (const run of failedRuns) console.error(`workflow run ${run.id} ${run.conclusion}`);
      for (const item of failedContexts) console.error(`status ${item.context} ${item.state}`);
      process.exit(1);
    }
    if (waitingChecks.length === 0 && waitingRuns.length === 0 && waitingContexts.length === 0) {
      const successes = otherChecks.filter((check) => check.conclusion === 'success').length
        + otherRuns.filter((run) => run.conclusion === 'success').length
        + contexts.filter((item) => item.state === 'success').length;
      if (successes === 0) {
        console.error('no other checks');
        process.exit(1);
      }
      console.log(`round-complete: ${otherChecks.length} checks, ${otherRuns.length} workflow runs, ${contexts.length} statuses are done`);
      process.exit(0);
    }
    const names = waitingChecks.map((check) => check.name)
      .concat(waitingRuns.map((run) => String(run.id)))
      .concat(waitingContexts.map((item) => item.context));
    console.log(`waiting queued or in_progress: ${names.join(', ')}`);
    await sleep(WAIT_MS);
  }
  console.error('timed_out waiting for other checks');
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
