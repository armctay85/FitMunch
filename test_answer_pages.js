'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const {
  PAGES,
  SKIPPED,
  RETIRED_SLUGS,
  SITE,
  TRIAL_HREF,
  TRIAL_LABEL,
  TRIAL_SENTENCE,
  PUBLIC_DIR,
  buildPage,
  wordCount,
  guardHits,
  assertPublicSlug,
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
  it('builds 7 to 12 pages and matches the committed HTML', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(7);
    expect(PAGES.length).toBeLessThanOrEqual(12);
    for (const page of PAGES) {
      const file = path.join(__dirname, 'public', `${page.slug}.html`);
      expect(fs.readFileSync(file, 'utf8')).toBe(buildPage(page));
    }
  });

  it('records a reason for each skipped query and links to a real page', () => {
    expect(SKIPPED.length).toBeGreaterThanOrEqual(6);
    const html = PAGES.map((page) => buildPage(page)).join('\n');
    const claims = SKIPPED.filter((skip) => /health-claim risk/i.test(skip.reason));
    expect(claims.map((skip) => skip.query).sort()).toEqual([
      'meal plan for muscle gain',
      'meal plan for weight loss australia',
    ]);
    for (const skip of SKIPPED) {
      expect(skip.reason.length).toBeGreaterThan(40);
      expect(html).toContain(`href="${skip.href}"`);
      expect(fs.existsSync(path.join(__dirname, 'public', `${skip.href.slice(1)}.html`))).toBe(true);
    }
    for (const slug of RETIRED_SLUGS) {
      expect(fs.existsSync(path.join(__dirname, 'public', `${slug}.html`))).toBe(false);
    }
  });

  it('rejects a slug that is not lowercase or that resolves outside public/', () => {
    expect(() => assertPublicSlug('Foo', PUBLIC_DIR)).toThrow(/rejected/);
    expect(() => assertPublicSlug('../secrets', PUBLIC_DIR)).toThrow(/rejected/);
    expect(() => assertPublicSlug('a/b', PUBLIC_DIR)).toThrow(/rejected/);
    expect(() => assertPublicSlug('has space', PUBLIC_DIR)).toThrow(/rejected/);
    const file = assertPublicSlug('weekly-meal-plan-australia', PUBLIC_DIR);
    expect(file.startsWith(path.resolve(PUBLIC_DIR) + path.sep)).toBe(true);
    expect(file.endsWith(`${path.sep}weekly-meal-plan-australia.html`)).toBe(true);
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
      expect(html).toContain('<meta property="og:image"');
      expect(html.match(/<h1>/g)).toHaveLength(1);
      const answer = pick(html, /<p class="ln-lead ln-answer-text">([^<]*)<\/p>/);
      expect(wordCount(answer)).toBeGreaterThanOrEqual(40);
      expect(wordCount(answer)).toBeLessThanOrEqual(60);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      expect(blocks.find((b) => b['@type'] === 'FAQPage').mainEntity.length).toBeGreaterThanOrEqual(4);
      expect(blocks.find((b) => b['@type'] === 'WebPage').url).toBe(url);
      expect(JSON.stringify(blocks)).not.toMatch(/AggregateRating|"price"|offers/);
      expect(html).toContain('This is not medical nutrition.');
      expect(html).toContain('width="28" height="28"');
      expect(html).toContain('data-fm-auth="login"');
    });

    it(`${page.slug} uses the homepage trial sentence and CTA exactly`, async () => {
      const html = (await request(app).get(`/${page.slug}`).expect(200)).text;
      const tags = [...html.matchAll(/<a\b[^>]*class="[^"]*(?:fm-btn|fm-nav-cta)[^"]*"[^>]*>([^<]*)</g)];
      expect(tags.length).toBeGreaterThanOrEqual(3);
      for (const tag of tags) {
        expect(tag[0]).toContain(`href="${TRIAL_HREF}"`);
        expect(tag[1]).toBe(TRIAL_LABEL);
      }
      expect(html.split(TRIAL_SENTENCE).length - 1).toBeGreaterThanOrEqual(2);
      expect(guardHits(html)).toEqual([]);
    });
  }

  it('lists every new page once in the sitemap on the www host and each page links the trial', async () => {
    const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
    const slugs = [
      'weekly-meal-plan-australia',
      'quick-weeknight-dinners',
      'macro-tracking-or-a-meal-plan',
      'how-to-plan-meals-when-you-are-busy',
      'meal-plan-and-workout-plan',
      'how-to-plan-meals-in-australia',
      'lunches-for-work',
    ];
    expect(PAGES.map((page) => page.slug).sort()).toEqual([...slugs].sort());
    for (const slug of slugs) {
      const loc = `<loc>${SITE}/${slug}</loc>`;
      expect(xml.split(loc).length - 1).toBe(1);
      const html = (await request(app).get(`/${slug}`).expect(200)).text;
      const trial = [...html.matchAll(/<a\b[^>]*class="[^"]*(?:fm-btn|fm-nav-cta)[^"]*"[^>]*>([^<]*)</g)];
      expect(trial.length).toBeGreaterThanOrEqual(3);
      for (const tag of trial) {
        expect(tag[0]).toContain(`href="${TRIAL_HREF}"`);
        expect(tag[1]).toBe(TRIAL_LABEL);
      }
    }
    for (const slug of RETIRED_SLUGS) {
      expect(xml).not.toContain(`/${slug}`);
    }
  });

  it('dropped slugs 404 and no remaining page links to them', async () => {
    const html = PAGES.map((page) => buildPage(page)).join('\n');
    for (const slug of RETIRED_SLUGS) {
      expect(html).not.toContain(`/${slug}`);
      await request(app).get(`/${slug}`).expect(404);
      await request(app).get(`/${slug}.html`).expect(404);
    }
  });
});

