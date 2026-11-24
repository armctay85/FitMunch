'use strict';
/**
 * EQA acceptance list, FitMunch round 7, M6: no JWT secret fallback anywhere in shipped code. Owned by Elite QA. LOCKED 24 Nov 2026 AEDT.
 * Static scan of every shipped .js/.cjs/.mjs/.html file (tests, node_modules, coverage and build output excluded).
 * Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SKIP_DIR = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', '.next', '.vercel', 'ios', 'android']);
const isTest = (f) => /(^|[\\/])(test_[^\\/]*|[^\\/]*\.(test|spec)\.[cm]?js)$/.test(f) || /[\\/](__tests__|tests?)[\\/]/.test(f);
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); continue; }
    if (/\.(c|m)?js$|\.html$/.test(e.name) && !isTest(path.relative(ROOT, p))) out.push(p);
  }
  return out;
}
const FILES = walk(ROOT, []);
const FALLBACK = [
  /JWT_SECRET\s*(\|\||\?\?)/,                       // process.env.JWT_SECRET || 'x'  /  ?? 'x'
  /JWT_SECRET\s*\?(?!\.)[^:\n]*:/,                   // JWT_SECRET ? JWT_SECRET : 'x'
  /fitmunch-secret-key-change-in-production/i,      // the known public fallback string
  /(\|\||\?\?)\s*process\.env\.JWT_SECRET/,          // 'x' || process.env.JWT_SECRET (wrong order, still a literal)
];
function hits() {
  const out = [];
  for (const f of FILES) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (FALLBACK.some((re) => re.test(l))) out.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  }
  return out;
}
describe('EQA r7, M6 no JWT secret fallback', () => {
  test('R7-M6a the scan covers the files that verify tokens (server.js, meal-planner.js, api_server.js, lib/session-token.js)', () => {
    const rel = FILES.map((f) => path.relative(ROOT, f));
    expect(['server.js', 'meal-planner.js', 'api_server.js', path.join('lib', 'session-token.js')].filter((f) => !rel.includes(f))).toEqual([]);
  });
  test('R7-M6b no shipped file falls back to a literal when JWT_SECRET is unset (server.js:815, meal-planner.js:31 and any other)', () => {
    expect(hits()).toEqual([]);
  });
  test('R7-M6c lib/session-token.js rejects a token when the secret is empty or missing', () => {
    const st = require('./lib/session-token');
    const sign = st.signSessionToken || st.sign;
    let forged = null;
    const crypto = require('crypto');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    for (const secret of ['fitmunch-secret-key-change-in-production', '']) {
      const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ userId: '11111111-1111-4111-8111-111111111111', iat: Math.floor(Date.now() / 1000) });
      forged = `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
      for (const s of [undefined, null, '']) {
        let ok = false; try { ok = !!st.verifySessionToken(forged, s); } catch (_) { ok = false; }
        expect({ secret: secret || '(empty)', verifyWith: String(s), accepted: ok }).toEqual({ secret: secret || '(empty)', verifyWith: String(s), accepted: false });
      }
    }
    expect(typeof sign === 'function' || sign === undefined).toBe(true);
  });
});
