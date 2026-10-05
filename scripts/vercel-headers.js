'use strict';

/**
 * vercel.json "headers" are generated from lib/security-headers.js.
 * public/*.html is served by the Vercel CDN before the /api rewrite, so
 * Express never sets headers on those files. These rules give the CDN the
 * same set Express sends, so the policy lives in one place.
 *
 *   node scripts/vercel-headers.js          print the rules
 *   node scripts/vercel-headers.js --write  rewrite vercel.json
 *   node scripts/vercel-headers.js --check  exit 1 if vercel.json has drifted
 *
 * test_server_api.js fails if vercel.json is not exactly this output.
 */

const fs = require('fs');
const path = require('path');
const {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  HSTS,
  CONTENT_TYPE_OPTIONS,
} = require('../lib/security-headers');

const SITE_ORIGIN = 'https://www.fitmunch.com.au';

// Helmet adds these on every Express response (see server.js helmet config).
// test_server_api.js compares them with a live Express response.
const HELMET_DEFAULTS = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
  { key: 'Origin-Agent-Cluster', value: '?1' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Download-Options', value: 'noopen' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'X-XSS-Protection', value: '0' },
];

// The CDN adds Access-Control-Allow-Origin: * to static files by default.
// Every static HTML page gets the site origin instead (path-to-regexp source).
const STATIC_HTML_SOURCE = '/(.*)\\.html';
// Static pages Express never sees; test_server_api.js checks each one.
const STATIC_PAGES = ['/login.html', '/app.html', '/success.html'];

// Paths that carry a secret in the URL (reset link, guest claim, checkout
// session id) must not leak it in the Referer header.
const NO_REFERRER_PATHS = ['/login', '/login.html', '/success.html', '/checkout/success'];

function buildHeaderRules() {
  const rules = [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        { key: 'X-Content-Type-Options', value: CONTENT_TYPE_OPTIONS },
        { key: 'Referrer-Policy', value: REFERRER_POLICY },
        { key: 'Strict-Transport-Security', value: HSTS },
        { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
        ...HELMET_DEFAULTS,
      ],
    },
  ];
  rules.push({
    source: STATIC_HTML_SOURCE,
    headers: [{ key: 'Access-Control-Allow-Origin', value: SITE_ORIGIN }],
  });
  for (const source of NO_REFERRER_PATHS) {
    rules.push({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] });
  }
  return rules;
}

const VERCEL_JSON = path.join(__dirname, '..', 'vercel.json');

function render(config) {
  return JSON.stringify(config, null, 2) + '\n';
}

function expectedVercelJson() {
  const config = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
  config.headers = buildHeaderRules();
  return render(config);
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--write') {
    fs.writeFileSync(VERCEL_JSON, expectedVercelJson());
  } else if (arg === '--check') {
    if (fs.readFileSync(VERCEL_JSON, 'utf8') !== expectedVercelJson()) {
      console.error('vercel.json headers are out of date. Run: node scripts/vercel-headers.js --write');
      process.exit(1);
    }
  } else {
    process.stdout.write(JSON.stringify(buildHeaderRules(), null, 2) + '\n');
  }
}

module.exports = {
  SITE_ORIGIN,
  HELMET_DEFAULTS,
  STATIC_HTML_SOURCE,
  STATIC_PAGES,
  NO_REFERRER_PATHS,
  buildHeaderRules,
  expectedVercelJson,
};
