/**
 * Publish ONE gate-compliant FitMunch IG carousel.
 * - No raw URLs in caption (link in bio only)
 * - Brand photography carousel
 * - Quality gate must pass
 */
import fs from 'fs';
import { assertIgQualityGate } from './ig-quality-gate.mjs';

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

const caption = `987g protein from one Woolies run.

Ignore shelf price. Compare price per 25g protein instead — eggs, Greek yoghurt, tuna, lentils, cottage cheese, tofu and marked-down chicken all win on different weeks.

Snap the receipt. FitMunch grades the haul and turns it into meals for the week.

Free to start — link in bio.

#mealprepaustralia #macrotracking #woolworthshaul #budgetmeals #highprotein`;

const imagePaths = ['.tmp-ig/slide-1.jpg', '.tmp-ig/slide-2.jpg', '.tmp-ig/slide-3.jpg'];
const overlayTexts = [
  'Price per 25g protein wins Not shelf price',
  'Scan the Woolies receipt Macros from the real shop',
  'Then build the week Link in bio FitMunch',
];

const gate = assertIgQualityGate({
  caption,
  imagePaths,
  overlayTexts,
  pillar: 'budget-protein',
  utmCampaign: 'budget-protein',
  utmContent: 'woolies-987g-quality',
  altText:
    'Australian groceries and meal prep: compare protein by price per 25 grams, scan a Woolworths receipt, plan the week with FitMunch',
  allowPublish: true,
});
console.log('GATE PASS', gate.checklist);
console.log('Set IG bio website to:', gate.bioUrl);

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), file.split(/[/\\]/).pop());
  const res = await fetch('https://api.postiz.com/public/v1/upload', {
    method: 'POST',
    headers: { Authorization: KEY },
    body: form,
  });
  const j = await res.json();
  if (!j.path) throw new Error('upload failed ' + JSON.stringify(j));
  console.log('uploaded', file, '->', j.path);
  return j;
}

const uploaded = [];
for (const p of imagePaths) uploaded.push(await upload(p));

// Carousel via Graph: create children, then container, then publish
const children = [];
for (const u of uploaded) {
  const child = await (
    await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: u.path,
        is_carousel_item: 'true',
        access_token: cfg.accessToken,
      }),
    })
  ).json();
  console.log('child', child);
  if (!child.id) throw new Error('child create failed');
  children.push(child.id);
}

await new Promise((r) => setTimeout(r, 3000));
const container = await (
  await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}/media`, {
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
console.log('container', container);
if (!container.id) throw new Error('container failed');

await new Promise((r) => setTimeout(r, 8000));
const pub = await (
  await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: cfg.accessToken,
    }),
  })
).json();
console.log('pub', pub);
if (!pub.id) process.exit(1);

const meta = await (
  await fetch(
    `https://graph.facebook.com/v20.0/${pub.id}?fields=permalink&access_token=${cfg.accessToken}`
  )
).json();
console.log('permalink', meta.permalink);

// Best-effort: update IG bio website to tracked URL
const bio = await (
  await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      website: gate.bioUrl,
      access_token: cfg.accessToken,
    }),
  })
).json();
console.log('bio update attempt', bio);

fs.appendFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
  JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    postId: pub.id,
    platform: 'instagram',
    pillar: 'budget-protein',
    hook: '987g protein from one Woolies run',
    state: 'PUBLISHED',
    releaseURL: meta.permalink,
    utm_campaign: 'budget-protein',
    utm_content: 'woolies-987g-quality',
    qualityGate: gate.checklist,
    postedBy: 'cursor-agent',
    notes: 'Replaced flat SVG posts; link-in-bio only; brand photo carousel',
  }) + '\n'
);
