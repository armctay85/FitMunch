'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const request = require('supertest');
const app = require('./server');

const PUBLIC = path.join(__dirname, 'public');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('self-hosted fonts', () => {
  const pages = walk(PUBLIC).filter((file) => /\.(html|css|js)$/.test(file));

  test('no public page references Google Fonts', () => {
    const hits = [];
    for (const file of pages) {
      const text = fs.readFileSync(file, 'utf8');
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text)) hits.push(path.relative(PUBLIC, file));
    }
    expect(hits).toEqual([]);
  });

  test('CSP does not allow google fonts hosts', () => {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(server).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  test('shared font css swaps, size-adjusts, and the home preloads two hero weights', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'fm-fonts.css'), 'utf8');
    expect(css).toContain("font-display: swap");
    expect(css).toContain('size-adjust:');
    expect(css).toContain('Bricolage Grotesque');
    expect(css).toContain('Literata');
    expect(css).toContain('IBM Plex Mono');
    const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const shopper = fs.readFileSync(path.join(PUBLIC, 'shopper.html'), 'utf8');
    for (const html of [home, shopper]) {
      expect(html).toContain('/fonts/bricolage-grotesque-latin-800.woff2');
      expect(html).toContain('/fonts/literata-latin-400.woff2');
      expect(html).toContain('rel="preload"');
    }
  });
});

