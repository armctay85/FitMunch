'use strict';

const { PRICE_NOTE } = require('./coach-plan');

const AISLE_ORDER = ['Produce', 'Bakery', 'Meat', 'Dairy', 'Frozen', 'Pantry'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return 'Check at checkout';
  return `$${Number(value).toFixed(2)}`;
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
  const aisles = groupLines(plan.shopping && plan.shopping.lines).map((group) => `
    <section class="aisle">
      <h3>${escapeHtml(group.aisle)}</h3>
      <ul>
        ${group.lines.map((line) => `<li><span>${escapeHtml(line.packLabel || line.name)}</span><span class="mono">${line.priced ? escapeHtml(money(line.lineAud)) : 'Check at checkout'}</span></li>`).join('')}
      </ul>
    </section>`).join('');

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
.week,.shop{max-width:1040px;margin:0 auto}
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
.shop{padding:8px 16px 16px}
.aisle{margin:0 0 14px}
.aisle h3{margin:0 0 6px;font-size:.95rem}
.aisle ul{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:12px}
.aisle li{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-top:1px solid var(--line)}
.aisle li:first-child{border-top:0}
.note{color:var(--mute);font-size:.95rem}
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
@media (min-width:900px){
  .cards{grid-template-columns:1fr 1fr}
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
  <h2>Shopping list</h2>
  <p class="total" id="share-total">Estimated total ${escapeHtml(money(plan.shopping && plan.shopping.totalAud))}</p>
  <p class="note" id="share-price-note">${escapeHtml(plan.priceNote || PRICE_NOTE)}</p>
  ${aisles}
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
