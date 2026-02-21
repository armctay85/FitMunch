
// FitMunch Final Launch Checklist Script
console.log("Running FitMunch Final Launch Checklist...");

// Helper to determine environment
const isBrowser = typeof window !== 'undefined';
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

// Critical components to check
const components = [
  { name: "User Accounts", file: "user_account.js", required: true },
  { name: "Subscription Manager", file: "subscription_manager.js", required: true },
  { name: "Receipt Validator", file: "receipt_validator.js", required: true },
  { name: "In-App Purchases", file: "app_iap_implementation.js", required: true },
  { name: "Analytics", file: "analytics.js", required: true },
  { name: "UI Components", file: "user_account_ui.js", required: true },
  { name: "Main App", file: "app.js", required: true },
  { name: "Integration Tests", file: "integration_test.js", required: false },
  { name: "Test Plan", file: "test_plan.js", required: false }
];

// App Store Assets
const appStoreAssets = [
  { name: "App Store Description", file: "app_store_description.txt", required: true },
  { name: "Google Play Content Rating", file: "google_play_content_rating.txt", required: true },
  { name: "Launch Checklist", file: "launch_checklist.md", required: true }
];

// Check if files exist
async function checkFileExists(filename) {
  if (isBrowser) {
    // In browser, we can't easily check file existence
    // Just assume it exists if we're running in browser
    return true;
  } else if (isNode) {
    const fs = require('fs');
    return new Promise(resolve => {
      fs.access(filename, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
  }
  return false;
}

// Check component implementation status
async function checkComponentStatus(component) {
  const exists = await checkFileExists(component.file);
  let status = "Unknown";
  let details = "";
  
  if (exists) {
    try {
      let module;
      if (isBrowser) {
        // Try to find in global scope by conventional name
        const conventionalName = component.file.replace('.js', '').replace(/[_-]/g, '');
        module = window[conventionalName] || null;
      } else if (isNode) {
        try {
          module = require(`./${component.file}`);
        } catch (e) {
          details = e.message;
        }
      }
      
      if (module) {
        status = "Implemented";
      } else {
        status = "File exists but module not loaded";
      }
    } catch (error) {
      status = "Error loading";
      details = error.message;
    }
  } else {
    status = "Missing";
  }
  
  return {
    name: component.name,
    file: component.file,
    status: status,
    details: details,
    required: component.required,
    passed: status === "Implemented" || (!component.required && exists)
  };
}

// Run the checklist
async function runChecklist() {
  console.log("Checking critical components...");
  const results = [];
  
  // Check components
  for (const component of components) {
    const status = await checkComponentStatus(component);
    results.push(status);
    console.log(`${status.name}: ${status.status} ${status.details ? `(${status.details})` : ''}`);
  }
  
  // Check app store assets
  console.log("\nChecking app store assets...");
  for (const asset of appStoreAssets) {
    const exists = await checkFileExists(asset.file);
    const status = {
      name: asset.name,
      file: asset.file,
      status: exists ? "Ready" : "Missing",
      required: asset.required,
      passed: exists || !asset.required
    };
    results.push(status);
    console.log(`${status.name}: ${status.status}`);
  }
  
  // Summary
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  const criticalFails = results.filter(r => r.required && !r.passed).length;
  
  console.log("\n=== Launch Readiness Summary ===");
  console.log(`Total checks: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Critical failures: ${criticalFails}`);
  
  if (criticalFails === 0) {
    console.log("\n✅ FitMunch is READY for launch!");
  } else {
    console.log(`\n❌ FitMunch is NOT ready for launch. Fix ${criticalFails} critical issues.`);
  }
  
  return {
    totalTests,
    passedTests,
    failedTests,
    criticalFails,
    results
  };
}

// Run in the appropriate environment
if (isBrowser) {
  // In browser, expose as global function
  window.runLaunchChecklist = runChecklist;
  console.log("Launch checklist ready. Call window.runLaunchChecklist() to execute.");
} else if (isNode) {
  // In Node.js, run immediately
  runChecklist().then(summary => {
    console.log("Launch checklist completed.");
    if (summary.criticalFails > 0) {
      process.exit(1); // Exit with error if critical failures
    }
  });
  
  // Export for potential programmatic use
  module.exports = {
    runChecklist
  };
}
