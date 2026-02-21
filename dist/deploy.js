
// FitMunch Deployment Script
// This script handles the build and deployment process for FitMunch

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Deployment configuration
const config = {
  production: {
    buildCommand: 'npm run build',
    outputDir: 'dist',
    platformConfigs: {
      web: {
        deployCommand: 'npm run deploy:web'
      },
      ios: {
        buildCommand: 'npm run build:ios',
        deployCommand: 'npm run deploy:ios'
      },
      android: {
        buildCommand: 'npm run build:android',
        deployCommand: 'npm run deploy:android'
      }
    }
  },
  staging: {
    buildCommand: 'npm run build:staging',
    outputDir: 'dist-staging',
    platformConfigs: {
      web: {
        deployCommand: 'npm run deploy:web-staging'
      }
    }
  }
};

// Main deployment function
async function deploy(environment = 'production', platforms = ['web']) {
  console.log(`Starting ${environment} deployment for platforms: ${platforms.join(', ')}...`);
  
  try {
    // Validate parameters
    if (!config[environment]) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    
    const envConfig = config[environment];
    
    // Validate platforms
    for (const platform of platforms) {
      if (!envConfig.platformConfigs[platform]) {
        throw new Error(`Platform ${platform} not configured for ${environment} environment`);
      }
    }
    
    // Run pre-deployment checks
    await runPreDeploymentChecks();
    
    // Build the app
    await runCommand(envConfig.buildCommand);
    
    // Deploy to each platform
    for (const platform of platforms) {
      console.log(`Deploying to ${platform}...`);
      const platformConfig = envConfig.platformConfigs[platform];
      
      // Run platform-specific build if needed
      if (platformConfig.buildCommand) {
        await runCommand(platformConfig.buildCommand);
      }
      
      // Run deployment command
      await runCommand(platformConfig.deployCommand);
      
      console.log(`Deployment to ${platform} completed successfully!`);
    }
    
    console.log(`${environment} deployment completed successfully!`);
    return true;
  } catch (error) {
    console.error('Deployment failed:', error);
    return false;
  }
}

// Run pre-deployment checks
async function runPreDeploymentChecks() {
  console.log('Running pre-deployment checks...');
  
  // Check for uncommitted changes
  const hasUncommittedChanges = await checkForUncommittedChanges();
  if (hasUncommittedChanges) {
    console.warn('Warning: You have uncommitted changes in your repository.');
    // Prompt for confirmation in a real implementation
  }
  
  // Run tests
  console.log('Running tests...');
  try {
    await runCommand('npm test');
  } catch (error) {
    throw new Error('Tests failed. Deployment aborted.');
  }
  
  // Check for critical issues
  const criticalIssues = await checkForCriticalIssues();
  if (criticalIssues.length > 0) {
    throw new Error(`Critical issues found: ${criticalIssues.join(', ')}. Deployment aborted.`);
  }
  
  console.log('Pre-deployment checks passed successfully!');
}

// Check for uncommitted changes
async function checkForUncommittedChanges() {
  return new Promise((resolve, reject) => {
    exec('git status --porcelain', (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      
      resolve(stdout.trim().length > 0);
    });
  });
}

// Check for critical issues
async function checkForCriticalIssues() {
  const issues = [];
  
  // In a real implementation, this would perform actual checks
  // For example, verifying that all required files exist
  
  // Check for required files
  const requiredFiles = [
    'index.html',
    'app.js',
    'user_account.js',
    'subscription_manager.js',
    'receipt_validator.js'
  ];
  
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      issues.push(`Missing required file: ${file}`);
    }
  }
  
  return issues;
}

// Run a shell command
function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`Running command: ${command}`);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command error: ${error.message}`);
        console.error(`Command stderr: ${stderr}`);
        return reject(error);
      }
      
      console.log(`Command stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

// Command line interface
function parseArgs() {
  const args = process.argv.slice(2);
  let environment = 'production';
  let platforms = ['web'];
  
  args.forEach(arg => {
    if (arg === '--staging' || arg === '-s') {
      environment = 'staging';
    } else if (arg === '--all-platforms' || arg === '-a') {
      platforms = ['web', 'ios', 'android'];
    } else if (arg.startsWith('--platform=') || arg.startsWith('-p=')) {
      const platform = arg.split('=')[1];
      if (platform) {
        platforms = [platform];
      }
    }
  });
  
  return { environment, platforms };
}

// Run the script if executed directly
if (require.main === module) {
  const { environment, platforms } = parseArgs();
  
  deploy(environment, platforms)
    .then(success => {
      if (success) {
        console.log('Deployment script completed successfully!');
        process.exit(0);
      } else {
        console.error('Deployment script failed.');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unhandled error during deployment:', error);
      process.exit(1);
    });
}

// Export for use in other modules
module.exports = {
  deploy,
  runPreDeploymentChecks
};
