#!/usr/bin/env node
/**
 * Ship-safety gate. Fails the process on internal public files, secrets,
 * SQL log leaks, demo data, banned customer copy, or missing security headers.
 * Also loads every public page in headless Chrome at 390px under the CSP.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ship-safety.config.json'), 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function publicFiles() {
  return walk(path.join(root, 'public')).map(rel);
}

function checkPublicAllow() {
  const allowed = new Set(config.publicAllow);
  const deny = (config.denyNames || []).map((source) => new RegExp(source, 'i'));
  for (const file of publicFiles()) {
    const name = file.slice('public/'.length);
    if (!allowed.has(name)) fail(`internal or unlisted file in public/: ${file}`);
    if (deny.some((re) => re.test(name))) fail(`internal file name in public/: ${file}`);
  }
  for (const name of allowed) {
    if (!fs.existsSync(path.join(root, 'public', name))) fail(`allowlist entry missing on disk: public/${name}`);
  }
}

function checkSecrets() {
  const skip = new Set(['node_modules', '.git', 'coverage', 'dist']);
  const patterns = config.secretPatterns.map((source) => new RegExp(source));
  const files = [];
  function collect(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) collect(full);
      else if (/\.(js|mjs|cjs|json|html|yml|yaml|md|txt|css|env|example)$/.test(ent.name) || ent.name.startsWith('.env')) {
        files.push(full);
      }
    }
  }
  collect(root);
  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const re of patterns) {
      if (re.test(text)) fail(`secret pattern ${re.source} in ${rel(file)}`);
      re.lastIndex = 0;
    }
  }
}

function checkFakeData() {
  const patterns = config.fakeData.map((source) => new RegExp(source, 'i'));
  for (const file of publicFiles()) {
    if (file.startsWith('public/fonts/')) continue;
    if (!/\.(html|js|css|json|txt|xml)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const re of patterns) {
      if (re.test(text)) fail(`demo or fake data ${re.source} in ${file}`);
      re.lastIndex = 0;
    }
  }
}

function checkBannedCopy() {
  const until = Date.parse(`${config.deferUntil}T23:59:59Z`);
  const deferOpen = Number.isFinite(until) && Date.now() <= until;
  const deferred = new Map((config.deferred || []).map((row) => [`${row.file}|${row.id}`, row.count]));
  const patterns = config.bannedPatterns.map((row) => ({
    ...row,
    re: new RegExp(row.source, `${row.flags || ''}g`),
  }));
  for (const file of publicFiles()) {
    if (file.startsWith('public/fonts/')) continue;
    if (!/\.(html|js|css|json|txt|xml)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const pattern of patterns) {
      const count = (text.match(pattern.re) || []).length;
      pattern.re.lastIndex = 0;
      if (!count) continue;
      const key = `${file}|${pattern.id}`;
      const allowed = deferOpen ? (deferred.get(key) || 0) : 0;
      if (count > allowed) {
        const why = allowed
          ? `count ${count} is above the deferred ${allowed}`
          : 'no deferral';
        fail(`banned customer copy "${pattern.id}" in ${file} (${why}). ${config.deferReason}`);
      }
    }
  }
}

function checkHeaders() {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const headers = require(path.join(root, 'lib/security-headers.js'));
  const rewrite = (vercel.rewrites || []).find((row) => row.source === '/(.*)' && row.destination === '/api');
  if (!rewrite) fail('vercel.json must keep the rewrite /(.*) -> /api');
  const block = (vercel.headers || []).find((row) => row.source === '/(.*)');
  if (!block) fail('vercel.json is missing headers for /(.*)');
  const map = Object.fromEntries((block ? block.headers : []).map((row) => [row.key, row.value]));
  if (map['Permissions-Policy']) fail('vercel.json must not set Permissions-Policy; Express sets it');
  if (map['Content-Security-Policy'] !== headers.CONTENT_SECURITY_POLICY) {
    fail('vercel.json Content-Security-Policy does not match lib/security-headers.js');
  }
  if (!map['Content-Security-Policy'] || /report-only/i.test(map['Content-Security-Policy'])) {
    fail('Content-Security-Policy must be enforcing');
  }
  if (map['X-Content-Type-Options'] !== headers.CONTENT_TYPE_OPTIONS) fail('missing X-Content-Type-Options: nosniff');
  if (map['Referrer-Policy'] !== headers.REFERRER_POLICY) fail('missing Referrer-Policy');
  if (map['Strict-Transport-Security'] !== headers.HSTS) fail('missing HSTS');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const rawAt = server.indexOf("app.use('/api/stripe/webhook', express.raw");
  const jsonAt = server.indexOf('app.use(express.json(');
  if (rawAt < 0 || jsonAt < 0 || rawAt > jsonAt) {
    fail('POST /api/stripe/webhook raw body parser must stay before the JSON parser');
  }
  if (!server.includes('webhookHandlerErrorLabel(err)')) {
    fail('webhook handler error log must use webhookHandlerErrorLabel');
  }
}

function checkSqlGuard() {
  const jestBin = path.join(root, 'node_modules/jest/bin/jest.js');
  const result = spawnSync(process.execPath, [
    jestBin,
    'test_ship_safety.js',
    '--runInBand',
    '--coverage=false',
  ], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) fail('SQL and receipt-sample guard test failed');
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch { /* next */ }
  }
  return '';
}

function contentType(file) {
  const ext = path.extname(file);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.json': 'application/json',
  }[ext] || 'application/octet-stream';
}

function startStatic(csp) {
  const publicDir = path.join(root, 'public');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(publicDir, pathname));
    if (!file.startsWith(publicDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType(file),
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function checkBrowser() {
  const chrome = findChrome();
  if (!chrome) {
    fail('headless Chrome is not installed');
    return;
  }
  const headers = require(path.join(root, 'lib/security-headers.js'));
  const puppeteer = await import('puppeteer-core');
  const server = await startStatic(headers.CONTENT_SECURITY_POLICY);
  const port = server.address().port;
  const browser = await puppeteer.default.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const pages = publicFiles().filter((file) => file.endsWith('.html'));
    for (const file of pages) {
      const urlPath = `/${file.slice('public/'.length)}`;
      const page = await browser.newPage();
      const violations = [];
      await page.evaluateOnNewDocument(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      page.on('console', (msg) => {
        const text = msg.text();
        if (/refused to/i.test(text) && /content security policy/i.test(text)) violations.push(text);
      });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}${urlPath}`, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
      const fromPage = await page.evaluate(() => window.__cspViolations || []);
      violations.push(...fromPage);
      if (violations.length) {
        fail(`CSP violation on ${urlPath}: ${violations.slice(0, 4).join(' | ')}`);
      }
      const width = await page.evaluate(() => ({
        scroll: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        inner: window.innerWidth,
      }));
      if (width.scroll > width.inner) {
        fail(`${urlPath} is ${width.scroll}px wide at a ${width.inner}px viewport`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

checkPublicAllow();
checkSecrets();
checkFakeData();
checkBannedCopy();
checkHeaders();
if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
checkSqlGuard();
if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
await checkBrowser();
if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
console.log('ship-safety ok');
