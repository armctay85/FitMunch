const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

// ASC API Credentials
const ISSUER_ID = '5e0496e7-e4ec-4467-a06a-210c64365371';
const KEY_ID = '548GZGCWZ9';
const KEY_PATH = 'C:\\Users\\Drew\\.openclaw\\media\\inbound\\AuthKey_548GZGCWZ9---83cc6f87-2a9e-4428-8c60-5c875f005a9a';
const privateKey = fs.readFileSync(KEY_PATH, 'utf8');

// FitMunch App Details
const APP_ID = '6760215679';

// Metadata from appstore-metadata.md
const METADATA = {
  name: 'FitMunch: Meal & Nutrition Tracker',
  subtitle: 'Track meals, hit macros, reach goals',
  description: `Take control of your nutrition with FitMunch — the simple, powerful meal tracker that helps you hit your macros and reach your goals.

WHY FITMUNCH?

→ TRACK MEALS IN SECONDS
Log food with our extensive database or scan barcodes. No more guessing — know exactly what you're eating.

→ HIT YOUR MACROS DAILY
Set protein, carbs, and fat targets. See real-time progress and get nudged when you're off track.

→ PERSONALIZED FOR YOU
Whether you're cutting, bulking, or maintaining, FitMunch adapts to your goals and lifestyle.

→ NO SUBSCRIPTION REQUIRED
Free tier includes full meal logging, macro tracking, and progress charts. Upgrade for advanced features.

FREE FEATURES:
• Log unlimited meals & snacks
• Track protein, carbs, fat, calories
• Set daily macro targets
• View progress charts & trends
• Barcode scanner for packaged foods
• 100,000+ food database

PREMIUM FEATURES:
• Meal plans & recipes
• Restaurant nutrition lookup
• Custom food creation
• Macro cycling (different targets by day)
• Data export (CSV/PDF)
• Priority support

PRIVACY FIRST
Your food diary is personal. FitMunch stores everything on your device — no cloud, no tracking, no ads. Your nutrition data belongs to you.

Whether you're an athlete dialing in your diet or just want to eat better, FitMunch makes nutrition tracking simple, accurate, and sustainable.`,
  keywords: 'meal tracker,nutrition,macros,calorie counter,food diary,diet,weight loss,fitness,health',
  promotionalText: 'Track meals, hit macros, reach goals. Free to use — upgrade for meal plans & restaurant lookup.',
  supportUrl: 'https://armctay85.github.io/fitmunch-site/support.html',
  marketingUrl: 'https://armctay85.github.io/fitmunch-site',
  privacyPolicyUrl: 'https://armctay85.github.io/fitmunch-site/privacy.html'
};

function makeJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url');
  const data = header + '.' + payload;
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  return data + '.' + sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const token = makeJWT();
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.appstoreconnect.apple.com', path, method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) }
    }, res => { let d = ''; res.on('data', x => d += x); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function updateAppStoreVersionLocalization() {
  console.log('=== Updating FitMunch App Store Metadata ===\n');
  
  // 1. Get app store version
  console.log('1. Getting app store version...');
  const versionsRes = await api('GET', '/v1/apps/' + APP_ID + '/appStoreVersions');
  
  if (versionsRes.status !== 200 || !versionsRes.body.data || versionsRes.body.data.length === 0) {
    console.log('   ERROR: No app store version found');
    return;
  }
  
  const versionId = versionsRes.body.data[0].id;
  console.log('   Version ID:', versionId);
  
  // 2. Get or create localization
  console.log('\n2. Updating localization...');
  const locsRes = await api('GET', '/v1/appStoreVersions/' + versionId + '/appStoreVersionLocalizations');
  
  let locId;
  if (locsRes.status === 200 && locsRes.body.data && locsRes.body.data.length > 0) {
    locId = locsRes.body.data[0].id;
    console.log('   Using existing localization:', locId);
  } else {
    // Create new localization
    console.log('   Creating new localization...');
    const createLocRes = await api('POST', '/v1/appStoreVersionLocalizations', {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: 'en-AU' },
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } }
        }
      }
    });
    
    if (createLocRes.status !== 201) {
      console.log('   ERROR creating localization:', JSON.stringify(createLocRes.body?.errors));
      return;
    }
    
    locId = createLocRes.body.data.id;
    console.log('   Localization created:', locId);
  }
  
  // 3. Update localization with metadata
  console.log('\n3. Updating metadata...');
  const updateRes = await api('PATCH', '/v1/appStoreVersionLocalizations/' + locId, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: locId,
      attributes: {
        description: METADATA.description,
        keywords: METADATA.keywords,
        promotionalText: METADATA.promotionalText,
        supportUrl: METADATA.supportUrl,
        marketingUrl: METADATA.marketingUrl
      }
    }
  });
  
  if (updateRes.status !== 200) {
    console.log('   ERROR updating metadata:', JSON.stringify(updateRes.body?.errors));
  } else {
    console.log('   Metadata updated successfully! ✅');
    console.log('   • Description:', METADATA.description.length, 'chars');
    console.log('   • Keywords:', METADATA.keywords);
    console.log('   • Promotional Text:', METADATA.promotionalText);
  }
  
  // 4. Update app info localization (privacy policy)
  console.log('\n4. Updating privacy policy...');
  const appInfoRes = await api('GET', '/v1/apps/' + APP_ID + '/appInfos');
  
  if (appInfoRes.status === 200 && appInfoRes.body.data && appInfoRes.body.data.length > 0) {
    const appInfoId = appInfoRes.body.data[0].id;
    
    const appInfoLocsRes = await api('GET', '/v1/appInfos/' + appInfoId + '/appInfoLocalizations');
    if (appInfoLocsRes.status === 200 && appInfoLocsRes.body.data && appInfoLocsRes.body.data.length > 0) {
      const appInfoLocId = appInfoLocsRes.body.data[0].id;
      
      const privacyRes = await api('PATCH', '/v1/appInfoLocalizations/' + appInfoLocId, {
        data: {
          type: 'appInfoLocalizations',
          id: appInfoLocId,
          attributes: { privacyPolicyUrl: METADATA.privacyPolicyUrl }
        }
      });
      
      if (privacyRes.status !== 200) {
        console.log('   ERROR updating privacy policy:', JSON.stringify(privacyRes.body?.errors));
      } else {
        console.log('   Privacy policy updated:', METADATA.privacyPolicyUrl, '✅');
      }
    }
  }
  
  // 5. Update app info (categories)
  console.log('\n5. Setting categories...');
  const categoriesRes = await api('GET', '/v1/appCategories?filter[platforms]=IOS');
  const healthCategory = categoriesRes.body.data.find(c => c.attributes?.name === 'Health & Fitness');
  const foodCategory = categoriesRes.body.data.find(c => c.attributes?.name === 'Food & Drink');
  
  if (healthCategory) {
    const updateAppInfoRes = await api('PATCH', '/v1/appInfos/' + appInfoId, {
      data: {
        type: 'appInfos',
        id: appInfoId,
        relationships: {
          primaryCategory: { data: { type: 'appCategories', id: healthCategory.id } },
          secondaryCategory: foodCategory ? { data: { type: 'appCategories', id: foodCategory.id } } : undefined
        }
      }
    });
    
    if (updateAppInfoRes.status !== 200) {
      console.log('   ERROR updating categories:', JSON.stringify(updateAppInfoRes.body?.errors));
    } else {
      console.log('   Categories set: Health & Fitness', foodCategory ? '+ Food & Drink' : '', '✅');
    }
  }
  
  console.log('\n=== Metadata Update Complete ===');
  console.log('\nWhat still needs manual work in ASC web interface:');
  console.log('1. App name update (cannot be done via API):');
  console.log('   Current: "FitMunch"');
  console.log('   Change to: "' + METADATA.name + '"');
  console.log('\n2. Subtitle (cannot be done via API):');
  console.log('   Add: "' + METADATA.subtitle + '"');
  console.log('\n3. Visual assets (must be uploaded manually):');
  console.log('   • App icon (generate from app-icon-prompt.md)');
  console.log('   • Screenshots (create from screenshot-specs.md)');
}

updateAppStoreVersionLocalization().catch(console.error);