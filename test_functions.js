
// Test Functions for FitMunch App

// Function to test all core functionality
function testAllFunctions() {
  console.log("Starting function tests...");
  
  // Initialize required components
  console.log("Initializing Grok Assistant...");
  if (typeof window.grokAssistant === 'undefined') {
    window.grokAssistant = {
      initialize: () => { 
        console.log("Grok Assistant initialized successfully");
        return true;
      }
    };
  }
  
  window.grokAssistant.initialize();
  
  console.log("Running all function tests...");
  
  // Test navigation functions
  console.log("Testing navigation functions...");
  const navResult = testNavigation();
  
  // Test meal planning functions
  console.log("Testing meal planning functions...");
  const mealResult = testMealPlanning();
  
  // Test shopping list functions
  console.log("Testing shopping list functions...");
  const shopResult = testShoppingList();
  
  // Test workout functions
  console.log("Testing workout functions...");
  const workoutResult = testWorkoutFunctions();
  
  // Test supermarket API
  console.log("Testing supermarket API functions...");
  const apiResult = testSupermarketAPI();
  
  // Test Grok agent
  console.log("Testing Grok agent functions...");
  const grokResult = testGrokAgent();
  
  // Collect and display results
  const results = {
    showSection: typeof window.showSection === 'function',
    updateProfileDisplay: typeof window.updateProfileDisplay === 'function',
    generateMealPlan: typeof window.generateMealPlan === 'function',
    calculateMacros: typeof window.calculateMacros === 'function',
    updateShoppingList: typeof window.updateShoppingList === 'function',
    generateActivityPlan: typeof window.generateActivityPlan === 'function',
    getProductPrice: typeof window.supermarketAPI?.getProductPrice === 'function',
    grokAgentInit: window.grokAgent && window.grokAgent.isInitialized && window.grokAgent.isInitialized()
  };
  
  console.log("Test results:");
  Object.entries(results).forEach(([test, passed]) => {
    if (passed) {
      console.log(`✅ ${test}: PASSED`);
    } else {
      console.log(`❌ ${test}: FAILED - ${getFailureReason(test)}`);
    }
  });
  
  const passCount = Object.values(results).filter(result => result === true).length;
  const failCount = Object.values(results).length - passCount;
  
  console.log(`Tests completed: ${passCount} passed, ${failCount} failed`);
  
  return results;
}

// Helper function to get failure reason
function getFailureReason(test) {
  switch(test) {
    case 'showSection':
    case 'updateProfileDisplay':
    case 'generateMealPlan':
    case 'calculateMacros':
    case 'updateShoppingList':
    case 'generateActivityPlan':
      return "Function not found";
    case 'getProductPrice':
      return "Function not found";
    case 'grokAgentInit':
      return "Not initialized";
    default:
      return "Unknown error";
  }
}

// Test navigation functionality
function testNavigation() {
  try {
    if (typeof window.showSection !== 'function') {
      console.log("❌ showSection function not found");
      return false;
    }
    
    // Try to navigate to dashboard
    window.showSection('dashboard');
    
    return true;
  } catch (error) {
    console.error("Navigation test failed:", error);
    return false;
  }
}

// Test meal planning functionality
function testMealPlanning() {
  try {
    if (typeof window.generateMealPlan !== 'function') {
      console.log("❌ generateMealPlan function not found");
      return false;
    }
    
    if (typeof window.calculateMacros !== 'function') {
      console.log("❌ calculateMacros function not found");
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Meal planning test failed:", error);
    return false;
  }
}

// Test shopping list functionality
function testShoppingList() {
  try {
    if (typeof window.updateShoppingList !== 'function') {
      console.log("❌ updateShoppingList function not found");
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Shopping list test failed:", error);
    return false;
  }
}

// Test workout functionality
function testWorkoutFunctions() {
  try {
    if (typeof window.generateActivityPlan !== 'function') {
      console.log("❌ generateActivityPlan function not found");
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Workout function test failed:", error);
    return false;
  }
}

// Test supermarket API
function testSupermarketAPI() {
  try {
    if (typeof window.supermarketAPI?.getProductPrice !== 'function') {
      console.log("❌ getProductPrice function not found");
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Supermarket API test failed:", error);
    return false;
  }
}

// Test Grok agent
function testGrokAgent() {
  try {
    if (!window.grokAgent || !window.grokAgent.isInitialized) {
      console.log("❌ Grok agent not initialized");
      return false;
    }
    
    if (window.grokAgent.isInitialized()) {
      console.log("✅ Grok agent initialized");
      return true;
    } else {
      console.log("❌ Grok agent not initialized");
      return false;
    }
  } catch (error) {
    console.error("Grok agent test failed:", error);
    return false;
  }
}

// Make test function available in global scope
if (typeof window !== 'undefined') {
  window.testAllFunctions = testAllFunctions;
}

// Export for module usage
try {
  if (typeof module !== 'undefined') {
    module.exports = {
      testAllFunctions
    };
  }
} catch (e) {
  console.log("Non-module environment");
}

// Run tests automatically when included
document.addEventListener('DOMContentLoaded', function() {
  // Give time for other modules to initialize
  setTimeout(function() {
    testAllFunctions();
  }, 1000);
});
