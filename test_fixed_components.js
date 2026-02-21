
// Test script for fixed FitMunch components

// Helper to determine environment
const isBrowser = typeof window !== 'undefined';
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

// Helper for loading modules in Node.js
function requireIfNode(modulePath) {
  if (isNode) {
    try {
      return require(modulePath);
    } catch (error) {
      console.error(`Failed to load module ${modulePath}:`, error.message);
      return null;
    }
  }
  return null;
}

// Test analytics fix
console.log("Testing analytics.js...");
try {
  const analytics = isBrowser ? window.AnalyticsService : requireIfNode('./analytics.js');
  console.log("Analytics loaded successfully:", !!analytics);
  if (analytics) {
    if (typeof analytics.initialize === 'function') {
      analytics.initialize();
      console.log("Analytics initialized successfully");
    }
    
    if (typeof analytics.trackPageView === 'function') {
      analytics.trackPageView("test_page");
      console.log("Analytics page view tracked successfully");
    }
  }
} catch (error) {
  console.error("Analytics test failed:", error);
}

// Test subscription manager
console.log("\nTesting subscription_manager.js...");
try {
  const subscriptionManager = isBrowser ? window.subscriptionManager : requireIfNode('./subscription_manager.js');
  console.log("Subscription manager loaded successfully:", !!subscriptionManager);
  if (subscriptionManager) {
    if (typeof subscriptionManager.getCurrentPlan === 'function') {
      console.log("Current plan:", subscriptionManager.getCurrentPlan());
    }
    
    if (typeof subscriptionManager.getAvailablePlans === 'function') {
      const plans = subscriptionManager.getAvailablePlans();
      console.log("Available plans:", plans && plans.monthly ? Object.keys(plans.monthly) : "Not available");
    }
  }
} catch (error) {
  console.error("Subscription manager test failed:", error);
}

// Test user account
console.log("\nTesting user_account.js...");
try {
  const userAccount = isBrowser ? window.userAccount : requireIfNode('./user_account.js');
  console.log("User account loaded successfully:", !!userAccount);
  if (userAccount) {
    if (typeof userAccount.isUserLoggedIn === 'function') {
      console.log("User logged in:", userAccount.isUserLoggedIn());
    }
    
    if (typeof userAccount.initialize === 'function') {
      if (userAccount.initialize.then) {
        // It's a promise
        userAccount.initialize().then(success => {
          console.log("User account initialization:", success ? "successful" : "failed");
        }).catch(err => {
          console.error("User account initialization error:", err);
        });
      } else {
        // It's a regular function
        const success = userAccount.initialize();
        console.log("User account initialization:", success ? "successful" : "failed");
      }
    }
  }
} catch (error) {
  console.error("User account test failed:", error);
}

// Test receipt validator
console.log("\nTesting receipt_validator.js...");
try {
  const receiptValidator = isBrowser ? window.receiptValidator : requireIfNode('./receipt_validator.js');
  console.log("Receipt validator loaded successfully:", !!receiptValidator);
  if (receiptValidator) {
    if (typeof receiptValidator.initialize === 'function') {
      if (receiptValidator.initialize.then) {
        // It's a promise
        receiptValidator.initialize().then(success => {
          console.log("Receipt validator initialization:", success ? "successful" : "failed");
        }).catch(err => {
          console.error("Receipt validator initialization error:", err);
        });
      } else {
        // It's a regular function
        const success = receiptValidator.initialize();
        console.log("Receipt validator initialization:", success ? "successful" : "failed");
      }
    }
  }
} catch (error) {
  console.error("Receipt validator test failed:", error);
}

console.log("\nComponent tests complete!");

// For Node.js exports
if (isNode) {
  module.exports = {
    runTests: () => console.log("Tests executed")
  };
}
