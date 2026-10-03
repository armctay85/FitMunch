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
  'No permitted source for the NSW metro week of 30 September to 6 October 2026.',
  'See docs/catalogue-source.md. Checked 3 October 2026.',
  '',
  'Woolworths robots.txt returned HTTP 403, so no Woolworths catalogue page was fetched.',
  'Coles terms forbid copying the site. No Coles catalogue page was fetched.',
  'Aldi legal notice forbids scripts and web crawlers, and forbids reproducing site data. No Aldi catalogue page was fetched.',
  'weeklyshop.au terms limit the service to personal household planning.',
  '1001catalogues.com terms forbid harvesting and commercial databases.',
  'mailerdesk.com terms forbid bots and compiling a database.',
  'kimbino.com.au terms allow browsing only, and robots.txt disallows the leaflet deals API.',
  'currentspecials.com.au terms limit the service to personal use.',
  'catalogue-au.com terms do not grant a licence to copy offers.',
  'au-catalogues.com publishes no terms page, so there is no licence to copy.',
  'yapik.com says the Australia pages are for information only and publishes no copy licence.',
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
