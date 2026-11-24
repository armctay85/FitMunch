'use strict';
// EQA locked launch-log check, FitMunch iOS build 12 (row OF2). Owned by Elite QA. FINAL 21 Nov 2026.
// Usage: node eqa_ios_b12_launchlog.js <launch log> [more logs]. Read-only, no deps. Every log must be a fresh sim or device launch that reached the paywall.
const fs = require('fs');
const BAD = [/No packages could be found for offering/i, /Could not find products with identifiers/i, /subwise_offering/i, /com\.fitmunch\.ios\./i, /Offerings error/i];
let fail = 0;
for (const f of process.argv.slice(2)) {
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch (_) { console.log(`FAIL OF2 ${f} :: missing`); fail++; continue; }
  const lines = t.split('\n'); const hits = [];
  lines.forEach((l, i) => { if (BAD.some((r) => r.test(l))) hits.push(`${i + 1}`); });
  const offeringSeen = /offering/i.test(t);
  const ok = hits.length === 0 && offeringSeen;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} OF2 ${f} :: ${hits.length ? 'bad lines ' + hits.join(',') : (offeringSeen ? 'clean' : 'no offering load in log, launch did not reach paywall')}`);
}
console.log(`SUMMARY fail=${fail}`);
