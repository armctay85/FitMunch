
// FitMunch Integration Test Runner
console.log("Starting FitMunch integration tests...");

// Helper to determine environment
const isBrowser = typeof window !== 'undefined';
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

// Import or reference necessary modules
let userAccount, subscriptionManager, iapImplementation, receiptValidator;

if (isBrowser) {
  userAccount = window.userAccount;
  subscriptionManager = window.subscriptionManager;
  iapImplementation = window.fitMunchIAP;
  receiptValidator = window.receiptValidator;
} else if (isNode) {
  try {
    userAccount = require('./user_account.js');
    subscriptionManager = require('./subscription_manager.js');
    iapImplementation = require('./app_iap_implementation.js');
    receiptValidator = require('./receipt_validator.js');
  } catch (error) {
    console.error("Failed to load required modules:", error.message);
  }
}

// Test complete user flow
async function testCompleteUserFlow() {
  console.log("\n=== Testing Complete User Flow ===");
  
  try {
    // 1. Initialize all components
    console.log("1. Initializing components...");
    await userAccount.initialize();
    await subscriptionManager.initialize();
    await iapImplementation.initialize();
    await receiptValidator.initialize();
    console.log("✅ All components initialized");
    
    // 2. Register a test user
    console.log("\n2. Registering test user...");
    const email = `test${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const registrationResult = await userAccount.register("Test User", email, password);
    
    if (registrationResult && registrationResult.success) {
      console.log("✅ User registration successful");
      const userId = registrationResult.user.id;
      
      // 3. Login with the test user
      console.log("\n3. Logging in test user...");
      const loginResult = await userAccount.login(email, password);
      if (loginResult && loginResult.success) {
        console.log("✅ User login successful");
        
        // 4. Purchase a subscription
        console.log("\n4. Purchasing a subscription...");
        const products = iapImplementation.getProducts();
        if (products && products.length > 0) {
          const basicProduct = products.find(p => p.name === "Basic") || products[0];
          console.log(`Purchasing product: ${basicProduct.name}`);
          
          const purchaseResult = await iapImplementation.purchaseSubscription(basicProduct.id);
          if (purchaseResult && purchaseResult.success) {
            console.log("✅ Subscription purchase successful");
            
            // 5. Validate the receipt
            console.log("\n5. Validating purchase receipt...");
            const isValid = await receiptValidator.validateReceipt(purchaseResult.receipt, purchaseResult.platform);
            if (isValid) {
              console.log("✅ Receipt validation successful");
              
              // 6. Activate the subscription
              console.log("\n6. Activating subscription...");
              const activationResult = await subscriptionManager.activateSubscription(
                userId, 
                basicProduct.id, 
                purchaseResult.receipt
              );
              
              if (activationResult && activationResult.success) {
                console.log("✅ Subscription activation successful");
                
                // 7. Verify user can access premium features
                console.log("\n7. Verifying premium features access...");
                const canAccess = subscriptionManager.canAccessFeature("mealPlanExport");
                console.log(`Can access premium features: ${canAccess ? "Yes" : "No"}`);
                
                // 8. Cancel subscription as cleanup
                console.log("\n8. Canceling subscription (cleanup)...");
                const cancelResult = await subscriptionManager.cancelSubscription(userId);
                if (cancelResult && cancelResult.success) {
                  console.log("✅ Subscription cancellation successful");
                } else {
                  console.log("❌ Subscription cancellation failed");
                }
              } else {
                console.log("❌ Subscription activation failed");
              }
            } else {
              console.log("❌ Receipt validation failed");
            }
          } else {
            console.log("❌ Subscription purchase failed");
          }
        } else {
          console.log("❌ No products available");
        }
      } else {
        console.log("❌ User login failed");
      }
    } else {
      console.log("❌ User registration failed");
    }
  } catch (error) {
    console.error("Integration test failed with error:", error);
  }
  
  console.log("\n=== Integration Test Complete ===");
}

// Run the tests
if (isBrowser) {
  // In browser, expose as global function
  window.runIntegrationTests = testCompleteUserFlow;
  console.log("Integration tests ready. Call window.runIntegrationTests() to execute.");
} else if (isNode) {
  // In Node.js, run immediately
  testCompleteUserFlow().then(() => {
    console.log("Integration tests completed.");
  });
  
  // Export for potential programmatic use
  module.exports = {
    runTests: testCompleteUserFlow
  };
}
