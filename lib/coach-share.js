'use strict';

const { DIETITIAN_LINE } = require('./coach-plan');
const { sanitizePlan } = require('./sanitize-plan');

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

function renderSharePage({ planRow, branding }) {
  const plan = sanitizePlan(planRow && planRow.plan);
  const shopping = plan.shopping || { lines: [], storeName: '' };
  const accent = safeAccent(branding && branding.accent);
  const practice = (branding && branding.practiceName) ? branding.practiceName : 'Your trainer';
  const logo = safeLogo(branding && branding.logoDataUrl);
  const days = (plan.days || []).map((day) => `
    <section class="day">
      <h2>${escapeHtml(day.day)} <span>${escapeHtml(day.kcal)} kcal</span></h2>
      ${day.meals.map((meal) => `
        <article>
          <h3>${escapeHtml(meal.slot)}: ${escapeHtml(meal.name)}</h3>
          <p>${escapeHtml(meal.kcal)} kcal · ${escapeHtml(meal.protein)}g protein · ${escapeHtml(meal.carbs)}g carbs · ${escapeHtml(meal.fat)}g fat</p>
          <ul>
            ${meal.ingredients.map((ing) => `<li>${escapeHtml(ing.amount)} ${escapeHtml(ing.unit)} ${escapeHtml(ing.name)}</li>`).join('')}
          </ul>
        </article>`).join('')}
    </section>`).join('');
  const lines = (shopping.lines || []).map((line) => `
    <li class="line">
      <span>${escapeHtml(line.packs)} x ${escapeHtml(line.name)}</span>
      <span>${escapeHtml(line.aisle)}</span>
      <span>${escapeHtml(line.amount)} ${escapeHtml(line.unit)}</span>
    </li>`).join('');
  const targets = plan.targets || {};
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>7-day meal plan</title>
<style>
  :root { --accent: ${accent}; --ink:#0c1210; --mute:#5c6d64; --line:#cfd9d2; --paper:#eef2ee; }
  * { box-sizing: border-box; }
  html, body { margin:0; max-width:100%; overflow-x:hidden; }
  body { font-family: Georgia, "Iowan Old Style", serif; color:var(--ink); background:var(--paper); }
  header { background:var(--accent); color:#fff; padding:20px 16px 18px; }
  header .brand { display:flex; align-items:center; gap:12px; }
  header img { width:48px; height:48px; object-fit:cover; border-radius:6px; background:#fff; }
  h1, h2, h3, .btn, .kicker { font-family: system-ui, sans-serif; }
  .kicker { margin:0 0 4px; font-size:.78rem; letter-spacing:.04em; text-transform:uppercase; }
  h1 { margin:0; font-size:1.55rem; letter-spacing:-.03em; line-height:1.1; }
  main { width:min(720px, 100%); margin:0 auto; padding:16px 16px 32px; }
  .meta, .note, footer p, article p { color:var(--mute); }
  .meta { font-size:.95rem; line-height:1.45; }
  h2 { display:flex; justify-content:space-between; gap:12px; font-size:1.05rem; margin:22px 0 8px; }
  h2 span { font-weight:600; color:var(--mute); }
  article { background:#fff; border:1px solid var(--line); border-radius:6px; padding:12px; margin:0 0 8px; }
  h3 { margin:0 0 4px; font-size:1rem; }
  article p, .meta, .note { font-size:.92rem; }
  ul { margin:8px 0 0; padding-left:18px; }
  .list { list-style:none; margin:0; padding:0; }
  .line { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .btn { display:flex; align-items:center; justify-content:center; min-height:48px; margin-top:14px; background:var(--accent); color:#fff; text-decoration:none; border-radius:4px; font-weight:700; }
  .note { margin-top:8px; }
  footer { border-top:1px solid var(--line); margin-top:28px; padding-top:14px; }
  footer p { margin:0; font-size:.9rem; }
</style>
</head>
<body>
<header>
  <div class="brand">
    ${logo ? `<img id="share-logo" alt="" src="${logo}"/>` : ''}
    <div>
      <p class="kicker" id="share-practice">${escapeHtml(practice)}</p>
      <h1>7-day meal plan</h1>
    </div>
  </div>
</header>
<main>
  <p class="meta" id="share-client">${escapeHtml(planRow.clientLabel || 'Client')}</p>
  <p class="meta">Targets: ${escapeHtml(targets.kcal)} kcal, ${escapeHtml(targets.protein)}g protein, ${escapeHtml(targets.carbs)}g carbs, ${escapeHtml(targets.fat)}g fat. Household size ${escapeHtml(plan.householdSize)}.</p>
  <div id="share-plan">${days}</div>
  <h2>${escapeHtml(shopping.storeName)} draft list</h2>
  <ul class="list" id="share-list">${lines}</ul>
  <p class="note" id="share-price-note">${escapeHtml(plan.priceNote)}</p>
  <a class="btn" id="share-pdf" href="/c/${escapeHtml(planRow.token)}/pdf">Download PDF</a>
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
<body style="font-family:system-ui,sans-serif;padding:24px">
<h1>This plan link is not available.</h1>
<p>Ask your trainer for a new link.</p>
</body></html>`;
}

module.exports = { renderSharePage, renderMissing, escapeHtml };
