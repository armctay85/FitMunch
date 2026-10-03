'use strict';

const { PRICE_NOTE, AISLE_WALK } = require('./coach-plan');

const AISLE_ORDER = AISLE_WALK;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeAccent(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#1f9d4a';
}

function safeLogo(value) {
  if (typeof value !== 'string') return '';
  return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

function accentInk(hex) {
  return contrast(hex, '#ffffff') >= contrast(hex, '#0c1210') ? '#ffffff' : '#0c1210';
}

function initials(practice) {
  const words = String(practice || 'FitMunch')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'FM';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function firstName(label) {
  const word = String(label || 'Client').trim().split(/\s+/)[0];
  return word || 'Client';
}

function weekOfLabel(now) {
  const date = now instanceof Date ? now : new Date();
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const cursor = new Date(Date.UTC(Number(bag.year), Number(bag.month) - 1, Number(bag.day)));
  const weekday = cursor.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  cursor.setUTCDate(cursor.getUTCDate() - delta);
  return `${cursor.getUTCDate()} ${MONTHS[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`;
}

const AISLE_ICONS = {
  Produce: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c1-8 6-13 14-14-1 8-6 13-14 14z"/><path d="M9 15c1.5-2.2 3.4-4.4 6-7"/></svg>',
  Bakery: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14c0-4.4 3.6-8 8-8s8 3.6 8 8v5H4z"/><path d="M8 14v5M12 14v5M16 14v5"/></svg>',
  Meat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5a5 5 0 0 1 1 7.5l-4.2 4.2-4-4 4.2-4.2a5 5 0 0 1 3-.5z"/><path d="M7.2 16.2 4 20M9.2 18.2 7 21"/></svg>',
  Dairy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v3l2 2.5V21H7V8.5L9 6z"/><path d="M8 11h8"/></svg>',
  Frozen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5.5 6.5l13 11M18.5 6.5l-13 11"/><path d="M8 4.5 12 8l4-3.5M8 19.5 12 16l4 3.5"/></svg>',
  Pantry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v3H8z"/><path d="M7 6h10v15H7z"/><path d="M7 11h10"/></svg>',
};

const SWAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/></svg>';
const STORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10 6.5 4h11L20 10"/><path d="M4 10h16v10H4z"/><path d="M9 20v-6h6v6"/><path d="M4 10c1.2 1.4 2.6 1.6 3.6.2 1 1.4 2.4 1.2 3.4-.2 1 1.4 2.4 1.4 3.4.2 1 1.4 2.4 1.2 3.6-.2"/></svg>';

function aisleIcon(name) {
  return AISLE_ICONS[name] || AISLE_ICONS.Pantry;
}

function groupLines(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const aisle = line.aisle || 'Other';
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle).push(line);
  }
  return [...groups.keys()]
    .sort((a, b) => {
      const ia = AISLE_ORDER.indexOf(a);
      const ib = AISLE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    })
    .map((aisle) => ({ aisle, lines: groups.get(aisle) }));
}

function ringPct(value, target) {
  const goal = Number(target);
  const current = Number(value);
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(100, Math.round((current / goal) * 100)));
}

function dayRing(day, targetKcal) {
  const pct = ringPct(day.kcal, targetKcal);
  return `<div class="ring" role="img" aria-label="${escapeHtml(day.day)} ${escapeHtml(day.kcal)} kilocalories">
    <svg viewBox="0 0 36 36" class="ring-svg" aria-hidden="true">
      <circle class="track" cx="18" cy="18" r="15.5" pathLength="100"/>
      <circle class="val" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="${pct} 100"/>
    </svg>
    <strong>${escapeHtml(day.kcal)}</strong>
  </div>`;
}

function mealCard(meal) {
  const slug = String(meal.slug || '').replace(/[^a-z0-9-]/g, '');
  const method = Array.isArray(meal.method) ? meal.method.slice(0, 3) : [];
  const lines = (meal.ingredients || [])
    .map((ing) => ing.qty)
    .filter(Boolean)
    .map((qty) => `<li>${escapeHtml(qty)}</li>`)
    .join('');
  const photo = slug
    ? `<img src="/img/meals/${escapeHtml(slug)}.webp" alt="${escapeHtml(meal.name)}" width="640" height="480">`
    : '';
  return `<article class="card">
    ${photo}
    <h3>${escapeHtml(meal.name)}</h3>
    <p class="strip mono"><span>${escapeHtml(meal.kcal)} kcal</span><span>${escapeHtml(meal.protein)} P</span><span>${escapeHtml(meal.carbs)} C</span><span>${escapeHtml(meal.fat)} F</span></p>
    <p class="method">${method.map((line) => escapeHtml(line)).join('<br>')}</p>
    ${lines ? `<ul class="ings">${lines}</ul>` : ''}
  </article>`;
}

