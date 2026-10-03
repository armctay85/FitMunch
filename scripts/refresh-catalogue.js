'use strict';

/**
 * Weekly catalogue refresh.
 *
 * Does not call Woolworths, Coles, or Aldi trolley, cart, checkout, or product
 * APIs. Does not call catalogues.aldi.com.au/api/ (robots.txt Disallow).
 * Does not download catalogue pages. The source decision is in
 * docs/catalogue-source.md. Checked 2 October 2026: no permitted feed.
 *
 * On success this writes data/catalogue/<validFrom>.json, data/catalogue/current.json,
 * and data/catalogue/SUMMARY.md. On failure it writes catalogue-refresh-failure.txt
 * and exits 1 without a price file.
 */

const fs = require('fs');
const path = require('path');
const { EMBEDDED_CATALOGUE, CATALOGUE } = require('../lib/public-specials-catalogue');
const {
  applyOffers,
  validateCatalogue,
  summaryMarkdown,
} = require('./catalogue-lib');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'catalogue');
const FAILURE_FILE = path.join(ROOT, 'catalogue-refresh-failure.txt');

const SOURCE_REFUSAL = [
  'Catalogue refresh refused before any price request.',
  '',
  'No permitted machine-readable source was available on 2 October 2026.',
  'See docs/catalogue-source.md.',
  '',
  'Woolworths robots.txt returned HTTP 403 from this environment, so no Woolworths page was fetched. Product, trolley, cart, and checkout APIs were not called.',
  '',
  'Coles robots.txt does not disallow /catalogues, but the website terms allow personal use only and forbid copying or distributing the site. The catalogues page does not include prices in the HTML. No Coles product API was called.',
  '',
  'Aldi www.aldi.com.au robots.txt allows most of the site. catalogues.aldi.com.au robots.txt allows / and disallows /api/. The website terms forbid access by scripts or web crawlers, except internet search engines, and forbid reproducing site data.',
  '',
  'SaleFinder has no robots.txt (HTTP 404). Its terms limit use to personal, non-commercial purposes and forbid harvesting and building a commercial database.',
  '',
  'Shopfully robots.txt allows most paths. Its terms forbid robots, spiders, and similar tools, and forbid copying the site into a derived product.',
  '',
  'No catalogue file was written. Do not invent prices.',
].join('\n');

function resolveSource() {
  return {
    ok: false,
    reason: SOURCE_REFUSAL,
  };
}

function writeFailure(reason) {
  fs.writeFileSync(FAILURE_FILE, `${reason}\n`);
}

function writeCatalogue(catalogue, summary) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fileName = `${catalogue.validFrom}.json`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), `${JSON.stringify(catalogue, null, 2)}\n`);
  const pointer = {
    file: fileName,
    validFrom: catalogue.validFrom,
    validTo: catalogue.validTo,
    updatedAt: catalogue.updatedAt,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'current.json'), `${JSON.stringify(pointer, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'SUMMARY.md'), summary);
  if (fs.existsSync(FAILURE_FILE)) fs.unlinkSync(FAILURE_FILE);
}

function buildFromOffers(offers, meta) {
  const previous = CATALOGUE || EMBEDDED_CATALOGUE;
  const next = applyOffers(previous, offers);
  next.id = `au-public-specials-${meta.validFrom}`;
  next.weekLabel = `Catalogue ${meta.validFrom} to ${meta.validTo}`;
  next.pricedAt = meta.validFrom;
  next.validFrom = meta.validFrom;
  next.validTo = meta.validTo;
  next.updatedAt = meta.updatedAt;
  next.currency = 'AUD';
  next.sourceKind = 'public_specials_catalogue';
  next.sourceNote = meta.sourceNote || 'public catalogue listing';
  const errors = validateCatalogue(next, previous);
  return { next, errors, summary: summaryMarkdown(previous, next) };
}

function main() {
  const source = resolveSource();
  if (!source.ok) {
    writeFailure(source.reason);
    console.error(source.reason);
    process.exit(1);
  }
  const built = buildFromOffers(source.offers, source.meta);
  if (built.errors.length) {
    const reason = `Catalogue refresh failed validation.\n${built.errors.join('\n')}`;
    writeFailure(reason);
    console.error(reason);
    process.exit(1);
  }
  writeCatalogue(built.next, built.summary);
  console.log(built.summary);
}

if (require.main === module) main();

module.exports = {
  SOURCE_REFUSAL,
  resolveSource,
  buildFromOffers,
  writeCatalogue,
  writeFailure,
  FAILURE_FILE,
  OUT_DIR,
};
