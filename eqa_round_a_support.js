'use strict';
/**
 * EQA Round A support helpers. Owned by Elite QA. LOCKED 2026-11-25 AEDT, with test_eqa_round_a*.js.
 * Commit unchanged. Do not edit, skip, loosen or retry. Not a test file (no testMatch entry needed).
 *
 * makeUsageDb(): an in-memory ai_usage_monthly table for lib/ai-usage.js _setQueryForTests. The REAL
 * lib/ai-usage.js runs on it, so the free counter in these tests is what a customer's counter would be.
 * It understands the SQL shapes lib/ai-usage.js uses on main af82efb (create, insert-upsert +1 or
 * +EXCLUDED.count, smoke capped upsert, SELECT count / SUM(count), UPDATE count = count - N, DELETE prune).
 * Any other statement throws, so a refund written in a new SQL shape fails loudly instead of passing.
 *
 * appGraph(html): splits public/app.html into column-0 function declarations, builds a call graph,
 * and lists API('<literal path>', {...}) calls. Calls on lines that only wire a handler (onclick,
 * addEventListener) are not treated as executed on load.
 */
const fs = require('fs');
const path = require('path');

function makeUsageDb() {
  const rows = new Map();
  const key = (u, m, f) => `${u}\u0001${m}\u0001${f}`;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const query = async (sql, p = []) => {
    const s = norm(sql);
    if (/^CREATE (TABLE|INDEX|UNIQUE INDEX)/i.test(s)) return { rows: [] };
    if (/^DELETE FROM ai_usage_monthly/i.test(s)) return { rows: [], rowCount: 0 };
    let m;
    if ((m = s.match(/^INSERT INTO ai_usage_monthly \(user_id, month, feature, count, updated_at\) VALUES \(\$1, ?\$2, ?\$3, ?(\$4|\d+), ?now\(\)\) ON CONFLICT \(user_id, month, feature\) DO UPDATE SET count = ai_usage_monthly\.count \+ (EXCLUDED\.count|\d+), updated_at = now\(\)( WHERE ai_usage_monthly\.count < \$4)?( RETURNING count)?$/i))) {
      const [u, mo, f] = p; const k = key(u, mo, f);
      const first = m[1] === '$4' ? Number(p[3]) : Number(m[1]);
      const inc = /EXCLUDED/i.test(m[2]) ? first : Number(m[2]);
      if (!rows.has(k)) { rows.set(k, first); return { rows: m[4] ? [{ count: first }] : [], rowCount: 1 }; }
      if (m[3] && !(rows.get(k) < Number(p[3]))) return { rows: [], rowCount: 0 };
      rows.set(k, rows.get(k) + inc);
      return { rows: m[4] ? [{ count: rows.get(k) }] : [], rowCount: 1 };
    }
    if ((m = s.match(/^UPDATE ai_usage_monthly SET count = count - (\d+|\$\d+), updated_at = now\(\) WHERE user_id ?= ?\$1 AND month ?= ?\$2 AND feature ?= ?('([^']+)'|\$3) AND count > 0( RETURNING count)?$/i))) {
      const dec = /^\$/.test(m[1]) ? Number(p[Number(m[1].slice(1)) - 1]) : Number(m[1]);
      const f = m[3] || p[2]; const k = key(p[0], p[1], f);
      if (!rows.has(k) || !(rows.get(k) > 0)) return { rows: [], rowCount: 0 };
      rows.set(k, Math.max(0, rows.get(k) - dec));
      return { rows: m[5] ? [{ count: rows.get(k) }] : [], rowCount: 1 };
    }
    if ((m = s.match(/^SELECT COALESCE\(SUM\(count\),0\)::int AS total FROM ai_usage_monthly WHERE user_id ?= ?\$1 AND month ?= ?\$2$/i))) {
      let t = 0; for (const [k, v] of rows) { const [u, mo] = k.split('\u0001'); if (u === p[0] && mo === p[1]) t += v; }
      return { rows: [{ total: t }] };
    }
    if ((m = s.match(/^SELECT (COALESCE\(count,0\)::int AS total|count) FROM ai_usage_monthly WHERE user_id ?= ?\$1 AND month ?= ?\$2 AND feature ?= ?\$3$/i))) {
      const k = key(p[0], p[1], p[2]);
      if (!rows.has(k)) return { rows: [] };
      return { rows: [/total/i.test(m[1]) ? { total: rows.get(k) } : { count: rows.get(k) }] };
    }
    throw new Error('EQA usage fake: unrecognised SQL: ' + s.slice(0, 160));
  };
  /** Everything this user has used this month (all features), as the free cap reads it. */
  const used = (userId, month) => { let t = 0; for (const [k, v] of rows) { const [u, mo] = k.split('\u0001'); if (u === userId && mo === month) t += v; } return t; };
  return { query, used, rows };
}

/** Index of the paren that closes the one at `open`, skipping strings and template literals. */
function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function appGraph(html) {
  const lines = html.split('\n');
  const fns = new Map();
  let cur = null;
  const HEAD = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  lines.forEach((line, i) => {
    const h = line.match(HEAD);
    if (h) { cur = { name: h[1], start: i, lines: [] }; fns.set(h[1], cur); }
    else if (/^\s*<\/script>/i.test(line)) cur = null;
    if (cur) cur.lines.push(line);
  });
  const names = [...fns.keys()];
  const WIRE = /onclick|addEventListener\s*\(|onkeydown|onchange|onsubmit/i;
  for (const f of fns.values()) {
    f.body = f.lines.join('\n');
    f.calls = new Set(); f.wired = new Set();
    for (const line of f.lines.slice(1)) {
      for (const n of names) {
        if (n === f.name) continue;
        if (new RegExp('(^|[^\\w$.])' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(line)) (WIRE.test(line) ? f.wired : f.calls).add(n);
      }
    }
    f.api = [];
    const re = /\bAPI\(\s*(['"`])([^'"`]+)\1/g; let m;
    while ((m = re.exec(f.body))) {
      const open = f.body.indexOf('(', m.index);
      const close = closeParen(f.body, open);
      const text = f.body.slice(open, close > 0 ? close + 1 : open + 800);
      const lineStart = f.body.lastIndexOf('\n', m.index) + 1;
      const lineText = f.body.slice(lineStart, f.body.indexOf('\n', m.index) === -1 ? undefined : f.body.indexOf('\n', m.index));
      const mm = text.match(/method\s*:\s*['"](\w+)['"]/i);
      f.api.push({ path: m[2], method: mm ? mm[1].toUpperCase() : 'GET', text, wired: WIRE.test(lineText) });
    }
  }
  /** Functions run when `root` runs (handler wiring excluded). */
  const reach = (roots) => {
    const seen = new Set(); const stack = roots.filter((r) => fns.has(r));
    while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const c of fns.get(n).calls) stack.push(c); }
    return seen;
  };
  /** Function names a tap can start: onclick="name(" attributes and handler-wiring lines. */
  const tapRoots = () => {
    const out = new Set();
    const attr = /on(?:click|submit)\s*=\s*"\s*(?:return\s+)?(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g; let m;
    while ((m = attr.exec(html))) out.add(m[1]);
    for (const f of fns.values()) for (const n of f.wired) out.add(n);
    return [...out].filter((n) => fns.has(n));
  };
  return { fns, reach, tapRoots };
}

/** Body for replaying an app.html AI call: typical Home facts plus every literal key: value in the call text. */
function replayBody(text, base) {
  const body = { ...base };
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(true|false|-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*")\s*[,}]/g; let m;
  while ((m = re.exec(text))) {
    if (['method'].includes(m[1])) continue;
    const v = m[2];
    body[m[1]] = v === 'true' ? true : v === 'false' ? false : /^['"]/.test(v) ? v.slice(1, -1) : Number(v);
  }
  return body;
}

function readRepo(rel) { return fs.readFileSync(path.join(__dirname, rel), 'utf8'); }

module.exports = { makeUsageDb, appGraph, closeParen, replayBody, readRepo };
