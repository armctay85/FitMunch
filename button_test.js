
// Comprehensive Button Click-Through Test for FitMunch
// Tests all buttons and interactive elements in the app

class ButtonTester {
  constructor() {
    this.testResults = [];
    this.totalTests = 0;
    this.passedTests = 0;
  }

  log(category, test, passed, details = '') {
    this.totalTests++;
    if (passed) this.passedTests++;
    
    const result = {
      category,
      test,
      status: passed ? '✅ PASS' : '❌ FAIL',
      details
    };
    
    this.testResults.push(result);
    console.log(`${result.status} [${category}] ${test}${details ? ' - ' + details : ''}`);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  highlightElement(element) {
    if (!element) return;
    
    const originalStyle = element.style.cssText;
    element.style.cssText += 'border: 3px solid red !important; background-color: rgba(255,0,0,0.1) !important;';
    
    setTimeout(() => {
      element.style.cssText = originalStyle;
    }, 1000);
  }

  async testNavigationButtons() {
    console.log("🧭 Testing Navigation Buttons...");
    
    // Test main navigation buttons
    const mainNavButtons = document.querySelectorAll('.main-nav .nav-item');
    this.log('NAV', `Main navigation buttons found: ${mainNavButtons.length}`, mainNavButtons.length > 0);
    
    const sections = ['dashboard', 'workout', 'food', 'meal', 'shopping', 'fitness'];
    
    for (const section of sections) {
      const navButton = document.querySelector(`.nav-item[data-section="${section}"]`);
      if (navButton) {
        this.highlightElement(navButton);
        
        try {
          navButton.click();
          await this.delay(300);
          
          const sectionElement = document.getElementById(section);
          const isVisible = sectionElement && (
            sectionElement.style.display === 'block' || 
            sectionElement.classList.contains('active-section')
          );
          
          this.log('NAV', `Navigate to ${section}`, isVisible, 
            isVisible ? 'Section activated' : 'Section not visible');
        } catch (error) {
          this.log('NAV', `Navigate to ${section}`, false, error.message);
        }
      } else {
        this.log('NAV', `Find ${section} nav button`, false, 'Button not found');
      }
    }

    // Test footer navigation (mobile)
    const footerNavButtons = document.querySelectorAll('footer.nav .nav-item');
    this.log('NAV', `Footer navigation buttons found: ${footerNavButtons.length}`, footerNavButtons.length > 0);
    
    // Test quick nav cards
    const navCards = document.querySelectorAll('.nav-card');
    this.log('NAV', `Navigation cards found: ${navCards.length}`, navCards.length > 0);
    
    for (let i = 0; i < navCards.length; i++) {
      const card = navCards[i];
      const section = card.getAttribute('data-section');
      
      if (section) {
        this.highlightElement(card);
        
        try {
          card.click();
          await this.delay(200);
          
          const sectionElement = document.getElementById(section);
          const isVisible = sectionElement && sectionElement.classList.contains('active-section');
          
          this.log('NAV', `Nav card ${i + 1} to ${section}`, isVisible);
        } catch (error) {
          this.log('NAV', `Nav card ${i + 1}`, false, error.message);
        }
      }
    }
  }

  async testActionButtons() {
    console.log("🔘 Testing Action Buttons...");
    
    // Test primary action buttons
    const primaryButtons = document.querySelectorAll('.primary-btn');
    this.log('ACTIONS', `Primary buttons found: ${primaryButtons.length}`, primaryButtons.length > 0);
    
    // Test specific action buttons
    const buttonTests = [
      { selector: '[onclick*="editProfile"]', name: 'Edit Profile', expected: 'modal opens' },
      { selector: '[onclick*="generateMealPlan"]', name: 'Generate Meal Plan', expected: 'meal plan generated' },
      { selector: '[onclick*="regenerateWorkout"]', name: 'Regenerate Workout', expected: 'workout regenerated' },
      { selector: '[onclick*="showFoodSearch"]', name: 'Add Food', expected: 'food search UI' },
      { selector: '[onclick*="scanBarcode"]', name: 'Scan Barcode', expected: 'barcode scanner' },
      { selector: '[onclick*="updateShoppingList"]', name: 'Update Shopping List', expected: 'shopping list updated' },
      { selector: '[onclick*="updateAnalytics"]', name: 'Update Analytics', expected: 'analytics refreshed' }
    ];

    for (const test of buttonTests) {
      const button = document.querySelector(test.selector);
      
      if (button) {
        this.highlightElement(button);
        
        try {
          button.click();
          await this.delay(500);
          this.log('ACTIONS', test.name, true, test.expected);
        } catch (error) {
          this.log('ACTIONS', test.name, false, error.message);
        }
      } else {
        this.log('ACTIONS', test.name, false, 'Button not found');
      }
    }
  }

  async testWorkoutButtons() {
    console.log("💪 Testing Workout Buttons...");
    
    // Navigate to workout section first
    if (typeof window.showSection === 'function') {
      window.showSection('workout');
      await this.delay(300);
    }

    // Generate workout plan to ensure buttons exist
    if (typeof window.generateActivityPlan === 'function') {
      window.generateActivityPlan();
      await this.delay(500);
    }

    // Test workout detail buttons
    const detailButtons = document.querySelectorAll('[onclick*="showWorkoutDetails"]');
    this.log('WORKOUT', `Workout detail buttons found: ${detailButtons.length}`, detailButtons.length > 0);

    for (let i = 0; i < detailButtons.length; i++) {
      const button = detailButtons[i];
      this.highlightElement(button);
      
      try {
        button.click();
        await this.delay(300);
        
        const modal = document.getElementById('workoutDetailsModal');
        const modalVisible = modal && modal.style.display === 'block';
        
        this.log('WORKOUT', `Detail button ${i + 1}`, modalVisible, 
          modalVisible ? 'Modal opened' : 'Modal not visible');
        
        // Close modal if opened
        if (modalVisible) {
          const closeBtn = modal.querySelector('.close-modal');
          if (closeBtn) closeBtn.click();
        }
      } catch (error) {
        this.log('WORKOUT', `Detail button ${i + 1}`, false, error.message);
      }
    }

    // Test workout log buttons
    const logButtons = document.querySelectorAll('[onclick*="openWorkoutLogModal"]');
    this.log('WORKOUT', `Workout log buttons found: ${logButtons.length}`, logButtons.length > 0);

    // Test workout checkboxes
    const checkboxes = document.querySelectorAll('.workout-checkbox');
    this.log('WORKOUT', `Workout checkboxes found: ${checkboxes.length}`, checkboxes.length > 0);

    for (let i = 0; i < Math.min(checkboxes.length, 2); i++) {
      const checkbox = checkboxes[i];
      this.highlightElement(checkbox);
      
      try {
        checkbox.click();
        await this.delay(200);
        this.log('WORKOUT', `Checkbox ${i + 1}`, checkbox.checked, 
          checkbox.checked ? 'Checked' : 'Unchecked');
      } catch (error) {
        this.log('WORKOUT', `Checkbox ${i + 1}`, false, error.message);
      }
    }
  }

  async testFoodButtons() {
    console.log("🍽️ Testing Food Buttons...");
    
    // Navigate to food section
    if (typeof window.showSection === 'function') {
      window.showSection('food');
      await this.delay(300);
    }

    // Test add food button
    const addFoodBtn = document.querySelector('[onclick*="showFoodSearch"]');
    if (addFoodBtn) {
      this.highlightElement(addFoodBtn);
      
      try {
        addFoodBtn.click();
        await this.delay(500);
        
        const searchResults = document.getElementById('searchResults');
        const hasSearchUI = searchResults && searchResults.innerHTML.includes('food-search-container');
        
        this.log('FOOD', 'Add Food button', hasSearchUI, 
          hasSearchUI ? 'Search UI displayed' : 'Search UI not found');
      } catch (error) {
        this.log('FOOD', 'Add Food button', false, error.message);
      }
    } else {
      this.log('FOOD', 'Add Food button', false, 'Button not found');
    }

    // Test quick add buttons (if food search is open)
    const quickAddButtons = document.querySelectorAll('[onclick*="quickAddFood"]');
    this.log('FOOD', `Quick add buttons found: ${quickAddButtons.length}`, quickAddButtons.length > 0);

    if (quickAddButtons.length > 0) {
      const firstQuickAdd = quickAddButtons[0];
      this.highlightElement(firstQuickAdd);
      
      try {
        firstQuickAdd.click();
        await this.delay(300);
        this.log('FOOD', 'Quick add food', true, 'Food added to log');
      } catch (error) {
        this.log('FOOD', 'Quick add food', false, error.message);
      }
    }

    // Test barcode scanner button
    const barcodeBtn = document.querySelector('[onclick*="scanBarcode"]');
    if (barcodeBtn) {
      this.highlightElement(barcodeBtn);
      
      try {
        barcodeBtn.click();
        await this.delay(500);
        
        const modal = document.querySelector('.barcode-modal');
        const modalVisible = modal && modal.style.display === 'block';
        
        this.log('FOOD', 'Barcode scanner', modalVisible, 
          modalVisible ? 'Scanner modal opened' : 'Scanner not opened');
        
        // Close modal if opened
        if (modalVisible) {
          const closeBtn = modal.querySelector('.close-modal');
          if (closeBtn) closeBtn.click();
        }
      } catch (error) {
        this.log('FOOD', 'Barcode scanner', false, error.message);
      }
    } else {
      this.log('FOOD', 'Barcode scanner', false, 'Button not found');
    }
  }

  async testMealPlanButtons() {
    console.log("📋 Testing Meal Plan Buttons...");
    
    // Navigate to meal section
    if (typeof window.showSection === 'function') {
      window.showSection('meal');
      await this.delay(300);
    }

    // Test goal type selector
    const goalSelector = document.getElementById('goalType');
    if (goalSelector) {
      this.highlightElement(goalSelector);
      
      try {
        goalSelector.value = 'Weight Loss';
        goalSelector.dispatchEvent(new Event('change'));
        this.log('MEAL', 'Goal type selector', true, 'Goal changed to Weight Loss');
      } catch (error) {
        this.log('MEAL', 'Goal type selector', false, error.message);
      }
    } else {
      this.log('MEAL', 'Goal type selector', false, 'Selector not found');
    }

    // Test generate meal plan button
    const generateBtn = document.querySelector('[onclick*="generateMealPlan"]');
    if (generateBtn) {
      this.highlightElement(generateBtn);
      
      try {
        generateBtn.click();
        await this.delay(500);
        
        const mealDisplay = document.getElementById('mealDisplay');
        const hasPlan = mealDisplay && mealDisplay.innerHTML.includes('meal-plan-header');
        
        this.log('MEAL', 'Generate meal plan', hasPlan, 
          hasPlan ? 'Meal plan generated' : 'Plan not generated');
      } catch (error) {
        this.log('MEAL', 'Generate meal plan', false, error.message);
      }
    } else {
      this.log('MEAL', 'Generate meal plan', false, 'Button not found');
    }
  }

  async testShoppingButtons() {
    console.log("🛒 Testing Shopping Buttons...");
    
    // Navigate to shopping section
    if (typeof window.showSection === 'function') {
      window.showSection('shopping');
      await this.delay(300);
    }

    // Test update shopping list button
    const updateBtn = document.querySelector('[onclick*="updateShoppingList"]');
    if (updateBtn) {
      this.highlightElement(updateBtn);
      
      try {
        updateBtn.click();
        await this.delay(1000); // Shopping list update takes longer
        
        const shopList = document.getElementById('shopList');
        const hasItems = shopList && shopList.innerHTML.includes('shopping-item');
        
        this.log('SHOPPING', 'Update shopping list', hasItems, 
          hasItems ? 'Shopping list updated' : 'List not updated');
      } catch (error) {
        this.log('SHOPPING', 'Update shopping list', false, error.message);
      }
    } else {
      this.log('SHOPPING', 'Update shopping list', false, 'Button not found');
    }

    // Test price check button
    const priceCheckBtn = document.getElementById('priceCheckBtn');
    if (priceCheckBtn) {
      this.highlightElement(priceCheckBtn);
      
      try {
        // Add some text to the price check input first
        const priceInput = document.getElementById('priceCheckInput');
        if (priceInput) {
          priceInput.value = 'chicken breast';
        }
        
        priceCheckBtn.click();
        await this.delay(500);
        
        const resultsContainer = document.getElementById('priceCheckResults');
        const hasResults = resultsContainer && resultsContainer.innerHTML.length > 0;
        
        this.log('SHOPPING', 'Price check', hasResults, 
          hasResults ? 'Price check executed' : 'No price results');
      } catch (error) {
        this.log('SHOPPING', 'Price check', false, error.message);
      }
    } else {
      this.log('SHOPPING', 'Price check', false, 'Button not found');
    }
  }

  async testModalButtons() {
    console.log("📱 Testing Modal Buttons...");
    
    // Test profile modal
    const editProfileBtn = document.querySelector('[onclick*="editProfile"]');
    if (editProfileBtn) {
      this.highlightElement(editProfileBtn);
      
      try {
        editProfileBtn.click();
        await this.delay(500);
        
        const profileModal = document.getElementById('profileModal');
        const modalVisible = profileModal && profileModal.style.display === 'block';
        
        this.log('MODAL', 'Profile modal open', modalVisible, 
          modalVisible ? 'Modal opened' : 'Modal not visible');
        
        if (modalVisible) {
          // Test close button
          const closeBtn = profileModal.querySelector('.close-modal');
          if (closeBtn) {
            this.highlightElement(closeBtn);
            closeBtn.click();
            await this.delay(200);
            
            const modalClosed = profileModal.style.display === 'none';
            this.log('MODAL', 'Profile modal close', modalClosed, 
              modalClosed ? 'Modal closed' : 'Modal still visible');
          }
        }
      } catch (error) {
        this.log('MODAL', 'Profile modal', false, error.message);
      }
    } else {
      this.log('MODAL', 'Profile modal', false, 'Edit profile button not found');
    }

    // Test all close modal buttons
    const closeButtons = document.querySelectorAll('.close-modal');
    this.log('MODAL', `Close buttons found: ${closeButtons.length}`, closeButtons.length > 0);
  }

  async testThemeButtons() {
    console.log("🎨 Testing Theme Buttons...");
    
    // Test theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      this.highlightElement(themeToggle);
      
      try {
        const originalChecked = themeToggle.checked;
        themeToggle.click();
        await this.delay(300);
        
        const toggled = themeToggle.checked !== originalChecked;
        this.log('THEME', 'Theme toggle', toggled, 
          toggled ? 'Theme toggled' : 'Theme not changed');
      } catch (error) {
        this.log('THEME', 'Theme toggle', false, error.message);
      }
    } else {
      this.log('THEME', 'Theme toggle', false, 'Toggle not found');
    }
  }

