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
  Produce: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 16a1 1 0 0 0-7-7q-4 4-5.987 12.385a.5.5 0 0 0 .602.602Q11 20 15 16l-3-3"/><path d="M15 9q4 4 7 0-3-4-7 0 4-4 0-7-4 3 0 7"/><path d="m8 15-2.58-2.58"/></svg>',
  Bakery: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1H4z"/><path d="M4 12h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 12v8M12 12v8M16 12v8"/></svg>',
  Meat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23"/><path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59"/></svg>',
  Dairy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/><path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/></svg>',
  Frozen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="M4 10l1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/></svg>',
  Pantry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v3H8z"/><path d="M7 6h10v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M7 11h10"/></svg>',
};

const SWAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/></svg>';
const PDF_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/><path d="M5 17v4M19 17v4"/></svg>';
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
    ? `<h1 id="share-practice"><img id="share-logo" class="mark" alt="${escapeHtml(practice)}" src="${logo}"></h1>`
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
    const facts = protein || swap ? `<span class="facts">${protein}${swap}</span>` : '';
    const label = line.packLabel || line.name || 'Item';
    return `<li><button type="button" class="row" data-sku="${escapeHtml(line.sku)}" aria-pressed="false" aria-label="Tick ${escapeHtml(label)}">
      <span class="box" aria-hidden="true"></span>
      <span class="item">${escapeHtml(label)}</span>
      ${facts}
    </button></li>`;
  };
  const columnOf = (groups) => {
    const weight = (group) => group.lines.length + 1;
    const ranked = [...groups].sort((a, b) => weight(b) - weight(a));
    const side = new Map();
    let left = 0;
    let right = 0;
    ranked.forEach((group) => {
      if (left <= right) {
        side.set(group.aisle, 'col-a');
        left += weight(group);
      } else {
        side.set(group.aisle, 'col-b');
        right += weight(group);
      }
    });
    return side;
  };
  const storeBlocks = (shopping.stores || []).map((store) => {
    const rows = (shopping.lines || []).filter((line) => line.storeId === store.storeId);
    const grouped = groupLines(rows);
    let body = '';
    if (grouped.length === 1) {
      const group = grouped[0];
      const mid = Math.ceil(group.lines.length / 2);
      body = `<section class="aisle-group">
        <h4 class="aisle">${aisleIcon(group.aisle)}${escapeHtml(group.aisle)}</h4>
        <div class="item-cols">
          <ul>${group.lines.slice(0, mid).map(shopLine).join('')}</ul>
          <ul>${group.lines.slice(mid).map(shopLine).join('')}</ul>
        </div>
      </section>`;
    } else {
      const side = columnOf(grouped);
      const groupHtml = (group) => `
        <section class="aisle-group">
          <h4 class="aisle">${aisleIcon(group.aisle)}${escapeHtml(group.aisle)}</h4>
          <ul>${group.lines.map(shopLine).join('')}</ul>
        </section>`;
      const left = grouped.filter((group) => side.get(group.aisle) === 'col-a').map(groupHtml).join('');
      const right = grouped.filter((group) => side.get(group.aisle) === 'col-b').map(groupHtml).join('');
      body = `<div class="col">${left}</div><div class="col">${right}</div>`;
    }
    const kind = grouped.length === 1 ? 'solo' : 'multi';
    return `<section class="store-block">
      <h3>${escapeHtml(store.storeName)}</h3>
      <div class="aisle-cols ${kind}">
        ${body}
      </div>
    </section>`;
  }).join('');
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
.shell{max-width:1180px;margin-left:auto;margin-right:auto;padding-left:20px;padding-right:20px}
.band{background:var(--accent);color:var(--on);margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding:20px calc(50vw - 50%) 18px}
.band-row{display:flex;gap:14px;align-items:center}
.mark{height:56px;width:auto;max-width:240px;border-radius:12px;flex:0 0 auto;object-fit:contain;background:transparent}
.monogram{display:grid;place-items:center;width:56px;height:56px;font-weight:800;font-size:22px;letter-spacing:.04em;border:2px solid currentColor}
h1{font-size:1.55rem;line-height:1.1;margin:0}
.who{margin:4px 0 0;font-size:1.05rem}
.when{margin:2px 0 0;opacity:.9}
.tabs{display:flex;flex-wrap:nowrap;gap:8px;align-items:center;padding-top:14px;padding-bottom:0}
.tabs label{min-height:44px;display:inline-flex;align-items:center;padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);cursor:pointer}
#tab-week:checked ~ .tabs label[for="tab-week"],#tab-shop:checked ~ .tabs label[for="tab-shop"]{background:var(--ink);color:#fff}
#tab-week:focus-visible ~ .tabs label[for="tab-week"],#tab-shop:focus-visible ~ .tabs label[for="tab-shop"]{outline:2px solid var(--ink);outline-offset:2px}
.chips{position:sticky;top:0;z-index:2;display:flex;gap:8px;overflow-x:auto;padding:12px 0;background:var(--paper);max-width:100%}
.chip{flex:0 0 auto;min-height:44px;display:inline-flex;align-items:center;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);cursor:pointer}
.day{display:none;padding:0 0 8px}
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
.shop{padding-top:8px;padding-bottom:28px}
.remain{position:sticky;top:0;z-index:4;margin:0 0 12px;padding:8px 0;background:var(--paper);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:800;font-variant-numeric:tabular-nums;font-size:1rem}
.shop-layout{display:flex;flex-direction:column;gap:18px}
.summary{order:-1;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 16px 14px}
.summary h2,.shop-title{font-size:1.35rem;margin:0 0 8px}
.split{margin:0 0 12px;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:1.02rem}
.summary dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:0}
.summary dt{color:var(--mute);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:.92rem}
.summary dd{margin:0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-variant-numeric:tabular-nums;font-weight:700}
.checkout{display:flex;gap:8px;align-items:flex-start;margin:14px 0 0;color:var(--mute);font-size:.98rem}
.checkout svg,.aisle svg,.facts svg,.btn svg{stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.checkout svg{width:18px;height:18px;flex:0 0 auto;margin-top:2px}
.store-block{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 14px 8px;margin:0 0 14px}
.store-block h3{margin:0 0 4px;font-size:1.2rem}
.aisle{display:flex;align-items:center;gap:8px;margin:8px 0 0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:1rem;font-weight:700}
.aisle svg{width:18px;height:18px;flex:0 0 auto}
.store-block ul{list-style:none;margin:0;padding:0}
.store-block li{border-top:1px solid var(--line)}
.row{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;flex-wrap:nowrap}
.row:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.box{width:20px;height:20px;border:1.6px solid var(--ink);border-radius:6px;flex:0 0 auto;display:grid;place-items:center}
.row[aria-pressed="true"]{opacity:.42}
.row[aria-pressed="true"] .item{text-decoration:line-through}
.row[aria-pressed="true"] .box{background:var(--accent);border-color:var(--accent)}
.row[aria-pressed="true"] .box::after{content:"";width:10px;height:6px;border-left:2px solid var(--on);border-bottom:2px solid var(--on);transform:rotate(-45deg) translate(1px,-1px)}
.item{flex:1 1 auto;margin:0;font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;font-size:1.02rem;white-space:nowrap}
.facts{display:flex;flex-wrap:nowrap;gap:6px;margin:0 0 0 auto;justify-content:flex-end}
.facts span{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:3px 10px;border-radius:999px;background:#e7f3eb;color:var(--ink);font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:.86rem;font-variant-numeric:tabular-nums;line-height:1.2;white-space:nowrap}
.facts svg{width:14px;height:14px;flex:0 0 auto}
.facts .swap{background:color-mix(in srgb, var(--accent) 16%, #fff);font-weight:700}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;min-width:44px;margin:0 0 0 auto;padding:8px 14px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);text-decoration:none;font-family:"Bricolage Grotesque",system-ui,sans-serif}
.btn svg{width:18px;height:18px;flex:0 0 auto}
footer{padding-top:28px;padding-bottom:40px;color:var(--mute)}
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
@media (max-width:719px){
  .shell{padding-left:12px;padding-right:12px}
  .tabs label{padding:8px 12px}
  .btn{width:44px;height:44px;min-width:44px;min-height:44px;padding:0}
  .btn-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .store-block{padding:10px 8px 6px}
  .item{font-size:.9rem}
  .facts span{font-size:.72rem;padding:2px 6px;min-height:24px}
}
@media (min-width:900px){
  .cards{grid-template-columns:1fr 1fr}
}
@media (min-width:1100px){
  .shop-layout{display:flex;flex-direction:column;gap:16px}
  .summary{order:-1;position:static;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title stats" "split stats" "note note";column-gap:28px;align-items:center}
  .summary h2{grid-area:title;margin-bottom:4px}
  .summary .split{grid-area:split;margin-bottom:0}
  .summary dl{grid-area:stats;display:flex;flex-wrap:wrap;gap:8px 22px;justify-content:flex-end;align-self:center}
  .summary dl dt{margin-right:6px}
  .summary dl dd{margin-right:0}
  .checkout{grid-area:note;margin-top:8px}
  .aisle-cols.multi{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;align-items:start}
  .aisle-cols.solo .item-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;align-items:start}
}
@media print{
  .tabs,.chips,.no-print{display:none !important}
  .week,.shop,.day{display:block !important}
  .card{break-inside:avoid}
  .band{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body data-token="${escapeHtml(planRow.token || '')}" data-week="${escapeHtml(week)}">
<div class="shell">
<header class="band">
  <div class="band-row">
    ${mark}
    <div>
      ${logo ? '' : `<h1 id="share-practice">${escapeHtml(practice)}</h1>`}
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
  <a class="btn no-print" id="share-pdf" href="/c/${escapeHtml(planRow.token)}/pdf" aria-label="Download PDF">${PDF_ICON}<span class="btn-label">Download PDF</span></a>
</nav>
${dayInputs}
<div class="week" id="share-plan">
  <div class="chips" aria-label="Days">${chips}</div>
  ${panels}
</div>
<div class="shop" id="share-list">
  <p class="remain" id="share-left">${escapeHtml(itemCount)} of ${escapeHtml(itemCount)} left</p>
  <div class="shop-layout">
    <div>
      <h2 class="shop-title">Shopping list</h2>
      <div class="stores">
        ${storeBlocks}
      </div>
    </div>
    <aside class="summary" id="share-summary">
      <h2>Your coach's store split</h2>
      <p class="split" id="share-split">${escapeHtml(shopping.storeLine || '')}</p>
      <dl>
        <dt>Items</dt><dd>${escapeHtml(itemCount)}</dd>
        <dt>Aisles</dt><dd>${escapeHtml(aisleList)}</dd>
        <dt>From this list</dt><dd>${escapeHtml(weekly)}g protein</dd>
      </dl>
      <p class="checkout" id="share-price-note">${STORE_ICON}${escapeHtml(shopping.note || plan.priceNote || PRICE_NOTE)}</p>
    </aside>
  </div>
</div>
<footer>
  <p>Prepared by ${escapeHtml(practice)} with FitMunch</p>
  <p>General guidance, not medical advice</p>
</footer>
</div>
<script>
(function () {
  var token = document.body.getAttribute('data-token') || '';
  var week = document.body.getAttribute('data-week') || '';
  var key = 'fm-coach-shop:' + token + ':' + week;
  var rows = Array.prototype.slice.call(document.querySelectorAll('.row[data-sku]'));
  var counter = document.getElementById('share-left');
  function read() {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch (err) { return {}; }
  }
  function paint() {
    var state = read();
    var done = 0;
    rows.forEach(function (row) {
      var on = Boolean(state[row.getAttribute('data-sku')]);
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) done += 1;
    });
    if (counter) counter.textContent = (rows.length - done) + ' of ' + rows.length + ' left';
  }
  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      var state = read();
      var sku = row.getAttribute('data-sku');
      if (state[sku]) delete state[sku];
      else state[sku] = true;
      localStorage.setItem(key, JSON.stringify(state));
      paint();
    });
  });
  paint();
})();
</script>
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
