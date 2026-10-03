'use strict';

const { DIETITIAN_LINE } = require('./coach-plan');
const {
  sanitizePlan,
  plain,
  ingredientParts,
  lineText,
  needText,
  groupShopping,
  macroParts,
} = require('./sanitize-plan');

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

function accentInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return y > 0.62 ? '#07130d' : '#ffffff';
}

function safeLogo(value) {
  if (typeof value !== 'string') return '';
  return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

function finite(value) {
  if (value == null || value === '' || value === 'undefined' || value === 'null') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function label(value) {
  return plain(value, '').trim();
}

function initials(name) {
  const parts = label(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function planTitle(plan) {
  const named = label(plan.name || plan.title);
  if (named) return named;
  const count = (plan.days || []).length;
  if (count === 1) return '1-day meal plan';
  if (count > 1) return `${count}-day meal plan`;
  return 'Meal plan';
}

function mealsPerDay(days) {
  const counts = (days || []).map((day) => (day.meals || []).length);
  if (!counts.length) return null;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? String(min) : `${min} to ${max}`;
}

function head(title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<meta name="theme-color" content="#07130d"/>
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="32x32"/>
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg"/>
<link rel="stylesheet" href="/css/fm-coach-fonts.css"/>
<link rel="stylesheet" href="/css/fm-tokens.css"/>
`;
}

function renderSharePage({ planRow, branding }) {
  const plan = sanitizePlan(planRow && planRow.plan);
  const shopping = plan.shopping || { lines: [], storeName: '' };
  const accent = safeAccent(branding && branding.accent);
  const ink = accentInk(accent);
  const practice = label(branding && branding.practiceName);
  const logo = safeLogo(branding && branding.logoDataUrl);
  const title = planTitle(plan);
  const identity = practice || 'FitMunch';
  const days = plan.days || [];
  const mealCount = mealsPerDay(days);
  const kcal = finite(plan.targets && plan.targets.kcal);
  const protein = finite(plan.targets && plan.targets.protein);
  const client = label(planRow && planRow.clientLabel) || 'Client';
  const storeName = label(shopping.storeName) || 'Store';

  let mark = '';
  if (logo) {
    mark = `<img class="mark" id="share-logo" alt="" src="${logo}"/>`;
  } else if (practice) {
    mark = `<div class="mark mark-initials" aria-hidden="true">${escapeHtml(initials(practice))}</div>`;
  } else {
    mark = '<img class="mark" alt="" src="/assets/logo.svg"/>';
  }

  const stats = [
    ['Days', String(days.length)],
    mealCount != null ? ['Meals a day', mealCount] : null,
    kcal != null ? ['kcal', `${kcal} kcal`] : null,
    protein != null ? ['Protein', `${protein} g`] : null,
  ].filter(Boolean);

  const statHtml = stats.map(([dt, dd]) => `
    <div class="stat"><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd></div>`).join('');

  const tabs = days.map((day, index) => `
    <button class="tab" type="button" role="tab" id="day-tab-${index}" aria-controls="day-panel-${index}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}">${escapeHtml(plain(day.day, 'Day'))}</button>`).join('');

  const panels = days.map((day, index) => {
    const dayKcal = finite(day.kcal);
    const meals = (day.meals || []).map((meal) => {
      const macros = macroParts(meal).map((part) => `<span>${escapeHtml(part)}</span>`).join('');
      const ingredients = (meal.ingredients || []).map((ing) => {
        const parts = ingredientParts(ing);
        const amt = parts.qty ? `<span class="amt">${escapeHtml(parts.qty)}</span> ` : '';
        return `<li>${amt}<span class="ing-name">${escapeHtml(parts.name)}</span></li>`;
      }).join('');
      return `
        <article class="meal">
          <p class="slot">${escapeHtml(plain(meal.slot, 'Meal'))}</p>
          <h3>${escapeHtml(plain(meal.name, 'Item'))}</h3>
          ${macros ? `<p class="macro">${macros}</p>` : ''}
          ${ingredients ? `<ul>${ingredients}</ul>` : ''}
        </article>`;
    }).join('');
    return `
    <section class="day-panel${index === 0 ? '' : ' is-hidden'}" role="tabpanel" id="day-panel-${index}" aria-labelledby="day-tab-${index}">
      <h2>${escapeHtml(plain(day.day, 'Day'))}${dayKcal != null ? `<span>${escapeHtml(String(dayKcal))} kcal</span>` : ''}</h2>
      ${meals || '<p class="macro">No meals on this day.</p>'}
    </section>`;
  }).join('');

  const groups = groupShopping(shopping.lines).map((group) => {
    const items = group.lines.map((line) => {
      const qty = needText(line);
      const id = `${group.key}|${lineText(line)}|${qty}`;
      return `
        <li>
          <label class="shop-row">
            <input class="tick" type="checkbox" data-id="${escapeHtml(id)}"/>
            <span class="item-name">${escapeHtml(lineText(line))}</span>
            ${qty ? `<span class="qty">${escapeHtml(qty)}</span>` : ''}
          </label>
        </li>`;
    }).join('');
    return `
      <section class="aisle-block">
        <h3 class="aisle">${escapeHtml(group.label)} <span class="count">· ${group.lines.length}</span></h3>
        <ul class="shop-grid">${items}</ul>
      </section>`;
  }).join('');

  return `${head(title)}
<style>
  :root { --accent: ${accent}; --accent-ink: ${ink}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; max-width: 100%; overflow-x: hidden; }
  body {
    font-family: 'Literata', Georgia, serif;
    background: var(--paper);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  button { font: inherit; }
  h1, h2, h3, .btn, .tab, .stat dd, .mark-initials {
    font-family: 'Bricolage Grotesque', 'Literata', Georgia, serif;
    font-weight: 800;
  }
  .kicker, .stat dt, .slot, .qty, .macro, .amt, .count, .day-panel h2 span {
    font-family: 'IBM Plex Mono', 'Literata', Georgia, serif;
    font-weight: 500;
  }
  .skip {
    position: absolute; left: 12px; top: 12px; z-index: 2;
    background: var(--leaf); color: #fff; padding: 8px 12px;
    text-decoration: none; border-radius: 6px;
    transform: translateY(-160%);
  }
  .skip:focus { transform: none; }
  main { width: min(1200px, 100%); margin: 0 auto; padding: 16px 16px 40px; }
  .summary {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .identity {
    display: flex; align-items: center; gap: 14px;
    background: var(--accent); color: var(--accent-ink);
    padding: 18px 16px;
  }
  .mark {
    width: 52px; height: 52px; border-radius: 8px;
    object-fit: cover; background: #fff; flex: 0 0 auto;
  }
  .mark-initials {
    display: grid; place-items: center;
    color: var(--accent); letter-spacing: -0.04em; font-size: 1.05rem;
  }
  .kicker {
    margin: 0 0 4px; font-size: 0.72rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--accent-ink); opacity: 0.82;
  }
  h1 {
    margin: 0; font-size: 1.65rem; line-height: 1.05;
    letter-spacing: -0.04em; overflow-wrap: anywhere;
  }
  .client { margin: 0; padding: 12px 16px 0; color: var(--mute); font-size: 0.98rem; }
  .stats {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
    margin: 12px 0 0; background: var(--line); border-top: 1px solid var(--line);
  }
  .stat { background: #fff; padding: 12px 16px 14px; min-width: 0; }
  .stat dt {
    margin: 0; font-size: 0.68rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--mute);
  }
  .stat dd {
    margin: 4px 0 0; font-size: 1.35rem; letter-spacing: -0.04em; color: var(--ink);
    white-space: nowrap;
  }
  .layout { display: block; }
  .day-switch {
    display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 12px;
  }
  .tab {
    flex: 0 0 auto; min-height: 44px; padding: 0 14px;
    border: 1px solid var(--line); border-radius: 999px;
    background: #fff; color: var(--ink); font-size: 0.82rem;
    letter-spacing: -0.02em; cursor: pointer;
  }
  .tab[aria-selected="true"] {
    background: var(--accent); border-color: var(--accent); color: var(--accent-ink);
  }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .day-panel.is-hidden { display: none; }
  .day-panel h2 {
    display: flex; justify-content: space-between; gap: 12px;
    margin: 0 0 10px; font-size: 1.05rem; letter-spacing: -0.03em;
  }
  .day-panel h2 span { color: var(--mute); font-size: 0.82rem; white-space: nowrap; }
  .meal {
    background: #fff; border: 1px solid var(--line); border-radius: 8px;
    padding: 12px 14px; margin: 0 0 8px; min-width: 0;
  }
  .slot {
    margin: 0; font-size: 0.68rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--accent);
  }
  .meal h3 {
    margin: 2px 0 6px; font-size: 1.05rem; letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .macro {
    display: flex; flex-wrap: wrap; gap: 4px 12px;
    margin: 0; color: var(--mute); font-size: 0.82rem; line-height: 1.4;
  }
  .macro span, .amt, .qty { white-space: nowrap; }
  .meal ul { margin: 8px 0 0; padding-left: 18px; }
  .meal li { margin: 3px 0; }
  .ing-name { overflow-wrap: anywhere; }
  .shop {
    background: #fff; border: 1px solid var(--line); border-radius: 8px;
    padding: 14px; margin-top: 18px;
  }
  .shop-head { margin: 0 0 4px; }
  .shop-head h2 { margin: 0; font-size: 1.2rem; letter-spacing: -0.03em; }
  .aisle {
    margin: 14px 0 8px; font-size: 0.75rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--mute);
  }
  .count { color: var(--accent); letter-spacing: 0; text-transform: none; }
  .shop-grid {
    display: grid; grid-template-columns: 1fr; gap: 8px;
    list-style: none; margin: 0; padding: 0;
  }
  .shop-row {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px; align-items: center; min-height: 44px;
    background: var(--paper); border-radius: 6px; padding: 8px 10px;
    cursor: pointer;
  }
  .tick { width: 20px; height: 20px; margin: 0; accent-color: var(--accent); }
  .item-name { font-size: 0.95rem; line-height: 1.3; overflow-wrap: anywhere; }
  .qty { color: var(--mute); font-size: 0.75rem; }
  .shop-row:has(input:checked) .item-name { color: var(--mute); text-decoration: line-through; }
  .note { color: var(--mute); font-size: 0.88rem; margin: 14px 0 0; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    min-height: 48px; margin-top: 14px; background: var(--accent);
    color: var(--accent-ink); text-decoration: none; border-radius: 8px; letter-spacing: -0.02em;
  }
  footer { border-top: 1px solid var(--line); margin-top: 28px; padding-top: 14px; }
  footer p { margin: 0; color: var(--mute); font-size: 0.92rem; }
  @media (min-width: 800px) {
    h1 { font-size: 2rem; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
  @media (min-width: 1024px) {
    main { padding: 28px 24px 56px; }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: 20px;
      align-items: start;
      margin-top: 16px;
    }
    .shop {
      position: sticky; top: 16px; margin-top: 0;
      max-height: calc(100vh - 32px); overflow: auto;
    }
    .shop-grid { grid-template-columns: 1fr 1fr; }
    .shop-row { grid-template-columns: auto minmax(0, 1fr); align-items: start; }
    .item-name { font-size: 0.88rem; }
    .qty { grid-column: 2; }
    .day-switch { margin-top: 0; }
  }
  @media print {
    body { background: #fff; }
    .skip, .day-switch, #share-pdf, .tick { display: none !important; }
    .day-panel.is-hidden { display: block !important; }
    .layout { display: block !important; }
    .shop { position: static; max-height: none; overflow: visible; }
    .meal, .shop-row { break-inside: avoid; page-break-inside: avoid; }
    .aisle, .shop-head h2, .day-panel h2, .meal h3 { break-after: avoid; page-break-after: avoid; }
    .btn { display: none !important; }
  }
</style>
</head>
<body>
<a class="skip" href="#share-days">Skip to meals</a>
<main>
  <section class="summary" id="share-summary">
    <div class="identity">
      ${mark}
      <div>
        <p class="kicker" id="share-practice">${escapeHtml(identity)}</p>
        <h1 id="share-title">${escapeHtml(title)}</h1>
      </div>
    </div>
    <p class="client" id="share-client">For ${escapeHtml(client)}</p>
    <dl class="stats">${statHtml}</dl>
  </section>
  <div class="layout">
    <div class="meals">
      <div class="day-switch" id="share-days" role="tablist" aria-label="Days">${tabs}</div>
      ${panels}
    </div>
    <aside class="shop" id="share-shop">
      <div class="shop-head"><h2>${escapeHtml(storeName)} draft list</h2></div>
      <div id="share-list">${groups}</div>
      <p class="note" id="share-price-note">${escapeHtml(plan.priceNote)}</p>
    </aside>
  </div>
  <a class="btn" id="share-pdf" href="/c/${escapeHtml(planRow.token)}/pdf">Download PDF</a>
  <footer>
    <p id="share-dietitian">${escapeHtml(DIETITIAN_LINE)}</p>
  </footer>
</main>
<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.day-panel');
  function openDay(index) {
    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (panel, i) {
      panel.classList.toggle('is-hidden', i !== index);
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { openDay(i); });
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      var next = event.key === 'ArrowRight' ? i + 1 : i - 1;
      if (next < 0) next = tabs.length - 1;
      if (next >= tabs.length) next = 0;
      openDay(next);
      tabs[next].focus();
    });
  });
  var box = document.getElementById('share-list');
  if (!box || !window.localStorage) return;
  var key = 'fm-shop:' + location.pathname;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { saved = {}; }
  box.querySelectorAll('.tick').forEach(function (input) {
    var id = input.getAttribute('data-id');
    input.checked = !!saved[id];
    input.addEventListener('change', function () {
      saved[id] = input.checked;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) {}
    });
  });
})();
</script>
</body>
</html>`;
}

function renderMissing() {
  return `${head('Plan link')}
<style>
  body {
    margin: 0; font-family: 'Literata', Georgia, serif;
    background: var(--paper); color: var(--ink);
  }
  main { width: min(560px, 100%); margin: 0 auto; padding: 32px 16px; }
  h1 { font-family: 'Bricolage Grotesque', 'Literata', Georgia, serif; font-weight: 800; letter-spacing: -0.03em; }
  p { color: var(--mute); }
</style>
</head>
<body>
<main>
  <h1>This plan link is not available.</h1>
  <p>Ask your trainer for a new link.</p>
</main>
</body>
</html>`;
}

module.exports = { renderSharePage, renderMissing, escapeHtml };
