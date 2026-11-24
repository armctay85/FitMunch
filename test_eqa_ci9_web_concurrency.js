'use strict';
/**
 * EQA locked acceptance, FitMunch "web-ci-truth" CI-9 web half (class C: staleness). Owned by Elite QA.
 * LOCKED 24 Nov 2026 AEDT. Static only: reads .github/workflows. Runs in jest on ubuntu in under 2s.
 * Rule: every web PR workflow cancels a superseded run on the same head; a live probe (deployment_status) is never cancelled.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '.github', 'workflows');
const read = (f) => { const p = path.join(WF, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const ALL = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).sort();
const WEB = ALL.filter((f) => !/^ios-/.test(f));
const LIVE = ['post-deploy-probe.yml', 'prod-smoke.yml'];

// Top-level concurrency block: { group, cancel } as raw strings, or null.
function concurrency(src) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => /^concurrency:/.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(/^concurrency:\s*/, '').trim();
  if (inline && !inline.startsWith('#')) {
    if (inline.startsWith('{')) {
      const g = inline.match(/group:\s*([^,]+?)\s*(,|}\s*$)/); const c = inline.match(/cancel-in-progress:\s*([^,}]+)/);
      return { group: g ? g[1].trim() : '', cancel: c ? c[1].trim() : null };
    }
    return { group: inline, cancel: null };
  }
  const out = { group: '', cancel: null };
  for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j]) || /^\s*$/.test(lines[j]) || /^\s*#/.test(lines[j])); j++) {
    const g = lines[j].match(/^\s+group:\s*(.+?)\s*$/); if (g) out.group = g[1];
    const c = lines[j].match(/^\s+cancel-in-progress:\s*(.+?)\s*(#.*)?$/); if (c) out.cancel = c[1];
  }
  return out;
}
const triggers = (src) => {
  const on = src.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)+)/m);
  if (on) return (on[1].match(/^ {2}([a-z_]+):/gm) || []).map((s) => s.trim().replace(':', ''));
  const inl = src.match(/^on:\s*\[([^\]]+)\]/m) || src.match(/^on:\s*([a-z_]+)\s*$/m);
  return inl ? inl[1].split(',').map((s) => s.trim()) : [];
};

describe('EQA CI-9 web: per-head concurrency on every web PR workflow, live probes never cancelled', () => {
  test('W0 the web workflow set is intact (nothing deleted to pass)', () => {
    for (const f of ['web-quality.yml', 'jest.yml', 'post-deploy-probe.yml', 'prod-smoke.yml', 'ai-credit-check.yml']) {
      expect(read(f).length).toBeGreaterThan(100);
    }
  });

  test('W1 web-quality.yml: top-level concurrency keyed on the workflow and the PR head, cancel-in-progress true', () => {
    const c = concurrency(read('web-quality.yml'));
    expect(c === null).toBe(false);
    expect(c.group).toMatch(/github\.(workflow|ref|head_ref)/);
    expect(c.group).toMatch(/github\.(head_ref|ref)\b/);
    expect(String(c.cancel)).toMatch(/^(true|\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\})$/);
  });

  for (const f of LIVE) test(`W2 ${f}: has a concurrency group and cancel-in-progress is literally false`, () => {
    const src = read(f);
    expect(triggers(src)).toContain('deployment_status');
    const c = concurrency(src);
    expect(c === null).toBe(false);
    expect(c.group.length).toBeGreaterThan(3);
    expect(c.cancel).toBe('false');
  });

  test('W3 class rule: every web workflow triggered by pull_request has a top-level concurrency group that cancels a superseded PR run', () => {
    const bad = [];
    for (const f of WEB) {
      const src = read(f);
      if (!triggers(src).includes('pull_request')) continue;
      const c = concurrency(src);
      if (!c || !/github\.(head_ref|ref)\b/.test(c.group) || !c.cancel || c.cancel === 'false') bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  test('W4 class rule: no deployment_status workflow may cancel in progress', () => {
    const bad = WEB.filter((f) => triggers(read(f)).includes('deployment_status')).filter((f) => { const c = concurrency(read(f)); return !c || c.cancel !== 'false'; });
    expect(bad).toEqual([]);
  });

  test('W5 existing groups kept: jest.yml still cancels superseded PR runs only, ai-credit-check.yml still never cancels', () => {
    const j = concurrency(read('jest.yml'));
    expect(j === null).toBe(false);
    expect(j.cancel).toMatch(/pull_request|true/);
    const a = concurrency(read('ai-credit-check.yml'));
    expect(a === null).toBe(false);
    expect(a.cancel).toBe('false');
  });
});