function renderSharePage({ planRow, branding }) {
  const plan = planRow.plan || {};
  const accent = safeAccent(branding && branding.accent);
  const ink = accentInk(accent);
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const logo = safeLogo(branding && branding.logoDataUrl);
  const client = firstName(planRow.clientLabel);
  const week = weekOfLabel();
  const mark = logo
    ? `<img id="share-logo" class="mark" alt="" src="${logo}">`
    : `<div class="mark monogram" role="img" aria-label="${escapeHtml(practice)}">${escapeHtml(initials(practice))}</div>`;
  const days = plan.days || [];
  const targetKcal = plan.targets && plan.targets.kcal;
  const dayInputs = days.map((day, index) => (
    `<input class="sr" type="radio" name="day" id="day-${index}" value="${escapeHtml(day.day)}"${index === 0 ? ' checked' : ''}>`
  )).join('');
  const chips = days.map((day, index) => (
    `<label class="chip" for="day-${index}">${escapeHtml(day.day)}</label>`
  )).join('');
  const panels = days.map((day, index) => `
    <section class="day day-${index}" aria-label="${escapeHtml(day.day)}">
      <div class="day-head">
        ${dayRing(day, targetKcal)}
        <div>
          <h2>${escapeHtml(day.day)}</h2>
          <p class="day-macros">${escapeHtml(day.kcal)} kcal · P${escapeHtml(day.protein)} C${escapeHtml(day.carbs)} F${escapeHtml(day.fat)}</p>
        </div>
      </div>
      <div class="cards">
        ${(day.meals || []).map(mealCard).join('')}
      </div>
    </section>`).join('');
  const dayRules = days.map((_, index) => `#day-${index}:checked ~ .week .day-${index}{display:block}`).join('');
  const chipRules = days.map((_, index) => `#day-${index}:checked ~ .week label[for="day-${index}"]{background:var(--accent);color:var(--on)}`).join('');
  const shopping = plan.shopping || { lines: [], stores: [], note: PRICE_NOTE, splitLabel: '' };
  const shopLine = (line) => {
    const protein = line.proteinLabel ? `<span class="protein">${escapeHtml(line.proteinLabel)}</span>` : '';
    const swap = line.swapLabel
      ? `<span class="swap">${SWAP_ICON}${escapeHtml(line.swapLabel)}</span>`
      : '';
    const facts = protein || swap ? `<p class="facts">${protein}${swap}</p>` : '';
    return `<li>
      <p class="item">${escapeHtml(line.packLabel || line.name)}</p>
      ${facts}
    </li>`;
  };
  const storeBlocks = (shopping.stores || []).map((store) => {
    const rows = (shopping.lines || []).filter((line) => line.storeId === store.storeId);
    const groups = groupLines(rows).map((group) => `
      <section>
        <h4 class="aisle">${aisleIcon(group.aisle)}${escapeHtml(group.aisle)}</h4>
        <ul>${group.lines.map(shopLine).join('')}</ul>
      </section>`).join('');
    return `<section class="store-block">
      <h3>${escapeHtml(store.storeName)}</h3>
      ${groups}
    </section>`;
  }).join('');
  const multi = (shopping.stores || []).length > 1 ? ' multi' : '';
  const aisleList = (shopping.aisles || []).join(', ');
  const itemCount = shopping.itemCount != null ? shopping.itemCount : (shopping.lines || []).length;
  const weekly = shopping.weeklyProtein != null ? shopping.weeklyProtein : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(practice)} week for ${escapeHtml(client)}</title>
