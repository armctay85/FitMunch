/**
 * EQA acceptance list, FitMunch Round E (brand and customer-copy cleanup).
 * Brief: /workspace/desk/fitmunch/briefs/round-e-brand-cleanup-brief-2026-11-26.md (items 1-7).
 * Owned by Elite QA. LOCKED 2026-11-26 AEDT, written and proved red against main d0b08328.
 * EQA also runs a hidden set and a rendered check (390 and 1440) the builder never sees. Every test name starts with its line ID.
 * Commit unchanged at the repo root (with eqa_round_e_support.js) and add this file to jest.config.js testMatch.
 * Do not edit, skip, loosen or retry.
 *
 * Contract these tests lock:
 *  - Logo files are copied byte-for-byte from the 18 Nov pack (hashes in the support file). Root /favicon.ico,
 *    /favicon.svg and /apple-touch-icon.png exist. Every icon <link> on every page resolves to a pack file.
 *    /assets/logo.svg is a full-colour or reversed pack mark (the nav is dark). A brand <img> under 32 px uses a small mark.
 *    No fmTile or fmCrown, and no copy of the old logo (sha de3fd111...) anywhere in public/.
 *    public/app_manifest.json icons resolve to pack icon-192, icon-512 and icon-512-maskable ("purpose": "maskable"), colours Forest.
 *  - Customer copy (visible text, meta/alt/aria/title, and sentences in inline scripts) has no "card on file",
 *    "portal route", "stripe checkout" or "AUD price(s)". "Stripe" appears in no customer page except one sentence
 *    each in terms.html and refund.html. privacy.html is exempt (privacy law: it names Stripe as the payments processor).
 *  - app.html keeps const API, function freeAiActionsLine and async function fillFreeAiLine (they run in a vm here).
 *    #home-free-ai and #billing-free-ai carry the hidden attribute and no numberless sentence in the HTML. No page
 *    (incl. index.html [data-free-ai]) shows "Free includes AI actions a month" without the hidden attribute.
 *    200 {success, freeMonthly:10} shows "Free includes 10 AI actions a month" in both. A 503 with Retry-After
 *    retries once after that many seconds; 503 then 503 stays hidden, 503 then 200 fills. No third call.
 *  - pricing.html keeps the (function billingToggle(){...})() block. Yearly config: toggle on shows A$149.99 a year
 *    and stays on. No yearly in config: toggle hidden.
 *  - /ai-meal-planner-australia: meta, og and twitter descriptions have no "AUD". No back-to-back sentences both starting "FitMunch".
 *    test_seo_ship_pack_1.js:54 may be re-baselined once, to the new meta string, stated in the PR body.
 */
const fs = require('fs');
const path = require('path');
const E = require('./eqa_round_e_support');

const P = (f) => path.join(E.PUB, f);

