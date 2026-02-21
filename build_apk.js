
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function buildAndroidAPK() {
  console.log('Building APK for Google Play Console submission...');
  
  try {
    // Step 0: Install Java if not available
    console.log('Checking and installing Java...');
    await runCommand('apt-get update && apt-get install -y openjdk-11-jdk');
    await runCommand('export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64');
    
    // Step 1: Ensure all web files are built and ready
    console.log('Preparing web files...');
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist');
    }
    
    // Copy all necessary files to dist
    const filesToCopy = fs.readdirSync('.').filter(file => 
      file.endsWith('.html') || 
      file.endsWith('.css') || 
      file.endsWith('.js') ||
      file.endsWith('.png') ||
      file.endsWith('.jpg')
    );
    
    for (const file of filesToCopy) {
      if (!file.includes('build_') && !file.includes('node_modules')) {
        fs.copyFileSync(file, path.join('dist', file));
        console.log(`Copied ${file} to dist folder`);
      }
    }
    
    // Step 2: Update the Android project with latest web files
    console.log('Syncing web files to Android project...');
    await runCommand('npx cap copy android');
    await runCommand('npx cap sync android');
    
    // Step 3: Update AndroidManifest.xml to target SDK 33+
    console.log('Ensuring Android manifest targets SDK 33+...');
    const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(manifestPath)) {
      let manifest = fs.readFileSync(manifestPath, 'utf8');
      // Ensure we have the proper targetSdkVersion
      if (!manifest.includes('android:targetSdkVersion="33"')) {
        manifest = manifest.replace(
          /<uses-sdk[^>]*>/,
          '<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="33" />'
        );
        fs.writeFileSync(manifestPath, manifest);
        console.log('Updated AndroidManifest.xml to target SDK 33');
      }
    }
    
    // Step 4: Build debug APK (for testing) with JAVA_HOME explicitly set
    console.log('Building debug APK...');
    await runCommand('cd android && JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64 ./gradlew assembleDebug');
    
    // Check if APK was created
    const debugApkPath = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (fs.existsSync(debugApkPath)) {
      console.log('\n✅ Debug APK built successfully!');
      console.log(`APK location: ${debugApkPath}`);
      console.log('\nTo download the APK, navigate to Files and download the APK from:');
      console.log('android/app/build/outputs/apk/debug/app-debug.apk');
      
      console.log('\n📱 For Google Play Console submission:');
      console.log('1. Open the Android project in Android Studio:');
      console.log('   npx cap open android');
      console.log('2. Build a release APK or App Bundle with proper signing:');
      console.log('   Build → Generate Signed Bundle/APK');
      console.log('3. Follow the signing process with your keystore');
      console.log('4. Upload the signed APK/AAB to Google Play Console');
    } else {
      console.error('❌ Failed to build debug APK. Check the logs for errors.');
    }
    
  } catch (error) {
    console.error('Error building Android APK:', error);
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command error: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }
      
      if (stdout) console.log(stdout);
      resolve(stdout);
    });
  });
}

// Run the build
buildAndroidAPK();

module.exports = { buildAndroidAPK };
