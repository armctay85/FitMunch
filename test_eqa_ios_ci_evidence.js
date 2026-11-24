'use strict';
/**
 * EQA locked acceptance, FitMunch "ios-ci-evidence" round 1 (CI-1, CI-2, CI-3, CI-4 static, CI-8, CI-9 iOS). Owned by Elite QA.
 * LOCKED 24 Nov 2026 AEDT. Static only: reads .github/workflows, project.yml and scripts. Runs in jest on ubuntu in under 5s.
 * It does NOT replace the macOS runner proof (force_fail artifact, STOREFRONT country=AUS, A$149.99), which Wilson/Ops Lead read.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const WF = path.join(ROOT, '.github', 'workflows');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const IOS = fs.readdirSync(WF).filter((f) => /^ios-.*\.ya?ml$/.test(f)).sort();
const UI = ['ios-uitest.yml', 'ios-design-uitest.yml', 'ios-screenshots.yml', 'ios-width-capture.yml'];
const RELEASE_ONLY = new Set(['ios-archive.yml']); // IPA upload is success-only by design

// Split a workflow into steps: each starts at a "- name:" or "- uses:" list item; a step runs until the next item at the same indent.
function steps(src) {
  const lines = src.split('\n'); const out = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- (name|uses|run|if|id):/);
    if (m && (!cur || m[1].length <= cur.indent)) { if (cur) out.push(cur); cur = { indent: m[1].length, start: i + 1, lines: [lines[i]] }; continue; }
    if (cur) {
      if (/^\S/.test(lines[i]) || (/^\s*\S/.test(lines[i]) && lines[i].search(/\S/) < cur.indent)) { out.push(cur); cur = null; continue; }
      cur.lines.push(lines[i]);
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, text: s.lines.join('\n') }));
}
const uploads = (src) => steps(src).filter((s) => /uses:\s*actions\/upload-artifact/.test(s.text));
const ifLine = (s) => { const m = s.text.match(/^\s*-?\s*if:\s*(.+)$/m); return m ? m[1] : ''; };

describe('EQA ios-ci-evidence r1 (static)', () => {
  test('IC0 the iOS workflow set is intact (no workflow removed to pass)', () => {
    const need = ['ios-archive.yml', 'ios-build.yml', 'ios-design-uitest.yml', 'ios-flow-recording.yml', 'ios-screenshots.yml', 'ios-uitest.yml', 'ios-width-capture.yml'];
    expect(need.filter((f) => !IOS.includes(f))).toEqual([]);
  });
  test('IC1 (CI-2) every upload-artifact step in a non-release iOS workflow runs if: always()', () => {
    const bad = [];
    for (const f of IOS) { if (RELEASE_ONLY.has(f)) continue; for (const s of uploads(read(path.join(WF, f)))) if (!/always\(\)/.test(ifLine(s))) bad.push(`${f}:${s.start}`); }
    expect(bad).toEqual([]);
  });
  test('IC2 (CI-2) no upload includes DerivedData; every directory upload excludes it explicitly', () => {
    const bad = [];
    for (const f of IOS) for (const s of uploads(read(path.join(WF, f)))) {
      const paths = [];
      const block = s.text.split('\n'); let inPath = false;
      for (const l of block) {
        if (/^\s*path:\s*\|/.test(l)) { inPath = true; continue; }
        const one = l.match(/^\s*path:\s*(\S.*)$/); if (one) { paths.push(one[1].trim()); inPath = false; continue; }
        if (inPath) { if (/^\s*[a-z-]+:/.test(l)) inPath = false; else if (l.trim()) paths.push(l.trim()); }
      }
      const excl = paths.some((p) => /^!.*DerivedData/.test(p));
      for (const p of paths) {
        if (!p.startsWith('!') && /DerivedData/i.test(p)) bad.push(`${f}:${s.start} uploads ${p}`);
        if (!p.startsWith('!') && /\/$/.test(p) && !excl) bad.push(`${f}:${s.start} directory ${p} without !**/DerivedData/** exclusion`);
      }
    }
    expect(bad).toEqual([]);
  });
  test('IC3 (CI-9) every iOS workflow has a per-head concurrency group with cancel-in-progress', () => {
    const bad = [];
    for (const f of IOS) {
      const src = read(path.join(WF, f));
      const top = src.match(/^concurrency:\s*\n((?:[ \t]+.+\n?)+)/m) || src.match(/^concurrency:\s*(\{.*)$/m);
      if (!top) { bad.push(`${f}: no top-level concurrency`); continue; }
      const body = top[1];
      if (!/github\.head_ref\s*\|\|\s*github\.ref/.test(body)) bad.push(`${f}: group not keyed on head_ref || ref`);
      if (!/cancel-in-progress:\s*true/.test(body)) bad.push(`${f}: cancel-in-progress not true`);
    }
    expect(bad).toEqual([]);
  });
  test('IC4 (CI-8) no iOS artifact name carries a hard-coded build number', () => {
    const bad = [];
    for (const f of IOS) for (const s of uploads(read(path.join(WF, f)))) {
      const n = (s.text.match(/^\s*name:\s*(.+)$/m) || [])[1] || '';
      if (/build-?\d+/i.test(n.replace(/\$\{\{[^}]*\}\}/g, ''))) bad.push(`${f}:${s.start} ${n.trim()}`);
    }
    expect(bad).toEqual([]);
  });
  test('IC5 (CI-1) each iOS UI workflow exports xcresult failure evidence on failure and uploads a <job>-failure artifact always', () => {
    const bad = [];
    for (const f of UI) {
      const src = read(path.join(WF, f)); const st = steps(src);
      const extract = st.filter((s) => /failure\(\)|always\(\)/.test(ifLine(s)) && /xcresulttool|scripts\/[\w.-]*fail[\w.-]*/i.test(s.text));
      const up = uploads(src).filter((s) => /name:\s*\S*-failure\b/.test(s.text) && /always\(\)/.test(ifLine(s)));
      const summary = /GITHUB_STEP_SUMMARY/.test(src) || extract.some((s) => /summary/i.test(s.text));
      if (!extract.length) bad.push(`${f}: no failure-extract step`);
      if (!up.length) bad.push(`${f}: no *-failure upload with if: always()`);
      if (!summary) bad.push(`${f}: no step summary`);
    }
    expect(bad).toEqual([]);
  });
  test('IC6 (CI-1 class) one shared failure-extract script is used by every iOS UI workflow', () => {
    const sets = UI.map((f) => new Set((read(path.join(WF, f)).match(/scripts\/[\w./-]*fail[\w./-]*/gi) || [])));
    const common = [...(sets[0] || [])].filter((s) => sets.every((x) => x.has(s)) && fs.existsSync(path.join(ROOT, s)));
    expect({ shared: common.length > 0 }).toEqual({ shared: true });
  });
  test('IC7 (CI-1) force_fail is a workflow_dispatch input defaulting to false, and the forced test cannot run on a PR', () => {
    const hits = [];
    for (const f of UI) {
      const src = read(path.join(WF, f));
      if (!/force_fail:/.test(src)) continue;
      const def = /force_fail:[\s\S]{0,200}?default:\s*false/.test(src);
      const gated = /inputs\.force_fail\s*==\s*(true|'true')/.test(src) && /github\.event_name\s*==\s*'workflow_dispatch'/.test(src);
      hits.push({ f, def, gated });
    }
    expect({ any: hits.length > 0, allSafe: hits.every((h) => h.def && h.gated) }).toEqual({ any: true, allSafe: true });
  });
  test('IC8 (CI-4) the StoreKit file resolves the Xcode way (from xcshareddata, i.e. scheme.parent.parent) and exists', () => {
    const pj = read(path.join(ROOT, 'project.yml'));
    const prefix = ((pj.match(/^\s*schemePathPrefix:\s*"?([^"\n]*)"?/m) || [])[1] || '../../').trim();
    const refs = [...new Set((pj.match(/storeKitConfiguration:\s*(\S+)/g) || []).map((l) => l.split(/:\s*/)[1]))];
    const base = path.join(ROOT, 'FitMunch.xcodeproj', 'xcshareddata');
    const bad = refs.length ? refs.map((r) => ({ r, at: path.resolve(base, prefix + r) })).filter((x) => !x.at.startsWith(ROOT + path.sep) || !fs.existsSync(x.at)).map((x) => `${x.r} -> ${path.relative(ROOT, x.at)}`) : ['no storeKitConfiguration in project.yml'];
    expect(bad).toEqual([]);
  });
  test('IC9 (CI-4) log-storekit-scheme-path.py resolves identifiers from SCHEME.parent.parent, not SCHEME.parent', () => {
    const py = read(path.join(ROOT, 'scripts', 'log-storekit-scheme-path.py'));
    expect({ parentParent: /SCHEME\.parent\.parent\s*\/\s*identifier/.test(py), oldBase: /\(SCHEME\.parent\s*\/\s*identifier\)/.test(py) }).toEqual({ parentParent: true, oldBase: false });
  });
  test('IC10 (CI-4) every workflow that tests -scheme FitMunchStoreKit gates on STOREFRONT country=AUS', () => {
    const bad = [];
    for (const f of IOS) { const src = read(path.join(WF, f)); if (/-scheme\s+FitMunchStoreKit/.test(src) && !/STOREFRONT country=AUS/.test(src)) bad.push(f); }
    expect(bad).toEqual([]);
  });
});
