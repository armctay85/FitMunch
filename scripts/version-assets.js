'use strict';

const fs = require('fs');
const { stampHtml, stampTargets } = require('../lib/asset-version');

function drifted() {
  const out = [];
  for (const file of stampTargets()) {
    const before = fs.readFileSync(file, 'utf8');
    const after = stampHtml(before);
    if (after !== before) out.push({ file, after });
  }
  return out;
}

if (require.main === module) {
  const arg = process.argv[2];
  const changes = drifted();
  if (arg === '--write') {
    for (const row of changes) fs.writeFileSync(row.file, row.after);
    console.log(`stamped ${changes.length} html file(s)`);
  } else if (arg === '--check') {
    if (changes.length) {
      console.error('asset urls are unversioned. Run: node scripts/version-assets.js --write');
      for (const row of changes) console.error(row.file);
      process.exit(1);
    }
  } else {
    for (const row of changes) console.log(row.file);
  }
}

module.exports = { drifted };
