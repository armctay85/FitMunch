'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const coach = require('./lib/coach-plan');
const { renderSharePage } = require('./lib/coach-share');
const { buildCoachPdf } = require('./lib/coach-pdf');

const PHRASES = [
  [/save beats/i, 'save beats'],
  [/second store/i, 'second store'],
  [/2nd store/i, '2nd store'],
  [/extra trips?/i, 'extra trip'],
  [/second trips?/i, 'second trip'],
  [/second shop/i, 'second shop'],
  [/split looks right/i, 'split looks right'],
  [/how the split/i, 'how the split'],
  [/split-shop/i, 'split-shop'],
  [/\bcheap\b/i, 'cheap'],
  [/\bcheaper\b/i, 'cheaper'],
  [/\bcheapest\b/i, 'cheapest'],
  [/protein per dollar/i, 'protein per dollar'],
  [/treat the total as a draft/i, 'treat the total as a draft'],
  [/matched to supermarket product catalogues/i, 'matched to supermarket product catalogues'],
  [/public catalogue specials/i, 'public catalogue specials'],
  [/5\s*[–-]\s*10\s*%/i, '5-10%'],
  [/5 to 10\s*%/i, '5 to 10%'],
  [/client count gate:\s*open/i, 'Client count gate: open'],
  [/pty ltd/i, 'Pty Ltd'],
  [/inc\.?\s*gst/i, 'inc. GST'],
  [/\$143\b/, '$143'],
  [/check the shelf price at the store\./i, 'Check the shelf price at the store.'],
  [/shelf price/i, 'shelf price'],
];

const DATE_FIELDS = /\b(pricedAt|validFrom|validTo|priced_at|valid_from|valid_to|weekLabel)\b/;
const STALE_DATES = /2026-08-25|2026-08-31|2023-06-30/;
const STORE = /woolworths|woolies|coles|aldi|\biga\b|catalogue|specials|docket|trolley|supermarket/i;
const ALLOWED_DOLLARS = new Set([
  '0', '0.00', '19.99', '39', '39.00', '59', '59.00', '59.99', '79', '79.00', '99', '99.00', '100',
]);

const PRICE_LINE = 'Prices vary by store and week.';
const PRICE_LINE_PAGES = [
  'public/index.html',
  'public/app.html',
  'public/shopper.html',
  'public/coach.html',
  'public/budget-meal-planner.html',
  'public/for-pts.html',
  'public/woolworths-meal-planner.html',
  'public/coles-meal-planner.html',
  'public/family-meal-plan.html',
  'public/macro-meal-planner.html',
  'public/meal-plan-for-one.html',
  'public/meal-prep-shopping-list.html',
  'public/fitmunch-coach-vs-spreadsheets.html',
  'public/meal-plan-software-personal-trainers.html',
  'public/pt-client-meal-plans-woolworths.html',
];

const HEAD_WORDS = [
  [/\bspecials?\b/i, 'special'],
  [/\bcatalogues?\b/i, 'catalogue'],
  [/\bpriced\b/i, 'priced'],
];

function headCopyChunks(html) {
  const chunks = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaRe.exec(html))) {
    const tag = match[0];
    if (/name=["']description["']/i.test(tag)
      || /property=["']og:(?:title|description)["']/i.test(tag)
      || /name=["']twitter:(?:title|description)["']/i.test(tag)) {
      chunks.push(tag);
    }
  }
  const ldRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = ldRe.exec(html))) chunks.push(match[1]);
  return chunks;
}

function publicListingFiles() {
  const root = path.join(__dirname, 'public');
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/^(app_manifest\.json|sitemap.*\.xml)$/i.test(name) || /\.webmanifest$/i.test(name)) {
        out.push(full);
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out;
}

function htmlBody(html) {
  const match = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : html;
}

function walkServed(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkServed(full, out);
    else if (/\.(html|js|css|json|txt|xml|svg|webmanifest)$/i.test(name)) out.push(full);
  }
  return out;
}

function walkPublic(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkPublic(full, out);
    else if (/\.(html|js)$/i.test(name)) out.push(full);
  }
  return out;
}

function phraseHits(text) {
  return PHRASES.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function moneyHits(text) {
  const hits = [];
  const re = /\$(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = re.exec(text))) {
    if (ALLOWED_DOLLARS.has(match[1])) continue;
    const start = Math.max(0, match.index - 180);
    const window = text.slice(start, match.index + match[0].length + 180);
    if (STORE.test(window)) hits.push(match[0]);
  }
  return hits;
}

function problems(text, label) {
  const found = [];
  const phrases = phraseHits(text);
  if (phrases.length) found.push(`${label} phrase: ${phrases.join(', ')}`);
  if (DATE_FIELDS.test(text)) found.push(`${label} catalogue date field`);
  if (STALE_DATES.test(text)) found.push(`${label} stale catalogue date`);
  const dollars = moneyHits(text);
  if (dollars.length) found.push(`${label} supermarket $: ${dollars.join(', ')}`);
  return found;
}

