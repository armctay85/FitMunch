#!/usr/bin/env node
/**
 * Production / staging asset smoke check.
 * Usage: FITMUNCH_SMOKE_URL=https://fitmunch.com.au node scripts/smoke-assets.mjs
 *
 * Exits 1 only if a critical URL is missing or unreachable.
 * Warns (exit 0) on optional paths such as modular JS until the latest deploy is live.
 */

const BASE = (process.env.FITMUNCH_SMOKE_URL || 'https://fitmunch.com.au').replace(
  /\/$/,
  ''
);

const checks = [
  { path: '/', label: 'home', critical: true },
  {
    path: '/api/health',
    label: 'api-health',
    critical: true,
    expectJson: { status: 'ok', service: 'fitmunch' },
  },
  { path: '/login.html', label: 'login', critical: true },
  { path: '/app.html', label: 'app', critical: true },
  { path: '/script.js', label: 'script.js', critical: true },
  {
    path: '/js/fm-storage.js',
    label: 'fm-storage.js',
    critical: false,
    hint: '404 until server has latest public/js (bundled fallback still in script.js)',
  },
  {
    path: '/js/fm-identity.js',
    label: 'fm-identity.js',
    critical: false,
    hint: '404 until latest deploy',
  },
  {
    path: '/js/fm-api.js',
    label: 'fm-api.js',
    critical: false,
    hint: 'optional client API helper',
  },
  {
    path: '/css/fm-tokens.css',
    label: 'fm-tokens.css',
    critical: false,
    hint: '404 until latest deploy',
  },
  {
    path: '/.well-known/security.txt',
    label: 'security.txt',
    critical: false,
    hint: 'optional RFC 9116',
  },
];

async function main() {
  let failed = false;
  console.log(`FitMunch smoke: ${BASE}\n`);

  for (const { path, label, critical, hint, expectJson } of checks) {
    const url = `${BASE}${path}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'fitmunch-smoke-assets/1.0' },
      });
      if (res.ok) {
        if (expectJson) {
          try {
            const body = await res.json();
            const bad = Object.entries(expectJson).some(
              ([k, v]) => body[k] !== v
            );
            if (bad) {
              console.error(`FAIL [${label}] JSON mismatch ${path}`, body);
              failed = true;
              continue;
            }
          } catch {
            console.error(`FAIL [${label}] not JSON ${path}`);
            failed = true;
            continue;
          }
        }
        console.log(`OK   [${label}] ${res.status} ${path}`);
      } else if (critical) {
        console.error(`FAIL [${label}] ${res.status} ${path}`);
        failed = true;
      } else {
        console.warn(`WARN [${label}] ${res.status} ${path}${hint ? ` — ${hint}` : ''}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (critical) {
        console.error(`FAIL [${label}] ${path} — ${msg}`);
        failed = true;
      } else {
        console.warn(`WARN [${label}] ${path} — ${msg}`);
      }
    }
  }

  console.log('');
  process.exit(failed ? 1 : 0);
}

main();
