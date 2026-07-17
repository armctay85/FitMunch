/**
 * Publish myth-tips gated carousel. Requires learning-loop decision first.
 */
import fs from 'fs';
import { assertIgQualityGate } from './ig-quality-gate.mjs';

const DECISION = 'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-daily-decision.json';
if (!fs.existsSync(DECISION)) {
  console.error('Run scripts/fitmunch-ig-learning-loop.mjs first');
  process.exit(1);
}
const decision = JSON.parse(fs.readFileSync(DECISION, 'utf8'));
if (decision.NEXT_PILLAR !== 'myth-tips' && decision.approachChange?.includes('RADICAL') === false) {
  console.warn('Decision pillar is', decision.NEXT_PILLAR, '— publishing myth-tips as approach break');
}

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

const caption = `This "healthy" yoghurt can have more sugar than a Mars bar.

Health-aisle branding is not a macro plan. Flip the pack. Compare sugar grams. Keep the staples that actually move protein and fibre.

FitMunch turns the real shop into meals that hit your targets — not vibes.

14-day Premium trial — link in bio.

#macrotracking #supermarketaustralia #nutritionaustralia #mealprepaustralia #highprotein`;

const imagePaths = ['.tmp-ig/slide-myth-1.jpg', '.tmp-ig/slide-myth-2.jpg', '.tmp-ig/slide-myth-3.jpg'];
const overlayTexts = [
  'Healthy aisle. Sugar bomb. Read the label',
  'Yoghurt vs Mars bar Compare sugar grams',
  'Build meals that hit macros Link in bio FitMunch',
];

const gate = assertIgQualityGate({
  caption,
  imagePaths,
  overlayTexts,
  pillar: 'myth-tips',
  utmCampaign: 'myth-tips',
  utmContent: 'healthy-yoghurt-sugar-20260717',
  altText:
    'Australian supermarket health aisle myth: flavoured yoghurt sugar compared to a Mars bar, then meal planning with FitMunch',
  allowPublish: true,
});
console.log('GATE PASS', gate.checklist);
console.log('BIO URL', gate.bioUrl);

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
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: cfg.accessToken,
    }),
  })
).json();
if (!pub.id) throw new Error(JSON.stringify(pub));

const meta = await (
  await fetch(
    `https://graph.facebook.com/v21.0/${pub.id}?fields=permalink&access_token=${encodeURIComponent(cfg.accessToken)}`
  )
).json();
console.log('permalink', meta.permalink);

fs.appendFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
  JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    postId: pub.id,
    platform: 'instagram',
    pillar: 'myth-tips',
    hook: 'This "healthy" yoghurt can have more sugar than a Mars bar',
    state: 'PUBLISHED',
    releaseURL: meta.permalink,
    utm_campaign: 'myth-tips',
    utm_content: 'healthy-yoghurt-sugar-20260717',
    qualityGate: gate.checklist,
    learningDecision: {
      NEXT_PILLAR: decision.NEXT_PILLAR,
      approachChange: decision.approachChange,
    },
    postedBy: 'cursor-agent',
    notes: 'Approach break — left receipt/protein dupe loop; learning loop enforced',
  }) + '\n'
);

decision.lastPublish = { id: pub.id, url: meta.permalink, pillar: 'myth-tips', at: new Date().toISOString() };
fs.writeFileSync(
  'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-daily-decision.json',
  JSON.stringify(decision, null, 2)
);
