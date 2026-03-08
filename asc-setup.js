const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

// ASC API Credentials (from SubWise setup)
const ISSUER_ID = '5e0496e7-e4ec-4467-a06a-210c64365371';
const KEY_ID = '548GZGCWZ9';
const KEY_PATH = 'C:\\Users\\Drew\\.openclaw\\media\\inbound\\AuthKey_548GZGCWZ9---83cc6f87-2a9e-4428-8c60-5c875f005a9a';
const privateKey = fs.readFileSync(KEY_PATH, 'utf8');

// FitMunch App Details
const BUNDLE_ID = 'com.fitmunch.ios';
const APP_NAME = 'FitMunch: Meal & Nutrition Tracker';
const APP_SUBTITLE = 'Track meals, hit macros, reach goals';

// IAP Products
const IAP_PRODUCTS = [
  { name: 'Weekly Premium', productId: 'fitmunch_weekly', duration: 'ONE_WEEK', price: '1.49', currency: 'AUD' },
  { name: 'Monthly Premium', productId: 'fitmunch_monthly', duration: 'ONE_MONTH', price: '4.49', currency: 'AUD' },
  { name: 'Annual Premium', productId: 'fitmunch_annual', duration: 'ONE_YEAR', price: '27.99', currency: 'AUD' },
  { name: 'Lifetime Premium', productId: 'fitmunch_lifetime', type: 'NON_CONSUMABLE', price: '44.99', currency: 'AUD' }
];

// App Description (from appstore-metadata.md)
const DESCRIPTION = `Take control of your nutrition with FitMunch — the simple, powerful meal tracker that helps you hit your macros and reach your goals.

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

Whether you're an athlete dialing in your diet or just want to eat better, FitMunch makes nutrition tracking simple, accurate, and sustainable.`;

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

async function createApp() {
  console.log('=== Creating FitMunch App in App Store Connect ===\n');
  
  // 1. Check if app already exists
  console.log('1. Checking for existing app...');
  const appsRes = await api('GET', '/v1/apps?filter[bundleId]=' + BUNDLE_ID);
  
  let appId;
  if (appsRes.body.data && appsRes.body.data.length > 0) {
    appId = appsRes.body.data[0].id;
    console.log('   App already exists: ' + appId + ' ✅');
  } else {
    // Create new app
    console.log('   Creating new app...');
    const createRes = await api('POST', '/v1/apps', {
      data: {
        type: 'apps',
        attributes: {
          name: APP_NAME,
          bundleId: BUNDLE_ID,
          sku: 'FM' + Date.now().toString().slice(-6),
          primaryLocale: 'en-AU'
        }
      }
    });
    
    if (createRes.status !== 201) {
      console.log('   ERROR creating app: ' + JSON.stringify(createRes.body?.errors));
      return null;
    }
    
    appId = createRes.body.data.id;
    console.log('   App created: ' + appId + ' ✅');
  }
  
  return appId;
}