describe('public price and claim ban', () => {
  const files = walkPublic(path.join(__dirname, 'public'), []);

  it('keeps the shelf-price line out of public HTML and JS and shows the store-week line once', () => {
    const found = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      if (/check the shelf price at the store\./i.test(text) || /shelf price/i.test(text)) {
        found.push(`${rel} still says shelf price`);
      }
    }
    const share = fs.readFileSync(path.join(__dirname, 'lib', 'coach-share.js'), 'utf8');
    if (/shelf price/i.test(share)) found.push('lib/coach-share.js still says shelf price');
    for (const rel of PRICE_LINE_PAGES) {
      const text = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      const count = text.split(PRICE_LINE).length - 1;
      if (count !== 1) found.push(`${rel} has the price line ${count} times`);
    }
    expect(found).toEqual([]);
  });

  it('keeps specials, cheap claims, and two-store wording out of public HTML, JS, and structured data', () => {
    const banned = [
      [/\bspecials?\b/i, 'special'],
      [/estimated price/i, 'estimated price'],
      [/\bcheap(?:er|est)?\b/i, 'cheap'],
      [/2nd\s+(?:store|trip)/i, '2nd store or trip'],
      [/save beats/i, 'save beats'],
      [/prices the list/i, 'prices the list'],
      [/the total/i, 'the total'],
      [/client count gate/i, 'Client count gate'],
      [/pt test account/i, 'PT test account'],
      [/when the split looks right/i, 'when the split looks right'],
    ];
    const found = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      for (const [re, label] of banned) {
        if (re.test(text)) found.push(`${rel} ${label}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps specials, catalogue, and priced out of meta, social tags, and structured data', () => {
    const found = [];
    function check(label, text) {
      for (const [re, name] of HEAD_WORDS) {
        if (re.test(text)) found.push(`${label} ${name}`);
      }
    }
    for (const file of files) {
      if (!/\.html$/i.test(file)) continue;
      const rel = path.relative(__dirname, file);
      const chunks = headCopyChunks(fs.readFileSync(file, 'utf8'));
      chunks.forEach((chunk, index) => check(`${rel}#${index + 1}`, chunk));
    }
    for (const file of publicListingFiles()) {
      check(path.relative(__dirname, file), fs.readFileSync(file, 'utf8'));
    }
    expect(found).toEqual([]);
  });

  it('keeps priced and catalogue out of page bodies and app_manifest.json', () => {
    const found = [];
    const words = [
      [/\bpriced\b/i, 'priced'],
      [/\bcatalogues?\b/i, 'catalogue'],
    ];
    for (const file of files) {
      if (!/\.html$/i.test(file)) continue;
      const rel = path.relative(__dirname, file);
      const body = htmlBody(fs.readFileSync(file, 'utf8'));
      for (const [re, name] of words) {
        if (re.test(body)) found.push(`${rel} body ${name}`);
      }
    }
    const manifest = fs.readFileSync(path.join(__dirname, 'public', 'app_manifest.json'), 'utf8');
    for (const [re, name] of words) {
      if (re.test(manifest)) found.push(`public/app_manifest.json ${name}`);
    }
    expect(found).toEqual([]);
  });

  it('keeps Grok, OpenClaw, and MRR out of every served public file', () => {
    const banned = [
      [/\bGrok\b/i, 'Grok'],
      [/\bOpenClaw\b/i, 'OpenClaw'],
      [/\bMRR\b/i, 'MRR'],
    ];
    const found = [];
    for (const file of walkServed(path.join(__dirname, 'public'), [])) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(__dirname, file);
      for (const [re, name] of banned) {
        if (re.test(text)) found.push(`${rel} ${name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps supermarket dollars, catalogue dates, and banned claims out of public HTML and JS', () => {
    const found = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      found.push(...problems(text, path.relative(__dirname, file)));
    }
    expect(found).toEqual([]);
  });

  it('keeps the same claims out of public shopper JSON and a coach share fixture', async () => {
    const week = await request(app).get('/api/shopper/week').expect(200);
    const draft = await request(app).post('/api/shopper/draft').send({}).expect(200);
    const approved = await request(app).post('/api/shopper/approve').send({}).expect(200);
    const info = await request(app).get('/api/shopper').expect(200);
    const plan = coach.buildCoachPlan({
      kcal: 2000,
      protein: 140,
      carbs: 180,
      fat: 60,
      storeId: 'coles',
      householdSize: 1,
    });
    const share = renderSharePage({
      planRow: { plan, clientLabel: 'Client', token: 'fixture' },
      branding: { practiceName: 'Northside training' },
    });
    const pdf = buildCoachPdf({
      plan,
      clientLabel: 'Client',
      branding: { practiceName: 'Northside training' },
    }).toString('latin1');
    const blobs = [
      ['GET /api/shopper', JSON.stringify(info.body)],
      ['GET /api/shopper/week', JSON.stringify(week.body)],
      ['POST /api/shopper/draft', JSON.stringify(draft.body)],
      ['POST /api/shopper/approve', JSON.stringify(approved.body)],
      ['coach share', share],
      ['coach pdf', pdf],
    ];
    const found = blobs.flatMap(([label, text]) => problems(text, label));
    expect(found).toEqual([]);
  });

  it('uses the GST sentence on /terms and does not name a person or a sole trader', async () => {
    const page = await request(app).get('/terms').expect(200);
    expect(page.text).toContain('We are not registered for GST, so no GST is charged on FitMunch prices.');
    expect(page.text).not.toMatch(/\bDrew\b/);
    expect(page.text).not.toMatch(/sole trader/i);
    expect(fs.readFileSync(path.join(__dirname, 'public', 'coach.html'), 'utf8')).not.toContain('Client count gate: open.');
  });
});