describe('EQA Round E: logo is the approved 18 Nov pack', () => {
  it('L1 /assets/logo.svg is a full-colour or reversed pack mark, not the old broccoli tile', () => {
    const s = E.sha(P('assets/logo.svg'));
    expect(s === E.OLD_LOGO_SHA ? 'old logo' : 'ok').toBe('ok');
    expect(E.NAV_MARK_SHAS.has(s) ? 'pack' : 'not pack: ' + s).toBe('pack');
  });
  it('L2 root favicon.ico, favicon.svg and apple-touch-icon.png are byte-identical to the pack', () => {
    const want = { 'favicon.ico': E.PACK['icons/favicon.ico'], 'favicon.svg': E.PACK['icons/favicon.svg'], 'apple-touch-icon.png': E.PACK['icons/apple-touch-icon.png'] };
    const bad = Object.entries(want).filter(([f, h]) => !fs.existsSync(P(f)) || E.sha(P(f)) !== h).map(([f]) => f);
    expect(bad).toEqual([]);
  });
  it('L3 every page has an icon link and every icon link resolves to a pack file', () => {
    const bad = [];
    for (const f of E.htmlFiles()) {
      const links = E.iconLinks(E.read(P(f)));
      if (!links.length) bad.push(f + ': no icon link');
      for (const l of links) {
        const file = E.resolvePublic(l.href, f);
        if (!file) bad.push(f + ': ' + l.href + ' missing');
        else if (!E.PACK_SHAS.has(E.sha(file))) bad.push(f + ': ' + l.href + ' not a pack file');
      }
    }
    expect(bad).toEqual([]);
  });
  it('L4 every brand <img> in nav/footer is a pack mark; under 32 px it is a small mark', () => {
    const bad = [];
    for (const f of E.htmlFiles()) {
      for (const img of E.brandImgs(E.read(P(f)))) {
        const file = E.resolvePublic(img.src, f);
        if (!file) { bad.push(f + ': ' + img.src + ' missing'); continue; }
        const s = E.sha(file);
        if (img.width && img.width < 32) { if (!E.SMALL_MARK_SHAS.has(s)) bad.push(f + ': ' + img.width + 'px uses ' + img.src + ' (needs fitmunch-mark-small-*)'); }
        else if (!E.NAV_MARK_SHAS.has(s)) bad.push(f + ': ' + img.src + ' not a full-colour/reversed pack mark');
      }
    }
    expect(bad).toEqual([]);
  });
  it('L5 no fmTile/fmCrown and no copy of the old logo anywhere in public/', () => {
    const bad = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (E.sha(p) === E.OLD_LOGO_SHA) bad.push(path.relative(E.PUB, p) + ': old logo bytes');
      if (/\.(html|svg|css|js|json)$/i.test(e.name) && /fmTile|fmCrown/.test(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(E.PUB, p) + ': fmTile/fmCrown');
    });
    walk(E.PUB);
    expect(bad).toEqual([]);
  });
  it('L6 app_manifest.json icons are the pack 192, 512 and 512-maskable, colours Forest', () => {
    const m = JSON.parse(E.read(P('app_manifest.json')));
    const bad = [];
    const want = [E.PACK['icons/icon-192.png'], E.PACK['icons/icon-512.png'], E.PACK['icons/icon-512-maskable.png']];
    const got = (m.icons || []).map((i) => { const f = E.resolvePublic(i.src.startsWith('/') ? i.src : '/' + i.src); return { i, s: f ? E.sha(f) : null }; });
    got.forEach(({ i, s }) => { if (!s) bad.push(i.src + ' missing'); else if (!E.PACK_SHAS.has(s)) bad.push(i.src + ' not a pack file'); });
    want.forEach((h) => { if (!got.some((g) => g.s === h)) bad.push('missing pack icon ' + h.slice(0, 8)); });
    const mask = got.find((g) => g.s === E.PACK['icons/icon-512-maskable.png']);
    if (mask && !/\bmaskable\b/.test(mask.i.purpose || '')) bad.push('maskable icon lacks purpose maskable');
    got.filter((g) => g.s && g.s !== E.PACK['icons/icon-512-maskable.png']).forEach((g) => { if (/\bmaskable\b/.test(g.i.purpose || '')) bad.push(g.i.src + ' is not the maskable file but claims maskable'); });
    if (String(m.theme_color).toUpperCase() !== '#0F2A1F') bad.push('theme_color ' + m.theme_color);
    if (String(m.background_color).toUpperCase() !== '#0F2A1F') bad.push('background_color ' + m.background_color);
    expect(bad).toEqual([]);
  });
});

describe('EQA Round E: no internal words in customer copy', () => {
  it('C1 no "card on file" on any customer page', () => { expect(E.hits(/card[\s-]+on[\s-]+file/)).toEqual([]); });
  it('C2 no "portal route"', () => { expect(E.hits(/portal\s+route/)).toEqual([]); });
  it('C3 no "Stripe checkout" (incl. "no Stripe checkout")', () => { expect(E.hits(/stripe\s+checkout/)).toEqual([]); });
  it('C4 "Stripe" nowhere except one sentence each in terms and refund (privacy exempt)', () => {
    const exempt = new Set(['privacy.html', 'terms.html', 'refund.html']);
    const bad = E.hits(/\bstripe\b/, E.htmlFiles().filter((f) => !exempt.has(f)));
    for (const f of ['terms.html', 'refund.html']) {
      const { text, scripts } = E.customerStrings(f);
      const n = E.sentencesWith(text + '\n' + scripts, /\bstripe\b/i).length;
      if (n > 1) bad.push(f + ': ' + n + ' sentences name Stripe (max 1)');
    }
    expect(bad).toEqual([]);
  });
  it('C5 no "AUD price(s)" claim anywhere (FitMunch shows no supermarket prices)', () => { expect(E.hits(/\bAUD\s+prices?\b/)).toEqual([]); });
});

