const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function loadAnalytics(pathname) {
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
    location: { pathname, origin: 'https://www.fitmunch.com.au' },
    document,
  };
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    URL,
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

  it('strips query and hash, and drops authenticated or token pages', () => {
    const pricing = loadAnalytics('/pricing');
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
      const page = loadAnalytics(pathname);
      expect(page.created).toHaveLength(0);
      expect(page.beforeSend({ url: `https://www.fitmunch.com.au${pathname}?session_id=cs_live_secret` })).toBeNull();
    }
  });
});
