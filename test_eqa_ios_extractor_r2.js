'use strict';
/**
 * EQA locked acceptance, FitMunch ios-ci-evidence r2, CI-1 (class A: evidence comes only from the xcresult export).
 * Owned by Elite QA. LOCKED 24 Nov 2026 AEDT. Behavioural, hermetic: runs scripts/extract-ios-failure.py with python3
 * against a fixture, with a stub `xcrun` first on PATH that "exports" a real PNG and a real element tree.
 * Rules: hierarchy.txt is the exported element tree and never the xcodebuild log or app-stdout.log (no picking its own
 * outputs); no tree means no fake tree; no PNG means a non-zero exit; the step summary carries the xcresult assertion;
 * the output stays under 20 MB; DerivedData is never used.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry. Needs python3 (ubuntu-latest has it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'scripts', 'extract-ios-failure.py');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const TREE = [
  'Attachment: EQA element tree',
  "Application, pid: 4242, label: 'FitMunch'",
  "  Window, identifier: 'eqa-tree-window'",
  "    Button, identifier: 'paywall-close', label: 'Close'",
  "    StaticText, identifier: 'paywall-price-fitmunch_annual', label: 'A$149.99/year'",
].join('\n');
const LOG_MARK = 'EQA_XCODEBUILD_LOG_MARKER';
const XCRESULT_ASSERT = 'XCTAssertTrue failed - EQA_XCRESULT_ASSERTION paywall price';

function stubXcrun(dir, { tree, png }) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const py = [
    '#!/usr/bin/env python3',
    'import sys, os, json',
    'a = sys.argv[1:]',
    'if "export" in a and "--output-path" in a:',
    '    out = a[a.index("--output-path") + 1]',
    '    os.makedirs(out, exist_ok=True)',
    png ? `    open(os.path.join(out, "Screenshot_EQA.png"), "wb").write(bytes.fromhex(${JSON.stringify(PNG.toString('hex'))}))` : '    pass',
    tree ? `    open(os.path.join(out, "ElementTree_EQA.txt"), "w").write(${JSON.stringify(TREE)})` : '    pass',
    '    sys.exit(0)',
    'if "get" in a and "tests" in a:',
    `    print(json.dumps({"testNodes": [{"name": "testEQA", "result": "Failed", "children": [{"nodeType": "Failure Message", "name": ${JSON.stringify(XCRESULT_ASSERT)}}]}]}))`,
    '    sys.exit(0)',
    'if "get" in a and "summary" in a:',
    '    print(json.dumps({"result": "Failed", "failedTests": 1}))',
    '    sys.exit(0)',
    'sys.exit(1)',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'xcrun'), py, { mode: 0o755 });
  return bin;
}

const MADE = [];
function fixture(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqa-extract-'));
  MADE.push(dir);
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'Run.xcresult'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Run.xcresult', 'Info.plist'), '<plist/>');
  // A big xcodebuild log that LOOKS like a tree (identifier, Button, Application) and has no XCTAssert line.
  const row = `${LOG_MARK} Test Case '-[FitMunchUITests.Gate testEQA]' Button identifier Application\n`;
  fs.writeFileSync(path.join(src, 'xcodebuild.log'), row.repeat(opts.bigLog ? 300000 : 4000));
  // DerivedData decoys: never used.
  const dd = path.join(src, 'DerivedData', 'Logs', 'Test');
  fs.mkdirSync(dd, { recursive: true });
  fs.writeFileSync(path.join(dd, 'decoy.png'), Buffer.concat([PNG, Buffer.from('EQA_DERIVED_DECOY')]));
  fs.writeFileSync(path.join(dd, 'decoy-tree.txt'), "EQA_DERIVED_DECOY Application identifier Button\n".repeat(50));
  const out = path.join(dir, 'out');
  const bin = stubXcrun(dir, opts);
  const r = spawnSync('python3', [SCRIPT, '--from', src, '--out', out], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: '' },
    encoding: 'utf8',
    timeout: 120000,
  });
  const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const size = fs.existsSync(out)
    ? fs.readdirSync(out, { recursive: true }).map((f) => path.join(out, String(f)))
      .filter((f) => fs.statSync(f).isFile()).reduce((n, f) => n + fs.statSync(f).size, 0)
    : 0;
  return { r, out, read, size, dir };
}

describe('EQA ios r2 CI-1: extract-ios-failure.py evidence is real', () => {
  if (typeof jest === 'object' && typeof jest.setTimeout === 'function') jest.setTimeout(180000);

  afterAll(() => {
    for (const d of MADE) fs.rmSync(d, { recursive: true, force: true });
  });

  test('E0 python3 and the script exist (nothing deleted to pass)', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(spawnSync('python3', ['--version']).status).toBe(0);
  });

  test('E1 hierarchy.txt is the exported element tree, not app-stdout.log or the xcodebuild log', () => {
    const f = fixture({ tree: true, png: true });
    expect(f.r.status).toBe(0);
    const h = f.read('hierarchy.txt');
    const s = f.read('app-stdout.log');
    expect(h === null).toBe(false);
    expect(h === s).toBe(false);
    expect(h).toContain("identifier: 'paywall-close'");
    expect(h.includes(LOG_MARK)).toBe(false);
    expect(h.includes('EQA_DERIVED_DECOY')).toBe(false);
  });

  test('E2 a second run into the same out dir still never picks its own outputs', () => {
    const f = fixture({ tree: true, png: true });
    const again = spawnSync('python3', [SCRIPT, '--from', path.join(f.dir, 'src'), '--out', f.out], {
      env: { ...process.env, PATH: `${path.join(f.dir, 'bin')}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: '' },
      encoding: 'utf8',
    });
    expect(again.status).toBe(0);
    const h = f.read('hierarchy.txt');
    expect(h.includes(LOG_MARK)).toBe(false);
    expect(h).toContain("identifier: 'paywall-close'");
  });

  test('E3 no exported tree: hierarchy.txt holds no log text (no fake tree)', () => {
    const f = fixture({ tree: false, png: true });
    const h = f.read('hierarchy.txt') || '';
    expect(h.includes(LOG_MARK)).toBe(false);
    expect(h === f.read('app-stdout.log')).toBe(false);
  });

  test('E4 no PNG exported: the script exits non-zero (fails closed) and uses no DerivedData decoy', () => {
    const f = fixture({ tree: true, png: false });
    expect(f.r.status === 0).toBe(false);
    const shot = path.join(f.out, 'screenshot.png');
    if (fs.existsSync(shot)) expect(fs.readFileSync(shot).includes(Buffer.from('EQA_DERIVED_DECOY'))).toBe(false);
  });

  test('E5 screenshot.png is the exported PNG, not a DerivedData decoy', () => {
    const f = fixture({ tree: true, png: true });
    const shot = fs.readFileSync(path.join(f.out, 'screenshot.png'));
    expect(shot.subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true);
    expect(shot.includes(Buffer.from('EQA_DERIVED_DECOY'))).toBe(false);
  });

  test('E6 the step summary carries the xcresult assertion and the real tree line', () => {
    const f = fixture({ tree: true, png: true });
    const md = f.read('step-summary.md');
    expect(md).toContain('EQA_XCRESULT_ASSERTION');
    expect(md).toContain("identifier: 'paywall-close'");
    expect(md.includes('No assertion line was parsed')).toBe(false);
  });

  test('E7 a 25 MB xcodebuild log still gives an output under 20 MB with the tree intact', () => {
    const f = fixture({ tree: true, png: true, bigLog: true });
    expect(f.r.status).toBe(0);
    expect(f.size < 20 * 1024 * 1024).toBe(true);
    expect(f.read('hierarchy.txt')).toContain("identifier: 'paywall-close'");
  });
});
