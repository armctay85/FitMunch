'use strict';

function scene(tint, body) {
  return `<svg class="food" viewBox="0 0 160 108" width="160" height="108" aria-hidden="true" focusable="false"><rect width="160" height="108" rx="8" fill="${tint}"/>${body}</svg>`;
}

const BOWL = `<path d="M34 58h92c0 24-20 40-46 40S34 82 34 58z" fill="#fff"/><ellipse cx="80" cy="58" rx="46" ry="15" fill="#f6f1e6"/><path d="M36 58c2 8 20 14 44 14s42-6 44-14" fill="none" stroke="#e4dccb" stroke-width="2"/>`;

const ARTS = {
  yoghurt: scene('#f6f1e6', `${BOWL}<ellipse cx="80" cy="56" rx="34" ry="10" fill="#fbfaf6"/><circle cx="62" cy="52" r="6" fill="#8e3a55"/><circle cx="76" cy="48" r="5" fill="#c45b78"/><circle cx="90" cy="53" r="4.5" fill="#6d2e4a"/><circle cx="102" cy="49" r="3.5" fill="#a34b66"/><circle cx="70" cy="58" r="2" fill="#e6d3a3"/><circle cx="84" cy="60" r="1.6" fill="#e6d3a3"/>`),
  'eggs-toast': scene('#f8f1e4', `<rect x="36" y="38" width="78" height="44" rx="8" fill="#e2b15c"/><rect x="42" y="44" width="66" height="32" rx="5" fill="#f3d7a2"/><ellipse cx="64" cy="60" rx="15" ry="11" fill="#fffef8"/><ellipse cx="90" cy="58" rx="14" ry="10" fill="#fffef8"/><circle cx="64" cy="60" r="4.5" fill="#f0b429"/><circle cx="91" cy="58" r="4" fill="#e09a1b"/><ellipse cx="124" cy="74" rx="12" ry="7" fill="#2f8f4e"/><ellipse cx="132" cy="66" rx="8" ry="5" fill="#3e8f55"/>`),
  eggs: scene('#f8f1e4', `<ellipse cx="62" cy="58" rx="22" ry="28" fill="#fffef8"/><ellipse cx="100" cy="58" rx="22" ry="28" fill="#f7f3ea"/><ellipse cx="62" cy="58" rx="8" ry="8" fill="#f0b429"/><ellipse cx="100" cy="58" rx="8" ry="8" fill="#e09a1b"/>`),
  'peanut-oats': scene('#f6f1e6', `${BOWL}<ellipse cx="80" cy="56" rx="32" ry="10" fill="#e7d3a4"/><path d="M58 70c10-28 34-28 44 0" fill="#f2d15a"/><path d="M96 62c8 2 12 10 8 16" fill="none" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/><ellipse cx="70" cy="54" rx="10" ry="4" fill="#c48a3a"/>`),
  oats: scene('#f6f1e6', `${BOWL}<ellipse cx="80" cy="56" rx="32" ry="10" fill="#e7d3a4"/><circle cx="64" cy="52" r="3" fill="#d7b56a"/><circle cx="78" cy="48" r="2.4" fill="#c9a15a"/><circle cx="92" cy="53" r="2.8" fill="#e6d3a3"/>`),
  chicken: scene('#e7f3eb', `<ellipse cx="78" cy="64" rx="40" ry="22" fill="#f4efe4"/><ellipse cx="70" cy="60" rx="16" ry="10" fill="#e7c7a1"/><ellipse cx="92" cy="66" rx="14" ry="8" fill="#efd3b4"/><circle cx="112" cy="48" r="10" fill="#2f8f4e"/><circle cx="124" cy="58" r="7" fill="#3e8f55"/><circle cx="48" cy="52" r="8" fill="#2f8f4e"/>`),
  tuna: scene('#eef3f1', `<ellipse cx="78" cy="66" rx="36" ry="20" fill="#f4efe4"/><ellipse cx="58" cy="52" rx="20" ry="14" fill="#d5dde2"/><ellipse cx="58" cy="52" rx="12" ry="8" fill="#eef2f4"/><rect x="48" y="46" width="20" height="4" rx="1" fill="#8aa0a8"/><ellipse cx="108" cy="58" rx="14" ry="8" fill="#7dba6a"/><ellipse cx="112" cy="72" rx="10" ry="6" fill="#6aaa5a"/>`),
  salmon: scene('#f8efe8', `<path d="M40 66c18-20 48-22 70-8 8 18-6 28-28 30-22 2-40-6-42-22z" fill="#e07a5f"/><path d="M58 60c12 4 24 4 36-2" fill="none" stroke="#f4c7b4" stroke-width="2"/><path d="M62 70c10 3 20 2 30-4" fill="none" stroke="#f4c7b4" stroke-width="2"/><ellipse cx="118" cy="46" rx="12" ry="8" fill="#e08a3c"/><ellipse cx="128" cy="62" rx="10" ry="7" fill="#efb07a"/><ellipse cx="46" cy="42" rx="10" ry="6" fill="#2f8f4e"/>`),
  pasta: scene('#f8f3e8', `${BOWL}<path d="M52 52c8 8 8 8 16 0s8-8 16 0 8 8 16 0" fill="none" stroke="#f0d48a" stroke-width="4" stroke-linecap="round"/><path d="M56 62c8 6 8 6 14 0s8-6 14 0 8 6 14 0" fill="none" stroke="#e2b15c" stroke-width="3" stroke-linecap="round"/><circle cx="104" cy="50" r="7" fill="#d4533c"/><circle cx="64" cy="48" r="5" fill="#a24b3a"/>`),
  stir: scene('#e7f3eb', `<path d="M36 70c8 16 80 18 92-2 2-16-20-28-46-26S28 54 36 70z" fill="#24362c"/><path d="M58 62c16-8 28-6 40 2" fill="none" stroke="#e7c7a1" stroke-width="6" stroke-linecap="round"/><circle cx="70" cy="56" r="6" fill="#d64545"/><circle cx="96" cy="54" r="5" fill="#e08a3c"/><circle cx="84" cy="66" r="5" fill="#2f8f4e"/>`),
  tray: scene('#f3eee4', `<rect x="36" y="34" width="88" height="52" rx="8" fill="#c96a3a"/><rect x="42" y="40" width="76" height="40" rx="4" fill="#e08a3c"/><rect x="48" y="46" width="18" height="14" rx="3" fill="#d64545"/><rect x="72" y="46" width="16" height="14" rx="3" fill="#6aaa5a"/><rect x="94" y="46" width="16" height="14" rx="3" fill="#3e8f55"/><ellipse cx="62" cy="70" rx="10" ry="5" fill="#efd3b4"/>`),
  mince: scene('#f8efe8', `<ellipse cx="80" cy="64" rx="42" ry="24" fill="#f4efe4"/><ellipse cx="72" cy="60" rx="18" ry="12" fill="#a24b3a"/><ellipse cx="96" cy="66" rx="14" ry="9" fill="#8e3a32"/><circle cx="112" cy="50" r="8" fill="#2f8f4e"/><circle cx="50" cy="52" r="6" fill="#3e8f55"/>`),
  rice: scene('#f7f4ee', `<ellipse cx="80" cy="64" rx="42" ry="24" fill="#f4efe4"/><circle cx="64" cy="58" r="3" fill="#fff"/><circle cx="74" cy="66" r="2.4" fill="#fff"/><circle cx="86" cy="56" r="2.6" fill="#fff"/><circle cx="96" cy="66" r="2.2" fill="#fff"/><circle cx="108" cy="58" r="7" fill="#6aaa5a"/><circle cx="52" cy="60" r="6" fill="#e08a3c"/>`),
  veg: scene('#e7f3eb', `<circle cx="58" cy="54" r="16" fill="#2f8f4e"/><circle cx="78" cy="48" r="12" fill="#3e8f55"/><circle cx="96" cy="58" r="14" fill="#6aaa5a"/><ellipse cx="70" cy="74" rx="16" ry="8" fill="#e08a3c"/><ellipse cx="102" cy="76" rx="12" ry="6" fill="#d64545"/>`),
  banana: scene('#f8f6e8', `<path d="M46 70c8-36 48-40 70-16" fill="none" stroke="#f2d15a" stroke-width="16" stroke-linecap="round"/><path d="M46 70c8-36 48-40 70-16" fill="none" stroke="#c9a227" stroke-width="2" stroke-linecap="round"/><path d="M112 50c6 2 10 8 8 12" fill="none" stroke="#6a8f3a" stroke-width="3" stroke-linecap="round"/>`),
  'banana-pb': scene('#f8f6e8', `<path d="M40 68c6-30 40-34 58-12" fill="none" stroke="#f2d15a" stroke-width="14" stroke-linecap="round"/><ellipse cx="108" cy="58" rx="22" ry="16" fill="#c48a3a"/><ellipse cx="108" cy="58" rx="12" ry="8" fill="#e2b56a"/>`),
  tub: scene('#f7f4ee', `<rect x="50" y="36" width="60" height="44" rx="8" fill="#fff"/><rect x="50" y="36" width="60" height="14" rx="6" fill="#e7e1d6"/><rect x="62" y="58" width="36" height="8" rx="3" fill="#f4efe4"/><rect x="74" y="18" width="6" height="22" rx="2" fill="#c9a15a"/>`),
  'cheese-cuke': scene('#f8f6e8', `<path d="M48 78l28-46 28 46z" fill="#f2c14e"/><path d="M62 78l14-24 14 24z" fill="#e2b56a"/><ellipse cx="116" cy="58" rx="16" ry="22" fill="#6aaa5a"/><ellipse cx="116" cy="50" rx="5" ry="3" fill="#e7f3eb"/><ellipse cx="116" cy="64" rx="5" ry="3" fill="#e7f3eb"/>`),
  plate: scene('#f3f6f3', `<ellipse cx="80" cy="60" rx="48" ry="28" fill="#fff"/><ellipse cx="80" cy="60" rx="30" ry="16" fill="#e7f3eb"/><circle cx="70" cy="56" r="6" fill="#2f8f4e"/><circle cx="90" cy="62" r="5" fill="#e08a3c"/>`),
};