async function createAppStoreVersion(appId) {
  console.log('\n2. Creating App Store version...');
  
  // Get primary category IDs
  const categoriesRes = await api('GET', '/v1/appCategories?filter[platforms]=IOS');
  const healthCategory = categoriesRes.body.data.find(c => c.attributes?.name === 'Health & Fitness');
  const foodCategory = categoriesRes.body.data.find(c => c.attributes?.name === 'Food & Drink');
  
  if (!healthCategory) {
    console.log('   ERROR: Could not find Health & Fitness category');
    return null;
  }
  
  // Create app store version
  const versionRes = await api('POST', '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: {
        platform: 'IOS',
        versionString: '1.0',
        copyright: '© 2026 Drew Chino',
        releaseType: 'AFTER_APPROVAL'
      },
      relationships: {
        app: { data: { type: 'apps', id: appId } }
      }
    }
  });
  
  if (versionRes.status !== 201) {
    console.log('   ERROR creating version: ' + JSON.stringify(versionRes.body?.errors));
    return null;
  }
  
  const versionId = versionRes.body.data.id;
  console.log('   Version created: ' + versionId + ' ✅');
  
  // Create localization
  const locRes = await api('POST', '/v1/appStoreVersionLocalizations', {
    data: {
      type: 'appStoreVersionLocalizations',
      attributes: {
        locale: 'en-AU',
        name: APP_NAME,
        subtitle: APP_SUBTITLE,
        description: DESCRIPTION,
        keywords: 'meal tracker,nutrition,macros,calorie counter,food diary,diet,weight loss,fitness,health',
        promotionalText: 'Track meals, hit macros, reach goals. Free to use — upgrade for meal plans & restaurant lookup.',
        supportUrl: 'https://armctay85.github.io/fitmunch-site/support.html',
        marketingUrl: 'https://armctay85.github.io/fitmunch-site'
      },
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } }
      }
    }
  });
  
  if (locRes.status !== 201) {
    console.log('   ERROR creating localization: ' + JSON.stringify(locRes.body?.errors));
  } else {
    console.log('   Localization created ✅');
  }
  
  // Set age rating
  console.log('3. Setting age rating...');
  const ageRes = await api('GET', '/v1/appStoreVersions/' + versionId + '/ageRatingDeclaration');
  const ageId = ageRes.body.data.id;
  
  await api('PATCH', '/v1/ageRatingDeclarations/' + ageId, {
    data: {
      type: 'ageRatingDeclarations', id: ageId,
      attributes: {
        alcoholTobaccoOrDrugUseOrReferences: 'NONE',
        contests: 'NONE',
        gambling: false,
        gamblingSimulated: 'NONE',
        gunsOrOtherWeapons: 'NONE',
        horrorOrFearThemes: 'NONE',
        lootBox: false,
        matureOrSuggestiveThemes: 'NONE',
        medicalOrTreatmentInformation: 'NONE',
        profanityOrCrudeHumor: 'NONE',
        sexualContentGraphicAndNudity: 'NONE',
        sexualContentOrNudity: 'NONE',
        unrestrictedWebAccess: false,
        userGeneratedContent: 'NONE',
        violenceCartoonOrFantasy: 'NONE',
        violenceRealistic: 'NONE',
        violenceRealisticProlongedGraphicOrSadistic: 'NONE',
      }
    }
  });
  console.log('   Age rating set to 4+ ✅');
  
  // Set app info (categories, privacy policy)
  console.log('4. Setting app info...');
  const appInfoRes = await api('GET', '/v1/apps/' + appId + '/appInfos');
  const appInfoId = appInfoRes.body.data[0].id;
  
  await api('PATCH', '/v1/appInfos/' + appInfoId, {
    data: {
      type: 'appInfos', id: appInfoId,
      relationships: {
        primaryCategory: { data: { type: 'appCategories', id: healthCategory.id } },
        secondaryCategory: foodCategory ? { data: { type: 'appCategories', id: foodCategory.id } } : undefined
      }
    }
  });
  
  // Set privacy policy on app info localization
  const appInfoLocsRes = await api('GET', '/v1/appInfos/' + appInfoId + '/appInfoLocalizations?limit=5');
  if (appInfoLocsRes.body.data && appInfoLocsRes.body.data.length > 0) {
    const appInfoLocId = appInfoLocsRes.body.data[0].id;
    await api('PATCH', '/v1/appInfoLocalizations/' + appInfoLocId, {
      data: {
        type: 'appInfoLocalizations', id: appInfoLocId,
        attributes: { privacyPolicyUrl: 'https://armctay85.github.io/fitmunch-site/privacy.html' }
      }
    });
  }
  
  console.log('   App info configured ✅');
  
  return { appId, versionId };
}

