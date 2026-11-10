'use strict';

/**
 * Write public answer pages and their sitemap entries from lib/answer-pages.js.
 *   node scripts/generate-answer-pages.js
 */

const fs = require('fs');
const path = require('path');
const { PAGES, SITE, buildPage, auditIssues, assertPublicSlug, RETIRED_SLUGS } = require('../lib/answer-pages');

const root = path.join(__dirname, '..');
const issues = auditIssues();
if (issues.length) {
  console.error(issues.join('\n'));
  process.exit(1);
}

const publicDir = path.join(root, 'public');
for (const slug of RETIRED_SLUGS) {
  const retired = path.join(publicDir, `${slug}.html`);
  if (fs.existsSync(retired)) fs.unlinkSync(retired);
}
for (const page of PAGES) {
  const file = assertPublicSlug(page.slug, publicDir);
  fs.writeFileSync(file, buildPage(page));
}

const sitemapPath = path.join(root, 'public', 'sitemap.xml');
let xml = fs.readFileSync(sitemapPath, 'utf8');
const block = [
  '  <!-- answer-pages:start -->',
  ...PAGES.map((page) => `  <url>
    <loc>${SITE}/${page.slug}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`),
  '  <!-- answer-pages:end -->',
].join('\n');
if (xml.includes('<!-- answer-pages:start -->')) {
  xml = xml.replace(/  <!-- answer-pages:start -->[\s\S]*?  <!-- answer-pages:end -->/, block);
} else {
  const needle = '  <url>\n    <loc>https://www.fitmunch.com.au/pricing</loc>';
  if (!xml.includes(needle)) {
    console.error('sitemap is missing the pricing entry');
    process.exit(1);
  }
  xml = xml.replace(needle, `${block}\n${needle}`);
}
fs.writeFileSync(sitemapPath, xml);
console.log(`wrote ${PAGES.length} answer pages`);
