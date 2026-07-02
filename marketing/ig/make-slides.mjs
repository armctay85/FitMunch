/**
 * Build 3 branded IG carousel slides (1080x1350) from brand photography
 * with quality text overlays per the FitMunch IG playbook.
 */
import sharp from 'sharp';
import fs from 'fs';

const W = 1080, H = 1350;
fs.mkdirSync('.tmp-ig', { recursive: true });

function overlaySVG({ hook, sub, tag }) {
  // Bottom gradient band + hook text + small brand tag.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const hookLines = hook.split('\n');
  const hookStartY = H - 150 - 64 - (hookLines.length - 1) * 82 - 96;
  const hookText = hookLines.map((line, i) =>
    `<text x="60" y="${hookStartY + i * 82}" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="800" fill="#ffffff" letter-spacing="-1">${esc(line)}</text>`
  ).join('');
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#052e16" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#052e16" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#052e16" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${H - 460}" width="${W}" height="460" fill="url(#fade)"/>
  <!-- brand pill top-left -->
  <rect x="48" y="48" rx="26" width="272" height="72" fill="#052e16" fill-opacity="0.82"/>
  <circle cx="92" cy="84" r="14" fill="#22c55e"/>
  <text x="118" y="98" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="800" fill="#ffffff">Fit<tspan fill="#4ade80">Munch</tspan></text>
  ${hookText}
  <text x="60" y="${H - 158}" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="600" fill="#bbf7d0">${esc(sub)}</text>
  <rect x="60" y="${H - 118}" rx="14" width="${tag.length * 21 + 48}" height="62" fill="#22c55e"/>
  <text x="84" y="${H - 75}" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="800" fill="#052e16">${esc(tag)}</text>
</svg>`);
}

const slides = [
  {
    src: 'public/assets/fm-groceries.webp',
    out: '.tmp-ig/slide1.jpg',
    hook: 'This $120 Woolies shop\n= 987g of protein',
    sub: 'Swipe to see how it becomes your week →',
    tag: 'fitmunch.com.au',
  },
  {
    src: 'public/assets/fm-hero-mealprep.webp',
    out: '.tmp-ig/slide2.jpg',
    hook: 'AI turned it into a\n7-day meal plan',
    sub: 'Real Woolies & Coles ingredients · 15 seconds',
    tag: 'Free to start',
  },
  {
    src: 'public/assets/fm-receipt-scan.webp',
    out: '.tmp-ig/slide3.jpg',
    hook: 'Scan your receipt.\nGet your macros.',
    sub: 'Your AI health partner — free at',
    tag: 'fitmunch.com.au',
  },
];

for (const s of slides) {
  await sharp(s.src)
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlaySVG(s) }])
    .jpeg({ quality: 88 })
    .toFile(s.out);
  const kb = Math.round(fs.statSync(s.out).size / 1024);
  console.log(`${s.out} ${kb}KB`);
}
console.log('done');
