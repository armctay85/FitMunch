#!/usr/bin/env node
/**
 * Push variables from local .env to a Vercel project (no dashboard copy-paste).
 *
 * Prerequisites:
 *   1. Create a token: https://vercel.com/account/tokens  →  VERCEL_TOKEN
 *   2. Keep DATABASE_URL / JWT_SECRET etc. in a local .env (never committed)
 *
 * Usage (pick one):
 *   A) Put in .env: VERCEL_TOKEN, VERCEL_TARGET_PROJECT (optional), DATABASE_URL, JWT_SECRET, …
 *      then: npm run env:vercel
 *   B) Export VERCEL_TOKEN in the shell + keep app secrets in .env
 *
 * VERCEL_TOKEN is never uploaded to the project — only used to call the API.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Only these keys are sent (matches .env.example; avoids leaking random local vars). */
const ALLOW = new Set([
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'ALLOWED_ORIGINS',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'AI_FREE_MONTHLY_LIMIT',
  'INSTAGRAM_ACCESS_TOKEN',
  'IG_BUSINESS_ACCOUNT_ID',
]);

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const envPath = path.join(ROOT, '.env');
  const local = loadDotEnv(envPath);

  const token =
    process.env.VERCEL_TOKEN ||
    local.VERCEL_TOKEN ||
    '';
  const project =
    process.env.VERCEL_TARGET_PROJECT ||
    process.env.VERCEL_PROJECT_NAME ||
    local.VERCEL_TARGET_PROJECT ||
    local.VERCEL_PROJECT_NAME ||
    'fit-munch';
  const teamId =
    process.env.VERCEL_TEAM_ID || local.VERCEL_TEAM_ID || '';

  if (!token) {
    console.error(
      'Missing VERCEL_TOKEN (shell or .env). Create one at https://vercel.com/account/tokens'
    );
    process.exit(1);
  }

  if (Object.keys(local).length === 0) {
    console.error(`No ${envPath} file — create it from .env.example and add secrets.`);
    process.exit(1);
  }

  const toSend = [];
  for (const key of ALLOW) {
    const value = local[key];
    if (value === undefined || value === '') continue;
    toSend.push({ key, value });
  }

  if (toSend.length === 0) {
    console.error(
      'Nothing to push. Add at least DATABASE_URL and JWT_SECRET to your local .env'
    );
    process.exit(1);
  }

  const base = `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env`;
  const q = new URLSearchParams({ upsert: 'true' });
  if (teamId) q.set('teamId', teamId);
  const url = `${base}?${q}`;

  console.log(`Pushing ${toSend.length} variable(s) to Vercel project "${project}"…`);

  for (const { key, value } of toSend) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`Failed ${key}: ${res.status} ${text}`);
      if (res.status === 404 && !teamId) {
        console.error(
          'Hint: if this project is under a team, set VERCEL_TEAM_ID (UUID from Vercel → Team Settings).'
        );
      }
      process.exit(1);
    }
    console.log(`  ok  ${key}`);
  }

  console.log('\nDone. Trigger a redeploy in Vercel (Deployments → ⋯ → Redeploy).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
