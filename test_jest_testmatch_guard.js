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

  it('every workflow is least-privilege, SHA-pinned, and cannot approve PRs', () => {
    const dir = path.join(__dirname, '.github/workflows');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yml')).sort();
    expect(files.length).toBeGreaterThan(0);
    const issueWriters = {
      'prod-smoke.yml': ['prod-smoke-issue'],
      'ai-credit-check.yml': ['check'],
    };
    const signingSecrets = [
      'CERTIFICATES_P12',
      'CERTIFICATES_PASSWORD',
      'KEYCHAIN_PASSWORD',
      'PROVISIONING_PROFILE',
      'PROVISIONING_PROFILE_NAME',
      'ASC_USERNAME',
      'ASC_PASSWORD',
    ];
    const approve = /pulls\/[^\s'"]+\/reviews|gh\s+pr\s+review|createReview|--approve\b|event:\s*['"]?APPROVE\b/;

    for (const name of files) {
      const yml = fs.readFileSync(path.join(dir, name), 'utf8');
      const jobsAt = yml.indexOf('\njobs:');
      expect(jobsAt).toBeGreaterThan(0);
      const head = yml.slice(0, jobsAt);
      expect(head).toMatch(/^permissions:\n {2}contents: read\n/m);
      expect(head).not.toMatch(/:\s*write\b/);

      const uses = yml.match(/uses:\s*\S+/g) || [];
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect([name, u]).toEqual([name, expect.stringMatching(/@[0-9a-f]{40}$/)]);
      expect(yml).not.toMatch(approve);

      const lines = yml.split('\n');
      const jobsLine = lines.findIndex((line) => line === 'jobs:');
      const jobPerms = {};
      let job = null;
      for (let i = jobsLine + 1; i < lines.length; i++) {
        const jobMatch = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
        if (jobMatch) job = jobMatch[1];
        if (!/^ {4}permissions:\s*$/.test(lines[i])) continue;
        const grants = {};
        for (let j = i + 1; j < lines.length; j++) {
          const grant = lines[j].match(/^ {6}([A-Za-z-]+):\s*(\S+)\s*$/);
          if (!grant) break;
          grants[grant[1]] = grant[2];
        }
        jobPerms[job] = grants;
      }

      for (const [jobName, grants] of Object.entries(jobPerms)) {
        const keys = Object.keys(grants).sort();
        expect(grants.contents).toBe('read');
        const writesIssues = (issueWriters[name] || []).includes(jobName);
        if (writesIssues) {
          expect(keys).toEqual(['contents', 'issues']);
          expect(grants.issues).toBe('write');
        } else {
          expect(keys).toEqual(['contents']);
        }
      }
      for (const jobName of issueWriters[name] || []) {
        expect(jobPerms[jobName]).toEqual({ contents: 'read', issues: 'write' });
      }

      for (const secret of signingSecrets) {
        if (name === 'ios-archive.yml') {
          expect(yml).toContain(secret);
        } else {
          expect(yml).not.toContain(secret);
        }
      }
    }

    const archive = fs.readFileSync(path.join(dir, 'ios-archive.yml'), 'utf8');
    const archiveJobs = archive.slice(archive.indexOf('\njobs:\n'));
    const jobNames = [...archiveJobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
    expect(jobNames).toEqual(['archive']);
  });
});
