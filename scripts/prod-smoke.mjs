#!/usr/bin/env node
/**
 * Production smoke: one Coach message and one receipt scan.
 * Skips with a warning when FM_SMOKE_EMAIL or FM_SMOKE_PASSWORD is unset.
 * Writes a result file and exits 1 on any result other than a Coach 200
 * and a scan of real items or a clean 422 unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { classifyCoach, classifyScan, secretsMissing } = require('./lib/prod-smoke-eval.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = process.env.PROD_SMOKE_RESULT || '/tmp/prod-smoke-result.json';
const base = String(process.env.SMOKE_BASE_URL || 'https://www.fitmunch.com.au').replace(/\/$/, '');
const REQUEST_MS = 90000;

function writeResult(result) {
  fs.writeFileSync(resultPath, JSON.stringify(result));
}

const email = process.env.FM_SMOKE_EMAIL || '';
const password = process.env.FM_SMOKE_PASSWORD || '';
if (secretsMissing(email, password)) {
  const warning = 'FM_SMOKE_EMAIL or FM_SMOKE_PASSWORD is unset. Skipping production smoke.';
  console.warn(warning);
  console.warn(`::warning::${warning}`);
  process.exit(0);
}

async function requestJson(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    return { status: res.status, json };
  } catch {
    return { status: null, json: null };
  } finally {
    clearTimeout(timer);
  }
}

const result = { ok: false, login: null, coach: null, scan: null };

const login = await requestJson(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ email, password }),
});
const token = login.json && typeof login.json.token === 'string' ? login.json.token : '';
if (login.status !== 200 || !login.json || login.json.success !== true || !token) {
  result.login = { ok: false, status: login.status };
  result.coach = { ok: false, status: null, reason: 'skipped after login' };
  result.scan = { ok: false, status: null, reason: 'skipped after login' };
  writeResult(result);
  console.error(`FAIL login status=${login.status == null ? 'none' : login.status}`);
  process.exit(1);
}
result.login = { ok: true, status: 200 };

const coach = await requestJson(`${base}/api/ai/chat`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    intent: 'general',
    messages: [{ role: 'user', content: 'In one short sentence, why drink water with a meal?' }],
  }),
});
result.coach = classifyCoach(coach.status, coach.json);

const imagePath = path.join(root, 'scripts/fixtures/sample-receipt.png');
const image = fs.readFileSync(imagePath);
const form = new FormData();
form.append('receipt', new Blob([image], { type: 'image/png' }), 'sample-receipt.png');
const scan = await requestJson(`${base}/api/receipt/scan`, {
  method: 'POST',
  headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  body: form,
});
result.scan = classifyScan(scan.status, scan.json);
result.ok = !!(result.coach.ok && result.scan.ok);
writeResult(result);

if (result.coach.ok) console.log(`PASS coach status=${result.coach.status}`);
else console.error(`FAIL coach status=${result.coach.status == null ? 'none' : result.coach.status} ${result.coach.reason || ''}`);
if (result.scan.ok) console.log(`PASS scan ${result.scan.kind} status=${result.scan.status}`);
else console.error(`FAIL scan status=${result.scan.status == null ? 'none' : result.scan.status} ${result.scan.reason || ''}`);

if (!result.ok) process.exit(1);
console.log('production smoke finished');
