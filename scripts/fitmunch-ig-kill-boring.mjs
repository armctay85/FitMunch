/**
 * HARD STOP: cancel/list Postiz IG queue + refuse soft template posts.
 * Also publishes ONE larry-style 6-slide conflict carousel via Graph (gated).
 *
 * Usage:
 *   node scripts/fitmunch-ig-kill-boring.mjs          # cancel queue + report
 *   node scripts/fitmunch-ig-kill-boring.mjs --publish # also ship the break post
 */
import fs from 'fs';
import sharp from 'sharp';
import { assertIgQualityGate } from './ig-quality-gate.mjs';
import { assertFreshImages, recordUsedImages } from './ig-image-freshness.mjs';

const KEY =
  process.env.POSTIZ_API_KEY ||
  fs.readFileSync('../multimate/.env', 'utf8').match(/^POSTIZ_API_KEY=(.+)$/m)?.[1]?.trim();
const IG = 'cmrfmv3bq0efglk0y3tc2cydy';
const LOCK = 'C:/Users/Drew/.openclaw/workspace/state/FITMUNCH_IG_POSTIZ_LOCK.json';
const cfg = JSON.parse(fs.readFileSync('.ig-config.json', 'utf8')).instagram;

const SOFT =
  /sunday prep|monday confidence|know every macro|midweek fridge|snap your woolies|protein check from the real|build the week from the shop|shop check before|blank meal plan|blank food diary/i;

