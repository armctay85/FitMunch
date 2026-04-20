#!/usr/bin/env node
/**
 * Prints which deploy-related env vars are present (never prints values).
 * Run from repo root: node scripts/check-deploy-prereqs.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (let line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = true;
  }
  return out;
}

const keys = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'VERCEL_TOKEN',
  'ALLOWED_ORIGINS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'AI_FREE_MONTHLY_LIMIT',
];

const fromFile = loadDotEnv(path.join(root, '.env'));
console.log('FitMunch deploy prereqs (set / missing — no values shown)\n');

for (const k of keys) {
  const shell = !!process.env[k];
  const file = !!fromFile[k];
  const status = shell || file ? 'set' : 'MISSING';
  const where = shell && file ? 'env+.env' : shell ? 'env' : file ? '.env' : '';
  console.log(`  ${k.padEnd(22)} ${status.padEnd(8)} ${where}`);
}

console.log('');
