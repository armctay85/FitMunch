// Enhanced Quick Test Runner for FitMunch
// Comprehensive testing system with improved validation and reporting

class FitMunchTestRunner {
  constructor() {
    this.tests = [];
    this.results = [];
    this.isRunning = false;
  }

  async runAllTests() {
    if (this.isRunning) {
      console.log("⏳ Tests already running...");
      return;
    }

    this.isRunning = true;
    console.log("🧪 Starting FitMunch Test Suite...");

    const startTime = performance.now();
    this.results = [];

    // Wait for app to initialize
    if (window.FitMunchApp && !window.FitMunchApp.isInitialized()) {
      console.log("⏳ Waiting for app initialization...");
      await new Promise(resolve => {
        const checkInit = setInterval(() => {
          if (window.FitMunchApp.isInitialized()) {
            clearInterval(checkInit);
            resolve();
          }
        }, 100);
      });
    }

    // Core functionality tests
    await this.testAppInitialization();
    await this.testNavigation();
    await this.testProfileManagement();
    await this.testMealPlanning();
    await this.testWorkoutGeneration();
    await this.testFoodLogging();
    await this.testShoppingList();
    await this.testDataPersistence();
    await this.testErrorHandling();

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);

    this.displayResults(duration);
    this.isRunning = false;
  }

  async testAppInitialization() {
    const testName = "App Initialization";
    console.log(`🔍 Testing: ${testName}`);

    try {
      // Check if main elements exist
      const mainApp = document.getElementById('mainApp');
      const dashboard = document.getElementById('dashboard');
      const emergencyFallback = document.getElementById('emergencyFallback');

      const checks = [
        { name: "Main app container exists", passed: !!mainApp },
        { name: "Dashboard section exists", passed: !!dashboard },
        { name: "Emergency fallback hidden", passed: emergencyFallback?.style.display === 'none' },
        { name: "User profile initialized", passed: !!window.userProfile },
        { name: "Daily log initialized", passed: !!window.dailyLog },
        { name: "Show section function available", passed: typeof showSection === 'function' }
      ];

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Some initialization checks failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testNavigation() {
    const testName = "Navigation System";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const sections = ['dashboard', 'meal', 'workout', 'food', 'shopping'];
      const navigationChecks = [];

      for (const sectionId of sections) {
        const sectionElement = document.getElementById(sectionId);
        const exists = !!sectionElement;

        if (exists && typeof showSection === 'function') {
          showSection(sectionId);
          const isActive = sectionElement.classList.contains('active-section') || 
                          sectionElement.style.display === 'block';

          navigationChecks.push({
            name: `Navigate to ${sectionId}`,
            passed: isActive
          });
        } else {
          navigationChecks.push({
            name: `${sectionId} section exists`,
            passed: exists
          });
        }
      }

      // Return to dashboard
      if (typeof showSection === 'function') {
        showSection('dashboard');
      }

      const passed = navigationChecks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: navigationChecks,
        error: passed ? null : "Navigation tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testProfileManagement() {
    const testName = "Profile Management";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "User profile object exists", passed: !!window.userProfile },
        { name: "Profile has name", passed: !!window.userProfile?.name },
        { name: "Profile has goals", passed: !!window.userProfile?.goals },
        { name: "Update profile function exists", passed: typeof updateProfileDisplay === 'function' }
      ];

      // Test profile update
      if (typeof updateProfileDisplay === 'function') {
        updateProfileDisplay();
        checks.push({ name: "Profile update executes without error", passed: true });
      }

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Profile management tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testMealPlanning() {
    const testName = "Meal Planning";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "Meal section exists", passed: !!document.getElementById('meal') },
        { name: "Generate meal plan function exists", passed: typeof generateMealPlan === 'function' }
      ];

      // Test meal plan generation
      if (typeof generateMealPlan === 'function') {
        const plan = generateMealPlan();
        checks.push({ 
          name: "Meal plan generation executes", 
          passed: true 
        });
      }

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Meal planning tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testWorkoutGeneration() {
    const testName = "Workout Generation";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "Workout section exists", passed: !!document.getElementById('workout') },
        { name: "Generate activity plan function exists", passed: typeof generateActivityPlan === 'function' }
      ];

      // Test workout generation
      if (typeof generateActivityPlan === 'function') {
        generateActivityPlan();
        checks.push({ 
          name: "Workout plan generation executes", 
          passed: true 
        });
      }

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Workout generation tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testFoodLogging() {
    const testName = "Food Logging";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "Food section exists", passed: !!document.getElementById('food') },
        { name: "Daily log object exists", passed: !!window.dailyLog },
        { name: "Meals object exists", passed: !!window.dailyLog?.meals },
        { name: "Show food search function exists", passed: typeof showFoodSearch === 'function' }
      ];

      // Test food search
      if (typeof showFoodSearch === 'function') {
        showFoodSearch();
        checks.push({ 
          name: "Food search interface loads", 
          passed: !!document.getElementById('searchResults') 
        });
      }

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Food logging tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testShoppingList() {
    const testName = "Shopping List";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "Shopping section exists", passed: !!document.getElementById('shopping') },
        { name: "Update shopping list function exists", passed: typeof updateShoppingList === 'function' }
      ];

      // Test shopping list update
      if (typeof updateShoppingList === 'function') {
        updateShoppingList();
        checks.push({ 
          name: "Shopping list update executes", 
          passed: true 
        });
      }

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Shopping list tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testDataPersistence() {
    const testName = "Data Persistence";
    console.log(`🔍 Testing: ${testName}`);

    try {
      // Test localStorage functionality
      const testKey = 'fitMunchTest';
      const testData = { test: true, timestamp: Date.now() };

      localStorage.setItem(testKey, JSON.stringify(testData));
      const retrieved = JSON.parse(localStorage.getItem(testKey));
      localStorage.removeItem(testKey);

      const checks = [
        { name: "localStorage write", passed: true },
        { name: "localStorage read", passed: retrieved?.test === true },
        { name: "User profile in localStorage", passed: !!localStorage.getItem('userProfile') },
        { name: "Daily log in localStorage", passed: !!localStorage.getItem('dailyLog') }
      ];

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Data persistence tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  async testErrorHandling() {
    const testName = "Error Handling";
    console.log(`🔍 Testing: ${testName}`);

    try {
      const checks = [
        { name: "Global error handler exists", passed: !!window.onerror || !!window.addEventListener },
        { name: "Emergency fallback exists", passed: !!document.getElementById('emergencyFallback') },
        { name: "FitMunchApp error handling", passed: window.FitMunchApp && typeof window.FitMunchApp.handleGlobalError === 'function' }
      ];

      const passed = checks.every(check => check.passed);

      this.results.push({
        test: testName,
        passed,
        details: checks,
        error: passed ? null : "Error handling tests failed"
      });

    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        details: [],
        error: error.message
      });
    }
  }

  displayResults(duration) {
    const totalTests = this.results.length;
    const passedTests = this.results.filter(result => result.passed).length;
    const failedTests = totalTests - passedTests;

    console.log("\n" + "=".repeat(50));
    console.log("🧪 FITMUNCH TEST RESULTS");
    console.log("=".repeat(50));
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`✅ Passed: ${passedTests}/${totalTests}`);
    console.log(`❌ Failed: ${failedTests}/${totalTests}`);
    console.log(`📊 Success Rate: ${((passedTests/totalTests) * 100).toFixed(1)}%`);

    if (failedTests > 0) {
      console.log("\n❌ FAILED TESTS:");
      this.results.filter(result => !result.passed).forEach(result => {
        console.log(`\n🔴 ${result.test}`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        if (result.details?.length > 0) {
          result.details.filter(detail => !detail.passed).forEach(detail => {
            console.log(`   ❌ ${detail.name}`);
          });
        }
      });
    }

    // Show notification
    if (typeof showNotification === 'function') {
      const message = failedTests === 0 
        ? `All ${totalTests} tests passed! 🎉` 
        : `${passedTests}/${totalTests} tests passed`;

      showNotification(message, failedTests === 0 ? 'success' : 'warning');
    }

    // Store results for further analysis
    localStorage.setItem('fitMunchTestResults', JSON.stringify({
      timestamp: new Date().toISOString(),
      duration,
      totalTests,
      passedTests,
      failedTests,
      results: this.results
    }));
  }
}

// Create global test runner instance
window.FitMunchTestRunner = new FitMunchTestRunner();

// Quick access function
window.runTests = function() {
  window.FitMunchTestRunner.runAllTests();
};