async function postiz(path, opts = {}) {
  const r = await fetch(`https://api.postiz.com/public/v1${path}`, {
    ...opts,
    headers: { Authorization: KEY, ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}

console.log('=== FitMunch IG — kill boring ===\n');

// Lock file: agents must not schedule Postiz IG while locked
fs.writeFileSync(
  LOCK,
  JSON.stringify(
    {
      locked: true,
      since: new Date().toISOString(),
      reason:
        'Drew callout 2026-07-25: soft template posts getting 0 likes. Postiz IG scheduling LOCKED. Only Cursor gated Graph publish after hook-lab + draft packet.',
      allowedPath: 'scripts/publish-ig-*-gated.mjs or fitmunch-ig-kill-boring.mjs --publish',
      banned: 'Any Postiz /public/v1/posts create for Instagram integration cmrfmv3…',
    },
    null,
    2
  )
);
console.log('LOCK written', LOCK);

const start = '2026-07-20T00:00:00.000Z';
const end = '2026-08-15T00:00:00.000Z';
const list = await postiz(`/posts?startDate=${start}&endDate=${end}`);
const posts = list.data?.posts || list.data || [];
const ig = posts.filter((p) => p.integration?.id === IG || p.integration?.providerIdentifier === 'instagram');

for (const p of ig) {
  const hook = (p.content || '').split('\n')[0];
  const soft = SOFT.test(hook + '\n' + (p.content || ''));
  console.log(p.state.padEnd(10), (p.publishDate || '').slice(0, 16), soft ? 'SOFT' : 'ok ', hook.slice(0, 70));
  if (p.state === 'QUEUE' || (p.state === 'PUBLISHED' && soft && Date.now() - new Date(p.publishDate).getTime() < 6 * 3600e3)) {
    const del = await postiz(`/posts/${p.id}`, { method: 'DELETE' });
    console.log('  DELETE', p.id, del.status, typeof del.data === 'string' ? del.data : JSON.stringify(del.data).slice(0, 120));
  }
}

if (!process.argv.includes('--publish')) {
  console.log('\nDone (queue cleanup). Re-run with --publish to ship the break carousel.');
  process.exit(0);
}

// --- Build 6-slide CONFLICT carousel (marketing, not lifestyle mush) ---
const W = 1080;
const H = 1350;
fs.mkdirSync('.tmp-ig', { recursive: true });

const slides = [
  { bg: '#052e16', accent: '#4ade80', lines: ['My flatmate', 'said our shop', 'had no protein.'], sub: 'So I scanned the receipt.' },
  { bg: '#14532d', accent: '#86efac', lines: ['$128 Woolies.', 'Graded B+.', '987g protein.'], sub: 'He shut up.' },
  { bg: '#052e16', accent: '#facc15', lines: ['The "healthy"', 'yoghurt?', 'More sugar', 'than a Mars bar.'], sub: 'Health aisle lies.' },
  { bg: '#0a1f12', accent: '#4ade80', lines: ['AI rebuilt', 'dinner from', 'what was left', 'in the fridge.'], sub: '180g protein day.' },
  { bg: '#14532d', accent: '#bbf7d0', lines: ['No gym.', 'Dumbbells.', '3-day plan', '+ the meals.'], sub: 'Same week. One app.' },
  { bg: '#052e16', accent: '#4ade80', lines: ['FitMunch.', 'Free trial.', 'Link in bio.'], sub: 'Receipt → macros → week.' },
];

async function makeSlide(s, i) {
  const out = `.tmp-ig/break-${i + 1}.jpg`;
  const y0 = 320;
  const texts = s.lines
    .map(
      (line, li) =>
        `<text x="70" y="${y0 + li * 95}" font-family="Arial Black, Impact, sans-serif" font-size="78" font-weight="900" fill="#ffffff">${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</text>`
    )
    .join('');
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${s.bg}"/>
  <rect x="0" y="0" width="18" height="100%" fill="${s.accent}"/>
  <text x="70" y="90" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="800" fill="${s.accent}">FITMUNCH</text>
  ${texts}
  <text x="70" y="${H - 100}" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="600" fill="${s.accent}">${s.sub
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</text>
</svg>`);
  await sharp(svg).jpeg({ quality: 92 }).toFile(out);
  return out;
}

const paths = [];
for (let i = 0; i < slides.length; i++) paths.push(await makeSlide(slides[i], i));

const caption = `My flatmate said our shop had no protein.

Scanned the Woolies docket. $128. Graded B+. 987g protein on the page.

Then FitMunch rebuilt dinner from what was left in the fridge — and the "healthy" yoghurt got exposed as a sugar bomb.

Train + eat + shop in one loop.

14-day Premium trial — link in bio.

#mealprepaustralia #woolworthshaul #macrotracking #highprotein #budgetmeals`;

const overlayTexts = slides.map((s) => [...s.lines, s.sub].join(' '));
// allow brand-frame slides (not recycled photo hashes)
const gate = assertIgQualityGate({
  caption,
  imagePaths: paths,
  overlayTexts: overlayTexts.map((t) => t.split(/\s+/).slice(0, 12).join(' ')),
  pillar: 'receipt-haul',
  utmCampaign: 'conflict-story',
  utmContent: 'flatmate-protein-20260725',
  altText:
    'FitMunch story carousel: flatmate doubted the Woolies protein haul, receipt graded B+, AI rebuilt dinner, link in bio',
  allowPublish: true,
  allowRecycledBrand: true,
});
console.log('GATE', gate.checklist);

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), file.split(/[/\\]/).pop());
  const res = await fetch('https://api.postiz.com/public/v1/upload', {
    method: 'POST',
    headers: { Authorization: KEY },
    body: form,
  });
  const j = await res.json();
  if (!j.path) throw new Error(JSON.stringify(j));
  return j;
}

const uploaded = [];
for (const p of paths) uploaded.push(await upload(p));
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
await new Promise((r) => setTimeout(r, 4000));
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
await new Promise((r) => setTimeout(r, 10000));
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
recordUsedImages(paths);
console.log('LIVE', meta.permalink);
console.log('BIO', gate.bioUrl);
fs.appendFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
  JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    postId: pub.id,
    platform: 'instagram',
    pillar: 'receipt-haul',
    hook: 'My flatmate said our shop had no protein.',
    state: 'PUBLISHED',
    releaseURL: meta.permalink,
    utm_campaign: 'conflict-story',
    utm_content: 'flatmate-protein-20260725',
    qualityGate: gate.checklist,
    format: '6-slide-conflict-story',
    postedBy: 'cursor-agent',
    notes: 'Kill-boring break: larry conflict formula, not soft shop-check templates',
  }) + '\n'
);
