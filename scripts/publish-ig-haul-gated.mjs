/**
 * Publish receipt-haul gated carousel (link in bio only).
 */
import fs from 'fs';
import { assertIgQualityGate } from './ig-quality-gate.mjs';

const cfg = JSON.parse(fs.readFileSync('.ig-config.json', 'utf8')).instagram;
const KEY = process.env.POSTIZ_API_KEY || (() => {
  try {
    const env = fs.readFileSync('../multimate/.env', 'utf8');
    return env.match(/^POSTIZ_API_KEY=(.+)$/m)?.[1]?.trim();
  } catch {
    return '';
  }
})();

const caption = `Snap the Woolies docket. Get graded.

FitMunch reads the receipt, scores the haul for protein, and turns the same shop into meals for the week.

No spreadsheet. No guessing.

Free Premium trial — link in bio.

#mealprepaustralia #woolworthshaul #macrotracking #budgetmeals #highprotein`;

const imagePaths = ['.tmp-ig/slide-haul-1.jpg', '.tmp-ig/slide-haul-2.jpg', '.tmp-ig/slide-haul-3.jpg'];
const overlayTexts = [
  'Snap the Woolies docket Get graded in seconds',
  'See protein in the haul Not just calories',
  'Then plan the week Link in bio FitMunch',
];

const gate = assertIgQualityGate({
  caption,
  imagePaths,
  overlayTexts,
  pillar: 'receipt-haul',
  utmCampaign: 'receipt-haul',
  utmContent: 'woolies-docket-grade-20260716',
  altText:
    'Australian Woolworths receipt scan graded for protein, then turned into a weekly meal plan with FitMunch',
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
  console.log('uploaded', file);
  return j;
}

const uploaded = [];
for (const p of imagePaths) uploaded.push(await upload(p));

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
  if (!child.id) throw new Error('child create failed ' + JSON.stringify(child));
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
if (!container.id) throw new Error('container failed ' + JSON.stringify(container));

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

fs.appendFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
  JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    postId: pub.id,
    platform: 'instagram',
    pillar: 'receipt-haul',
    hook: 'Snap the Woolies docket. Get graded.',
    state: 'PUBLISHED',
    releaseURL: meta.permalink,
    utm_campaign: 'receipt-haul',
    utm_content: 'woolies-docket-grade-20260716',
    qualityGate: gate.checklist,
    postedBy: 'cursor-agent',
    notes: 'Gated receipt-haul carousel; cash sprint restart 2026-07-16',
  }) + '\n'
);
