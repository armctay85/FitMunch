
// Comprehensive Feature Test Suite for FitMunch
// Tests all buttons, navigation, and core functionality with dummy user

class FitMunchFeatureTester {
  constructor() {
    this.testResults = [];
    this.dummyUser = {
      id: 'test_user_' + Date.now(),
      name: 'John TestUser',
      email: 'test@fitmunch.app',
      height: '180',
      weight: '75',
      goals: {
        calories: 2000,
        steps: 8000,
        activityPlan: {
          type: 'gym',
          frequency: 3,
          level: 'Intermediate',
          duration: 1.5,
          preferredTime: 'Morning (6-9)'
        },
        description: 'Build muscle and improve overall fitness'
      }
    };
  }

  async initialize() {
    console.log("🚀 FitMunch Feature Tester Initializing...");
    
    // Set up dummy user
    this.setupDummyUser();
    
    // Wait for page to load
    await this.waitForPageLoad();
    
    console.log("✅ Feature tester initialized with dummy user:", this.dummyUser.name);
  }

  setupDummyUser() {
    // Store dummy user data
    localStorage.setItem('userProfile', JSON.stringify(this.dummyUser));
    localStorage.setItem('fitmunch_user_id', this.dummyUser.id);
    localStorage.setItem('dailyLog', JSON.stringify({
      meals: {
        breakfast: [
          { name: 'Oatmeal with berries', calories: 350, protein: 12, carbs: 45, fat: 8 },
          { name: 'Greek yogurt', calories: 150, protein: 15, carbs: 8, fat: 5 }
        ],
        lunch: [
          { name: 'Chicken salad', calories: 400, protein: 35, carbs: 15, fat: 18 }
        ],
        dinner: [],
        snacks: []
      },
      totalCalories: 900,
      totalSteps: 5500
    }));

    // Set up workout history
    localStorage.setItem('workoutHistory', JSON.stringify({
      'Monday': { completed: true, workout: 'Upper Body Strength', date: new Date().toLocaleDateString() },
      'Wednesday': { completed: false, workout: 'Cardio Training' }
    }));

    // Set global user profile
    if (typeof window !== 'undefined') {
      window.userProfile = this.dummyUser;
    }

    console.log("👤 Dummy user set up:", this.dummyUser.name);
  }

