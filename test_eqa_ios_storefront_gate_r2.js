'use strict';
/**
 * EQA locked acceptance, FitMunch ios-ci-evidence r2, CI-4 (class B: StoreKit UI tests prove AUD inside the test;
 * class F: no test on the green path asserts nothing). Owned by Elite QA. LOCKED 24 Nov 2026 AEDT. Static.
 * Runtime proof (GATE_PRICE with and without -UseLocalStoreKit in one run, broken-session fail under 2 min) is read by
 * Wilson or Ops Lead from the CI run. This file only proves the shape cannot fake green.
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GATE = path.join(__dirname, 'FitMunchUITests', 'StorefrontGateUITests.swift');
const FORCE = path.join(__dirname, 'FitMunchUITests', 'ForceFailEvidenceUITests.swift');
const PM = path.join(__dirname, 'FitMunch', 'Utilities', 'PremiumManager.swift');
const R1_LOCK = path.join(__dirname, 'test_eqa_ios_ci_evidence.js');
const R1_SHA = '94ed066495908f07657e0196358084d7c7b8c2fa453a3a4ba172a3dbdbe5fd03';

const src = (f) => fs.readFileSync(f, 'utf8');
// Strip // and /* */ comments so a commented-out assertion never counts.
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1');

function funcs(text) {
  const out = [];
  const re = /func\s+([A-Za-z0-9_]+)\s*\([^)]*\)[^{]*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ name: m[1], body: text.slice(re.lastIndex, i - 1), start: m.index });
  }
  return out;
}
const ASSERT = /\bXCT(Assert\w*|Fail|Unwrap)\s*\(/;
function asserts(fn, all) {
  if (ASSERT.test(fn.body)) return true;
  return all.filter((h) => !/^test/.test(h.name) && ASSERT.test(h.body))
    .some((h) => new RegExp(`\\b${h.name}\\s*\\(`).test(fn.body));
}
const assertLines = (text) => text.split('\n').filter((l) => ASSERT.test(l));

describe('EQA ios r2 CI-4: the storefront gate proves AUD inside the test', () => {
  test('G0 the gate test file and class exist (nothing deleted or renamed to pass)', () => {
    expect(fs.existsSync(GATE)).toBe(true);
    expect(code(GATE)).toMatch(/class\s+StorefrontGateUITests\s*:\s*XCTestCase/);
  });

  test('G1 it imports StoreKitTest and creates an SKTestSession from FitMunchProducts.storekit', () => {
    const t = code(GATE);
    expect(t).toMatch(/^\s*import\s+StoreKitTest\b/m);
    expect(t).toMatch(/SKTestSession\s*\(\s*contentsOf:/);
    expect(t).toMatch(/FitMunchProducts/);
  });

  test('G2 the session is set to AUS and created before the first app launch, in file order', () => {
    const t = code(GATE);
    const session = t.search(/SKTestSession\s*\(\s*contentsOf:/);
    const aus = t.search(/\.storefront\s*=\s*"AUS"/);
    const launch = t.search(/\.launch\s*\(\s*\)/);
    expect(session >= 0 && aus >= 0 && launch >= 0).toBe(true);
    expect(session < launch && aus < launch).toBe(true);
  });

  test('G3 the session is held for the test lifetime (stored property, not a dropped local)', () => {
    expect(code(GATE)).toMatch(/(private\s+)?var\s+\w+\s*:\s*SKTestSession\??/);
  });

  test('G4 it asserts the AUD prices: both 19.99 and 149.99 appear in XCTAssert lines', () => {
    const lines = assertLines(code(GATE)).join('\n');
    expect(lines).toMatch(/19\.99/);
    expect(lines).toMatch(/149\.99/);
  });

  test('G5 it asserts NOT the US prices: 12.99 in a negative assertion', () => {
    const neg = assertLines(code(GATE)).filter((l) => /XCTAssert(False|NotEqual|Nil)\b/.test(l) || /!\s*\w+(\.label)?\.contains/.test(l));
    expect(neg.some((l) => /12\.99/.test(l))).toBe(true);
  });

  test('G6 the 99.99 check cannot match 149.99 (no bare contains("99.99"); it is anchored)', () => {
    const t = code(GATE);
    expect(/contains\(\s*"99\.99"\s*\)/.test(t)).toBe(false);
    const neg = assertLines(t).filter((l) => /99\\{0,2}\.99/.test(l));
    expect(neg.some((l) => /\$99\.99|\(\?<!|\\\\b99/.test(l))).toBe(true);
  });

  test('G7 it runs with and without -UseLocalStoreKit: at least two test methods, one with the flag and one without', () => {
    const all = funcs(code(GATE));
    const tests = all.filter((f) => /^test/.test(f.name));
    expect(tests.length >= 2).toBe(true);
    const flag = (f) => /-UseLocalStoreKit/.test(f.body) || /(useLocalStoreKit|localStoreKit|withLocal\w*)\s*:\s*true/i.test(f.body);
    expect(tests.some(flag)).toBe(true);
    expect(tests.some((f) => !flag(f))).toBe(true);
  });

  test('G8 class F: every test method in the gate and force_fail files asserts (no print-only test)', () => {
    for (const f of [GATE, FORCE]) {
      const all = funcs(code(f));
      const tests = all.filter((x) => /^test/.test(x.name));
      expect(tests.length >= 1).toBe(true);
      const empty = tests.filter((x) => !asserts(x, all)).map((x) => `${path.basename(f)}:${x.name}`);
      expect(empty).toEqual([]);
    }
  });

  test('G9 no skip path to green in the gate (no XCTSkip, no throw XCTSkip)', () => {
    expect(/XCTSkip/.test(code(GATE))).toBe(false);
  });

  test('G10 PremiumManager logs STOREFRONT through Logger or os_log with privacy .public, not print()', () => {
    const t = code(PM);
    expect(/print\(\s*"STOREFRONT/.test(t)).toBe(false);
    expect(t).toMatch(/(Logger|os_log|\.notice|\.info|\.error|\.log)\s*\([^\n]*STOREFRONT country=[^\n]*privacy:\s*\.public/);
  });

  test('G11 r1 locked test test_eqa_ios_ci_evidence.js is byte-unchanged', () => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(R1_LOCK)).digest('hex')).toBe(R1_SHA);
  });
});
