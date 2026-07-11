import sharp from 'sharp';
import fs from 'fs';

fs.mkdirSync('.tmp-ig', { recursive: true });
const W = 1080;
const H = 1350;
const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#052e16"/>
      <stop offset="100%" stop-color="#14532d"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="60" y="180" font-family="Segoe UI, Arial" font-size="42" font-weight="700" fill="#86efac">FitMunch</text>
  <text x="60" y="520" font-family="Segoe UI, Arial" font-size="72" font-weight="800" fill="#ffffff">Price per 25g</text>
  <text x="60" y="610" font-family="Segoe UI, Arial" font-size="72" font-weight="800" fill="#ffffff">protein wins</text>
  <text x="60" y="720" font-family="Segoe UI, Arial" font-size="36" fill="#bbf7d0">Not shelf price. Real AU grocery math.</text>
  <text x="60" y="1260" font-family="Segoe UI, Arial" font-size="28" fill="#86efac">fitmunch.com.au</text>
</svg>`);

await sharp(svg).jpeg({ quality: 90 }).toFile('.tmp-ig/budget-protein.jpg');
console.log('wrote', fs.statSync('.tmp-ig/budget-protein.jpg').size);
