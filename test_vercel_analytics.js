'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
// Google site verification is a token file, not a page.
const SKIP = new Set(['google3b5c73dd27c81eaf.html']);

const BEFORE_SEND = "window.va('beforeSend',function(e){try{var u=new URL(e.url);return Object.assign({},e,{url:u.origin+u.pathname});}catch(_){return null;}});";

describe('Vercel Web Analytics', () => {
  const pages = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html') && !SKIP.has(f));

  it('finds the served pages', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const file of pages) {
    it(`${file} loads the same-origin insights script once, before </body>`, () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      const tag = '<script defer src="/_vercel/insights/script.js"></script>';
      expect(html.split(tag).length - 1).toBe(1);
      expect(html.indexOf(tag)).toBeLessThan(html.lastIndexOf('</body>'));
      expect(html).toContain('window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};');
    });

    it(`${file} strips query and hash before analytics sends a URL`, () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      if (!html.includes('/_vercel/insights/script.js')) return;
      expect(html).toContain(BEFORE_SEND);
      expect(html.indexOf(BEFORE_SEND)).toBeLessThan(html.indexOf('/_vercel/insights/script.js'));
    });
  }

  it('beforeSend drops query strings and hashes (invite, session_id, claim, reset)', () => {
    const calls = [];
    const window = {};
    // eslint-disable-next-line no-new-func
    new Function('window', 'window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};' + BEFORE_SEND)(window);
    const fn = window.vaq.find((a) => a[0] === 'beforeSend')[1];
    const out = fn({ type: 'pageview', url: 'https://www.fitmunch.com.au/login.html?invite=abc&utm_source=x#claim=t' });
    calls.push(out.url);
    expect(out.url).toBe('https://www.fitmunch.com.au/login.html');
    expect(fn({ url: 'https://www.fitmunch.com.au/success.html?session_id=cs_live_1' }).url).toBe('https://www.fitmunch.com.au/success.html');
    expect(fn({ url: 'not a url' })).toBeNull();
  });

  it('every page with a served route and the script has beforeSend (covers pages added later)', () => {
    for (const file of fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      if (html.includes('/_vercel/insights/script.js')) expect(html).toContain(BEFORE_SEND);
    }
  });

  it('privacy policy discloses Vercel Web Analytics', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'privacy.html'), 'utf8');
    expect(html).toContain('Vercel Web Analytics counts page views without cookies and without identifying you. Vercel is based in the United States.');
    expect(html).toContain('Google (web fonts) and Vercel (website analytics) may also process your data in the United States.');
  });

  it('login.html loads fm-track.js once', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8');
    expect(html.split('<script src="/js/fm-track.js" defer></script>').length - 1).toBe(1);
  });

  it('CSP already allows the same-origin script and beacon', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const csp = cfg.headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/connect-src 'self'/);
  });
});
