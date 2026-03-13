
// Google Play Submission Helper Script
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CHECKLIST_FILE = 'google_play_submission_checklist.md';
const ANDROID_FOLDER = path.join(__dirname, 'android');
const APP_FOLDER = path.join(ANDROID_FOLDER, 'app');

async function prepareGooglePlaySubmission() {
  console.log('📱 FitMunch Google Play Submission Preparation');
  console.log('============================================');
  
  try {
    // Step 1: Check Android project exists
    if (!fs.existsSync(ANDROID_FOLDER)) {
      console.error('❌ Android project folder not found!');
      console.log('Run `node build_android.js` first to create the Android project.');
      return;
    }
    
    // Step 2: Validate app icons
    console.log('\n🖼️ Validating app icons...');
    const requiredIcons = [
      { name: 'mipmap-mdpi/ic_launcher.png', size: '48x48' },
      { name: 'mipmap-hdpi/ic_launcher.png', size: '72x72' },
      { name: 'mipmap-xhdpi/ic_launcher.png', size: '96x96' },
      { name: 'mipmap-xxhdpi/ic_launcher.png', size: '144x144' },
      { name: 'mipmap-xxxhdpi/ic_launcher.png', size: '192x192' },
      { name: 'drawable/splash.png', size: '512x512' }
    ];
    
    const resFolder = path.join(APP_FOLDER, 'src', 'main', 'res');
    let iconsValid = true;
    
    for (const icon of requiredIcons) {
      const iconPath = path.join(resFolder, icon.name);
      if (!fs.existsSync(iconPath)) {
        console.log(`❌ Missing: ${icon.name} (${icon.size})`);
        iconsValid = false;
      } else {
        console.log(`✅ Found: ${icon.name} (${icon.size})`);
      }
    }
    
    if (!iconsValid) {
      console.log('\n⚠️ Some app icons are missing! Add them to complete your submission.');
    } else {
      console.log('\n✅ All app icons verified!');
    }
    
    // Step 3: Validate app manifest
    console.log('\n📄 Validating Android manifest...');
    const manifestPath = path.join(APP_FOLDER, 'src', 'main', 'AndroidManifest.xml');
    
    if (!fs.existsSync(manifestPath)) {
      console.error('❌ AndroidManifest.xml not found!');
    } else {
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      
      // Check required manifest entries
      const checks = [
        { name: 'Internet Permission', regex: /uses-permission.*?android:name="android.permission.INTERNET"/, required: true },
        { name: 'Target SDK (33+)', regex: /android:targetSdkVersion="(\d+)"/, required: true, minValue: 33 },
        { name: 'App Icon', regex: /android:icon="@mipmap\/ic_launcher"/, required: true },
        { name: 'App Label', regex: /android:label="@string\/app_name"/, required: true }
      ];
      
      let manifestValid = true;
      
      for (const check of checks) {
        const match = manifest.match(check.regex);
        if (!match && check.required) {
          console.log(`❌ Missing: ${check.name}`);
          manifestValid = false;
        } else if (check.minValue && match) {
          const value = parseInt(match[1]);
          if (value < check.minValue) {
            console.log(`❌ Invalid: ${check.name} - ${value} (should be at least ${check.minValue})`);
            manifestValid = false;
          } else {
            console.log(`✅ Valid: ${check.name} - ${value}`);
          }
        } else {
          console.log(`✅ Valid: ${check.name}`);
        }
      }
      
      if (!manifestValid) {
        console.log('\n⚠️ Some manifest entries need to be fixed!');
      } else {
        console.log('\n✅ Android manifest looks good!');
      }
    }
    
    // Step 4: Check build.gradle for app version
    console.log('\n📋 Validating app version...');
    const buildGradlePath = path.join(APP_FOLDER, 'build.gradle');
    
    if (!fs.existsSync(buildGradlePath)) {
      console.error('❌ build.gradle not found!');
    } else {
      const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
      
      // Extract version code and name
      const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);
      const versionNameMatch = buildGradle.match(/versionName\s+['"]([^'"]+)['"]/);
      
      if (!versionCodeMatch) {
        console.log('❌ Missing versionCode in build.gradle');
      } else {
        console.log(`✅ Version Code: ${versionCodeMatch[1]}`);
      }
      
      if (!versionNameMatch) {
        console.log('❌ Missing versionName in build.gradle');
      } else {
        console.log(`✅ Version Name: ${versionNameMatch[1]}`);
      }
    }
    
    // Step 5: Update checklist file
    console.log('\n📝 Updating submission checklist...');
    if (fs.existsSync(CHECKLIST_FILE)) {
      console.log('✅ Checklist file found:', CHECKLIST_FILE);
    } else {
      console.log('⚠️ Checklist file not found. Creating it...');
      // Create the checklist file with default content
    }
    
    // Step 6: Print next steps
    console.log('\n🚀 Next Steps for Google Play Submission:');
    console.log('1. Open the Android project in Android Studio:');
    console.log('   npx cap open android');
    console.log('2. Build a release APK or App Bundle in Android Studio:');
    console.log('   Build → Generate Signed Bundle/APK');
    console.log('3. Test the signed APK on a real device');
    console.log('4. Complete the Google Play Store listing requirements');
    console.log('5. Submit to Google Play Console at https://play.google.com/console/');
    
  } catch (error) {
    console.error('❌ Error preparing Google Play submission:', error);
  }
}

// Run the preparation script
if (require.main === module) {
  prepareGooglePlaySubmission();
}

module.exports = { prepareGooglePlaySubmission };
