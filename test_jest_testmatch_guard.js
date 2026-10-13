'use strict';
// Every root test_*.js must run under jest, or be on the NOT_JEST list with a
// reason. Without this, a new test file left out of jest.config.js testMatch
// never runs and CI stays green.
const fs = require('fs');
const path = require('path');
const config = require('./jest.config');

// Root files named test_*.js that are not jest suites.
const NOT_JEST = {
  'test_all_features.js': 'browser-console script (window)',
  'test_api_endpoints.js': 'manual script against a running server',
  'test_app_functions.js': 'browser-console script (window)',
  'test_fixed_components.js': 'browser/node smoke script, no jest suites',
  'test_functions.js': 'browser-console script (window)',
  'test_plan.js': 'broken require("jest"), references removed modules',
};

const rootTests = fs.readdirSync(__dirname).filter((f) => /^test_.*\.js$/.test(f)).sort();
const matched = new Set(config.testMatch.map((p) => p.replace(/^\*\*\//, '')));

describe('jest testMatch guard', () => {
  it('every root test_*.js is in testMatch or on the NOT_JEST list', () => {
    const missing = rootTests.filter((f) => !matched.has(f) && !NOT_JEST[f]);
    expect(missing).toEqual([]);
  });

  it('every NOT_JEST entry exists and is not also in testMatch', () => {
    for (const f of Object.keys(NOT_JEST)) {
      expect([f, fs.existsSync(path.join(__dirname, f))]).toEqual([f, true]);
      expect([f, matched.has(f)]).toEqual([f, false]);
    }
  });

  it('every testMatch entry is a plain file name that exists', () => {
    for (const p of config.testMatch) {
      expect(p).toMatch(/^\*\*\/[\w.-]+\.js$/);
      const f = p.replace(/^\*\*\//, '');
      expect([f, fs.existsSync(path.join(__dirname, f))]).toEqual([f, true]);
    }
  });

  it('includes itself', () => {
    expect(matched.has('test_jest_testmatch_guard.js')).toBe(true);
  });

  it('the jest workflow is read-only and pins actions to commit SHAs', () => {
    const yml = fs.readFileSync(path.join(__dirname, '.github/workflows/jest.yml'), 'utf8');
    expect(yml).toMatch(/^permissions:\n {2}contents: read$/m);
    const uses = yml.match(/uses:\s*\S+/g) || [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(yml).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });
});
