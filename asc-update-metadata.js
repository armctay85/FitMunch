const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

// ASC API Credentials
const ISSUER_ID = '5e0496e7-e4ec-4467-a06a-210c64365371';
const KEY_ID = '548GZGCWZ9';
const KEY_PATH = 'C:\\Users\\Drew\\.openclaw\\media\\inbound\\AuthKey_548GZGCWZ9---83cc6f87-2a9e-4428-8c60-5c875f005a9a';

function getPrivateKey() {
  return fs.readFileSync(KEY_PATH, 'utf8');
}

// FitMunch App Details
const APP_ID = '6760215679';

// Trial line stays commented until FitMunchProducts.storekit has an introductory offer.
// const TRIAL_LINE = '[Start with a free trial, then]';

// Build 9 has no shopping-list screen, so there is no shopping-list screenshot.
// The listing says FitMunch builds your list split by store, and that you
// check prices at checkout. It does not cite supermarket prices, savings
// dollar figures, specials, or catalogue dates. "shopping" stays in keywords.
// Subscription lines are the App Store prices only: A$19.99 and A$149.99.
const METADATA = {
  name: 'FitMunch: Macro Meal Planner',
  subtitle: 'Scan your shop, hit protein',
  promotionalText: 'Scan your Woolies, Coles, Aldi or IGA receipt for macros and a haul score. FitMunch builds your list split by store. You check prices at checkout.',
  keywords: 'calorie,counter,tracker,diet,food,log,receipt,grocery,shopping,list,woolworths,coles,aldi,coach,ai',
  whatsNew: 'Welcome to FitMunch. Scan your shop, hit your protein and get a week of meals sorted.',
  supportUrl: 'https://www.fitmunch.com.au/support',
  marketingUrl: 'https://www.fitmunch.com.au',
  privacyPolicyUrl: 'https://www.fitmunch.com.au/privacy',
  description: `Turn your weekly shop into a plan you'll actually stick to.

FitMunch reads your Woolies, Coles, Aldi or IGA receipt, shows the protein and macros in what you bought, and builds a high-protein week around it. FitMunch builds your list split by store. You check prices at checkout.

SCAN YOUR SHOP
• Snap your receipt or pick a photo
• See protein, carbs, fat and calories across your haul
• Get a haul score with simple swaps that lift your protein

HIT YOUR MACROS EVERY DAY
• Set calorie and protein targets for your goal
• Log meals in a few taps and watch your rings fill
• Track progress over time

A WEEK OF MEALS, SORTED
• 7-day high-protein meal plans from your targets
• FitMunch builds your list split by store
• You check prices at checkout

YOUR AI COACH
• Ask "What should I eat tonight?" or "Build my workout"
• Answers that know your goals and your last shop

TRAIN WITH A PLAN
• Weekly gym or home workout plan
• Log sets and exercises

FREE TO START
Log up to 3 meals a day, scan receipts and try the coach for free.

FITMUNCH PREMIUM
Unlimited meal logging, full history, unlimited coach and meal plans.
• Monthly: A$19.99
• Annual: A$149.99

Payment is charged to your Apple Account at confirmation of purchase. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your App Store account settings.

Made in Australia by Develoop.
Terms: https://www.fitmunch.com.au/terms
Privacy: https://www.fitmunch.com.au/privacy
Support: support@fitmunch.com.au`
};

function makeJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url');
  const data = header + '.' + payload;
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  return data + '.' + sign.sign({ key: getPrivateKey(), dsaEncoding: 'ieee-p1363' }).toString('base64url');
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
        whatsNew: METADATA.whatsNew,
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

if (require.main === module) {
  updateAppStoreVersionLocalization().catch(console.error);
}

module.exports = { METADATA };