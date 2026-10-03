const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');

const SKIP = new Set([
  'privacy.html',
  'terms.html',
  'google3b5c73dd27c81eaf.html',
]);

function htmlFiles(dir, prefix) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...htmlFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.html')) found.push(rel);
  }
  return found;
}

function loadAnalytics(pathname, options) {
  const opts = options || {};
  const created = [];
  const document = {
    createElement() {
      const el = {};
      created.push(el);
      return el;
    },
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
  };
  const window = {
    location: {
      pathname,
      search: opts.search || '',
      origin: 'https://www.fitmunch.com.au',
    },
    document,
  };
  if (opts.analytics === true) window.FM_WEB_ANALYTICS = 1;
  else if (opts.analytics === false) window.FM_WEB_ANALYTICS = 0;
  const fetchImpl = opts.fetch || (async () => ({
    ok: true,
    json: async () => ({ webAnalytics: false }),
  }));
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    URL,
    fetch: fetchImpl,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/js/fm-va.js'), 'utf8'), context);
  const beforeSend = Array.from(window.vaq || []).find((args) => args[0] === 'beforeSend');
  return { window, created, beforeSend: beforeSend && beforeSend[1] };
}

describe('Vercel Web Analytics snippet', () => {
  const files = htmlFiles(path.join(__dirname, 'public'), '');

  it('is on every public page except privacy, terms, and the google verification file', () => {
    const missing = files.filter((file) => {
      if (SKIP.has(path.basename(file))) return false;
      const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
      return !html.includes('<script src="/js/fm-va.js" defer></script>');
    });
    expect(missing).toEqual([]);
  });

  it('leaves privacy.html and terms.html untouched', () => {
    for (const file of ['privacy.html', 'terms.html']) {
      const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
      expect(html).not.toContain('fm-va.js');
      expect(html).not.toContain('/_vercel/insights/script.js');
    }
  });

  it('keeps the analytics script same-origin so the existing CSP allows it', () => {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(server).toContain("scriptSrc: [\"'self'\"");
    expect(server).toContain("connectSrc: [\"'self'\"");
    const loader = fs.readFileSync(path.join(__dirname, 'public/js/fm-va.js'), 'utf8');
    expect(loader).toContain('/_vercel/insights/script.js');
    expect(loader).not.toContain('https://va.vercel-scripts.com');
  });

  it('loads public-config with same-origin credentials', async () => {
    let seen = null;
    loadAnalytics('/', {
      fetch: async (url, opts) => {
        seen = { url, opts };
        return { ok: true, json: async () => ({ webAnalytics: false }) };
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen.url).toBe('/api/public-config');
    expect(seen.opts.credentials).toBe('same-origin');
    const source = fs.readFileSync(path.join(__dirname, 'public/js/fm-va.js'), 'utf8');
    const comment = source.slice(0, source.indexOf('(function'));
    expect(comment).not.toMatch(/funnel/i);
    expect(source).not.toContain("credentials: 'omit'");
  });

  it('does not inject the insights script when the flag is off', async () => {
    const explicit = loadAnalytics('/pricing', { analytics: false });
    expect(explicit.created).toEqual([]);
    expect(explicit.beforeSend).toBeUndefined();

    const fromConfig = loadAnalytics('/', {
      fetch: async () => ({ ok: true, json: async () => ({ webAnalytics: false }) }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fromConfig.created).toEqual([]);
  });

  it('exposes the flag from the server and keeps it off by default', async () => {
    const app = require('./server');
    const previous = process.env.FM_WEB_ANALYTICS;
    delete process.env.FM_WEB_ANALYTICS;
    const off = await request(app).get('/api/public-config');
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ webAnalytics: false });
    process.env.FM_WEB_ANALYTICS = '1';
    const on = await request(app).get('/api/public-config');
    expect(on.body).toEqual({ webAnalytics: true });
    if (previous == null) delete process.env.FM_WEB_ANALYTICS;
    else process.env.FM_WEB_ANALYTICS = previous;

    const home = await request(app).get('/');
    expect(home.text).toContain('/js/fm-va.js');
    expect(home.text).not.toContain('/_vercel/insights/script.js');
  });

  it('blocks reset links on /login and /login.html on load and beforeSend', () => {
    for (const pathname of ['/login', '/login.html']) {
      const page = loadAnalytics(pathname, { analytics: true, search: '?reset=secret-token' });
      expect(page.created).toHaveLength(0);
      expect(page.beforeSend({
        url: `https://www.fitmunch.com.au${pathname}?reset=secret-token`,
      })).toBeNull();
    }
    const withReset = loadAnalytics('/login', { analytics: true, search: '?plan=premium&reset=abc' });
    expect(withReset.created).toHaveLength(0);
    expect(withReset.beforeSend({
      url: 'https://www.fitmunch.com.au/login.html?foo=1&reset=abc',
    })).toBeNull();

    const login = loadAnalytics('/login.html', { analytics: true, search: '?plan=premium' });
    expect(login.created).toHaveLength(1);
    expect(login.created[0].src).toBe('/_vercel/insights/script.js');
    expect(login.beforeSend({
      url: 'https://www.fitmunch.com.au/login.html?plan=premium',
    }).url).toBe('https://www.fitmunch.com.au/login.html');
  });

  it('strips query and hash, and drops authenticated or token pages', () => {
    const pricing = loadAnalytics('/pricing', { analytics: true });
    expect(pricing.created).toHaveLength(1);
    expect(pricing.created[0].src).toBe('/_vercel/insights/script.js');
    expect(typeof pricing.created[0].onerror).toBe('function');
    expect(() => pricing.created[0].onerror()).not.toThrow();
    const event = pricing.beforeSend({
      url: 'https://www.fitmunch.com.au/pricing?plan=premium&token=secret#pay',
    });
    expect(event.url).toBe('https://www.fitmunch.com.au/pricing');

    const blocked = [
      '/app.html',
      '/app/today',
      '/reset-password',
      '/checkout/success',
      '/success.html',
      '/funnel',
      '/funnel.html',
      '/c/share-token',
    ];
    for (const pathname of blocked) {
      const page = loadAnalytics(pathname, { analytics: true });
      expect(page.created).toHaveLength(0);
      expect(page.beforeSend({ url: `https://www.fitmunch.com.au${pathname}?session_id=cs_live_secret` })).toBeNull();
    }
  });
});
