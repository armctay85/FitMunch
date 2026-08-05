/**
 * Upload 6.7" screenshots + strip "Free" from promotionalText.
 * Requires version not locked; cancel WAITING_FOR_REVIEW first if needed.
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_ID = '47WA47F4DU';
const ISSUER = '5e0496e7-e4ec-4467-a06a-210c64365371';
const VERSION_ID = '703b5e6d-85a3-4183-b17a-0f797ac9b606';
const VERSION_LOC = 'd11e72d4-1fd0-456f-a0fe-213ee3659bba';
const pk = fs.readFileSync('C:/Users/Drew/Downloads/AuthKey_47WA47F4DU.p8', 'utf8');
const SHOT_DIR = path.join(__dirname, '../marketing/appstore');

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
    const headers = { Authorization: 'Bearer ' + jwt(), Accept: 'application/json', ...extraHeaders };
    if (data && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (data) headers['Content-Length'] = data.length;
    const req = https.request({ hostname: 'api.appstoreconnect.apple.com', path: apiPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function parse(r) {
  try {
    return JSON.parse(r.body);
  } catch {
    return { raw: r.body };
  }
}

async function uploadBinary(uploadOps, fileBuf) {
  for (const op of uploadOps || []) {
    const url = new URL(op.url);
    await new Promise((resolve, reject) => {
      const headers = {};
      for (const h of op.requestHeaders || []) headers[h.name] = h.value;
      headers['Content-Length'] = fileBuf.length;
      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, method: op.method || 'PUT', headers },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.write(fileBuf);
      req.end();
    });
  }
}

async function patchPromo() {
  const promo = 'Scan your shop, see your macros, and let AI plan your week.';
  const r = await api('PATCH', `/v1/appStoreVersionLocalizations/${VERSION_LOC}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: VERSION_LOC,
      attributes: { promotionalText: promo },
    },
  });
  console.log('promotionalText', r.status, r.body.slice(0, 400));
}

async function ensureScreenshotSet() {
  const sets = parse(await api('GET', `/v1/appStoreVersionLocalizations/${VERSION_LOC}/appScreenshotSets`));
  let set = (sets.data || []).find((s) => s.attributes?.screenshotDisplayType === 'APP_IPHONE_67');
  if (!set) {
    const created = parse(
      await api('POST', '/v1/appScreenshotSets', {
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: 'APP_IPHONE_67' },
          relationships: {
            appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: VERSION_LOC } },
          },
        },
      })
    );
    console.log('create set', created.errors || created.data?.id);
    set = created.data;
  }
  console.log('screenshot set', set?.id, set?.attributes?.screenshotDisplayType);
  return set?.id;
}

async function clearScreenshots(setId) {
  const existing = parse(await api('GET', `/v1/appScreenshotSets/${setId}/appScreenshots`));
  for (const s of existing.data || []) {
    const del = await api('DELETE', `/v1/appScreenshots/${s.id}`);
    console.log('delete', s.id, del.status);
  }
}

async function uploadShot(setId, filePath, sortOrder) {
  const buf = fs.readFileSync(filePath);
  const reserve = parse(
    await api('POST', '/v1/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: { fileName: path.basename(filePath), fileSize: buf.length },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
      },
    })
  );
  if (reserve.errors) {
    console.log('reserve fail', filePath, reserve.errors);
    return;
  }
  const id = reserve.data.id;
  await uploadBinary(reserve.data.attributes.uploadOperations, buf);
  const commit = await api('PATCH', `/v1/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex'),
      },
    },
  });
  console.log('uploaded', path.basename(filePath), 'order', sortOrder, commit.status);
}

async function cancelWaitingSubmission() {
  const subs = parse(await api('GET', '/v1/reviewSubmissions?filter[app]=6760215679'));
  for (const s of subs.data || []) {
    console.log('submission', s.id, s.attributes.state);
    if (s.attributes.state === 'WAITING_FOR_REVIEW') {
      // Prefer deleting submission items / cancel via PATCH if supported
      const cancel = await api('PATCH', `/v1/reviewSubmissions/${s.id}`, {
        data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } },
      });
      console.log('cancel attempt', cancel.status, cancel.body.slice(0, 500));
    }
  }
}

async function main() {
  console.log('=== ASC screenshots + promo ===');
  await cancelWaitingSubmission();
  await patchPromo();
  const setId = await ensureScreenshotSet();
  if (!setId) {
    console.error('No screenshot set');
    process.exit(1);
  }
  await clearScreenshots(setId);
  for (let i = 1; i <= 5; i++) {
    await uploadShot(setId, path.join(SHOT_DIR, `shot${i}.png`), i);
  }
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
