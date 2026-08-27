/**
 * Honesty / trust bar for FitMunch PR #5.
 * Each case maps to a paying-customer audit item. Do not weaken these.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

function startFreeHrefs(html) {
  const hrefs = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const label = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (label !== 'Start free') continue;
    const href = /href="([^"]+)"/.exec(attrs);
    if (href) hrefs.push(href[1]);
  }
  return hrefs;
}

describe('Trust bar 1: app is gated', () => {
  it('GET /app.html hides the cockpit until fm-authed and sends visitors to login', async () => {
    const res = await request(app).get('/app.html').expect(200);
    expect(res.text).toContain('id="app-gate"');
    expect(res.text).toContain('Sign in to FitMunch');
    expect(res.text).toContain('html:not(.fm-authed) .shell');
    expect(res.text).toContain('display:none!important');
    expect(res.text).toContain("location.replace('/login.html')");
    expect(res.text).toContain("role: 'client'");
    expect(res.text).not.toMatch(/<html[^>]*\bfm-authed\b/);
    const meIdx = res.text.indexOf("API('/auth/me')");
    const authedIdx = res.text.indexOf("classList.add('fm-authed')");
    expect(meIdx).toBeGreaterThan(0);
    expect(authedIdx).toBeGreaterThan(meIdx);
  });

  it('GET /app redirects to the gated app.html surface', async () => {
    await request(app).get('/app').expect(302).expect('Location', '/app.html');
  });
});

describe('Trust bar 2: health does not leak internals', () => {
  it('GET /api/health is ok and only publishes safe fields', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('fitmunch');
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'success', 'timestamp']);
    expect(JSON.stringify(res.body)).not.toMatch(/jwt|stripe|gemini|resend|sha|deploy|webhook/i);
  });
});

describe('Trust bar 3: funnel is not a public analytics UI', () => {
  const prevKey = process.env.FM_ANALYTICS_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.FM_ANALYTICS_KEY;
    else process.env.FM_ANALYTICS_KEY = prevKey;
  });

  it('refuses /funnel and /funnel.html without a matching key', async () => {
    process.env.FM_ANALYTICS_KEY = 'trust-bar-funnel-key';
    await request(app).get('/funnel').expect(401);
    await request(app).get('/funnel.html').expect(401);
    await request(app).get('/funnel?key=wrong-key').expect(401);
    await request(app).get('/funnel.html?key=wrong-key').expect(401);
  });

  it('serves the private UI only with the matching key and does not name the env var', async () => {
    process.env.FM_ANALYTICS_KEY = 'trust-bar-funnel-key';
    const res = await request(app).get('/funnel?key=trust-bar-funnel-key').expect(200);
    expect(res.text).toContain('Conversion funnel');
    expect(res.text).not.toContain('FM_ANALYTICS_KEY');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/i);
  });

  it('GET /api/analytics/funnel stays unauthorized without the key', async () => {
    process.env.FM_ANALYTICS_KEY = 'trust-bar-funnel-key';
    const res = await request(app).get('/api/analytics/funnel').expect(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Trust bar 4: one Stripe trial story', () => {
  it('live checkout code is a 14-day trial with card collection always', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib/fitmunch-checkout.js'), 'utf8');
    expect(src).toContain("payment_method_collection: 'always'");
    expect(src).toContain('const TRIAL_PERIOD_DAYS = 14');
    expect(src).toContain('trial_period_days: TRIAL_PERIOD_DAYS');
    expect(src).toContain('adaptive_pricing: { enabled: false }');
    expect(src).toContain("display_name: FITMUNCH_CHECKOUT_BRAND");
    expect(src).toContain("FITMUNCH_CHECKOUT_BRAND = 'FitMunch'");
    expect(src).toContain("'premium':    'price_1ToYrXGMuYRuJYDrwHtvWD1c'");
    expect(src).toContain("STRIPE_CHECKOUT_API_VERSION = '2026-03-25.dahlia'");
    expect(src).toContain("STRIPE_CHECKOUT_LOCALE = 'en-GB'");
    expect(src).toMatch(/rawRequest\(\s*'POST',\s*'\/v1\/checkout\/sessions'/);
    expect(src).not.toMatch(/locale:\s*['"]en-AU['"]/);
    expect(src).not.toContain('delete retry.branding_settings');
    expect(src).not.toMatch(/client hub/i);
    expect(src).not.toMatch(/trial_period_days:\s*(7|21|30)/);
  });

  it('public legal and marketing pages do not invent a post-charge refund window', async () => {
    const pages = ['/refund', '/terms', '/pricing', '/for-pts', '/', '/login.html', '/success.html'];
    for (const route of pages) {
      const res = await request(app).get(route).expect(200);
      expect(res.text).not.toContain('14-day refund window');
      expect(res.text).not.toContain('Refunds are available within 7 days');
      expect(res.text).not.toContain('no credit card');
      expect(res.text).not.toContain('No credit card');
    }
    const refund = await request(app).get('/refund').expect(200);
    expect(refund.text).toContain('card on file');
    expect(refund.text).toContain('It is not a 14-day refund after a paid charge');
    expect(refund.text).toContain('support@fitmunch.com.au');
  });
});

describe('Trust bar 5: web app, not store', () => {
  it('homepage and scanner say browser / Add to Home Screen and do not use store badges', async () => {
    const home = await request(app).get('/').expect(200);
    expect(home.text).toContain('web app');
    expect(home.text).toContain('Add to Home Screen');
    expect(home.text).toContain('App Store listing is not live');
    expect(home.text).not.toContain('Download on the App Store');
    expect(home.text).not.toContain('Get it on Google Play');

    const scanner = await request(app).get('/receipt-nutrition-scanner').expect(200);
    expect(scanner.text).toContain('web app');
    expect(scanner.text).toContain('Add to Home Screen');
  });
});

describe('Trust bar 6: haul 92 / $143 / 987g is a worked example', () => {
  const surfaces = [
    ['/', ['92', '143', '987']],
    ['/demo', ['92', '143', '987']],
    ['/haul-teardown', ['92', '143', '987']],
    ['/receipt-nutrition-scanner', ['92', '143', '987']],
    ['/pricing', ['92', '143']],
  ];

  it.each(surfaces)('%s labels those numbers as an example', async (route, tokens) => {
    const res = await request(app).get(route).expect(200);
    for (const token of tokens) {
      expect(res.text).toContain(token);
    }
    expect(res.text.toLowerCase()).toMatch(/worked example|sample .*woolies|weekly shop example/);
    expect(res.text).not.toContain('One real Woolworths shop, scanned and scored');
  });
});

describe('Trust bar 7: receipt photo story matches the scanner', () => {
  it('scanner keeps the upload in memory and does not persist the image', () => {
    const src = fs.readFileSync(path.join(__dirname, 'receipt-scanner.js'), 'utf8');
    expect(src).toContain('multer.memoryStorage()');
    expect(src).not.toMatch(/writeFile|createWriteStream|INSERT INTO.*receipt/i);
  });

  it('privacy, terms, FAQ, and support say the photo is discarded on FitMunch servers', async () => {
    const privacy = await request(app).get('/privacy').expect(200);
    expect(privacy.text).toContain('does not keep the original receipt photo');
    expect(privacy.text).not.toContain('Original receipt images are stored securely');

    const terms = await request(app).get('/terms').expect(200);
    expect(terms.text).toContain('does not keep the original receipt photo');

    const scanner = await request(app).get('/receipt-nutrition-scanner').expect(200);
    expect(scanner.text).toContain('does not keep the original photo on our servers');

    const support = await request(app).get('/support').expect(200);
    expect(support.text).toContain('not stored on our servers');
  });
});

describe('Trust bar 8: Start free does not force Premium Stripe', () => {
  it('register aliases omit plan=premium unless the request asked for it', async () => {
    await request(app).get('/register').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/signup').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/register?plan=premium').expect(301).expect('Location', '/login.html?plan=premium#register');
  });

  it('homepage Start free links do not set plan=premium', async () => {
    const home = await request(app).get('/').expect(200);
    const hrefs = startFreeHrefs(home.text);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).not.toMatch(/[?&]plan=premium\b/);
    }
  });

  it('login without a plan is a free account, not an immediate Stripe checkout', async () => {
    const login = await request(app).get('/login.html').expect(200);
    expect(login.text).toContain('id="free-intent"');
    expect(login.text).toContain('This creates a free account. No card and no Stripe checkout');
    expect(login.text).toContain('Create Free Account');
    expect(login.text).toMatch(/if \(!plan\) \{[\s\S]*\/api\/checkout/);
  });
});

describe('Trust bar 10: stranger first run is their receipt', () => {
  it('homepage primary hero path photographs their receipt, not the sample haul', async () => {
    const home = await request(app).get('/').expect(200);
    const hero = home.text.split('<header class="hero"')[1].split('</header>')[0];
    const capture = hero.split('data-fs-results')[0];
    expect(hero).toContain('Photograph your receipt');
    expect(hero).toContain('data-first-scan');
    expect(hero).toContain('data-fs-camera');
    expect(hero).toContain('capture="environment"');
    expect(hero).toContain('data-fs-open-camera');
    expect(hero).toContain('data-fs-live');
    expect(hero).toContain('data-fm-track="hero_scan_mine"');
    expect(hero).not.toContain('href="#first-scan"');
    expect(hero).not.toContain('Try a sample haul');
    expect(hero).not.toContain('/demo');
    expect(capture).not.toMatch(/>\s*Start free\s*</);
    expect(capture).not.toMatch(/>\s*Start Premium trial\s*</);
    expect(home.text).toContain('class="trial-bar"');
    expect(home.text).toContain('$19.99 AUD/mo');
    expect(home.text).toContain('id="first-scan"');
    expect(home.text).toContain('data-first-scan');
    expect(home.text).toContain('/js/fm-first-scan.js');
    expect(home.text).toContain('Start Premium trial, $19.99/mo');
    expect(home.text).toContain('YOUR HAUL SCORE');
    expect(home.text).toContain('Tonight from this shop');
    expect(home.text).toContain('not a demo shop');
  });

  it('pricing Free does not claim unlimited weekly AI plans', async () => {
    const res = await request(app).get('/pricing').expect(200);
    expect(res.text).not.toContain('Unlimited weekly AI plans');
    expect(res.text).toContain('Limited AI actions per month');
    expect(res.text).toContain('Weekly AI plans need Premium');
    expect(res.text).toContain('Secondary lane');
  });

  it('haul teardown hero sends the stranger to photograph their own receipt', async () => {
    const res = await request(app).get('/haul-teardown').expect(200);
    expect(res.text).toContain('Photograph your receipt');
    expect(res.text).toContain('href="/#first-scan"');
    expect(res.text).not.toContain('Scan a receipt free');
  });

  it('scanner landing leads with photograph, not the sample haul', async () => {
    const res = await request(app).get('/receipt-nutrition-scanner').expect(200);
    expect(res.text).toContain('Photograph your receipt');
    expect(res.text).toContain('href="/#first-scan"');
    expect(res.text).not.toContain('data-fm-track="scanner_demo"');
  });
});

describe('Trust bar 9: no invented ABN', () => {
  it('contact, terms, and refund do not invent an ABN, ACN, or street address', async () => {
    for (const route of ['/contact', '/terms', '/refund', '/privacy']) {
      const res = await request(app).get(route).expect(200);
      expect(res.text).not.toMatch(/\bABN\b/);
      expect(res.text).not.toMatch(/\bACN\b/);
      expect(res.text).toContain('support@fitmunch.com.au');
    }
  });
});
