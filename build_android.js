
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function buildAndroid() {
  console.log('Building web app for Android...');
  
  try {
    // Check for required packages
    console.log('Checking for required packages...');
    try {
      require('@capacitor/core');
      require('@capacitor/android');
      console.log('Capacitor packages found');
    } catch (err) {
      console.log('Installing required Capacitor packages...');
      await runCommand('npm install @capacitor/core @capacitor/cli @capacitor/android');
      console.log('Capacitor packages installed');
    }
    
    // Create dist directory if it doesn't exist
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist');
    }
    
    // Copy HTML, CSS, and JS files to dist
    const filesToCopy = fs.readdirSync('.').filter(file => 
      file.endsWith('.html') || 
      file.endsWith('.css') || 
      file.endsWith('.js') ||
      file.endsWith('.png') ||
      file.endsWith('.jpg')
    );
    
    filesToCopy.forEach(file => {
      if (!file.includes('build_android') && !file.includes('node_modules')) {
        fs.copyFileSync(file, path.join('dist', file));
      }
    });
    
    console.log('Web files copied to dist folder');
    
    // Update capacitor.config.json webDir if needed
    const capacitorConfig = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
    if (capacitorConfig.webDir !== 'dist') {
      capacitorConfig.webDir = 'dist';
      fs.writeFileSync('capacitor.config.json', JSON.stringify(capacitorConfig, null, 2));
      console.log('Updated capacitor.config.json to use dist folder');
    }
    
    // Check if Android platform exists
    if (!fs.existsSync('android')) {
      console.log('Android platform not found, creating...');
      await runCommand('npx cap add android');
      console.log('Android platform created');
    }
    
    // Copy and sync files to Android platform
    console.log('Copying web files to Android platform...');
    await runCommand('npx cap copy android');
    
    // Sync Android project with any plugin changes
    console.log('Syncing Android project...');
    await runCommand('npx cap sync android');
    
    console.log('Android build preparation completed!');
    console.log('To open in Android Studio, run: npx cap open android');
    console.log('From Android Studio, you can build the APK/AAB for Google Play submission');
    
  } catch (error) {
    console.error('Error building Android app:', error);
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }
      
      console.log(stdout);
      resolve(stdout);
    });
  });
}

// Run the build
buildAndroid();
