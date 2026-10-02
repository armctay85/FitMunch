'use strict';

const { PRICE_NOTE, DIETITIAN_LINE } = require('./coach-plan');
const { foodSvg } = require('./coach-share-art');

const STORES = [
  { id: 'woolworths', name: 'Woolworths' },
  { id: 'coles', name: 'Coles' },
  { id: 'aldi', name: 'Aldi' },
];

const AISLE_ORDER = ['Produce', 'Bakery', 'Meat', 'Dairy', 'Frozen', 'Pantry'];

const SLOT_COLOR = {
  Breakfast: '#8a5208',
  Lunch: '#146b32',
  Dinner: '#14532d',
  Snack: '#1e4fb0',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return 'No public special at this store';
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

function ringPct(value, target) {
  const goal = Number(target);
  const current = Number(value);
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(100, Math.round((current / goal) * 100)));
}

function shortFood(name) {
  return String(name || '')
    .replace(/\s+\d+(\.\d+)?\s*(kg|g|ml|l|pack).*/i, '')
    .replace(/\s+each$/i, '')
    .trim();
}

function amountLabel(ing) {
  const n = Number(ing.amount);
  if (!Number.isFinite(n)) return shortFood(ing.name);
  const pretty = n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  const unit = ing.unit && ing.unit !== 'each' ? ing.unit : '';
  return `${pretty}${unit} ${shortFood(ing.name)}`.trim();
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

function macroBar(day) {
  const p = (Number(day.protein) || 0) * 4;
  const c = (Number(day.carbs) || 0) * 4;
  const f = (Number(day.fat) || 0) * 9;
  const total = p + c + f || 1;
  return `<div class="macrobar" aria-hidden="true"><span class="p" style="width:${(p / total) * 100}%"></span><span class="c" style="width:${(c / total) * 100}%"></span><span class="f" style="width:${(f / total) * 100}%"></span></div>`;
}

function ring({ label, value, unit, target, color }) {
  const pct = ringPct(value, target);
  const shown = value == null ? '0' : String(value);
  const goal = target == null ? '0' : String(target);
  return `<div class="ring" role="img" aria-label="${escapeHtml(label)} ${escapeHtml(shown)}${escapeHtml(unit)} of ${escapeHtml(goal)}${escapeHtml(unit)} target">
    <div class="ring-face">
      <svg viewBox="0 0 36 36" class="ring-svg" aria-hidden="true">
        <circle class="track" cx="18" cy="18" r="15.5" pathLength="100"/>
        <circle class="val" cx="18" cy="18" r="15.5" pathLength="100" stroke="${color}" stroke-dasharray="${pct} 100"/>
      </svg>
      <strong class="ring-num">${escapeHtml(shown)}</strong>
    </div>
    <span class="ring-label">${escapeHtml(label)}</span>
  </div>`;
}

function renderSharePage({ planRow, branding }) {
  const plan = planRow.plan || {};
  const accent = safeAccent(branding && branding.accent);
  const ink = accentInk(accent);
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const logo = safeLogo(branding && branding.logoDataUrl);
  const client = planRow.clientLabel || 'Client';
  const targets = plan.targets || {};
  const averages = plan.draftAverages || {};
  const storeId = plan.shopping && plan.shopping.storeId;
  const storeName = (plan.shopping && plan.shopping.storeName) || 'Store';
  const monogram = escapeHtml((practice.match(/[A-Za-z0-9]/) || ['F'])[0].toUpperCase());
  const flags = Array.isArray(plan.flags) ? plan.flags : [];

  const days = (plan.days || []).map((day) => `
    <section class="day">
      <div class="day-head">
        <h2>${escapeHtml(day.day)}</h2>
        <span>${escapeHtml(day.kcal)} kcal</span>
      </div>
      ${macroBar(day)}
      <div class="meals">
        ${(day.meals || []).map((meal) => {
          const slot = SLOT_COLOR[meal.slot] ? meal.slot : 'Lunch';
          const ings = (meal.ingredients || []).slice(0, 4).map(amountLabel).join(', ');
          return `<article class="tile" style="--slot:${SLOT_COLOR[slot]}">
            ${foodSvg(meal.name, meal.slot)}
            <div class="tile-copy">
              <p class="slot">${escapeHtml(meal.slot)}</p>
              <h3>${escapeHtml(meal.name)}</h3>
              <p class="macros">${escapeHtml(meal.kcal)} kcal · ${escapeHtml(meal.protein)}g protein · ${escapeHtml(meal.carbs)}g carbs · ${escapeHtml(meal.fat)}g fat</p>
              <p class="ings">${escapeHtml(ings)}</p>
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`).join('');

  const aisles = groupLines(plan.shopping && plan.shopping.lines).map((group) => `
    <section class="aisle">
      <h3>${escapeHtml(group.aisle)} <span>${group.lines.length}</span></h3>
      <ul>
        ${group.lines.map((line) => `
          <li class="line">
            <span class="item-name">${escapeHtml(line.packs)} x ${escapeHtml(line.name)}${line.onSpecial ? ' <em class="special">Special</em>' : ''}</span>
            <span class="price">${escapeHtml(line.priced ? money(line.lineAud) : 'No public special at this store')}</span>
          </li>`).join('')}
      </ul>
    </section>`).join('');

  const badges = STORES.map((store) => {
    const on = store.id === storeId;
    return `<li class="badge${on ? ' is-on' : ''}">${escapeHtml(store.name)}</li>`;
  }).join('');

  const flagChips = flags.length
    ? `<ul class="flags">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>`
    : '';

  const unpriced = plan.shopping && plan.shopping.unpricedCount
    ? `<p class="note">${escapeHtml(plan.shopping.unpricedCount)} items have no public special at this store.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<meta name="description" content="${escapeHtml(practice)} 7-day meal plan with a draft shopping list from public specials."/>
<meta name="theme-color" content="#07130d"/>
<link rel="icon" href="/favicon.ico"/>
<title>${escapeHtml(practice)} 7-day meal plan</title>
<style>
  :root {
    --accent: ${accent};
    --accent-ink: ${ink};
    --fridge: #07130d;
    --ink: #0c1210;
    --mute: #3e5148;
    --line: #cfd9d2;
    --paper: #eef2ee;
    --surface: #fff;
    --leaf: #1f9d4a;
    --amber: #c47a12;
    --blue: #2f6fed;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; max-width: 100%; overflow-x: clip; }
  body {
    font-family: Georgia, "Iowan Old Style", Palatino, serif;
    color: var(--ink);
    background: var(--paper);
    font-size: 16px;
    line-height: 1.45;
  }
  img, svg { max-width: 100%; }
  h1, h2, h3, .ui, .btn, .kicker, .slot, .badge, .stamp, .ring-num, .ring-label, .day-head, .total, .fm {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .num, .price, .ring-copy strong, .day-head span, .macros { font-variant-numeric: tabular-nums; }
  .mast { background: var(--fridge); color: #fff; padding: 0 0 52px; }
  .accent-bar { height: 6px; background: var(--accent); }
  .mast-inner { width: min(1120px, 100%); margin: 0 auto; padding: 18px 16px 0; }
  .mast-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .fm { margin: 0; font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #b7e2c4; }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; margin-top: 16px; }
  .logo, #share-logo {
    width: 64px; height: 64px; max-width: 64px; flex: 0 0 64px;
    border-radius: 6px; object-fit: cover; background: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }
  .mark {
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, sans-serif; font-weight: 800; font-size: 1.4rem;
    color: var(--accent-ink); background: var(--accent);
  }
  .brand-copy { min-width: 0; }
  .kicker { margin: 0 0 2px; font-size: .75rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #b7e2c4; }
  h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.4rem); letter-spacing: -.04em; line-height: 1.05; overflow-wrap: break-word; }
  .plan-title { margin: 6px 0 0; color: rgba(255,255,255,.82); font-size: 1rem; }
  .client { margin: 8px 0 0; font-family: system-ui, sans-serif; font-weight: 700; font-size: .95rem; }
  main { width: min(1120px, 100%); margin: -32px auto 0; padding: 0 16px 40px; }
  .summary, .shops, .day, .aisle {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .summary { padding: 14px 12px 12px; }
  .rings { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .ring { display: flex; flex-direction: column; align-items: center; min-width: 0; }
  .ring-face { position: relative; width: 68px; max-width: 100%; }
  .ring-svg { width: 100%; height: auto; display: block; transform: rotate(-90deg); }
  .track { fill: none; stroke: #d7e2db; stroke-width: 3.2; }
  .val { fill: none; stroke-width: 3.2; stroke-linecap: round; }
  .ring-num {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: system-ui, sans-serif; font-size: .95rem; letter-spacing: -.03em; line-height: 1;
  }
  .ring-label { margin-top: 4px; font-family: system-ui, sans-serif; font-size: .75rem; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--mute); }
  .meta { margin: 12px 0 0; color: var(--mute); font-size: .92rem; }
  .flags { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 10px 0 0; padding: 0; }
  .flags li { font-family: system-ui, sans-serif; font-size: .75rem; font-weight: 700; padding: 4px 8px; border-radius: 99px; background: #e7f3eb; color: #14532d; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 10px 0 0; padding: 0; list-style: none; color: var(--mute); font-family: system-ui, sans-serif; font-size: .8rem; font-weight: 700; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .legend .p { background: var(--leaf); }
  .legend .c { background: var(--amber); }
  .legend .f { background: var(--blue); }
  .shops { margin-top: 12px; padding: 12px; }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
  .badge {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--line); border-radius: 6px;
    font-size: .8rem; font-weight: 800; color: var(--ink); background: var(--paper);
    text-align: center; padding: 8px 4px;
  }
  .badge.is-on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .stamp { margin: 8px 0 0; font-size: .8rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
  .section-label { margin: 22px 0 8px; font-size: .8rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); }
  .week { display: grid; grid-template-columns: 1fr; gap: 12px; min-width: 0; }
  .day { padding: 10px; min-width: 0; }
  .day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .day-head h2 { margin: 0; font-size: 1.05rem; letter-spacing: -.03em; }
  .day-head span { color: var(--ink); font-weight: 800; font-size: .85rem; }
  .macrobar { display: flex; height: 6px; border-radius: 99px; overflow: hidden; background: #e4ebe4; margin: 8px 0 10px; }
  .macrobar .p { background: var(--leaf); }
  .macrobar .c { background: var(--amber); }
  .macrobar .f { background: var(--blue); }
  .meals { display: grid; gap: 8px; }
  .tile {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-width: 0;
    background: var(--paper);
    border-radius: 6px;
    border-top: 3px solid var(--slot, var(--leaf));
    padding: 8px;
  }
  .food { width: 100%; height: auto; display: block; border-radius: 4px; }
  .tile-copy { min-width: 0; }
  .slot { margin: 0; font-size: .75rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--slot, var(--mute)); }
  .tile h3 { margin: 1px 0 2px; font-size: .98rem; letter-spacing: -.02em; line-height: 1.2; overflow-wrap: break-word; }
  .macros, .ings, .note, .meta { overflow-wrap: anywhere; }
  .macros { margin: 0; color: var(--mute); font-size: .82rem; }
  .ings { margin: 4px 0 0; font-size: .82rem; color: var(--ink); }
  .aisle { margin-top: 10px; padding: 4px 12px 2px; }
  .aisle h3 {
    display: flex; justify-content: space-between; gap: 8px;
    margin: 10px 0 0; font-size: .75rem; letter-spacing: .07em; text-transform: uppercase; color: var(--mute);
  }
  .aisle ul { list-style: none; margin: 0; padding: 0; }
  .line {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    padding: 10px 0; border-bottom: 1px dashed var(--line); min-width: 0;
  }
  .aisle li:last-child { border-bottom: 0; }
  .item-name { min-width: 0; }
  .special {
    display: inline-block; margin-left: 6px; font-style: normal;
    font-family: system-ui, sans-serif; font-size: .75rem; font-weight: 800;
    letter-spacing: .04em; text-transform: uppercase; color: #14532d;
  }
  .price { flex: 0 0 auto; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: .88rem; }
  .total {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    margin: 12px 0 0; padding: 14px; border-radius: 6px;
    background: var(--accent); color: var(--accent-ink); font-size: 1.15rem; font-weight: 800;
  }
  .note { margin: 8px 0 0; color: var(--mute); font-size: .9rem; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    min-height: 48px; margin-top: 14px; padding: 0 16px;
    background: var(--fridge); color: #fff; text-decoration: none; border-radius: 6px; font-weight: 800;
  }
  .btn:focus-visible, .badge:focus-visible { outline: 2px solid var(--leaf); outline-offset: 2px; }
  footer { border-top: 1px solid var(--line); margin-top: 22px; padding-top: 12px; }
  footer p { margin: 0; color: var(--mute); font-size: .9rem; }
  @media (min-width: 760px) {
    .week { grid-template-columns: 1fr 1fr; }
    .rings { gap: 12px; }
    .ring-face { width: 84px; }
    .ring-num { font-size: 1.05rem; }
    .summary, .shops { padding: 16px; }
  }
  @media (min-width: 1100px) {
    .week { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
    .day-head { flex-direction: column; align-items: flex-start; gap: 0; }
    .tile { grid-template-columns: 1fr; align-items: start; padding: 6px; }
    .tile h3 { font-size: .86rem; }
    .macros, .ings { font-size: .72rem; }
    .btn { width: fit-content; min-width: 200px; }
  }
  @media print {
    html, body { background: #fff; overflow: visible; }
    .no-print { display: none !important; }
    .mast, .badge.is-on, .total, .macrobar span, .food, .val, .accent-bar {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .mast { padding-bottom: 16px; }
    main { margin-top: 0; }
    .week { grid-template-columns: 1fr 1fr !important; }
    .tile { grid-template-columns: 88px minmax(0, 1fr) !important; break-inside: avoid; }
    .day, .aisle, .line { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    @page { margin: 12mm; size: A4; }
  }
</style>
</head>
<body>
<header class="mast">
  <div class="accent-bar"></div>
  <div class="mast-inner">
    <div class="mast-top"><p class="fm">FitMunch</p></div>
    <div class="brand">
      ${logo
        ? `<img id="share-logo" alt="" width="64" height="64" src="${logo}"/>`
        : `<div class="logo mark" aria-hidden="true">${monogram}</div>`}
      <div class="brand-copy">
        <p class="kicker">Trainer</p>
        <h1 id="share-practice">${escapeHtml(practice)}</h1>
        <p class="plan-title">7-day meal plan</p>
        <p class="client" id="share-client">${escapeHtml(client)}</p>
      </div>
    </div>
  </div>
</header>
<main>
  <section class="summary" aria-label="Daily targets">
    <div class="rings">
      ${ring({ label: 'kcal', value: averages.kcal, unit: '', target: targets.kcal, color: accent })}
      ${ring({ label: 'Protein', value: averages.protein, unit: 'g', target: targets.protein, color: '#1f9d4a' })}
      ${ring({ label: 'Carbs', value: averages.carbs, unit: 'g', target: targets.carbs, color: '#c47a12' })}
      ${ring({ label: 'Fat', value: averages.fat, unit: 'g', target: targets.fat, color: '#2f6fed' })}
    </div>
    <p class="meta">Targets: ${escapeHtml(targets.kcal)} kcal, ${escapeHtml(targets.protein)}g protein, ${escapeHtml(targets.carbs)}g carbs, ${escapeHtml(targets.fat)}g fat. Household size ${escapeHtml(plan.householdSize)}. Rings show the draft daily average.</p>
    <ul class="legend" aria-hidden="true"><li><i class="p"></i>Protein</li><li><i class="c"></i>Carbs</li><li><i class="f"></i>Fat</li></ul>
    ${flagChips}
  </section>
  <section class="shops" aria-label="Stores">
    <ul class="badges">${badges}</ul>
    <p class="stamp">from public specials, draft</p>
  </section>
  <p class="section-label">The week</p>
  <div id="share-plan" class="week">${days}</div>
  <p class="section-label">${escapeHtml(storeName)} draft list</p>
  <div id="share-list">${aisles}</div>
  <p class="total" id="share-total">${escapeHtml(storeName)} total ${escapeHtml(money(plan.shopping && plan.shopping.totalAud))}</p>
  <p class="note" id="share-price-note">${escapeHtml(plan.priceNote || PRICE_NOTE)}</p>
  ${unpriced}
  <a class="btn no-print" id="share-pdf" href="/c/${escapeHtml(planRow.token)}/pdf">Download PDF</a>
  <footer>
    <p id="share-dietitian">${escapeHtml(DIETITIAN_LINE)}</p>
  </footer>
</main>
</body>
</html>`;
}

function renderMissing() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Plan link</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#0c1210;background:#eef2ee">
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
};