describe('CTA contrast token', () => {
  test('button fill is #15803D and #22C55E is not a text color', () => {
    const tokens = fs.readFileSync(path.join(PUBLIC, 'css', 'fm-tokens.css'), 'utf8');
    expect(tokens).toContain('--cta: #15803D');
    expect(tokens).toContain('--accent: #22C55E');
    const shell = fs.readFileSync(path.join(PUBLIC, 'css', 'fm-shell.css'), 'utf8');
    expect(shell).toMatch(/\.fm-btn-leaf\{background:var\(--cta\);color:#fff/);
    expect(shell).toMatch(/\.fm-nav-cta\{[\s\S]*background:var\(--cta\)/);
    const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    expect(home).toContain('.btn-leaf{background:var(--cta);color:#fff}');
    expect(home).not.toMatch(/color:\s*var\(--accent\)|color:\s*#22C55E/i);
  });

  test('login tabs use #A7F3D0 and in-text links are underlined', () => {
    const login = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');
    expect(login).toMatch(/\.tab \{[\s\S]*color:\s*#A7F3D0/);
    expect(login).toMatch(/\.foot a \{[^}]*text-decoration:\s*underline/);
    expect(login).toMatch(/\.btn \{[\s\S]*background:\s*var\(--cta\)/);
  });
});

describe('sample trolley and legal copy', () => {
  test('home sample trolley is labelled, priced, and motion-safe', async () => {
    const home = await request(app).get('/').expect(200);
    const hero = home.text.split('<header class="hero">')[1].split('</header>')[0];
    expect(hero).toContain('Sample');
    expect(hero).toContain('A$84.20');
    expect(hero).toContain('Approve this trolley');
    expect(hero).toContain('Not a shop charge');
    expect(hero).toContain('Sample week');
    expect(hero).toContain('>Mince<');
    expect(hero).toContain('>Pasta<');
    const shopper = await request(app).get('/shopper').expect(200);
    const macro = await request(app).get('/macro-meal-planner').expect(200);
    for (const page of [home, shopper, macro]) {
      expect(page.text).toContain('>Mince<');
      expect(page.text).toContain('>Salmon<');
      expect(page.text).toContain('>Thigh<');
      expect(page.text).toContain('>Chicken<');
      expect(page.text).toContain('>Pasta<');
    }
    expect(macro.text).toContain('overhead-chicken.webp');
    const terms = await request(app).get('/terms').expect(200);
    expect(terms.text).toContain('App Store subscriptions are billed and managed by Apple.');
    expect(terms.text).toContain('<!-- ENTITY_LINE: pending owner confirmation -->');
    expect(terms.text).not.toMatch(/governing law/i);
    const privacy = await request(app).get('/privacy').expect(200);
    expect(privacy.text).toContain('Last updated: October 2026');
    expect(hero).not.toContain('$19.99');
    expect(home.text).toContain('prefers-reduced-motion: no-preference');
    expect(home.text).toContain('prefers-reduced-motion:reduce');
    expect(home.text).toContain('loading="lazy"');
    expect(home.text).toContain('overhead-chicken.webp');
  });

  test('terms and refund carry the ACL wording without an entity line or GST', async () => {
    const terms = await request(app).get('/terms').expect(200);
    const refund = await request(app).get('/refund').expect(200);
    for (const page of [terms, refund]) {
      expect(page.text).toContain('Nothing in these terms excludes, restricts or modifies rights you have under the Australian Consumer Law.');
      expect(page.text).toContain('We provide remedies required by the ACL. Outside that, refunds are at our discretion.');
      expect(page.text).toContain('Prices in Australian dollars (AUD).');
      expect(page.text).not.toMatch(/GST/i);
      expect(page.text).not.toMatch(/Pty Ltd/i);
      expect(page.text).not.toMatch(/\bABN\b/);
      expect(page.text).toContain('class="fm-doc legal"');
    }
    expect(terms.text).toContain('<!-- ENTITY_LINE: pending owner confirmation -->');
    expect(refund.text).not.toContain('ENTITY_LINE');
    expect(terms.text).toContain('FitMunch Coach');
    expect(terms.text).toContain('Solo covers up to 10 clients.');
    expect(terms.text).toContain('Pro covers unlimited clients.');
    expect(terms.text).toContain('prorated');
    expect(terms.text).toContain('cancel any time from billing');
    expect(terms.text).toContain('must consent');
    expect(terms.text).toContain('responsible for their advice');
    expect(refund.text).toContain('card on file');
    expect(refund.text).toContain('It is not a 14-day refund after a paid charge');
  });

  test('support is the App Store contact page', async () => {
    const support = await request(app).get('/support').expect(200);
    expect(support.text).toContain('mailto:support@fitmunch.com.au');
    expect(support.text).toContain('within 1 business day');
    expect(support.text).toContain('Settings');
    expect(support.text).toContain('Apple ID');
    expect(support.text).toContain('Subscriptions');
    expect(support.text).toContain('billing portal');
    expect(support.text).toContain('Restore Purchases');
    expect(support.text).toContain('Delete Account');
    expect(support.text).toContain('href="/terms"');
    expect(support.text).toContain('href="/privacy"');
    expect(support.text).toContain('not stored on our servers');
    expect(support.text).not.toMatch(/GST/i);
    expect(support.text).not.toMatch(/Pty Ltd/i);
    expect(support.text).not.toMatch(/hello@/i);
  });
});

describe('390 overflow on legal pages', () => {
  test('legal css wraps copy and caps tables', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', 'fm-shell.css'), 'utf8');
    expect(css).toMatch(/\.legal p,\.legal a\{overflow-wrap:anywhere\}/);
    expect(css).toMatch(/\.legal table\{max-width:100%\}/);
  });

  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((bin) => fs.existsSync(bin));

  test('terms, refund, and privacy do not overflow a 390px viewport', async () => {
    if (!chrome) return;
    jest.setTimeout(40000);
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const script = `
        const http = require('http');
        const { spawn } = require('child_process');
        const port = process.argv[1];
        const chrome = process.argv[2];
        const routes = ['/terms', '/refund', '/privacy', '/support'];
        const child = spawn(chrome, [
          '--headless=new', '--disable-gpu', '--no-sandbox',
          '--remote-debugging-port=9333', '--window-size=390,844', 'about:blank'
        ], { stdio: 'ignore' });
        function get(pathname) {
          return new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port: 9333, path: pathname }, (res) => {
              let body = '';
              res.on('data', (c) => { body += c; });
              res.on('end', () => resolve(body));
            }).on('error', reject);
          });
        }
        async function waitJson() {
          for (let i = 0; i < 40; i++) {
            try { return JSON.parse(await get('/json')); } catch (e) { await new Promise(r => setTimeout(r, 150)); }
          }
          throw new Error('chrome debug port did not open');
        }
        (async () => {
          const targets = await waitJson();
          const wsUrl = targets[0].webSocketDebuggerUrl;
          const ws = new WebSocket(wsUrl);
          let id = 0;
          const pending = new Map();
          ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
          });
          await new Promise((resolve) => ws.addEventListener('open', resolve));
          function send(method, params) {
            const msgId = ++id;
            return new Promise((resolve) => {
              pending.set(msgId, resolve);
              ws.send(JSON.stringify({ id: msgId, method, params }));
            });
          }
          await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
          const failures = [];
          for (const route of routes) {
            await send('Page.navigate', { url: 'http://127.0.0.1:' + port + route });
            await new Promise(r => setTimeout(r, 400));
            const result = await send('Runtime.evaluate', { expression: 'JSON.stringify({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})', returnByValue: true });
            const box = JSON.parse(result.result.result.value);
            if (box.sw > box.cw + 1) failures.push(route + ' ' + box.sw + '>' + box.cw);
          }
          ws.close();
          child.kill();
          if (failures.length) {
            console.error(failures.join('\\n'));
            process.exit(1);
          }
        })().catch((err) => { console.error(err); try { child.kill(); } catch (e) {} process.exit(1); });
      `;
      execFileSync(process.execPath, ['-e', script, String(port), chrome], { stdio: 'inherit', timeout: 30000 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
