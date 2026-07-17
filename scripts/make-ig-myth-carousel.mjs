/**
 * Myth-tips gated carousel — breaks the Woolies/protein dupe loop.
 */
import sharp from 'sharp';
import fs from 'fs';

fs.mkdirSync('.tmp-ig', { recursive: true });
const W = 1080;
const H = 1350;

const slides = [
  {
    src: '.tmp-ig/fm-groceries.webp',
    out: '.tmp-ig/slide-myth-1.jpg',
    hook: 'Healthy aisle.\nSugar bomb.',
    sub: 'Read the label',
  },
  {
    src: '.tmp-ig/fm-receipt-scan.webp',
    out: '.tmp-ig/slide-myth-2.jpg',
    hook: 'Yoghurt vs\nMars bar',
    sub: 'Compare sugar grams',
  },
  {
    src: '.tmp-ig/fm-hero-mealprep.webp',
    out: '.tmp-ig/slide-myth-3.jpg',
    hook: 'Build meals\nthat hit macros',
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
  const n = `${s.hook} ${s.sub}`.split(/\s+/).length;
  if (n > 12) throw new Error('overlay too long ' + n);
  await sharp(s.src)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlaySvg(s), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(s.out);
  console.log('wrote', s.out);
}
console.log('DONE');
