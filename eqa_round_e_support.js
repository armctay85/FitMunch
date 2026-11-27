'use strict';
// EQA Round E support (brand and customer-copy cleanup). Owned by Elite QA. Commit unchanged. Do not edit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.resolve(__dirname);
const PUB = path.join(ROOT, 'public');
const read = (p) => fs.readFileSync(p, 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// Approved logo pack, Drew 18 Nov 2026 (/workspace/desk/brand/claude-logos-2026-11-18/fitmunch-logo-5g/).
const PACK = Object.freeze({
  'icons/apple-touch-icon.png': '7affaba11c9ca77689408ae755429cb6004c8fbe8ffe2fd4a6f6e1d037b4f616',
  'icons/favicon-16.png': '9692b1211f887ba70d444a976c18c4f5e99c3e10c6220cee6eee2be2b7d19b95',
  'icons/favicon-32.png': '69330ef7bf4df831b4ceee762f8dee006b495964a54f3f42b1f8880403404e94',
  'icons/favicon-48.png': 'a860208fcbfbf904fcf804edf2e7053606edeb65c6630df0ee2f3855be495e45',
  'icons/favicon.ico': '96e90d051595c21431b3c018ca8834f6d0c8ef4ebfef23c9e01f815fcdf013d8',
  'icons/favicon.svg': '7babb43fcf6265430d9d8bde01b0274a127f9c620048a34854724c58086f38d5',
  'icons/icon-192.png': '04c5948fd47dfb2dce881a305b6bac30201232555b2095d5f49034a35f3d7905',
  'icons/icon-512-maskable.png': 'dfe481295891e5555f316b0a8bee5da753386e0f9ea4d39859c5f7a6afab6414',
  'icons/icon-512.png': 'd4d31e6ad71758b8c72d9480c0aa29697d3b3e65940acbddf4d775db1371d8ce',
  'svg/fitmunch-app-icon.svg': '9ca0636d9d293146df74ac80ee65f5ce9f99d9c17ba1aa14df605396ecbe4076',
  'svg/fitmunch-mark-full-colour.svg': '541d75caa9bffa4de0f5d5882b61284dca46f823576070c17c75250e48575bf6',
  'svg/fitmunch-mark-reversed.svg': '064b61a27a792d9ca46016c14785fb90319850726099a7300cf73858c22effb4',
  'svg/fitmunch-mark-small-full-colour.svg': 'c692b80aa64606841aac512daa6bf5b45639901f36e52237e957f37a0a72e0f7',
  'svg/fitmunch-mark-small-reversed.svg': 'd3ab9c2bfa7c66fecca0b6cd97dea09dd426b462ce82c64105a5aaf8efac2780',
});
const PACK_SHAS = new Set(Object.values(PACK));
// The nav is dark (Forest family), so only full-colour or reversed marks are allowed in it. Mint never on white.
const NAV_MARK_SHAS = new Set([PACK['svg/fitmunch-app-icon.svg'], PACK['svg/fitmunch-mark-full-colour.svg'], PACK['svg/fitmunch-mark-reversed.svg']]);
const SMALL_MARK_SHAS = new Set([PACK['svg/fitmunch-mark-small-full-colour.svg'], PACK['svg/fitmunch-mark-small-reversed.svg'], PACK['icons/favicon.svg']]);
const OLD_LOGO_SHA = 'de3fd111dd2061bb30d57407c289e681952096d03d4c2b39ad097a892db0875c';

const htmlFiles = () => fs.readdirSync(PUB).filter((f) => f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)).sort();

function stripNonVisible(h) {
  return h.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}
