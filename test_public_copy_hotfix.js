/** Public copy guard: the only GST sentence is "No GST is charged.", and no internal campaign tags or words ship. */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const TEXT_EXT = /\.(html|js|mjs|json|xml|txt|webmanifest|css|svg)$/i;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name)) out.push(p);
  }
  return out;
}

function decodeAll(s) {
  let prev;
  let cur = s.replace(/&amp;/gi, '&');
  for (let i = 0; i < 3 && cur !== prev; i += 1) {
    prev = cur;
    try { cur = decodeURIComponent(cur); } catch (_) { cur = cur.replace(/%([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))); }
  }
  return cur;
}

function visibleText(src) {
  return src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
}

const FILES = walk(PUBLIC);
const rel = (f) => path.relative(__dirname, f);

describe('public copy hotfix', () => {
  test('terms carries exactly "No GST is charged."', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'terms.html'), 'utf8');
    expect(visibleText(html)).toContain('No GST is charged.');
  });

  test('the only GST sentence in any public file is "No GST is charged."', () => {
    const hits = [];
    for (const f of FILES) {
      const raw = fs.readFileSync(f, 'utf8').replace(/gstatic/gi, '');
      const text = /\.html$/i.test(f) ? visibleText(raw) : raw;
      const sentences = text.match(/[^.!?<>"'`]*\bGST\b[^.!?<>"'`]*[.!?]?/g) || [];
      for (const s of sentences) {
        if (s.trim() !== 'No GST is charged.') hits.push(`${rel(f)}: ${s.trim().slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('no internal campaign tags in any public link, after decoding', () => {
    const banned = /utm_[a-z]+=[^&"'\s#)]*(mrr|sprint|value_first|desk|ladder|sku|\bqa\b)/i;
    const hits = [];
    for (const f of FILES) {
      decodeAll(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        if (banned.test(line)) hits.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test('no internal words in visible page text', () => {
    const words = /\b(MRRs?|mrr_\w+|sprint|value[_ ]first|OpenClaw|Mission Control|Pty Ltd|SKU ladder)\b/i;
    const hits = [];
    for (const f of FILES.filter((x) => /\.html$/i.test(x))) {
      const m = visibleText(fs.readFileSync(f, 'utf8')).match(words);
      if (m) hits.push(`${rel(f)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