describe('EQA Round E: free AI line never shows without a number', () => {
  it('A1 app lines are hidden with no numberless sentence; no page shows the numberless sentence by default', () => {
    const app = E.read(P('app.html'));
    const bad = [];
    for (const id of ['home-free-ai', 'billing-free-ai']) {
      if (!E.hasHiddenAttr(app, id)) bad.push(id + ' not hidden by default');
      if (/Free includes\s+AI actions/i.test(E.initialText(app, id))) bad.push(id + ' has the numberless sentence');
    }
    const any = [];
    E.htmlFiles().forEach((f) => E.numberlessFreeAi(E.read(P(f))).forEach((x) => { if (!x.hidden) any.push(f + ': numberless sentence shown by default: ' + x.tag); }));
    expect(bad.concat(any)).toEqual([]);
  });
  it('A2 200 with freeMonthly 10 fills and shows both lines', async () => {
    const r = await E.runFreeAi([{ status: 200, body: { success: true, freeMonthly: 10, limit: 10, remaining: 10 } }]);
    expect([r.home.hidden, r.bill.hidden]).toEqual([false, false]);
    expect([r.home.textContent.trim(), r.bill.textContent.trim()]).toEqual(['Free includes 10 AI actions a month', 'Free includes 10 AI actions a month']);
    expect(r.calls.length).toBe(1);
  });
  it('A3 503 then 503 keeps both lines hidden, exactly two calls, retry waits Retry-After', async () => {
    const r = await E.runFreeAi([{ status: 503, retryAfter: 2, body: { success: false, error: 'busy' } }, { status: 503, retryAfter: 2, body: { success: false } }]);
    expect([r.home.hidden, r.bill.hidden]).toEqual([true, true]);
    expect(r.calls.length).toBe(2);
    expect(r.delays.some((d) => d >= 2000) ? 'waited' : 'delays ' + JSON.stringify(r.delays)).toBe('waited');
  });
  it('A4 503 then 200 fills both lines', async () => {
    const r = await E.runFreeAi([{ status: 503, retryAfter: 1, body: { success: false } }, { status: 200, body: { success: true, freeMonthly: 10, limit: 10 } }]);
    expect([r.home.hidden, r.bill.hidden]).toEqual([false, false]);
    expect(r.home.textContent.trim()).toBe('Free includes 10 AI actions a month');
    expect(r.calls.length).toBe(2);
  });
});

describe('EQA Round E: yearly price', () => {
  const cfg = { success: true, premiumAnnual: true, freeAiMonthly: 10, premiumMonthly: 'A$19.99 a month', premiumAmount: 'A$19.99', premiumAnnualLabel: 'A$149.99 a year', premiumMonthlyAmount: '19.99', premiumCurrency: 'AUD' };
  it('Y1 yearly on shows A$149.99 a year and stays on after a second tap', async () => {
    const t = await E.runBillingToggle(cfg);
    expect(t.box.hidden).toBe(false);
    t.aBtn.click(); await new Promise((r) => setImmediate(r));
    t.aBtn.click(); await new Promise((r) => setImmediate(r));
    expect(t.price.textContent.replace(/\s+/g, ' ').trim()).toBe('A$149.99 a year');
    expect([t.aBtn.getAttribute('aria-pressed'), t.mBtn.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  });
  it('Y2 no yearly price in config hides the toggle', async () => {
    const t = await E.runBillingToggle(Object.assign({}, cfg, { premiumAnnual: false, premiumAnnualLabel: '' }));
    expect(t.box.hidden).toBe(true);
  });
});

describe('EQA Round E: PR 244 S1 and S2', () => {
  const h = () => E.read(P('ai-meal-planner-australia.html'));
  it('S1 meta, og and twitter descriptions carry no "AUD"', () => {
    const tags = (h().match(/<meta\b[^>]*(name|property)\s*=\s*["'](description|og:description|twitter:description)["'][^>]*>/gi) || []);
    expect(tags.length > 0 ? 'found' : 'no description meta').toBe('found');
    expect(tags.filter((t) => /\bAUD\b/.test(t))).toEqual([]);
  });
  it('S2 no back-to-back sentences both starting "FitMunch" in one paragraph', () => {
    const bad = [];
    E.blocks(h()).forEach((b) => {
      const sent = b.split(/(?<=[.!?])\s+/);
      for (let k = 1; k < sent.length; k++) if (/^FitMunch\b/.test(sent[k - 1]) && /^FitMunch\b/.test(sent[k])) bad.push(sent[k - 1].slice(0, 60) + ' | ' + sent[k].slice(0, 60));
    });
    expect(bad).toEqual([]);
  });
});
