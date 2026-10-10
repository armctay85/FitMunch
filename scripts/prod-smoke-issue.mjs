#!/usr/bin/env node
/**
 * Create or update the open prod-smoke issue. No assignees and no mentions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildIssueBody, upsertProdSmokeIssue } = require('./lib/prod-smoke-eval.js');

const repo = process.env.GITHUB_REPOSITORY;
const resultPath = process.env.PROD_SMOKE_RESULT || '/tmp/prod-smoke-result.json';
const runUrl = process.env.SMOKE_RUN_URL || '';
if (!repo) {
  console.error('GITHUB_REPOSITORY is unset');
  process.exit(1);
}

let result = null;
try {
  result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
} catch {
  result = null;
}

const title = 'Production smoke failed';
const body = buildIssueBody(result, runUrl);
const bodyFile = path.join(os.tmpdir(), 'prod-smoke-issue-body.txt');
fs.writeFileSync(bodyFile, body);

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const github = {
  async ensureLabel(target) {
    try {
      gh([
        'label', 'create', 'prod-smoke',
        '--repo', target,
        '--color', 'B60205',
        '--description', 'Production Coach or receipt smoke failed',
      ]);
    } catch (err) {
      const stderr = String(err.stderr || '');
      if (!/already exists/i.test(stderr)) throw err;
    }
  },
  async listOpen(target) {
    const raw = gh([
      'issue', 'list',
      '--repo', target,
      '--label', 'prod-smoke',
      '--state', 'open',
      '--limit', '1',
      '--json', 'number',
    ]);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  },
  async update(target, number) {
    gh(['issue', 'edit', String(number), '--repo', target, '--body-file', bodyFile]);
  },
  async create(target, issueTitle, _body, labels) {
    const raw = gh([
      'issue', 'create',
      '--repo', target,
      '--title', issueTitle,
      '--label', labels[0],
      '--body-file', bodyFile,
    ]);
    const match = String(raw).match(/\/issues\/(\d+)/);
    if (!match) throw new Error('could not read the new issue number');
    return { number: Number(match[1]) };
  },
};

const outcome = await upsertProdSmokeIssue({ github, repo, title, body });
console.log(`${outcome.action} prod-smoke issue #${outcome.number}`);
