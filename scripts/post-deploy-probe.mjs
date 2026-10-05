#!/usr/bin/env node
/**
 * After a production deploy, and on a 6 hour schedule, internal paths must 404
 * on fitmunch.com.au and www. Preview deploys do not update those hosts.
 * A Vercel Security Checkpoint 403 is inconclusive: it is not a pass and it is not a fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ship-safety.config.json'), 'utf8'));
const { PERMISSIONS_POLICY } = require(path.join(root, 'lib/security-headers.js'));

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

const LOGIN_HEADER_PATHS = ['/login', '/login?reset=x', '/login.html'];
const PERMISSIONS_POLICY_PATHS = ['/login.html', '/success.html', '/coach-upgrade.html', '/app_manifest.json'];

function headerValue(res, name) {
  return res.headers.get(name) || '';
}

async function probeUrl(url, redirect) {
  const res = await fetch(url, {
    redirect,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      accept: 'text/html,application/json',
    },
  });
  const headerText = [...res.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
  const body = await res.text();
  return { res, headerText, body };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// The apex host is a Vercel domain redirect to www, which carries no app headers.
// A redirect is fine only when it lands on another probed host at the same path and
// query; the headers are then checked on that canonical response instead.
async function probeHeaders(url) {
  const first = await probeUrl(url, 'manual');
  if (!REDIRECT_STATUSES.has(first.res.status)) return { ...first, finalUrl: url };
  const location = first.res.headers.get('location') || '';
  let target;
  try {
    target = new URL(location, url);
  } catch {
    throw new Error(`redirected to an unreadable Location "${location}"`);
  }
  const source = new URL(url);
  // Same-host redirects (for example /login to /login.html) must carry the headers themselves.
  if (target.origin === source.origin) return { ...first, finalUrl: url };
  const probedOrigins = config.probeHosts.map((host) => new URL(host).origin);
  if (
    !probedOrigins.includes(target.origin)
    || target.pathname !== source.pathname
    || target.search !== source.search
  ) {
    throw new Error(`redirected ${first.res.status} to ${target.href}, expected a redirect to another probed host at the same path and query`);
  }
  const second = await probeUrl(target.href, 'manual');
  return { ...second, finalUrl: target.href };
}

for (const host of config.probeHosts) {
  for (const probePath of LOGIN_HEADER_PATHS) {
    const url = `${host}${probePath}`;
    let probed;
    try {
      probed = await probeHeaders(url);
    } catch (err) {
      failures.push(`${url} request failed: ${err.message}`);
      continue;
    }
    if (isCheckpoint(probed.res.status, probed.headerText, probed.body)) {
      inconclusive.push(url);
      console.log(`INCONCLUSIVE ${url} Vercel Security Checkpoint`);
      continue;
    }
    const referrer = headerValue(probed.res, 'referrer-policy');
    if (referrer !== 'no-referrer') {
      failures.push(`${url} Referrer-Policy is ${referrer || 'unset'}, expected no-referrer`);
      continue;
    }
    console.log(`PASS ${url} referrer-policy no-referrer${probed.finalUrl !== url ? ` (via ${probed.finalUrl})` : ''}`);
  }

  for (const probePath of PERMISSIONS_POLICY_PATHS) {
    const url = `${host}${probePath}`;
    let probed;
    try {
      probed = await probeHeaders(url);
    } catch (err) {
      failures.push(`${url} request failed: ${err.message}`);
      continue;
    }
    if (isCheckpoint(probed.res.status, probed.headerText, probed.body)) {
      inconclusive.push(url);
      console.log(`INCONCLUSIVE ${url} Vercel Security Checkpoint`);
      continue;
    }
    const policy = headerValue(probed.res, 'permissions-policy');
    if (policy !== PERMISSIONS_POLICY) {
      failures.push(`${url} Permissions-Policy is ${policy || 'unset'}`);
      continue;
    }
    console.log(`PASS ${url} permissions-policy${probed.finalUrl !== url ? ` (via ${probed.finalUrl})` : ''}`);
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
