'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HASH_LEN = 12;

// /js and /css are cached for a day plus a week of stale-while-revalidate.
// The query is the file bytes, so a new deploy's HTML names a URL the old
// cache entry cannot satisfy. Static servers ignore the query when reading
// the file. The CDN cache key includes it.
const ASSET_ATTR = /(\s(?:href|src)=["'])(\/(?:js|css)\/[^"'?\s]+)(?:\?v=[0-9a-f]+)?(["'])/gi;

function contentHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);
}

function assetFile(urlPath) {
  const rel = String(urlPath || '').split('?')[0].replace(/^\//, '');
  return path.join(PUBLIC_DIR, rel);
}

function assetQuery(urlPath) {
  return contentHash(fs.readFileSync(assetFile(urlPath)));
}

function versionedUrl(urlPath) {
  const clean = String(urlPath).split('?')[0];
  return `${clean}?v=${assetQuery(clean)}`;
}

function stampHtml(html) {
  return String(html).replace(ASSET_ATTR, (full, pre, url, post) => `${pre}${versionedUrl(url)}${post}`);
}

function htmlFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFilesUnder(abs));
    else if (entry.name.endsWith('.html')) out.push(abs);
  }
  return out;
}

function stampTargets() {
  return [
    ...htmlFilesUnder(PUBLIC_DIR),
    ...htmlFilesUnder(path.join(__dirname, '..', 'private')),
  ];
}

function unstampedAssetRefs(html) {
  const refs = [];
  const re = /(?:href|src)=["'](\/(?:js|css)\/[^"'?\s]+)(?:\?v=([0-9a-f]+))?["']/gi;
  let match;
  while ((match = re.exec(html))) {
    refs.push({ url: match[1], version: match[2] || '' });
  }
  return refs;
}

module.exports = {
  HASH_LEN,
  PUBLIC_DIR,
  contentHash,
  assetQuery,
  versionedUrl,
  stampHtml,
  stampTargets,
  unstampedAssetRefs,
};
