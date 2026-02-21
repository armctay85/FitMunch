
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function updateAndroidSdkTargets() {
  console.log('Updating Android SDK targets for Google Play compliance...');
  
  // Update build.gradle
  const appBuildGradlePath = path.join('android', 'app', 'build.gradle');
  
  if (fs.existsSync(appBuildGradlePath)) {
    let buildGradle = fs.readFileSync(appBuildGradlePath, 'utf8');
    
    // Update compileSdkVersion and targetSdkVersion
    buildGradle = buildGradle.replace(
      /compileSdkVersion\s+\d+/,
      'compileSdkVersion 33'
    );
    
    buildGradle = buildGradle.replace(
      /targetSdkVersion\s+\d+/,
      'targetSdkVersion 33'
    );
    
    fs.writeFileSync(appBuildGradlePath, buildGradle);
    console.log('✅ Updated app/build.gradle with SDK 33+');
  } else {
    console.error('❌ App build.gradle not found');
  }
  
  // Update AndroidManifest.xml
  const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    
    // Update or add uses-sdk element with proper target
    if (manifest.includes('<uses-sdk')) {
      manifest = manifest.replace(
        /<uses-sdk[^>]*>/,
        '<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="33" />'
      );
    } else {
      // Add it before the application tag
      manifest = manifest.replace(
        '<application',
        '<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="33" />\n    <application'
      );
    }
    
    fs.writeFileSync(manifestPath, manifest);
    console.log('✅ Updated AndroidManifest.xml with SDK 33+');
  } else {
    console.error('❌ AndroidManifest.xml not found');
  }
  
  console.log('\n🚀 SDK targets updated! You can now build your APK for Google Play submission.');
}

// Run the update
updateAndroidSdkTargets();
