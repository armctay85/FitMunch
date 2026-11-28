/**
 * EQA acceptance list, FitMunch Round H (home hero redesign Option 1 + /brand images + home banner).
 * Briefs: /workspace/desk/fitmunch/briefs/round-hero-redesign-plus-brand-brief-2026-11-28.md (controlling) and
 * home-hero-redesign-brief-2026-11-28.md. Owned by Elite QA. LOCKED 2026-11-28 AEDT, proved red against main 503f40dc.
 * EQA also runs a hidden rendered check (390 and 1440, twice) the builder never sees. Every test name starts with its line ID.
 * Commit unchanged at the repo root and add it to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 *
 * Contract: /brand <img> sources are absolute and resolve to real files, and nothing else on /brand changes.
 * Home trial banner keeps the premiumMonthly price span with the period straight after it, and keeps its copy.
 * .fold .hero-app (fm-elite.css and the index.html inline CSS) has no fixed px height, no 176px grid row,
 * no 'center 68%' crop, no blur, opacity below 1 or mask. fm-elite.css ?v= is bumped. H1, CTA, title and meta unchanged.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PUB = path.join(__dirname, 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const BRAND_NORM_SHA = '34891f53550490c76b1b46dbc7c204e0a0d46782eb7142a97195ddbe0c114b04';
const OLD_V = '6ae150199ccb';
const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
function rules(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(',').some((s) => s.trim() === sel)) out.push(m[2]);
  return out;
}
function inlineCss(html) { return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); }
function heroShotRows(css) { return [...css.matchAll(/\.fold \.hero-shot\s*\{([^}]*)\}/g)].map((m) => m[1]); }

describe('EQA Round H: /brand images', () => {
  it('H1 every <img> on /brand has an absolute src (starts with /) that resolves to a file in public/', () => {
    const bad = imgSrcs(read('brand/index.html')).filter((s) => !s.startsWith('/') || !fs.existsSync(path.join(PUB, s.split('?')[0])));
    expect(bad).toEqual([]);
  });
  it('H2 the three previews point at /brand/logo-icon.svg, /brand/logo-social-profile.svg and /brand/logo-wordmark.svg', () => {
    const s = imgSrcs(read('brand/index.html'));
    expect(['/brand/logo-icon.svg', '/brand/logo-social-profile.svg', '/brand/logo-wordmark.svg'].filter((x) => !s.includes(x))).toEqual([]);
  });
  it('H3 nothing else on /brand changed (page equals main once logo srcs are normalised)', () => {
    const n = read('brand/index.html').replace(/src="\/?(?:brand\/)?(logo-[a-z-]+\.svg)"/g, 'src="$1"');
    expect(crypto.createHash('sha256').update(n).digest('hex')).toBe(BRAND_NORM_SHA);
  });
});

describe('EQA Round H: home trial banner', () => {
  const html = read('index.html');
  const bar = (html.match(/<aside class="trial-bar">([\s\S]*?)<\/aside>/) || [])[1] || '';
  it('H4 the banner keeps "14-day trial, then", the premiumMonthly span, "Cancel anytime." and the no-charge sentence', () => {
    const miss = ['14-day trial, then', 'data-fm-price="premiumMonthly"', 'Cancel anytime.', 'Cancel before the trial ends and you are not charged.'].filter((x) => !bar.includes(x));
    expect(miss).toEqual([]);
  });
  it('H5 the period sits straight after the price span (closing tags allowed, no whitespace, not deleted)', () => {
    expect(/data-fm-price="premiumMonthly"[^>]*><\/span>(?:<\/span>)*\./.test(bar)).toBe(true);
  });
});

describe('EQA Round H: hero app screen', () => {
  const sheets = { 'css/fm-elite.css': read('css/fm-elite.css'), 'index.html inline': inlineCss(read('index.html')) };
  it('H6 no .fold .hero-app rule has a fixed px height, center 68%, blur, opacity below 1 or a mask', () => {
    const bad = [];
    for (const [f, css] of Object.entries(sheets)) for (const r of rules(css, '.fold .hero-app')) {
      if (/(^|;|\s)height\s*:\s*\d+px/.test(r)) bad.push(f + ': fixed height');
      if (/center\s+68%/.test(r)) bad.push(f + ': center 68%');
      if (/blur\(/.test(r)) bad.push(f + ': blur');
      const op = r.match(/opacity\s*:\s*([\d.]+)/); if (op && parseFloat(op[1]) < 1) bad.push(f + ': opacity ' + op[1]);
      if (/mask-image\s*:\s*(?!none)/.test(r)) bad.push(f + ': mask');
    }
    expect(bad).toEqual([]);
  });
  it('H7 no .fold .hero-shot grid keeps the fixed 176px row', () => {
    const bad = Object.entries(sheets).filter(([, css]) => heroShotRows(css).some((r) => /grid-template-rows[^;]*176px/.test(r))).map(([f]) => f);
    expect(bad).toEqual([]);
  });
  it('H8 index.html loads fm-elite.css with a bumped ?v=', () => {
    const v = (read('index.html').match(/fm-elite\.css\?v=([a-z0-9]+)/) || [])[1];
    expect(!!v && v !== OLD_V).toBe(true);
  });
  it('H9 H1, CTA, title and meta description are unchanged', () => {
    const h = read('index.html');
    const miss = ['<title>FitMunch: Your body wrote the trolley</title>', 'Start the 14-day trial',
      '<meta name="description" content="The health engine plans a week of meals and training from your body, then writes the shopping list. 14-day free trial. Cancel anytime."/>'].filter((x) => !h.includes(x));
    expect(miss).toEqual([]);
    expect(/<h1[^>]*>[\s\S]*?Your body wrote[\s\S]*?the trolley[\s\S]*?<\/h1>/.test(h)).toBe(true);
  });
});
