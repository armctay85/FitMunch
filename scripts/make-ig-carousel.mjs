/**
 * Build a gate-compliant FitMunch IG carousel from brand photography.
 * Overlays ≤12 words. Output: .tmp-ig/slide-1.jpg … slide-3.jpg (1080×1350)
 */
import sharp from 'sharp';
import fs from 'fs';

fs.mkdirSync('.tmp-ig', { recursive: true });
const W = 1080;
const H = 1350;

const slides = [
  {
    src: '.tmp-ig/fm-groceries.webp',
    out: '.tmp-ig/slide-1.jpg',
    hook: 'Price per 25g\nprotein wins',
    sub: 'Not shelf price',
  },
  {
    src: '.tmp-ig/fm-receipt-scan.webp',
    out: '.tmp-ig/slide-2.jpg',
    hook: 'Scan the\nWoolies receipt',
    sub: 'Macros from the real shop',
  },
  {
    src: '.tmp-ig/fm-hero-mealprep.webp',
    out: '.tmp-ig/slide-3.jpg',
    hook: 'Then build\nthe week',
    sub: 'Link in bio · FitMunch',
  },
];

function overlaySvg({ hook, sub }) {
  const lines = hook.split('\n');
  const hookText = lines
    .map(
      (line, i) =>
        `<text x="56" y="${H - 240 + i * 70}" font-family="Arial Black, Segoe UI, sans-serif" font-size="58" font-weight="900" fill="#ffffff">${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</text>`
    )
    .join('');
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.78"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="56" y="72" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#86efac">FitMunch</text>
  ${hookText}
  <text x="56" y="${H - 70}" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#bbf7d0">${sub
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</text>
</svg>`);
}

for (const s of slides) {
  const overlayWords = `${s.hook} ${s.sub}`.split(/\s+/).length;
  if (overlayWords > 12) throw new Error(`Overlay too long (${overlayWords}): ${s.hook}`);
  await sharp(s.src)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlaySvg(s), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(s.out);
  console.log('wrote', s.out, fs.statSync(s.out).size, 'overlayWords', overlayWords);
}
console.log('DONE');