function artKey(name, slot) {
  const n = String(name || '').toLowerCase();
  if (n.includes('banana') && n.includes('peanut')) return 'banana-pb';
  if (n.includes('cheese') && n.includes('cucumber')) return 'cheese-cuke';
  if (n.includes('tray')) return 'tray';
  if (n.includes('stir')) return 'stir';
  if (n.includes('pasta')) return 'pasta';
  if (n.includes('salmon')) return 'salmon';
  if (n.includes('tuna')) return 'tuna';
  if (n.includes('chicken')) return 'chicken';
  if (n.includes('mince')) return 'mince';
  if (n.includes('rice') && n.includes('veg')) return 'rice';
  if (n.includes('vegetable')) return 'veg';
  if (n.includes('boiled egg')) return 'eggs';
  if (n.includes('egg')) return 'eggs-toast';
  if (n.includes('peanut')) return 'peanut-oats';
  if (n.includes('yoghurt') || n.includes('yogurt')) return 'yoghurt';
  if (n.includes('banana')) return 'banana';
  if (n.includes('cottage') || n.includes('tub')) return 'tub';
  if (n.includes('oat')) return 'oats';
  if (slot === 'Breakfast') return 'oats';
  if (slot === 'Snack') return 'banana';
  if (slot === 'Dinner') return 'plate';
  return 'plate';
}

function foodSvg(name, slot) {
  return ARTS[artKey(name, slot)] || ARTS.plate;
}

module.exports = { artKey, foodSvg, ARTS };
