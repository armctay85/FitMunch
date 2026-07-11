/**
 * Fix FitMunch ASC IAP metadata that is MISSING_METADATA (likely rejection cause).
 * - privacyPolicyUrl on version localization
 * - en-AU subscription localizations
 * - AUD base prices for monthly/annual/weekly
 * - review screenshots from marketing/appstore shots
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_ID = '47WA47F4DU';
const ISSUER = '5e0496e7-e4ec-4467-a06a-210c64365371';
const pk = fs.readFileSync('C:/Users/Drew/Downloads/AuthKey_47WA47F4DU.p8', 'utf8');

const VERSION_LOC = 'd11e72d4-1fd0-456f-a0fe-213ee3659bba';
const SUBS = [
  { id: '6760268275', productId: 'fitmunch_monthly', name: 'FitMunch Premium Monthly', desc: 'Unlimited AI coach, meal plans, workout programs, receipt scans and weekly reviews. Cancel anytime.', period: 'ONE_MONTH', targetAud: 19.99 },
  { id: '6760268203', productId: 'fitmunch_annual', name: 'FitMunch Premium Annual', desc: 'Full year of unlimited AI coach, meal plans, workouts and receipt scans. Best value. Cancel anytime.', period: 'ONE_YEAR', targetAud: 149.99 },
  { id: '6760268161', productId: 'fitmunch_weekly', name: 'FitMunch Premium Weekly', desc: 'Unlimited AI features for one week. Try Premium with a short commitment. Cancel anytime.', period: 'ONE_WEEK', targetAud: 6.99 },
];

function jwt() {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url');
  const s = crypto.createSign('SHA256').update(h + '.' + p).sign({ key: pk, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return h + '.' + p + '.' + s;
}

function api(method, apiPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const headers = {
      Authorization: 'Bearer ' + jwt(),
      Accept: 'application/json',
      ...extraHeaders,
    };
    if (data && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (data) headers['Content-Length'] = data.length;
    const req = https.request({
      hostname: 'api.appstoreconnect.apple.com',
      path: apiPath,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function parse(r) {
  try { return JSON.parse(r.body); } catch { return { raw: r.body }; }
}

async function setPrivacyUrl() {
  const r = await api('PATCH', `/v1/appStoreVersionLocalizations/${VERSION_LOC}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: VERSION_LOC,
      attributes: {
        privacyPolicyUrl: 'https://www.fitmunch.com.au/privacy',
        supportUrl: 'https://www.fitmunch.com.au/support.html',
        marketingUrl: 'https://www.fitmunch.com.au',
      },
    },
  });
  console.log('privacyPolicyUrl', r.status, r.body.slice(0, 300));
}

async function ensureLocalization(sub) {
  const existing = parse(await api('GET', `/v1/subscriptions/${sub.id}/subscriptionLocalizations`));
  if ((existing.data || []).length) {
    console.log(sub.productId, 'localization exists');
    return existing.data[0].id;
  }
  const r = await api('POST', '/v1/subscriptionLocalizations', {
    data: {
      type: 'subscriptionLocalizations',
      attributes: {
        name: sub.name,
        description: sub.desc,
        locale: 'en-AU',
      },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: sub.id } },
      },
    },
  });
  console.log(sub.productId, 'create localization', r.status, r.body.slice(0, 400));
  return parse(r).data?.id;
}

async function findPricePoint(subId, targetAud) {
  // Paginate AUD price points and pick closest customerPrice
  let url = `/v1/subscriptions/${subId}/pricePoints?filter[territory]=AUS&limit=200`;
  let best = null;
  while (url) {
    const r = await api('GET', url);
    const j = parse(r);
    for (const pp of (j.data || [])) {
      const price = Number(pp.attributes?.customerPrice);
      if (!Number.isFinite(price)) continue;
      const diff = Math.abs(price - targetAud);
      if (!best || diff < best.diff) best = { id: pp.id, price, diff };
      if (diff < 0.01) return best;
    }
    const next = j.links?.next;
    url = next ? next.replace('https://api.appstoreconnect.apple.com', '') : null;
  }
  return best;
}

async function ensurePrice(sub) {
  const existing = parse(await api('GET', `/v1/subscriptions/${sub.id}/prices?limit=10`));
  if ((existing.data || []).length) {
    console.log(sub.productId, 'price exists', existing.data.length);
    return;
  }
  const pp = await findPricePoint(sub.id, sub.targetAud);
  if (!pp) {
    console.log(sub.productId, 'NO AUD PRICE POINT FOUND for', sub.targetAud);
    return;
  }
  console.log(sub.productId, 'using price point', pp.price, pp.id);
  const r = await api('POST', '/v1/subscriptionPrices', {
    data: {
      type: 'subscriptionPrices',
      attributes: { startDate: null },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: sub.id } },
        subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pp.id } },
      },
    },
  });
  console.log(sub.productId, 'create price', r.status, r.body.slice(0, 500));
}

async function ensureReviewScreenshot(sub) {
  // Check existing
  const check = await api('GET', `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`);
  if (check.status === 200 && parse(check).data) {
    console.log(sub.productId, 'review screenshot exists');
    return;
  }
  const shotPath = path.join(__dirname, '../marketing/appstore/shot1.png');
  if (!fs.existsSync(shotPath)) {
    console.log(sub.productId, 'missing shot1.png — skip screenshot');
    return;
  }
  const fileSize = fs.statSync(shotPath).size;
  const create = await api('POST', '/v1/subscriptionAppStoreReviewScreenshots', {
    data: {
      type: 'subscriptionAppStoreReviewScreenshots',
      attributes: {
        fileName: 'fitmunch-premium-review.png',
        fileSize,
      },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: sub.id } },
      },
    },
  });
  console.log(sub.productId, 'create screenshot reservation', create.status, create.body.slice(0, 600));
  const cj = parse(create);
  const shotId = cj.data?.id;
  const uploadOps = cj.data?.attributes?.uploadOperations || [];
  if (!shotId || !uploadOps.length) return;

  const fileBuf = fs.readFileSync(shotPath);
  for (const op of uploadOps) {
    const method = op.method || 'PUT';
    const url = new URL(op.url);
    const headers = {};
    for (const h of (op.requestHeaders || [])) headers[h.name] = h.value;
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: { ...headers, 'Content-Length': fileBuf.length },
      }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          console.log(sub.productId, 'upload', res.statusCode);
          resolve();
        });
      });
      req.on('error', reject);
      req.write(fileBuf);
      req.end();
    });
  }

  const commit = await api('PATCH', `/v1/subscriptionAppStoreReviewScreenshots/${shotId}`, {
    data: {
      type: 'subscriptionAppStoreReviewScreenshots',
      id: shotId,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash('md5').update(fileBuf).digest('hex'),
      },
    },
  });
  console.log(sub.productId, 'commit screenshot', commit.status, commit.body.slice(0, 400));
}

async function main() {
  await setPrivacyUrl();
  for (const sub of SUBS) {
    console.log('\n====', sub.productId);
    await ensureLocalization(sub);
    await ensurePrice(sub);
    await ensureReviewScreenshot(sub);
    const refreshed = parse(await api('GET', `/v1/subscriptions/${sub.id}`));
    console.log(sub.productId, 'STATE NOW', refreshed.data?.attributes?.state);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
