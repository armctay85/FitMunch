/**
 * FitMunch ASC: attach monthly+annual IAPs + version to READY_FOR_REVIEW submission, then submit.
 * Skips weekly (MISSING_METADATA). Does not invent Resolution Center text.
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';

const KEY_ID = '47WA47F4DU';
const ISSUER = '5e0496e7-e4ec-4467-a06a-210c64365371';
const APP_ID = '6760215679';
const VERSION_ID = '703b5e6d-85a3-4183-b17a-0f797ac9b606';
const MONTHLY = '6760268275';
const ANNUAL = '6760268203';
const pk = fs.readFileSync('C:/Users/Drew/Downloads/AuthKey_47WA47F4DU.p8', 'utf8');

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

function j(r) {
  try {
    return JSON.parse(r.body);
  } catch {
    return { raw: r.body };
  }
}

console.log('=== FitMunch ASC resubmit ===');

// 1. Version + app info state
const ver = j(await api('GET', `/v1/appStoreVersions/${VERSION_ID}`));
console.log('version state', ver.data?.attributes?.appStoreState, ver.data?.attributes?.appVersionState);

// 2. Find READY_FOR_REVIEW submission or create one
let subs = j(await api('GET', `/v1/reviewSubmissions?filter[app]=${APP_ID}`));
console.log(
  'submissions',
  (subs.data || []).map((s) => ({ id: s.id, state: s.attributes.state, submitted: s.attributes.submittedDate }))
);

let ready = (subs.data || []).find((s) => s.attributes.state === 'READY_FOR_REVIEW');
if (!ready) {
  const created = j(
    await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: {},
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    })
  );
  console.log('create submission', created);
  ready = created.data;
}
if (!ready?.id) {
  console.error('No READY_FOR_REVIEW submission available');
  process.exit(1);
}
console.log('using submission', ready.id, ready.attributes?.state);

// 3. List current items
const items = j(await api('GET', `/v1/reviewSubmissions/${ready.id}/items`));
console.log(
  'current items',
  (items.data || []).map((i) => ({
    id: i.id,
    state: i.attributes?.state,
    type: i.relationships?.appStoreVersion?.data?.type || i.relationships,
  }))
);

// 4. Attach version
const attachVersion = j(
  await api('POST', '/v1/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: ready.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } },
      },
    },
  })
);
console.log('attach version', attachVersion.errors || attachVersion.data?.id || attachVersion);

// 5. Attach monthly + annual subscriptions
for (const [label, id] of [
  ['monthly', MONTHLY],
  ['annual', ANNUAL],
]) {
  const r = j(
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: ready.id } },
          subscription: { data: { type: 'subscriptions', id } },
        },
      },
    })
  );
  console.log(`attach ${label}`, r.errors?.[0]?.detail || r.errors || r.data?.id || r);
}

// 6. Re-list items
const items2 = j(await api('GET', `/v1/reviewSubmissions/${ready.id}/items`));
console.log(
  'items after attach',
  (items2.data || []).map((i) => ({
    id: i.id,
    state: i.attributes?.state,
    rels: Object.keys(i.relationships || {}),
  }))
);

// 7. Resolve any unresolved items if needed
for (const item of items2.data || []) {
  if (item.attributes?.state === 'READY_FOR_REVIEW' || item.attributes?.resolved === false) {
    const patch = j(
      await api('PATCH', `/v1/reviewSubmissionItems/${item.id}`, {
        data: { type: 'reviewSubmissionItems', id: item.id, attributes: { resolved: true } },
      })
    );
    console.log('resolve item', item.id, patch.errors?.[0]?.detail || patch.data?.attributes?.state || 'ok');
  }
}

// 8. Submit
const submit = j(
  await api('PATCH', `/v1/reviewSubmissions/${ready.id}`, {
    data: {
      type: 'reviewSubmissions',
      id: ready.id,
      attributes: { submitted: true },
    },
  })
);
console.log('SUBMIT', submit.errors?.[0]?.detail || submit.data?.attributes || submit);

// 9. Final states
const ver2 = j(await api('GET', `/v1/appStoreVersions/${VERSION_ID}`));
console.log('FINAL version', ver2.data?.attributes?.appStoreState, ver2.data?.attributes?.appVersionState);
const sub2 = j(await api('GET', `/v1/reviewSubmissions/${ready.id}`));
console.log('FINAL submission', sub2.data?.attributes?.state, sub2.data?.attributes?.submittedDate);
