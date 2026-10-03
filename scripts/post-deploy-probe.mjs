#!/usr/bin/env node
/**
 * After a production deploy, and on a 6 hour schedule, internal paths must 404
 * on fitmunch.com.au and www. Preview deploys do not update those hosts.
 * A Vercel Security Checkpoint 403 is inconclusive: it is not a pass and it is not a fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ship-safety.config.json'), 'utf8'));

function isCheckpoint(status, headerText, body) {
  if (status !== 403) return false;
  const joined = `${headerText}\n${body}`.toLowerCase();
  return joined.includes('vercel security checkpoint')
    || joined.includes('security checkpoint')
    || joined.includes('x-vercel-mitigated')
    || joined.includes('challenge-platform');
}

const failures = [];
const inconclusive = [];

for (const host of config.probeHosts) {
  for (const probePath of config.probePaths) {
    const url = `${host}${probePath}`;
    let res;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          accept: 'text/html,application/json',
        },
      });
    } catch (err) {
      failures.push(`${url} request failed: ${err.message}`);
      continue;
    }
    const headerText = [...res.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
    const body = await res.text();
    if (isCheckpoint(res.status, headerText, body)) {
      inconclusive.push(url);
      console.log(`INCONCLUSIVE ${url} Vercel Security Checkpoint`);
      continue;
    }
    if (res.status === 404) {
      console.log(`PASS ${url} 404`);
      continue;
    }
    failures.push(`${url} returned ${res.status}, expected 404`);
  }
}

if (inconclusive.length) {
  console.log(`::warning::${inconclusive.length} probe responses were a Vercel Security Checkpoint. Inconclusive, not a pass or a fail.`);
}
if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
console.log(`post-deploy probe finished. inconclusive=${inconclusive.length}`);
