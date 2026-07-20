/**
 * FitMunch external publish quality gate.
 * HARD FAIL before any IG/Reddit/Postiz/Graph publish.
 *
 * Usage:
 *   import { assertIgQualityGate } from './ig-quality-gate.mjs';
 *   assertIgQualityGate({ caption, imagePaths, pillar, utmCampaign, utmContent, altText });
 */
import fs from 'fs';
import path from 'path';
import { assertFreshImages } from './ig-image-freshness.mjs';

const FORBIDDEN_IG_URL = /https?:\/\/|www\.fitmunch\.com\.au\/\?/i;
const LINK_IN_BIO_OK = /link in bio/i;
const MAX_OVERLAY_WORDS = 12;
const FEED_W = 1080;
const FEED_H = 1350;
const ASPECT_TOL = 0.08; // 4:5 ≈ 0.8

export function wordCount(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function assertIgQualityGate(input) {
  const errors = [];
  const {
    caption = '',
    imagePaths = [],
    pillar = '',
    utmCampaign = '',
    utmContent = '',
    altText = '',
    overlayTexts = [],
    allowPublish = false,
  } = input;

  if (!allowPublish) {
    errors.push('allowPublish=false — set explicitly after human/agent gate review');
  }

  // 1. Hook
  const firstLine = caption.split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (wordCount(firstLine) < 3) errors.push('Hook too weak: first line needs a stop-worthy hook');
  if (
    /budget protein tip|stop comparing shelf price|same grocery budget|same weekly shop|snap the woolies|price per 25g protein wins|987g protein from one woolies|monday protein check|sunday shop check|build the week from the shop|protein check from the real shop|meal-plan draft/i.test(
      firstLine
    )
  ) {
    errors.push('Hook is a near-duplicate of the dead receipt/protein loop — rotate pillar/hook');
  }
  // Soft / no-conflict hooks die on IG
  if (/^(monday|sunday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(firstLine) && wordCount(firstLine) < 8) {
    errors.push('Hook is calendar filler, not a stop-scroll conflict — rewrite');
  }
  if (/check from the real shop|before the week starts|shop you already did/i.test(firstLine)) {
    errors.push('Hook has no conflict/curiosity — rewrite with a punchier first line');
  }

  // 2. Link discipline — IG captions must NOT contain raw URLs (not clickable in feed)
  if (FORBIDDEN_IG_URL.test(caption)) {
    errors.push(
      'IG caption contains a raw URL. Instagram feed links are NOT clickable. Use “link in bio” + set bio UTM instead.'
    );
  }
  if (!LINK_IN_BIO_OK.test(caption)) {
    errors.push('CTA must say “link in bio” (bio carries the tracked UTM URL)');
  }

  // 3. Images
  if (!imagePaths.length) errors.push('No images — feed posts require real media');
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      errors.push(`Missing image file: ${p}`);
      continue;
    }
    const ext = path.extname(p).toLowerCase();
    if (ext === '.svg') errors.push(`SVG graphics banned for feed: ${p}`);
    const base = path.basename(p).toLowerCase();
    if (/budget-protein\.jpg|gradient|slide-text-only/.test(base)) {
      errors.push(`Banned flat/AI-slop graphic: ${p} — use brand photography`);
    }
    const size = fs.statSync(p).size;
    if (size < 40_000) errors.push(`Image too small/likely low quality (${size}b): ${p}`);
  }

  // 4. Overlay word budget
  for (const t of overlayTexts) {
    const n = wordCount(t);
    if (n > MAX_OVERLAY_WORDS) {
      errors.push(`Overlay exceeds ${MAX_OVERLAY_WORDS} words (${n}): "${t}"`);
    }
  }

  // 5. Pillar / UTM metadata (for bio + ledger — not pasted in caption)
  if (!pillar) errors.push('Missing pillar tag');
  if (!utmCampaign) errors.push('Missing utm_campaign for bio/ledger');
  if (!utmContent) errors.push('Missing utm_content for bio/ledger');
  if (!altText || altText.length < 20) errors.push('Alt text missing or too short');

  // 6. Medical / shame
  if (/lose \d+\s*kg|guaranteed|cure|diagnose/i.test(caption)) {
    errors.push('Medical/shame claim detected');
  }

  // 7. Hashtag spam
  const tags = caption.match(/#[\w]+/g) || [];
  if (tags.length > 6) errors.push(`Too many hashtags (${tags.length}) — max 5–6 AU-relevant`);
  if (tags.some((t) => /#fyp|#viral|#explorepage/i.test(t))) {
    errors.push('Spam hashtags banned');
  }

  // 8. Image freshness (no more recycled groceries/mealprep/receipt loop)
  try {
    assertFreshImages(imagePaths, { allowRecycledBrand: input.allowRecycledBrand === true });
  } catch (e) {
    for (const line of String(e.message || e).split('\n').slice(1)) {
      if (line.trim()) errors.push(line.replace(/^\s*-\s*/, ''));
    }
  }

  if (errors.length) {
    const msg = ['IG QUALITY GATE FAILED:', ...errors.map((e) => ` - ${e}`)].join('\n');
    const err = new Error(msg);
    err.gateErrors = errors;
    throw err;
  }

  return {
    ok: true,
    bioUrl: `https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=organic&utm_campaign=${encodeURIComponent(utmCampaign)}&utm_content=${encodeURIComponent(utmContent)}`,
    checklist: {
      hook: true,
      noRawUrl: true,
      linkInBioCta: true,
      images: true,
      overlays: true,
      pillar: true,
      utm: true,
      altText: true,
      hashtags: true,
    },
  };
}

/** Quick self-test when run directly */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('ig-quality-gate.mjs')) {
  try {
    assertIgQualityGate({
      caption: 'x',
      imagePaths: [],
      allowPublish: true,
    });
  } catch (e) {
    console.log('Gate correctly blocked bad payload');
    console.log(e.message);
  }
}
