'use strict';
/**
 * EQA locked acceptance, FitMunch "web-ci-truth" CI-7 (class E: premature done). Owned by Elite QA.
 * LOCKED 24 Nov 2026 AEDT. Static only: reads .github/workflows. Runs in jest on ubuntu in under 2s.
 * Rule: one PR check, round-complete, is the only "done": it discovers every other check on the PR head (no hard-coded list),
 * excludes itself, ignores skipped/neutral (path-filtered) ones, waits while any is queued or in progress, fails on any
 * failure, cancellation or time-out, and is read-only. The runtime proof (pending, failing, green) is the PR's own CI rounds.
 * Making it a REQUIRED branch-protection check is a settings change for Drew and is NOT tested here.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '.github', 'workflows');
const ALL = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).sort();
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const files = ALL.filter((f) => /^\s{2}round-complete:\s*$/m.test(read(f)) || /^name:\s*['"]?round-complete['"]?\s*$/m.test(read(f)));
const SRC = files.length === 1 ? read(files[0]) : '';
const ON = (SRC.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)+)/m) || ['', ''])[1];
// Logic lives in the workflow or in a script it runs; both count as the implementation.
const scriptRefs = (SRC.match(/(?:node|python3|bash)\s+(\.?\/?scripts\/[\w./-]+)/g) || []).map((s) => s.split(/\s+/)[1]);
const IMPL = SRC + '\n' + scriptRefs.map((p) => { const f = path.join(__dirname, p); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }).join('\n');

describe('EQA CI-7: round-complete is the single done check', () => {
  test('R0 exactly one workflow defines a round-complete job, triggered on pull_request', () => {
    expect(files.length).toBe(1);
    expect(ON).toMatch(/^ {2}pull_request(_target)?:/m);
  });

  test('R1 it discovers checks on the PR head SHA through the API, not a hard-coded workflow list', () => {
    expect(IMPL).toMatch(/check-runs|check_runs|checks\.listForRef|actions\/runs|listWorkflowRunsForRepo|head_sha|commits\/\$\{?[\w.{} ]*\}?\/check/);
    expect(IMPL).toMatch(/pull_request\.head\.sha|github\.event\.pull_request\.head\.sha|head\.sha|HEAD_SHA/);
    const named = ALL.filter((f) => f !== files[0]).map((f) => (read(f).match(/^name:\s*['"]?(.+?)['"]?\s*$/m) || [])[1]).filter(Boolean);
    const hard = named.filter((n) => n.length > 4 && IMPL.includes(n));
    expect(hard).toEqual([]);
  });

  test('R2 it excludes itself from what it waits on', () => {
    // Self is named by literal, constant, github.job or GITHUB_JOB, and a name/id inequality or exclude filter is applied.
    expect(IMPL).toMatch(/round-complete|github\.job|GITHUB_JOB|GITHUB_RUN_ID|github\.run_id/);
    expect(IMPL).toMatch(/(name|id|app|workflow\w*)\s*(!==|!=)\s*\S+|exclude|select\(\.name\s*!=|-ne\s/i);
  });

  test('R3 skipped and neutral checks do not block (path-filtered workflows never report)', () => {
    expect(IMPL).toMatch(/skipped/);
    expect(IMPL).toMatch(/neutral/);
  });

  test('R4 it waits while any check is queued or in progress, with a bounded timeout', () => {
    expect(IMPL).toMatch(/in_progress/);
    expect(IMPL).toMatch(/queued|pending|waiting/);
    expect(SRC).toMatch(/timeout-minutes:\s*\d+/);
  });

  test('R5 it fails on failure, cancelled, timed_out or action_required', () => {
    for (const c of ['failure', 'cancelled', 'timed_out', 'action_required']) expect(IMPL).toMatch(new RegExp(c));
  });

  test('R6 read-only and per-head: permissions grant no write; concurrency is keyed on the PR head', () => {
    const perms = (SRC.match(/^permissions:\s*\n((?:[ \t]+.*\n)+)/m) || ['', ''])[1];
    expect(perms.length).toBeGreaterThan(0);
    expect(/:\s*write\b/.test(perms) || /^permissions:\s*write-all/m.test(SRC)).toBe(false);
    expect(perms).toMatch(/checks:\s*read|actions:\s*read/);
    expect(SRC).toMatch(/^concurrency:[\s\S]{0,200}(head_ref|github\.ref|pull_request\.number|head\.sha)/m);
  });

  test('R7 it does not pass vacuously: zero discovered checks is a failure, not a green', () => {
    expect(IMPL).toMatch(/(length|count|total_count|\.size)\s*(===|==|<|<=|-eq|-lt)\s*[01]\b|no (other )?checks?/i);
  });
});