  async waitForPageLoad() {
    return new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve);
      }
    });
  }

  async runAllTests() {
    console.log("🧪 Starting comprehensive feature tests...");
    
    const tests = [
      () => this.testNavigation(),
      () => this.testDashboard(),
      () => this.testWorkoutSection(),
      () => this.testFoodLogging(),
      () => this.testMealPlanning(),
      () => this.testShoppingList(),
      () => this.testProfileEditing(),
      () => this.testButtonFunctionality(),
      () => this.testModalInteractions(),
      () => this.testDataPersistence(),
      () => this.testResponsiveDesign(),
      () => this.testErrorHandling()
    ];

    for (const test of tests) {
      try {
        await test();
        await this.delay(500); // Small delay between tests
      } catch (error) {
        console.error("Test failed:", error);
        this.logResult('ERROR', `Test failed: ${error.message}`, false);
      }
    }

    this.displayResults();
  }

  async testNavigation() {
    console.log("🧭 Testing Navigation...");
    
    const sections = ['dashboard', 'workout', 'food', 'meal', 'shopping', 'fitness'];
    
    for (const section of sections) {
      try {
        // Test navigation function
        if (typeof window.showSection === 'function') {
          window.showSection(section);
          await this.delay(300);
          
          const sectionElement = document.getElementById(section);
          const isVisible = sectionElement && (
            sectionElement.style.display === 'block' || 
            sectionElement.classList.contains('active-section')
          );
          
          this.logResult('NAVIGATION', `Navigate to ${section}`, isVisible);
        } else {
          this.logResult('NAVIGATION', 'showSection function', false);
        }
      } catch (error) {
        this.logResult('NAVIGATION', `Navigate to ${section}`, false);
      }
    }

    // Test nav buttons
    const navButtons = document.querySelectorAll('.nav-item, .nav-card');
    this.logResult('NAVIGATION', `Nav buttons found: ${navButtons.length}`, navButtons.length > 0);
  }

  async testDashboard() {
    console.log("📊 Testing Dashboard...");
    
    // Navigate to dashboard
    if (typeof window.showSection === 'function') {
      window.showSection('dashboard');
      await this.delay(300);
    }

    // Test profile display update
    if (typeof window.updateProfileDisplay === 'function') {
      window.updateProfileDisplay();
      this.logResult('DASHBOARD', 'Update profile display', true);
    } else {
      this.logResult('DASHBOARD', 'Update profile display function', false);
    }

    // Check if user name is displayed
    const userNameEl = document.getElementById('userName');
    const userNameDisplayed = userNameEl && userNameEl.textContent.includes(this.dummyUser.name);
    this.logResult('DASHBOARD', 'User name displayed', userNameDisplayed);

    // Check stats display
    const calorieDisplay = document.getElementById('calorieDisplay');
    const stepsDisplay = document.getElementById('stepsDisplay');
    const macroDisplay = document.getElementById('macroDisplay');
    
    this.logResult('DASHBOARD', 'Calorie display', !!calorieDisplay);
    this.logResult('DASHBOARD', 'Steps display', !!stepsDisplay);
    this.logResult('DASHBOARD', 'Macro display', !!macroDisplay);

    // Test wellness score
    const scoreElement = document.querySelector('.score');
    this.logResult('DASHBOARD', 'Wellness score display', !!scoreElement);
  }

  async testWorkoutSection() {
    console.log("💪 Testing Workout Section...");
    
    if (typeof window.showSection === 'function') {
      window.showSection('workout');
      await this.delay(500);
    }

    // Test workout plan generation
    if (typeof window.generateActivityPlan === 'function') {
      window.generateActivityPlan();
      await this.delay(500);
      
      const workoutDisplay = document.getElementById('workoutPlanDisplay');
      const hasContent = workoutDisplay && workoutDisplay.innerHTML.trim() !== '';
      this.logResult('WORKOUT', 'Generate workout plan', hasContent);
    } else {
      this.logResult('WORKOUT', 'Generate workout plan function', false);
    }

    // Test workout completion checkboxes
    const workoutCheckboxes = document.querySelectorAll('.workout-completed-checkbox');
    this.logResult('WORKOUT', `Workout checkboxes: ${workoutCheckboxes.length}`, workoutCheckboxes.length > 0);

    // Test regenerate button
    const regenerateBtn = document.querySelector('[onclick*="regenerateWorkoutPlan"]');
    this.logResult('WORKOUT', 'Regenerate workout button', !!regenerateBtn);

    // Test workout details modal
    const detailsButtons = document.querySelectorAll('.workout-details-btn');
    this.logResult('WORKOUT', `Workout details buttons: ${detailsButtons.length}`, detailsButtons.length > 0);
  }

  async testFoodLogging() {
    console.log("🍽️ Testing Food Logging...");
    
    if (typeof window.showSection === 'function') {
      window.showSection('food');
      await this.delay(500);
    }

    // Test food search
    if (typeof window.showFoodSearch === 'function') {
      window.showFoodSearch();
      const searchContainer = document.getElementById('searchResults');
      const hasSearchUI = searchContainer && searchContainer.innerHTML.includes('search');
      this.logResult('FOOD', 'Food search UI', hasSearchUI);
    } else {
      this.logResult('FOOD', 'Food search function', false);
    }

    // Test food log display
    if (typeof window.updateFoodLogDisplay === 'function') {
      window.updateFoodLogDisplay();
      this.logResult('FOOD', 'Update food log display', true);
    } else {
      this.logResult('FOOD', 'Update food log display function', false);
    }

    // Check meal logs
    const breakfastLog = document.getElementById('breakfastLog');
    const lunchLog = document.getElementById('lunchLog');
    const dinnerLog = document.getElementById('dinnerLog');
    const snacksLog = document.getElementById('snacksLog');
    
    this.logResult('FOOD', 'Breakfast log element', !!breakfastLog);
    this.logResult('FOOD', 'Lunch log element', !!lunchLog);
    this.logResult('FOOD', 'Dinner log element', !!dinnerLog);
    this.logResult('FOOD', 'Snacks log element', !!snacksLog);

    // Test macro chart
    const macroChart = document.getElementById('macroChart');
    this.logResult('FOOD', 'Macro chart element', !!macroChart);
  }

  async testMealPlanning() {
    console.log("📅 Testing Meal Planning...");
    
    if (typeof window.showSection === 'function') {
      window.showSection('meal');
      await this.delay(500);
    }

    // Test meal plan generation
    if (typeof window.generateMealPlan === 'function') {
      window.generateMealPlan();
      await this.delay(500);
      
      const mealDisplay = document.getElementById('mealDisplay');
      const hasMealPlan = mealDisplay && mealDisplay.innerHTML.includes('meal-plan');
      this.logResult('MEAL', 'Generate meal plan', hasMealPlan);
    } else {
      this.logResult('MEAL', 'Generate meal plan function', false);
    }

    // Test goal type selector
    const goalSelect = document.getElementById('goalType');
    this.logResult('MEAL', 'Goal type selector', !!goalSelect);

    // Test nutritional breakdown
    const caloriesEl = document.getElementById('mealCalories');
    const proteinEl = document.getElementById('mealProtein');
    const carbsEl = document.getElementById('mealCarbs');
    const fatEl = document.getElementById('mealFat');
    
    this.logResult('MEAL', 'Nutritional breakdown elements', 
      !!(caloriesEl && proteinEl && carbsEl && fatEl));
  }

  async testShoppingList() {
    console.log("🛒 Testing Shopping List...");
    
    if (typeof window.showSection === 'function') {
      window.showSection('shopping');
      await this.delay(500);
    }

    // Test shopping list update
    if (typeof window.updateShoppingList === 'function') {
      window.updateShoppingList();
      await this.delay(500);
      
      const shopList = document.getElementById('shopList');
      const hasItems = shopList && shopList.innerHTML.trim() !== '' && 
                     !shopList.innerHTML.includes('Loading');
      this.logResult('SHOPPING', 'Update shopping list', hasItems);
    } else {
      this.logResult('SHOPPING', 'Update shopping list function', false);
    }

    // Test cost displays
    const totalCost = document.getElementById('totalCost');
    const totalItems = document.getElementById('totalItems');
    
    this.logResult('SHOPPING', 'Total cost display', !!totalCost);
    this.logResult('SHOPPING', 'Total items display', !!totalItems);

    // Test price comparison
    const priceCheckBtn = document.getElementById('priceCheckBtn');
    this.logResult('SHOPPING', 'Price check feature', !!priceCheckBtn);
  }

  async testProfileEditing() {
    console.log("👤 Testing Profile Editing...");
    
    // Test edit profile function
    if (typeof window.editProfile === 'function') {
      window.editProfile();
      await this.delay(300);
      
      const modal = document.getElementById('profileModal');
      const isModalOpen = modal && modal.style.display === 'block';
      this.logResult('PROFILE', 'Open profile modal', isModalOpen);
      
      if (isModalOpen) {
        // Test form fields
        const heightField = document.getElementById('userHeight');
        const weightField = document.getElementById('userWeight');
        const caloriesField = document.getElementById('calories');
        
        this.logResult('PROFILE', 'Profile form fields', 
          !!(heightField && weightField && caloriesField));
        
        // Close modal
        if (typeof window.closeModal === 'function') {
          window.closeModal();
        }
      }
    } else {
      this.logResult('PROFILE', 'Edit profile function', false);
    }
  }

  async testButtonFunctionality() {
    console.log("🔘 Testing Button Functionality...");
    
    // Test primary navigation buttons
    const navButtons = document.querySelectorAll('.nav-item');
    let workingNavButtons = 0;
    
    navButtons.forEach(button => {
      const hasClickListener = button.onclick || 
        button.getAttribute('data-section') ||
        button.addEventListener;
      if (hasClickListener) workingNavButtons++;
    });
    
    this.logResult('BUTTONS', `Navigation buttons (${workingNavButtons}/${navButtons.length})`, 
      workingNavButtons > 0);

    // Test action buttons
    const primaryButtons = document.querySelectorAll('.primary-btn, .secondary-btn');
    this.logResult('BUTTONS', `Action buttons found: ${primaryButtons.length}`, 
      primaryButtons.length > 0);

    // Test specific important buttons
    const editProfileBtn = document.querySelector('[onclick*="editProfile"]');
    const generateMealBtn = document.querySelector('[onclick*="generateMealPlan"]');
    const regenerateWorkoutBtn = document.querySelector('[onclick*="regenerateWorkoutPlan"]');
    
    this.logResult('BUTTONS', 'Edit profile button', !!editProfileBtn);
    this.logResult('BUTTONS', 'Generate meal plan button', !!generateMealBtn);
    this.logResult('BUTTONS', 'Regenerate workout button', !!regenerateWorkoutBtn);
  }

  async testModalInteractions() {
    console.log("🪟 Testing Modal Interactions...");
    
    // Test profile modal
    const profileModal = document.getElementById('profileModal');
    this.logResult('MODALS', 'Profile modal exists', !!profileModal);
    
    // Test workout details modal
    const workoutModal = document.getElementById('workoutDetailsModal');
    this.logResult('MODALS', 'Workout details modal exists', !!workoutModal);
    
    // Test workout log modal
    const workoutLogModal = document.getElementById('workoutLogModal');
    this.logResult('MODALS', 'Workout log modal exists', !!workoutLogModal);
    
    // Test close functionality
    const closeButtons = document.querySelectorAll('.close, .close-details-modal, .workout-log-close');
    this.logResult('MODALS', `Close buttons found: ${closeButtons.length}`, 
      closeButtons.length > 0);
  }

  async testDataPersistence() {
    console.log("💾 Testing Data Persistence...");
    
    // Test localStorage data
    const userProfile = localStorage.getItem('userProfile');
    const dailyLog = localStorage.getItem('dailyLog');
    const workoutHistory = localStorage.getItem('workoutHistory');
    
    this.logResult('DATA', 'User profile in storage', !!userProfile);
    this.logResult('DATA', 'Daily log in storage', !!dailyLog);
    this.logResult('DATA', 'Workout history in storage', !!workoutHistory);
    
    // Test data parsing
    try {
      const parsedProfile = JSON.parse(userProfile);
      this.logResult('DATA', 'User profile parseable', !!parsedProfile.name);
    } catch (error) {
      this.logResult('DATA', 'User profile parseable', false);
    }
  }

  async testResponsiveDesign() {
    console.log("📱 Testing Responsive Design...");
    
    // Test mobile optimization function
    if (typeof window.optimizeForMobile === 'function') {
      // Simulate mobile viewport
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
      
      window.optimizeForMobile();
      this.logResult('RESPONSIVE', 'Mobile optimization function', true);
      
      // Restore original width
      Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    } else {
      this.logResult('RESPONSIVE', 'Mobile optimization function', false);
    }
    
    // Check for mobile classes
    const hasMobileClass = document.body.classList.contains('mobile-device');
    this.logResult('RESPONSIVE', 'Mobile device class applied', hasMobileClass);
    
    // Check for responsive grid
    const statsGrid = document.querySelector('.stats-grid');
    this.logResult('RESPONSIVE', 'Responsive stats grid', !!statsGrid);
  }

  async testErrorHandling() {
    console.log("⚠️ Testing Error Handling...");
    
    // Test with invalid section
    try {
      if (typeof window.showSection === 'function') {
        window.showSection('nonexistent-section');
        this.logResult('ERROR', 'Invalid section handling', true);
      }
    } catch (error) {
      this.logResult('ERROR', 'Invalid section handling', false);
    }
    
    // Test with missing elements
    try {
      if (typeof window.updateProfileDisplay === 'function') {
        // Temporarily hide an element
        const userName = document.getElementById('userName');
        if (userName) {
          userName.style.display = 'none';
          window.updateProfileDisplay();
          userName.style.display = '';
          this.logResult('ERROR', 'Missing element handling', true);
        }
      }
    } catch (error) {
      this.logResult('ERROR', 'Missing element handling', false);
    }
  }

  logResult(category, test, passed) {
    const result = {
      category,
      test,
      passed,
      timestamp: new Date().toISOString()
    };
    
    this.testResults.push(result);
    
    const status = passed ? '✅' : '❌';
    console.log(`${status} [${category}] ${test}`);
  }

  displayResults() {
    console.log("\n" + "=".repeat(60));
    console.log("🏁 FITMUNCH FEATURE TEST RESULTS");
    console.log("=".repeat(60));
    
    const categories = [...new Set(this.testResults.map(r => r.category))];
    let totalTests = 0;
    let passedTests = 0;
    
    categories.forEach(category => {
      const categoryResults = this.testResults.filter(r => r.category === category);
      const categoryPassed = categoryResults.filter(r => r.passed).length;
      
      console.log(`\n📋 ${category}:`);
      console.log(`   Passed: ${categoryPassed}/${categoryResults.length}`);
      
      categoryResults.forEach(result => {
        const status = result.passed ? '✅' : '❌';
        console.log(`   ${status} ${result.test}`);
      });
      
      totalTests += categoryResults.length;
      passedTests += categoryPassed;
    });
    
    console.log("\n" + "=".repeat(60));
    console.log(`📊 OVERALL RESULTS: ${passedTests}/${totalTests} tests passed`);
    console.log(`📈 Success Rate: ${((passedTests/totalTests) * 100).toFixed(1)}%`);
    console.log("=".repeat(60));
    
    // Display critical issues
    const failedTests = this.testResults.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log("\n🚨 CRITICAL ISSUES TO ADDRESS:");
      failedTests.forEach(test => {
        console.log(`❌ [${test.category}] ${test.test}`);
      });
    }
    
    // Create summary report
    this.createSummaryReport();
  }

  createSummaryReport() {
    const report = {
      testRun: {
        timestamp: new Date().toISOString(),
        dummyUser: this.dummyUser,
        totalTests: this.testResults.length,
        passedTests: this.testResults.filter(r => r.passed).length,
        failedTests: this.testResults.filter(r => !r.passed).length
      },
      results: this.testResults,
      recommendations: this.generateRecommendations()
    };
    
    // Store in localStorage for reference
    localStorage.setItem('fitmunch_test_report', JSON.stringify(report));
    
    console.log("\n📄 Test report saved to localStorage as 'fitmunch_test_report'");
  }

  generateRecommendations() {
    const failedTests = this.testResults.filter(r => !r.passed);
    const recommendations = [];
    
    if (failedTests.some(t => t.category === 'NAVIGATION')) {
      recommendations.push("Fix navigation issues - ensure showSection function works properly");
    }
    
    if (failedTests.some(t => t.category === 'WORKOUT')) {
      recommendations.push("Workout functionality needs attention - check generateActivityPlan function");
    }
    
    if (failedTests.some(t => t.category === 'FOOD')) {
      recommendations.push("Food logging features need improvement");
    }
    
    if (failedTests.some(t => t.category === 'BUTTONS')) {
      recommendations.push("Button functionality issues detected - check event listeners");
    }
    
    return recommendations;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Auto-initialize when page loads
document.addEventListener('DOMContentLoaded', async function() {
  // Wait a moment for other scripts to load
  setTimeout(async () => {
    const tester = new FitMunchFeatureTester();
    await tester.initialize();
    await tester.runAllTests();
  }, 2000);
});

// Make available globally for manual testing
window.FitMunchFeatureTester = FitMunchFeatureTester;
window.runFeatureTests = async function() {
  const tester = new FitMunchFeatureTester();
  await tester.initialize();
  await tester.runAllTests();
};

console.log("🧪 FitMunch Feature Tester loaded. Run manually with: runFeatureTests()");
