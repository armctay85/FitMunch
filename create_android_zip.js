
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

async function createAndroidZip() {
  console.log('Creating downloadable Android project ZIP for Google Play submission...');
  
  try {
    // Check if archiver is installed, if not install it
    try {
      require('archiver');
    } catch (err) {
      console.log('Installing archiver package...');
      const { execSync } = require('child_process');
      execSync('npm install archiver');
      console.log('Archiver package installed');
    }
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist');
    }
    
    const output = fs.createWriteStream(path.join('dist', 'android-project.zip'));
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });
    
    // Listen for all archive data to be written
    output.on('close', function() {
      console.log(`✅ Android project ZIP created successfully: ${archive.pointer()} total bytes`);
      console.log('ZIP file location: dist/android-project.zip');
      console.log('\nDownload instructions:');
      console.log('1. Navigate to the Files panel in Replit');
      console.log('2. Find and download the "dist/android-project.zip" file');
      console.log('3. Extract the ZIP file on your local machine');
      console.log('4. Open the project in Android Studio');
      console.log('5. Build the APK or App Bundle for Google Play submission');
    });
    
    archive.on('error', function(err) {
      throw err;
    });
    
    // Pipe archive data to the output file
    archive.pipe(output);
    
    // Add the android directory to the archive
    if (fs.existsSync('android')) {
      archive.directory('android', 'android');
      console.log('Added Android project files to ZIP');
    } else {
      throw new Error('Android project directory not found. Run build_android.js first.');
    }
    
    // Add important configuration files
    const configFiles = [
      'capacitor.config.json',
      'app_manifest.json',
      'package.json',
      'google_play_submission_checklist.md'
    ];
    
    configFiles.forEach(file => {
      if (fs.existsSync(file)) {
        archive.file(file, { name: file });
        console.log(`Added ${file} to ZIP`);
      }
    });
    
    // Add dist folder with web files if it exists
    if (fs.existsSync('dist')) {
      const distContents = fs.readdirSync('dist').filter(file => 
        file !== 'android-project.zip' && 
        !file.endsWith('.zip')
      );
      
      if (distContents.length > 0) {
        archive.directory('dist', 'dist');
        console.log('Added web files from dist folder to ZIP');
      }
    }
    
    // Finalize the archive
    archive.finalize();
    
  } catch (error) {
    console.error('Error creating Android project ZIP:', error);
  }
}

// Run the function
createAndroidZip();
