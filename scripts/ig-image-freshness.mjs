/**
 * Kill soft calendar/shop-check posts. Any FitMunch IG publish must call this
 * after assertIgQualityGate. Tracks image SHA256 to ban reuse.
 */
import fs from 'fs';
import crypto from 'crypto';

const USED = process.env.FITMUNCH_IG_USED_IMAGES
  || 'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-used-images.json';

const BANNED_BASENAMES = [
  'fm-groceries.webp',
  'fm-hero-mealprep.webp',
  'fm-receipt-scan.webp',
  'budget-protein.jpg',
];

export function assertFreshImages(imagePaths, { allowRecycledBrand = false } = {}) {
  const errors = [];
  const store = fs.existsSync(USED) ? JSON.parse(fs.readFileSync(USED, 'utf8')) : { hashes: [], files: [] };
  for (const p of imagePaths) {
    const base = p.split(/[/\\]/).pop().toLowerCase();
    if (!allowRecycledBrand && BANNED_BASENAMES.includes(base)) {
      errors.push(`Recycled brand asset banned until new creative: ${base}`);
    }
    if (!fs.existsSync(p)) {
      errors.push(`Missing image: ${p}`);
      continue;
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (store.hashes.includes(hash)) {
      errors.push(`Image already used on FitMunch IG (sha ${hash.slice(0, 12)}…): ${p}`);
    }
  }
  if (errors.length) {
    const err = new Error(['IMAGE FRESHNESS GATE FAILED:', ...errors.map((e) => ` - ${e}`)].join('\n'));
    err.gateErrors = errors;
    throw err;
  }
  return true;
}

export function recordUsedImages(imagePaths) {
  const store = fs.existsSync(USED) ? JSON.parse(fs.readFileSync(USED, 'utf8')) : { hashes: [], files: [] };
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (!store.hashes.includes(hash)) {
      store.hashes.push(hash);
      store.files.push({ path: p, hash, at: new Date().toISOString() });
    }
  }
  fs.writeFileSync(USED, JSON.stringify(store, null, 2));
}
