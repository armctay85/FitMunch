const fs = require('fs');
const os = require('os');
const path = require('path');
const { findShadows } = require('./scripts/check-shadowed-modules');

function writePair(root, relJs, relTs) {
  const jsPath = path.join(root, relJs);
  const tsPath = path.join(root, relTs);
  fs.mkdirSync(path.dirname(jsPath), { recursive: true });
  fs.mkdirSync(path.dirname(tsPath), { recursive: true });
  fs.writeFileSync(jsPath, 'module.exports = {};\n');
  fs.writeFileSync(tsPath, 'export {};\n');
}

describe('shadowed module check', () => {
  test('the repo allows shared/schema.ts beside shared/schema.js and nothing else', () => {
    expect(findShadows(path.join(__dirname))).toEqual([]);
  });

  test('server/storage.ts beside server/storage.js fails, schema.ts does not', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shadow-'));
    writePair(root, 'server/storage.js', 'server/storage.ts');
    writePair(root, 'shared/schema.js', 'shared/schema.ts');
    writePair(root, 'lib/widget.js', 'lib/widget.tsx');
    const problems = findShadows(root);
    expect(problems).toEqual([
      'lib/widget.tsx shadows lib/widget.js',
      'server/storage.ts shadows server/storage.js',
    ]);
  });

  test('the allowlist comment explains shared/schema.ts', () => {
    const src = fs.readFileSync(path.join(__dirname, 'scripts/check-shadowed-modules.js'), 'utf8');
    expect(src).toContain('shared/schema.ts');
    expect(src).toContain('Drizzle');
    expect(src).toContain('Do not allowlist a file under server/');
  });
});