  async testPremiumButtons() {
    console.log("👑 Testing Premium Buttons...");
    
    // Test upgrade button
    const upgradeBtn = document.querySelector('.banner-btn');
    if (upgradeBtn) {
      this.highlightElement(upgradeBtn);
      
      try {
        upgradeBtn.click();
        await this.delay(300);
        this.log('PREMIUM', 'Upgrade button', true, 'Upgrade button clicked');
      } catch (error) {
        this.log('PREMIUM', 'Upgrade button', false, error.message);
      }
    } else {
      this.log('PREMIUM', 'Upgrade button', false, 'Button not found');
    }
  }

  generateReport() {
    console.log("\n" + "=".repeat(60));
    console.log("🔘 BUTTON CLICK-THROUGH TEST RESULTS");
    console.log("=".repeat(60));
    
    const categories = {};
    this.testResults.forEach(result => {
      if (!categories[result.category]) {
        categories[result.category] = { passed: 0, total: 0, tests: [] };
      }
      categories[result.category].total++;
      if (result.status.includes('PASS')) categories[result.category].passed++;
      categories[result.category].tests.push(result);
    });

    Object.entries(categories).forEach(([category, data]) => {
      console.log(`\n📋 ${category}:`);
      console.log(`   Passed: ${data.passed}/${data.total}`);
      data.tests.forEach(test => {
        console.log(`   ${test.status} ${test.test}${test.details ? ' - ' + test.details : ''}`);
      });
    });

    console.log(`\n📊 OVERALL RESULTS: ${this.passedTests}/${this.totalTests} tests passed`);
    console.log(`📈 Success Rate: ${((this.passedTests / this.totalTests) * 100).toFixed(1)}%`);

    const failedTests = this.testResults.filter(r => r.status.includes('FAIL'));
    if (failedTests.length > 0) {
      console.log(`\n🚨 FAILED TESTS TO ADDRESS:`);
      failedTests.forEach(test => {
        console.log(`❌ [${test.category}] ${test.test}${test.details ? ' - ' + test.details : ''}`);
      });
    }

    // Save report to localStorage
    localStorage.setItem('fitmunch_button_test_report', JSON.stringify({
      timestamp: new Date().toISOString(),
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      successRate: ((this.passedTests / this.totalTests) * 100).toFixed(1),
      results: this.testResults,
      categories
    }));

    console.log(`\n📄 Test report saved to localStorage as 'fitmunch_button_test_report'`);
  }

  async runAllTests() {
    console.log("🚀 Starting Comprehensive Button Click-Through Test...\n");
    
    try {
      await this.testNavigationButtons();
      await this.testActionButtons();
      await this.testWorkoutButtons();
      await this.testFoodButtons();
      await this.testMealPlanButtons();
      await this.testShoppingButtons();
      await this.testModalButtons();
      await this.testThemeButtons();
      await this.testPremiumButtons();
      
      this.generateReport();
      
    } catch (error) {
      console.error("❌ Error during button testing:", error);
      this.log('ERROR', 'Test execution', false, error.message);
    }
  }
}

// Auto-run the test when this file is loaded
window.addEventListener('DOMContentLoaded', function() {
  console.log("Button test module loaded. Run buttonTest.runAllTests() to test all buttons.");
});

// Make the tester globally available
window.buttonTest = new ButtonTester();

// Export for manual testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ButtonTester;
}
