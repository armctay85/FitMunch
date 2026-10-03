'use strict';

const { DIETITIAN_LINE } = require('./coach-plan');
const { sanitizePlan, plain, ingredientText, lineText, qtyText, groupShopping } = require('./sanitize-plan');

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

function macroLine(meal) {
  const parts = [];
  const kcal = finite(meal.kcal);
  const protein = finite(meal.protein);
  const carbs = finite(meal.carbs);
  const fat = finite(meal.fat);
  if (kcal != null) parts.push(`${kcal} kcal`);
  if (protein != null) parts.push(`${protein} g protein`);
  if (carbs != null) parts.push(`${carbs} g carbs`);
  if (fat != null) parts.push(`${fat} g fat`);
  return parts.join(' · ');
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
    kcal != null ? ['kcal', String(kcal)] : null,
    protein != null ? ['Protein', `${protein} g`] : null,
  ].filter(Boolean);

  const statHtml = stats.map(([dt, dd]) => `
    <div class="stat"><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd></div>`).join('');

  const tabs = days.map((day, index) => `
    <button class="tab" type="button" role="tab" id="day-tab-${index}" aria-controls="day-panel-${index}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}">${escapeHtml(plain(day.day, 'Day'))}</button>`).join('');

  const panels = days.map((day, index) => {
    const dayKcal = finite(day.kcal);
    const meals = (day.meals || []).map((meal) => {
      const macros = macroLine(meal);
      const ingredients = (meal.ingredients || []).map((ing) => `<li>${escapeHtml(ingredientText(ing))}</li>`).join('');
      return `
        <article class="meal">
          <p class="slot">${escapeHtml(plain(meal.slot, 'Meal'))}</p>
          <h3>${escapeHtml(plain(meal.name, 'Item'))}</h3>
          ${macros ? `<p class="macro">${escapeHtml(macros)}</p>` : ''}
          ${ingredients ? `<ul>${ingredients}</ul>` : ''}
        </article>`;
    }).join('');
    return `
    <section class="day-panel" role="tabpanel" id="day-panel-${index}" aria-labelledby="day-tab-${index}" ${index === 0 ? '' : 'hidden'}>
      <h2>${escapeHtml(plain(day.day, 'Day'))}${dayKcal != null ? `<span>${escapeHtml(String(dayKcal))} kcal</span>` : ''}</h2>
      ${meals || '<p class="macro">No meals on this day.</p>'}
    </section>`;
  }).join('');

  const groups = groupShopping(shopping.lines).map((group) => {
    const items = group.lines.map((line) => {
      const qty = qtyText(line);
      return `
        <li>
          <span class="item-name">${escapeHtml(lineText(line))}</span>
          ${qty ? `<span class="qty">${escapeHtml(qty)}</span>` : ''}
        </li>`;
    }).join('');
    return `
      <section>
        <h3 class="aisle">${escapeHtml(group.label)}</h3>
        <ul class="shop-grid">${items}</ul>
      </section>`;
  }).join('');

  return `${head(title)}
<style>
  :root { --accent: ${accent}; }
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
  .kicker, .stat dt, .slot, .qty, .macro, .day-panel h2 span {
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
  main { width: min(840px, 100%); margin: 0 auto; padding: 16px 16px 40px; }
  .summary {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .identity {
    display: flex; align-items: center; gap: 14px;
    background: var(--fridge); color: #fff;
    padding: 18px 16px;
  }
  .mark {
    width: 52px; height: 52px; border-radius: 8px;
    object-fit: cover; background: #fff; flex: 0 0 auto;
  }
  .mark-initials {
    display: grid; place-items: center;
    color: var(--fridge); letter-spacing: -0.04em; font-size: 1.05rem;
  }
  .kicker {
    margin: 0 0 4px; font-size: 0.72rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: #b7e2c4;
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
  }
  .day-switch {
    display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 12px;
  }
  .tab {
    flex: 1 1 0; min-width: 0; min-height: 44px;
    border: 1px solid var(--line); border-radius: 6px;
    background: #fff; color: var(--ink); font-size: 0.82rem;
    letter-spacing: -0.02em; cursor: pointer;
  }
  .tab[aria-selected="true"] { background: var(--fridge); border-color: var(--fridge); color: #fff; }
  .day-panel h2 {
    display: flex; justify-content: space-between; gap: 12px;
    margin: 0 0 10px; font-size: 1.05rem; letter-spacing: -0.03em;
  }
  .day-panel h2 span { color: var(--mute); font-size: 0.82rem; }
  .meal {
    background: #fff; border: 1px solid var(--line); border-radius: 6px;
    padding: 12px 14px; margin: 0 0 8px; min-width: 0;
  }
  .slot {
    margin: 0; font-size: 0.68rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--leaf2);
  }
  .meal h3 {
    margin: 2px 0 4px; font-size: 1.05rem; letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .macro { margin: 0; color: var(--mute); font-size: 0.82rem; line-height: 1.4; }
  .meal ul { margin: 8px 0 0; padding-left: 18px; }
  .meal li { margin: 2px 0; overflow-wrap: anywhere; }
  .shop-head { margin: 22px 0 4px; }
  .shop-head h2 { margin: 0; font-size: 1.25rem; letter-spacing: -0.03em; }
  .aisle {
    margin: 14px 0 8px; font-size: 0.75rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--mute);
  }
  .shop-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    list-style: none; margin: 0; padding: 0;
  }
  .shop-grid li {
    min-width: 0; background: #fff; border: 1px solid var(--line);
    border-radius: 6px; padding: 8px 10px;
  }
  .item-name {
    display: block; font-size: 0.92rem; line-height: 1.35; overflow-wrap: anywhere;
  }
  .qty { display: block; margin-top: 4px; color: var(--mute); font-size: 0.75rem; }
  .note { color: var(--mute); font-size: 0.92rem; margin: 14px 0 0; }
  .btn {
    display: flex; align-items: center; justify-content: center;
    min-height: 48px; margin-top: 14px; background: var(--fridge);
    color: #fff; text-decoration: none; border-radius: 6px; letter-spacing: -0.02em;
  }
  footer { border-top: 1px solid var(--line); margin-top: 28px; padding-top: 14px; }
  footer p { margin: 0; color: var(--mute); font-size: 0.92rem; }
  @media (min-width: 800px) {
    main { padding: 28px 24px 56px; }
    h1 { font-size: 2rem; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
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
  <div class="day-switch" id="share-days" role="tablist" aria-label="Days">${tabs}</div>
  ${panels}
  <div class="shop-head"><h2>${escapeHtml(storeName)} draft list</h2></div>
  <div id="share-list">${groups}</div>
  <p class="note" id="share-price-note">${escapeHtml(plan.priceNote)}</p>
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
      panel.hidden = i !== index;
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