const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", hellip: '...' };
function decode(s) {
  return s.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, d) => String.fromCharCode(parseInt(d, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : ' ')).replace(/\u00a0/g, ' ');
}
// Customer-visible text: body text, plus meta content, alt, title, aria-label, placeholder and value attributes.
function visibleText(h) {
  const s = stripNonVisible(h);
  const attrs = [];
  s.replace(/\s(?:content|alt|title|aria-label|placeholder|value|data-tip)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, q, a, b) => { attrs.push(a != null ? a : b); return m; });
  return decode(s.replace(/<[^>]+>/g, ' ') + ' \n ' + attrs.join(' \n ')).replace(/[ \t]+/g, ' ');
}
function bodyText(h) {
  const m = h.match(/<body\b[\s\S]*<\/body>/i);
  return decode(stripNonVisible(m ? m[0] : h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
// Human sentences inside inline scripts: string literals that contain a space and a letter.
function scriptSentences(h) {
  const out = [];
  const scripts = h.match(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const sc of scripts) {
    const body = sc.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    let m;
    while ((m = re.exec(body))) { const v = m[2]; if (/\s/.test(v) && /[a-z]/i.test(v)) out.push(v); }
  }
  return out;
}
function customerStrings(file) {
  const h = read(path.join(PUB, file));
  return { file, text: visibleText(h), scripts: scriptSentences(h).join(' \n ') };
}
function hits(re, files) {
  const out = [];
  for (const f of files || htmlFiles()) {
    const { text, scripts } = customerStrings(f);
    for (const src of [text, scripts]) { const m = src.match(new RegExp(re.source, 'gi')); if (m) out.push(f + ': ' + m.length + 'x "' + m[0] + '"'); }
  }
  return out;
}
function sentencesWith(text, re) {
  return text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter((s) => re.test(s));
}

// Resolve a site-relative href to a file in public/ (query and hash dropped).
function resolvePublic(href, fromFile) {
  if (!href || /^(https?:)?\/\//i.test(href) || href.startsWith('data:')) return null;
  const clean = href.split('#')[0].split('?')[0];
  const p = clean.startsWith('/') ? path.join(PUB, clean) : path.join(path.dirname(path.join(PUB, fromFile || 'index.html')), clean);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}
function iconLinks(h) {
  const out = [];
  (h.match(/<link\b[^>]*>/gi) || []).forEach((tag) => {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!/(^|\s)(icon|shortcut|apple-touch-icon|mask-icon)(\s|$)/i.test(rel)) return;
    out.push({ rel, href: (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || '', sizes: (tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i) || [])[1] || '' });
  });
  return out;
}
function brandImgs(h) {
  const out = [];
  const re = /<a\b[^>]*class\s*=\s*["'][^"']*\b(fm-brand|fm-footer-brand|brand|logo|nav-brand)\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(h))) {
    (m[2].match(/<img\b[^>]*>/gi) || []).forEach((img) => {
      out.push({ src: (img.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '', width: Number((img.match(/\bwidth\s*=\s*["']?(\d+)/i) || [])[1] || 0) });
    });
  }
  return out;
}

// ---------- minimal DOM for running page script fragments in a vm ----------
function makeEl(id, attrs) {
  const el = {
    id, hidden: !!(attrs && attrs.hidden), textContent: (attrs && attrs.text) || '', className: (attrs && attrs.className) || '',
    style: {}, _attrs: Object.assign({}, (attrs && attrs.attrs) || {}), _listeners: {}, children: [],
    getAttribute(n) { if (n === 'hidden') return this.hidden ? '' : null; return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
    setAttribute(n, v) { if (n === 'hidden') { this.hidden = true; return; } this._attrs[n] = String(v); if (n === 'class') this.className = String(v); },
    removeAttribute(n) { if (n === 'hidden') this.hidden = false; delete this._attrs[n]; },
    hasAttribute(n) { return n === 'hidden' ? this.hidden : Object.prototype.hasOwnProperty.call(this._attrs, n); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({ preventDefault() {}, currentTarget: el, target: el })); if (typeof this.onclick === 'function') this.onclick({ preventDefault() {} }); },
    replaceChildren(...k) { this.children = k; this.textContent = k.map((c) => c.textContent || '').join(''); },
    append(...k) { k.forEach((c) => { this.children.push(c); this.textContent += c.textContent || ''; }); },
    appendChild(c) { this.append(c); return c; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    classList: null,
  };
  el.classList = {
    add: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); },
    remove: (...c) => { el.className = el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
    toggle: (c, on) => { const has = el.className.split(/\s+/).includes(c); const want = on === undefined ? !has : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
    contains: (c) => el.className.split(/\s+/).includes(c),
  };
  Object.defineProperty(el, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get() { return this.textContent; }, set(v) { this.textContent = String(v).replace(/<[^>]+>/g, ''); } });
  return el;
}
function textNode(t) { return { textContent: String(t) }; }

// Brace-matched extraction of a top-level declaration from page source.
function extractBlock(src, startRe) {
  const m = startRe.exec(src);
  if (!m) return null;
  const from = m.index + m[0].length - 1;
  const arrow = src.indexOf('=>', from);
  const brace0 = src.indexOf('{', from);
  // Arrow functions: the body brace follows '=>' (default params such as opts={} come first).
  let i = (arrow >= 0 && /^\s*async\s*\(|^\s*\(/.test(src.slice(from)) && arrow < src.indexOf('\n', from) + 200) ? src.indexOf('{', arrow) : brace0;
  if (i < 0) return null;
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { let end = j + 1; const tail = src.slice(end, end + 4); if (/^\)\(\);?/.test(tail)) end += tail.match(/^\)\(\);?/)[0].length; else if (src[end] === ';') end++; return src.slice(m.index, end); } }
  }
  return null;
}

// Free-AI line harness. Runs app.html's API helper and its free-AI block against a scripted fetch.
// responses: [{status, body, retryAfter}] consumed in order for GET /api/ai/usage.
async function runFreeAi(responses, opts) {
  const app = read(path.join(PUB, 'app.html'));
  const apiSrc = extractBlock(app, /const API\s*=\s*async\s*\(/);
  const startIdx = app.search(/function freeAiActionsLine\s*\(/);
  const fillSrc = extractBlock(app, /async function fillFreeAiLine\s*\(/);
  if (!apiSrc || startIdx < 0 || !fillSrc) throw new Error('EQA-E contract: app.html must keep const API, function freeAiActionsLine and async function fillFreeAiLine');
  const fillIdx = app.indexOf(fillSrc);
  const block = app.slice(startIdx, fillIdx + fillSrc.length);
  const home = makeEl('home-free-ai', { hidden: hasHiddenAttr(app, 'home-free-ai'), text: initialText(app, 'home-free-ai') });
  const bill = makeEl('billing-free-ai', { hidden: hasHiddenAttr(app, 'billing-free-ai'), text: initialText(app, 'billing-free-ai') });
  const calls = []; const delays = [];
  const queue = responses.slice();
  const fetch = async (url, init) => {
    calls.push(String(url));
    const r = queue.length ? queue.shift() : { status: 599, body: { success: false } };
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300,
      headers: { get: (n) => (/^retry-after$/i.test(n) && r.retryAfter != null ? String(r.retryAfter) : null) },
      json: async () => r.body, text: async () => JSON.stringify(r.body),
    };
  };
  const sandbox = {
    fetch, console: { log() {}, warn() {}, error() {}, info() {} },
    document: { getElementById: (id) => (id === 'home-free-ai' ? home : id === 'billing-free-ai' ? bill : null), querySelectorAll: () => [], querySelector: () => null },
    S: { token: 'eqa-token', user: { subscriptionTier: 'free' } },
    AI_PATHS: ['/ai/chat', '/ai/weekly-review', '/ai/workout-plan', '/meal-plan/generate'],
    AI_OFF_RESULT: { success: false, code: 'ai_off' },
    aiConsentState: () => true, ensureAiConsent: async () => true,
    setTimeout: (fn, ms) => { delays.push(Number(ms) || 0); Promise.resolve().then(fn); return delays.length; },
    clearTimeout: () => {}, Promise, Number, String, Math, Date, JSON, Error, Object, Array, isFinite, parseInt, parseFloat,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(apiSrc + '\n' + block + '\nthis.__fill = fillFreeAiLine;', sandbox, { timeout: 2000 });
  await Promise.race([sandbox.__fill(), new Promise((r) => setTimeout(r, (opts && opts.waitMs) || 1500))]);
  for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
  return { home, bill, calls: calls.filter((u) => /\/api\/ai\/usage/.test(u)), delays };
}
function tagFor(app, id) { return (app.match(new RegExp('<[a-z]+\\b[^>]*\\bid\\s*=\\s*["\\\']' + id + '["\\\'][^>]*>', 'i')) || [])[0] || ''; }
function hasHiddenAttr(app, id) { return /\shidden(\s|=|>|\/)/i.test(tagFor(app, id)); }
function initialText(app, id) { const m = app.match(new RegExp('\\bid\\s*=\\s*["\\\']' + id + '["\\\'][^>]*>([^<]*)<', 'i')); return m ? m[1] : ''; }

// Pricing yearly toggle harness: runs pricing.html's billingToggle IIFE against a scripted config.
async function runBillingToggle(cfg) {
  const h = read(path.join(PUB, 'pricing.html'));
  const src = extractBlock(h, /\(function billingToggle\s*\(\)\s*/);
  if (!src) throw new Error('EQA-E contract: pricing.html must keep the (function billingToggle() {...})() block');
  const box = makeEl('billing-toggle', { hidden: true });
  const price = makeEl('premium-price', { text: '' });
  const mBtn = makeEl('', { attrs: { 'data-billing': 'monthly', 'aria-pressed': 'true' }, className: 'fm-btn fm-btn-leaf' });
  const aBtn = makeEl('', { attrs: { 'data-billing': 'annual', 'aria-pressed': 'false' }, className: 'fm-btn fm-btn-ink' });
  const badge = makeEl('yearly-save', { hidden: true });
  box.querySelectorAll = (sel) => (/data-billing/.test(sel) ? [mBtn, aBtn] : []);
  box.querySelector = (sel) => (/annual/.test(sel) ? aBtn : /monthly/.test(sel) ? mBtn : null);
  const byId = { 'billing-toggle': box, 'premium-price': price, 'yearly-save': badge };
  const sandbox = {
    document: { getElementById: (id) => byId[id] || null, querySelectorAll: (sel) => (/data-billing/.test(sel) ? [mBtn, aBtn] : []), querySelector: () => null, createTextNode: textNode, createElement: () => makeEl('') },
    window: {}, location: { origin: 'https://www.fitmunch.com.au', pathname: '/pricing', search: '' }, URL, URLSearchParams,
    fetch: async () => ({ ok: !!cfg, status: cfg ? 200 : 503, json: async () => cfg }),
    console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; }, Promise, Number, String, Math, JSON, Array, Object,
  };
  sandbox.window = Object.assign(sandbox.window, { fetch: sandbox.fetch, location: sandbox.location });
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 2000 });
  for (let k = 0; k < 30; k++) await new Promise((r) => setImmediate(r));
  return { box, price, mBtn, aBtn, badge };
}

// Inner text of each <p>, <dd>, <li>, <td> and <figcaption> in the body.
function blocks(h) {
  const out = [];
  const re = /<(p|dd|li|td|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  const b = stripNonVisible(h);
  while ((m = re.exec(b))) out.push(decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
  return out;
}
// Elements whose own text is the numberless free-AI sentence, with whether they carry the hidden attribute.
function numberlessFreeAi(h) {
  const out = [];
  const re = /<([a-z]+)\b([^>]*)>\s*Free includes\s+AI actions a month\s*<\/\1>/gi;
  let m;
  while ((m = re.exec(stripNonVisible(h)))) out.push({ tag: m[0].slice(0, 80), hidden: /\shidden(\s|=|$|\/)/i.test(m[2]) });
  return out;
}
module.exports = { blocks, numberlessFreeAi, ROOT, PUB, read, sha, PACK, PACK_SHAS, NAV_MARK_SHAS, SMALL_MARK_SHAS, OLD_LOGO_SHA, htmlFiles, visibleText, bodyText, scriptSentences, customerStrings, hits, sentencesWith, resolvePublic, iconLinks, brandImgs, runFreeAi, runBillingToggle, hasHiddenAttr, initialText, extractBlock };
