import https from 'https';
import crypto from 'crypto';
import fs from 'fs';

const KEY_ID = '47WA47F4DU';
const ISSUER = '5e0496e7-e4ec-4467-a06a-210c64365371';
const pk = fs.readFileSync('C:/Users/Drew/Downloads/AuthKey_47WA47F4DU.p8', 'utf8');
const DETAIL = 'd3b14178-d9e9-46eb-8717-251ef702ee7c';

function jwt() {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url');
  const s = crypto.createSign('SHA256').update(h + '.' + p).sign({ key: pk, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return h + '.' + p + '.' + s;
}

function api(method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        hostname: 'api.appstoreconnect.apple.com',
        path,
        method,
        headers: {
          Authorization: 'Bearer ' + jwt(),
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (resp) => {
        let b = '';
        resp.on('data', (c) => (b += c));
        resp.on('end', () => res({ status: resp.statusCode, body: b }));
      }
    );
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

const notes = `Demo account: appreview@fitmunch.com.au / FitMunchReview2026

How to review:
1) Sign in with the demo account.
2) Home / Coach / Scan tabs are live against production API.
3) Receipt scan: use any grocery receipt photo.
4) Premium: subscriptions fitmunch_monthly (A$19.99) and fitmunch_annual (A$149.99) are configured under FitMunch Premium. Sandbox purchase works with a Sandbox Apple ID. Website Stripe is a separate rail.

Privacy: https://www.fitmunch.com.au/privacy
Terms: https://www.fitmunch.com.au/terms.html
Support: https://www.fitmunch.com.au/support.html

Not a medical device. No diagnoses. Nutrition estimates only.`;

const r = await api('PATCH', '/v1/appStoreReviewDetails/' + DETAIL, {
  data: {
    type: 'appStoreReviewDetails',
    id: DETAIL,
    attributes: {
      notes,
      demoAccountRequired: true,
      demoAccountName: 'appreview@fitmunch.com.au',
      demoAccountPassword: 'FitMunchReview2026',
    },
  },
});
console.log(r.status, r.body.slice(0, 400));
const ver = JSON.parse((await api('GET', '/v1/appStoreVersions/703b5e6d-85a3-4183-b17a-0f797ac9b606')).body);
console.log('version', ver.data.attributes.appStoreState);
