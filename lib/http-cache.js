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

const PRIVATE_HTML = new Set([
  '/login.html',
  '/app.html',
  '/success.html',
  '/coach-upgrade.html',
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
  '/funnel',
  '/funnel.html',
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

module.exports = {
  PUBLIC_DIR,
  MARKETING_CACHE,
  MARKETING_CDN,
  ASSET_CACHE,
  ASSET_CDN,
  PRIVATE_HTML,
  normalizePath,
  isPrivatePath,
  isPrivateFile,
  publicHtmlPaths,
  publicAssetPaths,
  isMarketingDocument,
  lockNoStore,
  applyMarketingCache,
  applyAssetCache,
};
