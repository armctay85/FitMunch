/** Public copy guard: exact GST line, no internal campaign tags on public files. */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const TEXT_EXT = /\.(html|js|json|xml|txt|webmanifest)$/i;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name)) out.push(p);
  }
  return out;
}

describe('public copy hotfix', () => {
  test('terms carries exactly "No GST is charged." and no other GST sentence', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'terms.html'), 'utf8');
    expect(html).toContain('No GST is charged.');
    const gstSentences = html.replace(/<[^>]+>/g, ' ').match(/[^.]*\bGST\b[^.]*\./g) || [];
    expect(gstSentences.map((s) => s.trim())).toEqual(['No GST is charged.']);
  });

  test('no internal campaign tags in any public file', () => {
    const banned = /utm_[a-z]+=[^&"'\s#]*(mrr|sprint|value_first|desk|ladder|sku|qa\b)/i;
    const hits = [];
    for (const f of walk(PUBLIC)) {
      const src = fs.readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (banned.test(line)) hits.push(`${path.relative(__dirname, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
