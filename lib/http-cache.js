'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// CDN keeps a warm copy. Browsers revalidate. Vercel strips s-maxage from the
// client only when Cache-Control is the sole cache header, so the CDN header
// is set alongside it and the client still sees s-maxage.
const MARKETING_CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
const MARKETING_CDN = 'public, s-maxage=3600, stale-while-revalidate=86400';
const ASSET_CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';
const ASSET_CDN = 'public, s-maxage=86400, stale-while-revalidate=604800';

// Plan prices are printed in the HTML. A public cache would keep the old
// number for the stale-while-revalidate window (about 25h). Those documents
// are not stored. The homepage reads the same numbers from /api/pricing/config,
// which is no-store, so its shell can stay on the marketing cache.
const PRICE_CACHE = 'no-store';
const PLAN_PRICE_RE = /A\$19\.99|A\$149\.99|A\$39|A\$79|"price"\s*:\s*"19\.99"/;

const PRIVATE_HTML = new Set([
  '/login.html',
  '/app.html',
  '/success.html',
  '/coach-upgrade.html',
  '/coach.html',
]);

const PRIVATE_EXACT = new Set([
  '/login',
  '/login.html',
  '/register',
  '/signup',
  '/sign-up',
  '/auth',
  '/app',
  '/app.html',
  '/checkout',
  '/success',
  '/success.html',
  '/coach/upgrade',
  '/coach-upgrade.html',
  '/coach',
  '/coach.html',
  '/funnel',
  '/funnel.html',
  '/404',
  '/404.html',
]);

function normalizePath(urlPath) {
  const pathOnly = String(urlPath || '/').split('?')[0];
  if (pathOnly.length > 1 && pathOnly.endsWith('/')) return pathOnly.slice(0, -1);
  return pathOnly || '/';
}

function isPrivatePath(urlPath) {
  const pathOnly = normalizePath(urlPath);
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return true;
  if (pathOnly === '/checkout' || pathOnly.startsWith('/checkout/')) return true;
  if (pathOnly === '/funnel' || pathOnly.startsWith('/funnel/')) return true;
  return PRIVATE_EXACT.has(pathOnly);
}

function isPrivateFile(filePath) {
  return PRIVATE_HTML.has('/' + path.basename(filePath));
}

function walkPublic(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) walkPublic(path.join(dir, entry.name), rel + '/', out);
    else out.push('/' + rel.replace(/^\/+/, ''));
  }
}

function allPublicPaths() {
  const out = [];
  walkPublic(PUBLIC_DIR, '', out);
  return out.sort();
}

function publicHtmlPaths() {
  return allPublicPaths().filter((p) => p.endsWith('.html'));
}

function publicAssetPaths() {
  return allPublicPaths().filter((p) => !p.endsWith('.html'));
}

function fileExists(rel) {
  const abs = path.join(PUBLIC_DIR, rel.replace(/^\//, ''));
  try {
    return fs.statSync(abs).isFile();
  } catch (_) {
    return false;
  }
}

function resolvePublicHtml(urlPath) {
  const pathOnly = normalizePath(urlPath);
  const candidates = [];
  if (pathOnly === '/') candidates.push(path.join(PUBLIC_DIR, 'index.html'));
  else {
    const rel = pathOnly.replace(/^\//, '');
    if (rel.endsWith('.html')) candidates.push(path.join(PUBLIC_DIR, rel));
    else {
      candidates.push(path.join(PUBLIC_DIR, rel + '.html'));
      candidates.push(path.join(PUBLIC_DIR, rel, 'index.html'));
    }
  }
  for (const abs of candidates) {
    try {
      if (fs.statSync(abs).isFile()) return abs;
    } catch (_) {}
  }
  return null;
}

function isPriceFile(filePath) {
  try {
    return PLAN_PRICE_RE.test(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return false;
  }
}

function isPriceDocument(urlPath) {
  const abs = resolvePublicHtml(urlPath);
  return abs ? isPriceFile(abs) : false;
}

function isMarketingDocument(urlPath) {
  const pathOnly = normalizePath(urlPath);
  if (isPrivatePath(pathOnly)) return false;
  if (pathOnly === '/') return true;
  if (pathOnly.endsWith('.html')) return fileExists(pathOnly) && !PRIVATE_HTML.has(pathOnly);
  if (fileExists(pathOnly + '.html') && !PRIVATE_HTML.has(pathOnly + '.html')) return true;
  if (fileExists(pathOnly + '/index.html')) return true;
  return false;
}

// Force no-store even if a later handler asks for a public cache.
function lockNoStore(res) {
  const orig = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    const key = String(name).toLowerCase();
    if (key === 'cache-control') return orig('Cache-Control', 'no-store');
    if (key === 'vercel-cdn-cache-control' || key === 'cdn-cache-control') return res;
    return orig(name, value);
  };
  orig('Cache-Control', 'no-store');
}

function applyMarketingCache(res) {
  res.setHeader('Cache-Control', MARKETING_CACHE);
  res.setHeader('Vercel-CDN-Cache-Control', MARKETING_CDN);
}

function applyAssetCache(res) {
  res.setHeader('Cache-Control', ASSET_CACHE);
  res.setHeader('Vercel-CDN-Cache-Control', ASSET_CDN);
}

function applyDocumentCache(res, urlPath) {
  if (isPriceDocument(urlPath)) {
    res.setHeader('Cache-Control', PRICE_CACHE);
    if (typeof res.removeHeader === 'function') res.removeHeader('Vercel-CDN-Cache-Control');
    return;
  }
  applyMarketingCache(res);
}

function applyFileCache(res, filePath) {
  if (isPrivateFile(filePath) || isPriceFile(filePath)) {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.removeHeader === 'function') res.removeHeader('Vercel-CDN-Cache-Control');
    return;
  }
  if (String(filePath).endsWith('.html')) applyMarketingCache(res);
  else applyAssetCache(res);
}

module.exports = {
  PUBLIC_DIR,
  MARKETING_CACHE,
  MARKETING_CDN,
  ASSET_CACHE,
  ASSET_CDN,
  PRICE_CACHE,
  PLAN_PRICE_RE,
  PRIVATE_HTML,
  normalizePath,
  isPrivatePath,
  isPrivateFile,
  publicHtmlPaths,
  publicAssetPaths,
  isMarketingDocument,
  isPriceDocument,
  isPriceFile,
  resolvePublicHtml,
  lockNoStore,
  applyMarketingCache,
  applyAssetCache,
  applyDocumentCache,
  applyFileCache,
};
