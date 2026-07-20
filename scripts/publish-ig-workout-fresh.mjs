/**
 * High-hook workout/AI carousel using FRESH images only (not recycled brand webps).
 * Image reuse ban: refuses if source files match known recycled set.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertIgQualityGate } from './ig-quality-gate.mjs';

const W = 1080;
const H = 1350;
const USED = 'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-used-images.json';

const sources = [
  { src: '.tmp-ig/fresh-dumbbell-prep.png', out: '.tmp-ig/slide-hook-1.jpg', hook: 'No gym.\nStill trained.', sub: '3-day dumbbell plan' },
  { src: '.tmp-ig/fresh-coach-phone.png', out: '.tmp-ig/slide-hook-2.jpg', hook: 'AI built\nthe week', sub: 'Meals + lifts together' },
  { src: '.tmp-ig/fresh-label-trap.png', out: '.tmp-ig/slide-hook-3.jpg', hook: 'Then hit\nthe macros', sub: 'Link in bio · FitMunch' },
];

for (const s of sources) {
  if (!fs.existsSync(s.src)) throw new Error('Missing fresh asset: ' + s.src + ' — run gen-fresh-ig-assets.mjs');
  if (/fm-groceries|fm-hero-mealprep|fm-receipt-scan/.test(s.src)) {
    throw new Error('Recycled brand webp banned: ' + s.src);
  }
}

function overlaySvg({ hook, sub }) {
  const lines = hook.split('\n');
  const hookText = lines
    .map(
      (line, i) =>
        `<text x="56" y="${H - 250 + i * 72}" font-family="Arial Black, Segoe UI, sans-serif" font-size="62" font-weight="900" fill="#ffffff">${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</text>`
    )
    .join('');
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0.88"/>
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

const hashes = fs.existsSync(USED) ? JSON.parse(fs.readFileSync(USED, 'utf8')) : { hashes: [] };

for (const s of sources) {
  const buf = fs.readFileSync(s.src);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hashes.hashes.includes(hash)) throw new Error('Image already used on IG: ' + s.src);
  const n = `${s.hook} ${s.sub}`.split(/\s+/).length;
  if (n > 12) throw new Error('overlay too long');
  await sharp(s.src)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlaySvg(s), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(s.out);
  hashes.hashes.push(hash);
  console.log('wrote', s.out);
}
fs.writeFileSync(USED, JSON.stringify(hashes, null, 2));

const caption = `No gym. Still trained.

3 days. Dumbbells at home. AI built the lifts AND the meals around the same week — so dinner stops being a coin flip after work.

This is the loop FitMunch is for: train → eat → shop → repeat.

14-day Premium trial — link in bio.

#homeworkoutaustralia #macrotracking #mealprepaustralia #dumbbellworkout #aicoach`;

const imagePaths = sources.map((s) => s.out);
const overlayTexts = sources.map((s) => `${s.hook.replace(/\n/g, ' ')} ${s.sub}`);

const gate = assertIgQualityGate({
  caption,
  imagePaths,
  overlayTexts,
  pillar: 'workout-plans',
  utmCampaign: 'workout-plans',
  utmContent: 'no-gym-still-trained-20260721',
  altText:
    'Home dumbbell workout and AI meal coaching for busy Australians — FitMunch Premium trial',
  allowPublish: true,
});

const cfg = JSON.parse(fs.readFileSync('.ig-config.json', 'utf8')).instagram;
const KEY =
  process.env.POSTIZ_API_KEY ||
  (() => {
    try {
      return fs.readFileSync('../multimate/.env', 'utf8').match(/^POSTIZ_API_KEY=(.+)$/m)?.[1]?.trim();
    } catch {
      return '';
    }
  })();
if (!KEY) throw new Error('POSTIZ_API_KEY missing');

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), path.basename(file));
  const res = await fetch('https://api.postiz.com/public/v1/upload', {
    method: 'POST',
    headers: { Authorization: KEY },
    body: form,
  });
  const j = await res.json();
  if (!j.path) throw new Error(JSON.stringify(j));
  return j;
}

console.log('GATE PASS', gate.checklist);
const uploaded = [];
for (const p of imagePaths) uploaded.push(await upload(p));

const children = [];
for (const u of uploaded) {
  const child = await (
    await fetch(`https://graph.facebook.com/v21.0/${cfg.businessAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: u.path,
        is_carousel_item: 'true',
        access_token: cfg.accessToken,
      }),
    })
  ).json();
  if (!child.id) throw new Error(JSON.stringify(child));
  children.push(child.id);
}

await new Promise((r) => setTimeout(r, 3000));
const container = await (
  await fetch(`https://graph.facebook.com/v21.0/${cfg.businessAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
      access_token: cfg.accessToken,
    }),
  })
).json();
if (!container.id) throw new Error(JSON.stringify(container));
await new Promise((r) => setTimeout(r, 8000));
const pub = await (
  await fetch(`https://graph.facebook.com/v21.0/${cfg.businessAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: container.id, access_token: cfg.accessToken }),
  })
).json();
if (!pub.id) throw new Error(JSON.stringify(pub));
const meta = await (
  await fetch(
    `https://graph.facebook.com/v21.0/${pub.id}?fields=permalink&access_token=${encodeURIComponent(cfg.accessToken)}`
  )
).json();
console.log('permalink', meta.permalink);
console.log('BIO', gate.bioUrl);

fs.appendFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
  JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    postId: pub.id,
    platform: 'instagram',
    pillar: 'workout-plans',
    hook: 'No gym. Still trained.',
    state: 'PUBLISHED',
    releaseURL: meta.permalink,
    utm_campaign: 'workout-plans',
    utm_content: 'no-gym-still-trained-20260721',
    qualityGate: gate.checklist,
    freshAssets: true,
    postedBy: 'cursor-agent',
    notes: 'Broke recycled webp loop; conflict hook; workout pillar',
  }) + '\n'
);
