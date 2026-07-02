/**
 * Generate App Store screenshots (1290x2796, 6.7" iPhone) from FitMunch brand
 * photography with headline overlays. Output: marketing/appstore/shot{1..5}.png
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const W = 1290, H = 2796;
const outDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const asset = (f) => path.resolve(outDir, '../../public/assets', f);

function overlay({ kicker, headline }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = headline.split('\n');
  const startY = 430;
  const headlineText = lines.map((l, i) =>
    `<text x="90" y="${startY + i * 118}" font-family="Segoe UI, Arial, sans-serif" font-size="104" font-weight="800" fill="#ffffff" letter-spacing="-2">${esc(l)}</text>`
  ).join('');
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#052e16" stop-opacity="0.96"/>
      <stop offset="0.62" stop-color="#052e16" stop-opacity="0.60"/>
      <stop offset="1" stop-color="#052e16" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#052e16" stop-opacity="0"/>
      <stop offset="1" stop-color="#052e16" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="820" fill="url(#top)"/>
  <rect x="0" y="${H - 360}" width="${W}" height="360" fill="url(#bot)"/>
  <!-- brand pill -->
  <rect x="90" y="120" rx="40" width="360" height="104" fill="#052e16" fill-opacity="0.85"/>
  <circle cx="150" cy="172" r="20" fill="#22c55e"/>
  <text x="188" y="205" font-family="Segoe UI, Arial, sans-serif" font-size="58" font-weight="800" fill="#ffffff">Fit<tspan fill="#4ade80">Munch</tspan></text>
  <text x="90" y="310" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700" fill="#86efac" letter-spacing="2">${esc(kicker.toUpperCase())}</text>
  ${headlineText}
  <text x="90" y="${H - 130}" font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="600" fill="#dcfce7">Free to start · fitmunch.com.au</text>
</svg>`);
}

const shots = [
  { src: 'fm-receipt-scan.webp', out: 'shot1.png', kicker: 'Receipt scanner', headline: 'Scan your shop.\nSee the macros.' },
  { src: 'fm-hero-mealprep.webp', out: 'shot2.png', kicker: 'AI meal plans', headline: 'A full week\nin 15 seconds.' },
  { src: 'fm-groceries.webp', out: 'shot3.png', kicker: 'Budget protein', headline: 'Hit your macros\nfor less.' },
  { src: 'fm-workout.webp', out: 'shot4.png', kicker: 'AI coach', headline: 'A coach that\nknows your week.' },
  { src: 'fm-hero-mealprep.webp', out: 'shot5.png', kicker: 'Your AI health partner', headline: 'Eat well.\nTrain smart.' },
];

for (const s of shots) {
  await sharp(asset(s.src))
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlay(s) }])
    .png()
    .toFile(path.resolve(outDir, s.out));
  console.log(s.out, Math.round(fs.statSync(path.resolve(outDir, s.out)).size / 1024) + 'KB');
}
console.log('done');
