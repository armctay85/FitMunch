'use strict';
/**
 * EQA locked acceptance, FitMunch CI-9b (class C, live probes never cancelled). Owned by Elite QA. LOCKED 24 Nov 2026 AEDT.
 * GitHub concurrency keeps ONE pending run per group and cancels any older pending run, even with cancel-in-progress: false.
 * So a deployment_status workflow whose group is shared across deployments can still lose a queued Production probe.
 * Rule: every workflow triggered by deployment_status either has no top-level concurrency, or its group includes a
 * per-event unique key (github.event.deployment.id, github.event.deployment_status.id or github.run_id).
 * Also: no concurrency block at ANY level of such a workflow may use anything but a literal cancel-in-progress: false,
 * and every job-level group (except a job that only runs on if: failure(), such as an issue filer) is per-event unique.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '.github', 'workflows');
const UNIQUE = /github\.event\.deployment\.id|github\.event\.deployment_status\.id|github\.run_id/;

function topBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return null;
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length; j += 1) {
    if (/^\S/.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}
function deployWorkflows() {
  return fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).filter((f) => {
    const on = topBlock(fs.readFileSync(path.join(DIR, f), 'utf8'), 'on') || '';
    return /deployment_status/.test(on);
  });
}

describe('EQA CI-9b: deployment_status concurrency can never drop a queued live probe', () => {
  test('B0 the deployment_status workflow set is intact (post-deploy-probe and prod-smoke still exist)', () => {
    const set = deployWorkflows();
    expect(set.includes('post-deploy-probe.yml')).toBe(true);
    expect(set.includes('prod-smoke.yml')).toBe(true);
  });
  for (const f of ['post-deploy-probe.yml', 'prod-smoke.yml']) {
    test(`B1 ${f}: no shared group (absent, or keyed on a per-event unique id) and never cancels`, () => {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      const c = topBlock(text, 'concurrency');
      if (c === null) return;
      const group = (c.match(/group:\s*(.+)/) || [, ''])[1];
      expect(UNIQUE.test(group)).toBe(true);
      expect(/cancel-in-progress:\s*true/.test(c)).toBe(false);
    });
  }
  test('B2 class rule: every deployment_status workflow obeys B1', () => {
    const bad = deployWorkflows().filter((f) => {
      const c = topBlock(fs.readFileSync(path.join(DIR, f), 'utf8'), 'concurrency');
      if (c === null) return false;
      const group = (c.match(/group:\s*(.+)/) || [, ''])[1];
      return !UNIQUE.test(group) || /cancel-in-progress:\s*true/.test(c);
    });
    expect(bad).toEqual([]);
  });
});

function jobs(text) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^jobs:/.test(l));
  const out = [];
  let cur = null;
  for (let j = i + 1; i >= 0 && j < lines.length; j += 1) {
    if (/^\S/.test(lines[j])) break;
    const m = lines[j].match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { cur = { name: m[1], body: [] }; out.push(cur); } else if (cur) cur.body.push(lines[j]);
  }
  return out.map((x) => ({ name: x.name, body: x.body.join('\n') }));
}

describe('EQA CI-9b job level: deploy smoke jobs are never cancelled or dropped', () => {
  for (const f of ['post-deploy-probe.yml', 'prod-smoke.yml']) {
    test(`B3 ${f}: every cancel-in-progress at any level is literally false`, () => {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      const vals = (text.match(/cancel-in-progress:\s*(.+)/g) || []).map((l) => l.replace(/cancel-in-progress:\s*/, '').replace(/\s*#.*$/, '').trim());
      expect(vals.filter((v) => v !== 'false')).toEqual([]);
    });
    test(`B4 ${f}: every job-level group (except if: failure() jobs) is keyed on a per-event unique id`, () => {
      const text = fs.readFileSync(path.join(DIR, f), 'utf8');
      const bad = jobs(text).filter((j) => /\n\s+concurrency:/.test('\n' + j.body))
        .filter((j) => !/^    if:\s*failure\(\)\s*$/m.test(j.body))
        .filter((j) => !UNIQUE.test((j.body.match(/group:\s*(.+)/) || [, ''])[1]))
        .map((j) => j.name);
      expect(bad).toEqual([]);
    });
  }
});
