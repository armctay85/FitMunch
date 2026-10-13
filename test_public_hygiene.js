/** public/ ships to every visitor: no internal review notes, and the homepage phone rules stay below 860px. */
const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(html?|js|mjs|css|txt|json|xml|svg|md|webmanifest)$/i.test(e.name) ? [p] : [];
  });
}

// "agent" alone, but not the legitimate User-agent / userAgent.
const BANNED = /elite\s*qa|\bqa\s*r\d|maximus|wilson|droop|grok|openclaw|(?<!user[-_ ]?)\bagents?\b/i;

describe('public/ hygiene', () => {
  it('has no internal review, desk or agent references', () => {
    const hits = [];
    for (const f of walk(path.join(__dirname, 'public'))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${path.relative(__dirname, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it('the guard catches the patterns it is meant to', () => {
    for (const s of ['// Elite QA r3 M2', 'QA r2 fix', 'per Maximus', 'Wilson asked', 'grokBot', 'OpenClaw', 'the agent']) {
      expect(BANNED.test(s)).toBe(true);
    }
    for (const s of ['User-agent: *', 'navigator.userAgent', 'const ua = userAgent;']) {
      expect(BANNED.test(s)).toBe(false);
    }
  });
});

describe('homepage hero breakpoints', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  it('phone hero rules use max-width:859px so they never overlap min-width:860px', () => {
    const m = html.match(/@media\(max-width:(\d+)px\)\{\s*\/\*[^*]*fold[\s\S]*?\.fold\{min-height:auto\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('859');
    expect(html).toContain('@media(min-width:860px){');
    expect(html).not.toMatch(/@media\(max-width:860px\)/);
  });
});