describe('answer pages: copy guards', () => {
  const bannedSamples = [
    ['weight loss', 'A meal plan for weight loss australia'],
    ['lose weight', 'This plan will help you lose weight fast'],
    ['muscle gain', 'A meal plan for muscle gain'],
    ['healthy', 'Easy healthy dinners for the week'],
    ['best', 'The best meal planning app'],
    ['waste less', 'You waste less food and money'],
    ['trial sentence', 'The trial is on the web. Start the 14-day trial on the web.'],
  ];

  it.each(bannedSamples)('catches the old copy: %s', (label, sample) => {
    expect(guardHits(sample)).toContain(label);
  });

  it('accepts the homepage trial sentence and CTA and rejects a near miss', () => {
    expect(guardHits(`<h2>${TRIAL_LABEL}</h2><p>${TRIAL_SENTENCE}</p>`)).toEqual([]);
    expect(guardHits('14-day trial, then a monthly plan. Card on file.')).toContain('trial sentence');
    expect(guardHits('The trial is on the web.')).toContain('trial sentence');
    expect(guardHits('Start the 14-day trial on the web.')).toContain('trial sentence');
  });

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
  });

  it('has no em dash in any new page', () => {
    const hits = [];
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(__dirname, 'public', `${page.slug}.html`), 'utf8');
      if (html.includes('\u2014') || html.includes('\u2013') || html.includes(' -- ')) hits.push(page.slug);
    }
    expect(hits).toEqual([]);
  });

  it('reserves one box for the fallback link and the loaded price, with the period on the text', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'weekly-meal-plan-australia.html'), 'utf8');
    expect(html).toContain('.ln-answer .ln-price{display:inline-grid;max-width:100%;vertical-align:baseline;justify-items:stretch;align-items:start}');
    expect(html).toContain('.ln-answer .ln-price>.ln-price-fallback,.ln-answer .ln-price>.ln-price-live{grid-area:1/1;min-width:0}');
    expect(html).toContain('.ln-answer .ln-price.is-ready>.ln-price-fallback{visibility:hidden}');
    expect(html).not.toContain('min-width:16ch');
    expect(html).not.toMatch(/\$\d|A\$/);
    expect(html).toContain('>See current plans and prices</a>.');
    expect(html).not.toMatch(/<\/span>\.\s*Card on file/);
  });

  it('a failed price fetch keeps the index fallback instead of an empty then-dot', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'weekly-meal-plan-australia.html'), 'utf8');
    const script = html.match(/\(function \(\) \{[\s\S]*?\}\)\(\);/)[0];
    const els = [...html.matchAll(/<span class="ln-price" data-fm-price="([^"]*)">([\s\S]*?)<\/span>/g)].map((m) => {
      const live = { textContent: '' };
      return {
        key: m[1],
        fallback: (m[2].match(/<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '',
        live,
        classList: { add() {} },
        getAttribute(name) { return name === 'data-fm-price' ? this.key : ''; },
        querySelector(sel) { return sel === '.ln-price-live' ? live : null; },
      };
    });
    const document = { querySelectorAll: () => els };
    const fetch = () => Promise.reject(new Error('offline'));
    new Function('window', 'document', 'fetch', script)({ fetch }, document, fetch);
    await new Promise((resolve) => setImmediate(resolve));
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) {
      expect(el.fallback).toBe('See current plans and prices');
      expect(el.live.textContent).toBe('');
    }
  });
});
