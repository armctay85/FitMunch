#!/usr/bin/env node
'use strict';

/**
 * Fail when a TypeScript file sits beside the JavaScript file Vercel would
 * compile over. On 3 Oct 2026 a stale server/storage.ts hid server/storage.js.
 * Login and checkout then 500'd with "effectiveTier is not a function" and
 * "storage.withStripeCustomerLock is not a function".
 *
 * shared/schema.ts is allowlisted. It is the Drizzle source
 * (drizzle.config.ts schema: './shared/schema.ts'). shared/schema.js is the
 * CommonJS module server/storage.js requires at runtime. That pair is
 * intentional. Do not allowlist a file under server/. A server .ts file
 * beside a server .js file is the shadow that took checkout down.
 */

const fs = require('fs');
const path = require('path');

const ALLOWLIST = new Set([
  'shared/schema.ts',
]);

const ROOTS = ['server', 'lib', 'shared', 'api'];
const TS_EXT = new Set(['.ts', '.tsx']);

function repoRoot() {
  if (process.env.FITMUNCH_SHADOW_ROOT) return path.resolve(process.env.FITMUNCH_SHADOW_ROOT);
  return path.resolve(__dirname, '..');
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function findShadows(root) {
  const files = [];
  for (const relRoot of ROOTS) walk(path.join(root, relRoot), files);
  const groups = new Map();
  for (const full of files) {
    const ext = path.extname(full);
    if (!ext) continue;
    const base = full.slice(0, -ext.length);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ ext, rel });
  }
  const problems = [];
  for (const group of groups.values()) {
    const js = group.filter((file) => file.ext === '.js');
    const ts = group.filter((file) => TS_EXT.has(file.ext));
    if (!js.length || !ts.length) continue;
    for (const file of ts) {
      if (ALLOWLIST.has(file.rel)) continue;
      problems.push(`${file.rel} shadows ${js.map((item) => item.rel).join(', ')}`);
    }
  }
  problems.sort();
  return problems;
}

function main() {
  const problems = findShadows(repoRoot());
  if (problems.length) {
    console.error('Shadowed modules: a .ts or .tsx file sits beside a .js file.');
    console.error('Vercel compiles the TypeScript file over the JavaScript file.');
    for (const line of problems) console.error(`  ${line}`);
    console.error('Allowlisted: shared/schema.ts (Drizzle source; see the comment at the top of this script).');
    process.exit(1);
  }
  console.log('No shadowed modules under server/, lib/, shared/, or api/.');
}

if (require.main === module) main();

module.exports = { findShadows, ALLOWLIST, ROOTS };
