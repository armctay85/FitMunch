'use strict';

/**
 * Fail when the committed catalogue ended more than 8 days ago
 * (Australia/Sydney).
 *
 * Emergency hotfix deploys may set CATALOGUE_STALE_OK=1. That skips this
 * process exit only. The shopper and Coach pages still show validFrom and
 * validTo from the catalogue.
 *
 * Every use of that hatch prints one line:
 * CATALOGUE_STALE_OVERRIDE used: validTo=<date>, age=<n>d, commit=<sha>
 * In GitHub Actions it also opens or comments on an issue labelled
 * catalogue-stale-override. On Vercel, GET /api/health/catalogue reports
 * staleOverride for a monitor. Documented in docs/catalogue-source.md.
 */

const { spawnSync } = require('child_process');
const { CATALOGUE } = require('../lib/public-specials-catalogue');
const { sydneyToday, daysBefore } = require('./catalogue-lib');

const STALE_OVERRIDE_LABEL = 'catalogue-stale-override';
const STALE_OVERRIDE_TITLE = 'Catalogue stale override';

function catalogueHealth(catalogue, env, now) {
  const today = sydneyToday(now);
  const validFrom = catalogue && catalogue.validFrom ? String(catalogue.validFrom) : null;
  const validTo = catalogue && catalogue.validTo ? String(catalogue.validTo) : null;
  const ageDays = validTo ? daysBefore(validTo, today) : null;
  return {
    validFrom,
    validTo,
    ageDays,
    staleOverride: !!(env && env.CATALOGUE_STALE_OK === '1'),
  };
}

function resolveCommit(env) {
  const fromEnv = env && (env.GITHUB_SHA || env.VERCEL_GIT_COMMIT_SHA);
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = result.status === 0 ? String(result.stdout || '').trim() : '';
    return sha || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

function overrideLine(catalogue, env, now) {
  const health = catalogueHealth(catalogue, env, now || new Date());
  const validTo = health.validTo || 'unset';
  const age = health.ageDays == null ? 'unknown' : `${health.ageDays}d`;
  const commit = resolveCommit(env || {});
  return {
    ...health,
    commit,
    line: `CATALOGUE_STALE_OVERRIDE used: validTo=${validTo}, age=${age}, commit=${commit}`,
  };
}

function checkFreshness(catalogue, env, now) {
  if (env && env.CATALOGUE_STALE_OK === '1') {
    const record = overrideLine(catalogue, env, now);
    return {
      ok: true,
      skipped: true,
      staleOverride: true,
      age: record.ageDays,
      today: sydneyToday(now),
      validFrom: record.validFrom,
      validTo: record.validTo,
      commit: record.commit,
      line: record.line,
      message: record.line,
    };
  }
  const today = sydneyToday(now);
  const validTo = catalogue && catalogue.validTo;
  if (!validTo) {
    return { ok: false, message: 'Catalogue validTo is not set.' };
  }
  const age = daysBefore(validTo, today);
  if (age == null) {
    return { ok: false, message: `Catalogue validTo ${validTo} is not a date.` };
  }
  if (age > 8) {
    return {
      ok: false,
      age,
      today,
      message: `Catalogue validTo ${validTo} is ${age} days before ${today} (Australia/Sydney). The limit is 8 days. Set CATALOGUE_STALE_OK=1 only for an emergency hotfix deploy. The shopper still shows the catalogue dates.`,
    };
  }
  return {
    ok: true,
    age,
    today,
    message: `Catalogue validTo ${validTo} is ${age} days before ${today} (Australia/Sydney).`,
  };
}

function actionsCanFileIssue(env) {
  return !!(env && env.GITHUB_ACTIONS === 'true' && (env.GITHUB_TOKEN || env.GH_TOKEN));
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
    throw new Error(detail || `${command} exited ${result.status}`);
  }
  return result;
}

function fileStaleOverrideIssue(record, env, run) {
  if (!actionsCanFileIssue(env)) return { filed: false };
  const exec = run || ((command, args) => runCommand(command, args, env));
  const repo = env.GITHUB_REPOSITORY ? ['--repo', env.GITHUB_REPOSITORY] : [];
  exec('gh', [
    'label', 'create', STALE_OVERRIDE_LABEL,
    ...repo,
    '--color', 'B60205',
    '--description', 'Freshness gate bypassed with CATALOGUE_STALE_OK=1',
    '--force',
  ]);
  const listed = exec('gh', [
    'issue', 'list',
    ...repo,
    '--state', 'open',
    '--label', STALE_OVERRIDE_LABEL,
    '--limit', '1',
    '--json', 'number',
    '--jq', '.[0].number',
  ]);
  const number = String(listed.stdout || '').trim();
  if (number && number !== 'null') {
    exec('gh', ['issue', 'comment', number, ...repo, '--body', record.line]);
    return { filed: true, action: 'comment', number };
  }
  exec('gh', [
    'issue', 'create',
    ...repo,
    '--title', STALE_OVERRIDE_TITLE,
    '--label', STALE_OVERRIDE_LABEL,
    '--body', record.line,
  ]);
  return { filed: true, action: 'create' };
}

function applyOverrideTrail(record, env, deps) {
  const log = (deps && deps.log) || console.error;
  log(record.line);
  if (!actionsCanFileIssue(env)) return { ok: true, filed: false };
  try {
    return { ok: true, ...fileStaleOverrideIssue(record, env, deps && deps.run) };
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    log(`CATALOGUE_STALE_OVERRIDE issue failed: ${error}`);
    return { ok: false, error };
  }
}

function main() {
  const result = checkFreshness(CATALOGUE, process.env, new Date());
  if (result.staleOverride) {
    const trail = applyOverrideTrail(result, process.env);
    if (!trail.ok) process.exit(1);
    return;
  }
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (require.main === module) main();

module.exports = {
  STALE_OVERRIDE_LABEL,
  catalogueHealth,
  overrideLine,
  checkFreshness,
  actionsCanFileIssue,
  fileStaleOverrideIssue,
  applyOverrideTrail,
};