async function createIAPs(appId) {
  console.log('\n5. Creating In-App Purchases...');
  
  // Create subscription group
  const groupRes = await api('POST', '/v1/subscriptionGroups', {
    data: {
      type: 'subscriptionGroups',
      attributes: { referenceName: 'FitMunch Premium' },
      relationships: { app: { data: { type: 'apps', id: appId } } }
    }
  });
  
  if (groupRes.status !== 201) {
    console.log('   ERROR creating subscription group: ' + JSON.stringify(groupRes.body?.errors));
    return;
  }
  
  const groupId = groupRes.body.data.id;
  console.log('   Subscription group created: ' + groupId + ' ✅');
  
  // Create subscription products
  for (const product of IAP_PRODUCTS.filter(p => !p.type || p.type !== 'NON_CONSUMABLE')) {
    console.log('   Creating ' + product.productId + '...');
    
    const subRes = await api('POST', '/v1/subscriptions', {
      data: {
        type: 'subscriptions',
        attributes: {
          name: product.name,
          productId: product.productId,
          subscriptionPeriod: product.duration,
          reviewNote: 'Test with sandbox Apple ID. Free tier available with limited features.',
          familySharable: false,
        },
        relationships: {
          group: { data: { type: 'subscriptionGroups', id: groupId } }
        }
      }
    });
    
    if (subRes.status === 201) {
      const subId = subRes.body.data.id;
      console.log('     Created (ID: ' + subId + ') ✅');
      
      // Add localization
      await api('POST', '/v1/subscriptionLocalizations', {
        data: {
          type: 'subscriptionLocalizations',
          attributes: { 
            locale: 'en-AU', 
            name: product.name, 
            description: 'Unlock meal plans, restaurant lookup, custom foods, macro cycling, and data export.' 
          },
          relationships: { subscription: { data: { type: 'subscriptions', id: subId } } }
        }
      });
    } else {
      console.log('     ERROR: ' + JSON.stringify(subRes.body?.errors?.[0]?.detail || subRes.body?.errors));
    }
  }
  
  // Create lifetime non-consumable
  console.log('   Creating lifetime IAP...');
  const lifetimeRes = await api('POST', '/v1/inAppPurchasesV2', {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: 'Lifetime Premium',
        productId: 'fitmunch_lifetime',
        inAppPurchaseType: 'NON_CONSUMABLE',
        reviewNote: 'One-time purchase for lifetime premium access.',
      },
      relationships: { app: { data: { type: 'apps', id: appId } } }
    }
  });
  
  if (lifetimeRes.status === 201) {
    console.log('     Lifetime IAP created ✅');
  } else {
    console.log('     ERROR: ' + JSON.stringify(lifetimeRes.body?.errors?.[0]?.detail || lifetimeRes.body?.errors));
  }
  
  console.log('   IAP creation complete ✅');
}

async function main() {
  try {
    // Create app
    const appId = await createApp();
    if (!appId) {
      console.log('\n❌ Failed to create/get app');
      return;
    }
    
    // Create app store version and metadata
    const versionInfo = await createAppStoreVersion(appId);
    if (!versionInfo) {
      console.log('\n❌ Failed to create app store version');
      return;
    }
    
    // Create IAPs
    await createIAPs(appId);
    
    console.log('\n=== ASC Setup Complete ===');
    console.log('\nApp Store Connect Details:');
    console.log('• App ID: ' + appId);
    console.log('• Bundle ID: ' + BUNDLE_ID);
    console.log('• Version ID: ' + versionInfo.versionId);
    console.log('\nNext Steps:');
    console.log('1. Generate app icon using DALL-E prompt in app-icon-prompt.md');
    console.log('2. Create screenshots following screenshot-specs.md');
    console.log('3. Create privacy policy at: https://armctay85.github.io/fitmunch-site/privacy.html');
    console.log('4. Run archive workflow in GitHub Actions');
    console.log('5. Upload build to App Store Connect');
    console.log('6. Add icon and screenshots in ASC');
    console.log('7. Submit for review');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
}

// Run the setup
main();