<link rel="icon" href="/favicon.ico"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Mono:wght@500;600&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap" rel="stylesheet"/>
<style>
:root{--paper:#eef2ee;--ink:#0c1210;--mute:#3e5148;--line:#d5ddd6;--accent:${accent};--on:${ink};--card:#fff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);overflow-x:clip}
body{font-family:Literata,Georgia,serif;font-size:17px;line-height:1.45}
h1,h2,h3,.chip,.tabs label,.mark{font-family:"Bricolage Grotesque",system-ui,sans-serif}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.band{background:var(--accent);color:var(--on);padding:20px 16px 18px}
.band-row{display:flex;gap:14px;align-items:center;max-width:1040px;margin:0 auto}
.mark{width:64px;height:64px;border-radius:14px;flex:0 0 auto;object-fit:cover;background:transparent}
.monogram{display:grid;place-items:center;font-weight:800;font-size:22px;letter-spacing:.04em;border:2px solid currentColor}
h1{font-size:1.55rem;line-height:1.1;margin:0}
.who{margin:4px 0 0;font-size:1.05rem}
.when{margin:2px 0 0;opacity:.9}
.tabs{display:flex;gap:8px;padding:14px 16px 0;max-width:1040px;margin:0 auto}
.tabs label{min-height:44px;display:inline-flex;align-items:center;padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);cursor:pointer}
#tab-week:checked ~ .tabs label[for="tab-week"],#tab-shop:checked ~ .tabs label[for="tab-shop"]{background:var(--ink);color:#fff}
#tab-week:focus-visible ~ .tabs label[for="tab-week"],#tab-shop:focus-visible ~ .tabs label[for="tab-shop"]{outline:2px solid var(--ink);outline-offset:2px}
.week{max-width:1040px;margin:0 auto}
.shop{max-width:1240px;margin:0 auto}
.chips{position:sticky;top:0;z-index:2;display:flex;gap:8px;overflow-x:auto;padding:12px 16px;background:var(--paper);max-width:100%}
.chip{flex:0 0 auto;min-height:44px;display:inline-flex;align-items:center;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);cursor:pointer}
.day{display:none;padding:0 16px 8px}
.day-head{display:flex;gap:12px;align-items:center;margin:4px 0 12px}
.day-head > div{min-width:0}
.day-head h2{margin:0;font-size:1.4rem}
.day-macros{margin:2px 0 0;color:var(--mute);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-variant-numeric:tabular-nums;font-size:.88rem;line-height:1.2;white-space:nowrap}
.ring{position:relative;width:96px;height:96px;flex:0 0 auto}
.ring-svg{width:96px;height:96px;transform:rotate(-90deg)}
.ring .track{fill:none;stroke:var(--line);stroke-width:3}
.ring .val{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round}
.ring strong{position:absolute;inset:0;display:grid;place-items:center;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-variant-numeric:tabular-nums;font-size:15px;font-weight:800}
.cards{display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.card img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;background:#1c2421}
.card h3{margin:12px 14px 4px;font-size:1.2rem}
.strip{display:flex;flex-wrap:wrap;gap:10px;margin:0 14px 8px;font-size:.92rem}
.method{margin:0 14px 8px;color:var(--mute)}
.ings{margin:0 14px 14px;padding-left:1.1rem}
.ings li{margin:2px 0}
.shop{padding:8px 16px 28px}
.shop-layout{display:flex;flex-direction:column;gap:18px}
.summary{order:-1;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 16px 14px}
.summary h2,.shop-title{font-size:1.35rem;margin:0 0 8px}
.split{margin:0 0 12px;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:1.02rem}
.summary dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:0}
.summary dt{color:var(--mute);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:.92rem}
.summary dd{margin:0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-variant-numeric:tabular-nums;font-weight:700}
.checkout{display:flex;gap:8px;align-items:flex-start;margin:14px 0 0;color:var(--mute);font-size:.98rem}
.checkout svg,.aisle svg,.facts svg{stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.checkout svg{width:18px;height:18px;flex:0 0 auto;margin-top:2px}
.store-block{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 14px 6px;margin:0 0 14px}
.store-block h3{margin:0;font-size:1.2rem}
.aisle{display:flex;align-items:center;gap:8px;margin:16px 0 0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:1rem;font-weight:700}
.aisle svg{width:18px;height:18px;flex:0 0 auto}
.store-block ul{list-style:none;margin:0;padding:0}
.store-block li{padding:12px 0;border-top:1px solid var(--line)}
.item{margin:0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;font-size:1.05rem}
.facts{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:10px 0 0}
.facts span{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 12px;border-radius:999px;background:#e7f3eb;color:var(--ink);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:.95rem;font-variant-numeric:tabular-nums;line-height:1.25}
.facts svg{width:16px;height:16px;flex:0 0 auto}
.facts .swap{background:color-mix(in srgb, var(--accent) 16%, #fff);font-weight:700}
.btn{display:inline-flex;align-items:center;min-height:44px;margin:8px 16px 0;padding:8px 16px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-family:"Bricolage Grotesque",system-ui,sans-serif}
footer{padding:28px 16px 40px;color:var(--mute);max-width:1040px;margin:0 auto}
footer p{margin:4px 0}
${dayRules}
${chipRules}
#tab-shop:checked ~ .week{display:none}
#tab-week:checked ~ .shop{display:none}
#day-0:focus-visible ~ .week label[for="day-0"],
#day-1:focus-visible ~ .week label[for="day-1"],
#day-2:focus-visible ~ .week label[for="day-2"],
#day-3:focus-visible ~ .week label[for="day-3"],
#day-4:focus-visible ~ .week label[for="day-4"],
#day-5:focus-visible ~ .week label[for="day-5"],
#day-6:focus-visible ~ .week label[for="day-6"]{outline:2px solid var(--ink);outline-offset:2px}
@media (min-width:720px){
  .facts{flex-direction:row;flex-wrap:wrap}
}
@media (min-width:900px){
  .cards{grid-template-columns:1fr 1fr}
}
@media (min-width:1100px){
  .shop-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px;align-items:start}
  .summary{order:0;position:sticky;top:16px}
  .stores.multi{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
}
@media print{
  .tabs,.chips,.no-print{display:none !important}
  .week,.shop,.day{display:block !important}
  .card{break-inside:avoid}
  .band{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<header class="band">
  <div class="band-row">
    ${mark}
    <div>
      <h1 id="share-practice">${escapeHtml(practice)}</h1>
      <p class="who" id="share-client">${escapeHtml(client)}</p>
      <p class="when">Week of ${escapeHtml(week)}</p>
    </div>
  </div>
</header>
<input class="sr" type="radio" name="tab" id="tab-week" checked>
<input class="sr" type="radio" name="tab" id="tab-shop">
<nav class="tabs" aria-label="Plan sections">
  <label for="tab-week">Week</label>
  <label for="tab-shop">Shopping list</label>
</nav>
${dayInputs}
<div class="week" id="share-plan">
  <div class="chips" aria-label="Days">${chips}</div>
  ${panels}
</div>
<div class="shop" id="share-list">
  <div class="shop-layout">
    <div>
      <h2 class="shop-title">Shopping list</h2>
      <div class="stores${multi}">
        ${storeBlocks}
      </div>
    </div>
    <aside class="summary" id="share-summary">
      <h2>Your coach's store split</h2>
      <p class="split" id="share-split">${escapeHtml(shopping.splitLabel || '')}</p>
      <dl>
        <dt>Items</dt><dd>${escapeHtml(itemCount)}</dd>
        <dt>Aisles</dt><dd>${escapeHtml(aisleList)}</dd>
        <dt>From this list</dt><dd>${escapeHtml(weekly)}g protein</dd>
      </dl>
      <p class="checkout" id="share-price-note">${STORE_ICON}${escapeHtml(shopping.note || plan.priceNote || PRICE_NOTE)}</p>
    </aside>
  </div>
</div>
<a class="btn no-print" id="share-pdf" href="/c/${escapeHtml(planRow.token)}/pdf">Download PDF</a>
<footer>
  <p>Prepared by ${escapeHtml(practice)} with FitMunch</p>
  <p>General guidance, not medical advice</p>
</footer>
</body>
</html>`;
}

function renderMissing() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Plan link</title></head>
<body style="font-family:Georgia,serif;padding:24px;color:#0c1210;background:#eef2ee">
<h1>This plan link is not available.</h1>
<p>Ask your trainer for a new link.</p>
</body></html>`;
}

module.exports = {
  renderSharePage,
  renderMissing,
  escapeHtml,
  groupLines,
  accentInk,
  initials,
  firstName,
  weekOfLabel,
};
