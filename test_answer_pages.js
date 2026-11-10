'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const {
  PAGES,
  SKIPPED,
  SITE,
  TRIAL_HREF,
  buildPage,
  wordCount,
} = require('./lib/answer-pages');

function pick(html, re) {
  const match = html.match(re);
  return match ? match[1] : '';
}

function titlesInPublic() {
  const dir = path.join(__dirname, 'public');
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(dir, name), 'utf8');
    found.push({ file: name, title: pick(html, /<title>([^<]*)<\/title>/i) });
  }
  return found;
}

describe('answer pages: generated set', () => {
  it('builds 8 to 12 pages and matches the committed HTML', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(8);
    expect(PAGES.length).toBeLessThanOrEqual(12);
    for (const page of PAGES) {
      const file = path.join(__dirname, 'public', `${page.slug}.html`);
      expect(fs.readFileSync(file, 'utf8')).toBe(buildPage(page));
    }
  });

  it('records a reason for each skipped query and links to the existing page', () => {
    expect(SKIPPED.length).toBeGreaterThanOrEqual(6);
    const html = PAGES.map((page) => buildPage(page)).join('\n');
    for (const skip of SKIPPED) {
      expect(skip.reason.length).toBeGreaterThan(40);
      expect(html).toContain(`href="${skip.href}"`);
      expect(fs.existsSync(path.join(__dirname, 'public', `${skip.href.slice(1)}.html`))).toBe(true);
    }
  });
});

describe('answer pages: routes, meta, JSON-LD and trial CTA', () => {
  for (const page of PAGES) {
    it(`${page.slug} returns 200 with canonical, description, FAQ and WebPage JSON-LD`, async () => {
      const res = await request(app).get(`/${page.slug}`).expect(200);
      const html = res.text;
      const url = `${SITE}/${page.slug}`;
      expect(pick(html, /<title>([^<]*)<\/title>/i)).toBe(page.title);
      expect(pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i)).toBe(page.description);
      expect(page.description.length).toBeGreaterThan(80);
      expect(page.description.length).toBeLessThanOrEqual(155);
      expect(pick(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i)).toBe(url);
      expect(pick(html, /<meta property="og:url" content="([^"]+)"/)).toBe(url);
      expect(pick(html, /<meta property="og:title" content="([^"]+)"/)).toBe(page.title);
      expect(html).toContain('<meta property="og:description"');
      expect(html).toContain('<meta property="og:image"');
      expect(html.match(/<h1>/g)).toHaveLength(1);
      const answer = pick(html, /<p class="ln-lead ln-answer">([^<]*)<\/p>/);
      expect(wordCount(answer)).toBeGreaterThanOrEqual(40);
      expect(wordCount(answer)).toBeLessThanOrEqual(60);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      const faq = blocks.find((b) => b['@type'] === 'FAQPage');
      const web = blocks.find((b) => b['@type'] === 'WebPage');
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
      expect(web.url).toBe(url);
      expect(JSON.stringify(blocks)).not.toMatch(/AggregateRating|"price"/);
      for (const q of faq.mainEntity) {
        expect(html).toContain(`<dt>${q.name}</dt>`);
      }
    });

    it(`${page.slug} sends every trial CTA to the homepage trial path`, async () => {
      const html = (await request(app).get(`/${page.slug}`).expect(200)).text;
      const tags = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
      const ctas = tags.filter((tag) => /fm-btn|fm-nav-cta/.test(tag));
      expect(ctas.length).toBeGreaterThanOrEqual(3);
      for (const tag of ctas) {
        expect(tag).toContain(`href="${TRIAL_HREF}"`);
        expect(tag).not.toMatch(/utm_|A\$|\$/);
      }
    });
  }

  it('lists every new page once in the sitemap on the www host', () => {
    const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
    for (const page of PAGES) {
      const loc = `<loc>${SITE}/${page.slug}</loc>`;
      expect(xml.split(loc).length - 1).toBe(1);
    }
  });
});

describe('answer pages: house rules', () => {
  it('has no duplicate titles across public HTML pages', () => {
    const seen = new Map();
    const dupes = [];
    const titled = titlesInPublic().filter((row) => row.title);
    for (const page of PAGES) {
      expect(titled.some((row) => row.file === `${page.slug}.html` && row.title === page.title)).toBe(true);
    }
    for (const row of titled) {
      if (seen.has(row.title)) dupes.push(`${row.title}: ${seen.get(row.title)} and ${row.file}`);
      else seen.set(row.title, row.file);
    }
    expect(dupes).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(PAGES.length + 10);
  });

  it('has no em dash in any new page', () => {
    const hits = [];
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(__dirname, 'public', `${page.slug}.html`), 'utf8');
      if (html.includes('\u2014') || html.includes('\u2013') || html.includes(' -- ')) hits.push(page.slug);
    }
    expect(hits).toEqual([]);
  });

  it('has no price literals, store names, or banned claims', () => {
    const banned = [
      /\$|A\$|&#36;|&#x24;/i,
      /woolworths|woolies|\bcoles\b|\baldi\b/i,
      /\bbudget\b/i,
      /pty ltd|inc\.?\s*gst/i,
      /dietitian approved/i,
      /guaranteed weight loss/i,
      /app store/i,
      /buys your groceries|automatic checkout/i,
      /aggregaterating/i,
      /\d+\s*%/,
    ];
    const hits = [];
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(__dirname, 'public', `${page.slug}.html`), 'utf8');
      for (const re of banned) if (re.test(html)) hits.push(`${page.slug} ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it('gives the protein question no gram or per-kg figure', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'how-much-protein-do-i-need-a-day.html'), 'utf8');
    const body = html.replace(/<footer[\s\S]*<\/footer>/i, '');
    expect(body).not.toMatch(/\bgrams?\b/i);
    expect(body).not.toMatch(/\bkg\b/i);
    expect(body).not.toMatch(/per\s*kg/i);
    expect(body).not.toMatch(/\d+\s*g\b/i);
    expect(body).toContain('Australian Dietary Guidelines');
    expect(body).toContain('https://www.eatforhealth.gov.au/guidelines');
    expect(body).toContain('varies by person');
  });
});
