
// FitMunch App Function Test Suite
// This file contains functions to test and diagnose app functionality

(function() {
  // Store test results
  const testResults = {
    core: {},
    navigation: {},
    buttons: {},
    pages: {}
  };
  
  // Current test phase
  let currentPhase = 0;
  
  // Define test phases
  const testPhases = [
    { name: 'Dashboard', section: 'dashboard', elements: ['.nav-card', '.profile-header'] },
    { name: 'Food Logging', section: 'food', elements: ['.food-log-entries', '.macro-summary'] },
    { name: 'Meal Planning', section: 'meal', elements: ['.meal-plan-controls', '.meal-nutritional-info'] },
    { name: 'Workout', section: 'workout', elements: ['.workout-controls', '.exercise-log-btn'] },
    { name: 'Shopping', section: 'shopping', elements: ['.shopping-list-controls', '#shopList'] }
  ];
  
  // Test core functions
  function testCoreFunctions() {
    console.log("Testing core functions...");
    
    const functions = {
      // Navigation
      showSection: typeof window.showSection === 'function',
      
      // Meal planning
      generateMealPlan: typeof window.generateMealPlan === 'function',
      calculateMacros: typeof window.calculateMacros === 'function',
      
      // Workout
      generateActivityPlan: typeof window.generateActivityPlan === 'function',
      
      // Food logging
      showFoodSearch: typeof window.showFoodSearch === 'function',
      
      // Profile
      editProfile: typeof window.editProfile === 'function',
      saveGoals: typeof window.saveGoals === 'function',
      
      // Shopping
      updateShoppingList: typeof window.updateShoppingList === 'function',
      
      // Utils
      themeToggle: typeof window.toggleTheme === 'function'
    };
    
    testResults.core = functions;
    console.log("Core function test results:", functions);
    return functions;
  }
  
  // Test page content
  function testPageContent() {
    console.log("Testing page content...");
    
    const pages = {
      dashboard: {
        element: document.querySelector('#dashboard'),
        components: {
          profile: document.querySelector('.profile-header') !== null,
          stats: document.querySelector('.stats-grid') !== null
        }
      },
      food: {
        element: document.querySelector('#food'),
        components: {
          macroSummary: document.querySelector('.macro-summary') !== null,
          foodLog: document.querySelector('.food-log-entries') !== null
        }
      },
      workout: {
        element: document.querySelector('#workout'),
        components: {
          controls: document.querySelector('.workout-controls') !== null,
          planDisplay: document.querySelector('#workoutPlanDisplay') !== null
        }
      },
      meal: {
        element: document.querySelector('#meal'),
        components: {
          controls: document.querySelector('.meal-plan-controls') !== null,
          nutritionalInfo: document.querySelector('.meal-nutritional-info') !== null
        }
      },
      shopping: {
        element: document.querySelector('#shopping'),
        components: {
          controls: document.querySelector('.shopping-list-controls') !== null,
          list: document.querySelector('#shopList') !== null
        }
      }
    };
    
    const results = {};
    Object.entries(pages).forEach(([page, data]) => {
      results[page] = {
        exists: data.element !== null,
        components: data.components
      };
    });
    
    testResults.pages = results;
    console.log("Page content test results:", results);
    return results;
  }
  
  // Test buttons
  function testButtons() {
    console.log("Testing buttons...");
    
    const buttons = {
      navigation: document.querySelectorAll('.nav-item').length > 0,
      themeToggle: document.getElementById('themeToggle') !== null,
      mealGenerate: document.querySelector('.meal-plan-controls .primary-btn') !== null,
      workoutGenerate: document.querySelector('.workout-controls .primary-btn') !== null,
      editProfile: document.querySelector('.edit-profile-btn') !== null,
      addFood: document.querySelector('.meal-section .primary-btn') !== null,
      footer: document.querySelectorAll('footer.nav a').length > 0
    };
    
    testResults.buttons = buttons;
    console.log("Button test results:", buttons);
    return buttons;
  }
  
  // Test navigation
  function testNavigation() {
    console.log("Testing navigation...");
    
    const navElements = {
      mainNav: document.querySelector('.main-nav') !== null,
      tabs: document.querySelector('.tabs') !== null,
      footerNav: document.querySelector('footer.nav') !== null
    };
    
    const navFunctions = {
      showSection: typeof window.showSection === 'function'
    };
    
    const results = {
      elements: navElements,
      functions: navFunctions
    };
    
    testResults.navigation = results;
    console.log("Navigation test results:", results);
    return results;
  }
  
  // Test specific section rendering
  function testSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) {
      console.error(`Section ${sectionId} not found`);
      return false;
    }
    
    console.log(`Testing ${sectionId} section...`);
    
    // Make sure the section is visible
    if (typeof window.showSection === 'function') {
      window.showSection(sectionId);
    } else {
      // Manually show section
      const allSections = document.querySelectorAll('.section, .active-section');
      allSections.forEach(s => {
        s.classList.remove('active-section');
        s.classList.add('section');
      });
      section.classList.remove('section');
      section.classList.add('active-section');
    }
    
    // Check that content is visible
    const isVisible = window.getComputedStyle(section).display !== 'none';
    console.log(`Section ${sectionId} visibility:`, isVisible);
    
    return isVisible;
  }
  
  // Test all sections
  function testAllSections() {
    const sections = ['dashboard', 'food', 'workout', 'meal', 'shopping', 'fitness'];
    const results = {};
    
    sections.forEach(section => {
      results[section] = testSection(section);
    });
    
    console.log("All section test results:", results);
    return results;
  }
  
  // Get test results summary
  function getTestSummary() {
    // Run all tests
    testCoreFunctions();
    testPageContent();
    testButtons();
    testNavigation();
    
    // Prepare summary
    const summary = {
      overallStatus: 'PASS',
      coreFunctions: {
        total: Object.keys(testResults.core).length,
        passing: Object.values(testResults.core).filter(Boolean).length
      },
      pages: {
        total: Object.keys(testResults.pages).length,
        passing: Object.values(testResults.pages).filter(page => page.exists).length
      },
      buttons: {
        total: Object.keys(testResults.buttons).length,
        passing: Object.values(testResults.buttons).filter(Boolean).length
      }
    };
    
    // Determine overall status
    if (summary.coreFunctions.passing < summary.coreFunctions.total * 0.8 ||
        summary.pages.passing < summary.pages.total * 0.8 ||
        summary.buttons.passing < summary.buttons.total * 0.8) {
      summary.overallStatus = 'FAIL';
    }
    
    console.log("Test summary:", summary);
    return summary;
  }
  
  // Start interaction test with a specific phase
  function startInteractionTest(phaseIndex = 0) {
    currentPhase = phaseIndex;
    
    // Create test UI if it doesn't exist
    let testPanel = document.getElementById('test-panel');
    if (!testPanel) {
      testPanel = document.createElement('div');
      testPanel.id = 'test-panel';
      testPanel.className = 'test-panel';
      testPanel.style.position = 'fixed';
      testPanel.style.bottom = '20px';
      testPanel.style.left = '20px';
      testPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      testPanel.style.color = 'white';
      testPanel.style.padding = '15px';
      testPanel.style.borderRadius = '8px';
      testPanel.style.zIndex = '9999';
      testPanel.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
      document.body.appendChild(testPanel);
    }
    
    // Show current phase instructions
    const phase = testPhases[currentPhase];
    testPanel.innerHTML = `
      <h3>Testing Phase ${currentPhase + 1}: ${phase.name}</h3>
      <p>Please navigate to the ${phase.section} section and interact with the following elements:</p>
      <ul>
        ${phase.elements.map(el => `<li>${el}</li>`).join('')}
      </ul>
      <div class="test-buttons">
        <button id="next-phase-btn" class="primary-btn">Next Phase</button>
        <button id="skip-phase-btn" class="secondary-btn">Skip Phase</button>
        <button id="end-test-btn" class="secondary-btn">End Test</button>
      </div>
    `;
    
    // Navigate to the appropriate section
    if (typeof window.showSection === 'function') {
      window.showSection(phase.section);
    }
    
    // Set up button listeners
    document.getElementById('next-phase-btn').addEventListener('click', nextPhase);
    document.getElementById('skip-phase-btn').addEventListener('click', skipPhase);
    document.getElementById('end-test-btn').addEventListener('click', endTest);
    
    // Track interactions for analytics
    document.addEventListener('click', trackInteraction);
    
    console.log(`Started interaction test phase ${currentPhase + 1}: ${phase.name}`);
  }
  
  // Track user interactions
  function trackInteraction(event) {
    // Don't track clicks on the test panel itself
    if (event.target.closest('#test-panel')) {
      return;
    }
    
    const target = event.target;
    const elementType = target.tagName.toLowerCase();
    const elementClass = target.className;
    const elementId = target.id;
    const elementText = target.textContent.trim().substring(0, 30);
    
    console.log('User interaction:', {
      element: elementType,
      class: elementClass,
      id: elementId,
      text: elementText,
      phase: currentPhase + 1,
      phaseSection: testPhases[currentPhase].section
    });
    
    // Track in analytics if available
    if (typeof window.AnalyticsService !== 'undefined') {
      window.AnalyticsService.trackEvent('test_interaction', {
        element: elementType,
        class: elementClass,
        id: elementId,
        text: elementText,
        phase: currentPhase + 1,
        phaseSection: testPhases[currentPhase].section
      });
    }
  }
  
  // Move to next test phase
  function nextPhase() {
    console.log(`Completing test phase ${currentPhase + 1}`);
    
    // Log phase completion in analytics
    if (typeof window.AnalyticsService !== 'undefined') {
      window.AnalyticsService.trackEvent('test_phase_completed', {
        phase: currentPhase + 1,
        phaseName: testPhases[currentPhase].name,
        phaseSection: testPhases[currentPhase].section
      });
    }
    
    currentPhase++;
    
    if (currentPhase < testPhases.length) {
      startInteractionTest(currentPhase);
    } else {
      endTest(true);
    }
  }
  
  // Skip the current phase
  function skipPhase() {
    console.log(`Skipping test phase ${currentPhase + 1}`);
    
    // Log phase skipped in analytics
    if (typeof window.AnalyticsService !== 'undefined') {
      window.AnalyticsService.trackEvent('test_phase_skipped', {
        phase: currentPhase + 1,
        phaseName: testPhases[currentPhase].name,
        phaseSection: testPhases[currentPhase].section
      });
    }
    
    currentPhase++;
    
    if (currentPhase < testPhases.length) {
      startInteractionTest(currentPhase);
    } else {
      endTest(true);
    }
  }
  
  // End the interaction test
  function endTest(completed = false) {
    console.log("Ending interaction test");
    
    // Remove event listener
    document.removeEventListener('click', trackInteraction);
    
    // Log test completion in analytics
    if (typeof window.AnalyticsService !== 'undefined') {
      window.AnalyticsService.trackEvent('test_completed', {
        phasesCompleted: currentPhase,
        totalPhases: testPhases.length,
        completed: completed
      });
    }
    
    // Show completion message
    const testPanel = document.getElementById('test-panel');
    if (testPanel) {
      testPanel.innerHTML = `
        <h3>Test ${completed ? 'Completed' : 'Ended'}</h3>
        <p>You've ${completed ? 'completed' : 'ended'} the interaction test.</p>
        <p>Phases completed: ${currentPhase}/${testPhases.length}</p>
        <button id="remove-test-panel" class="primary-btn">Close</button>
      `;
      
      document.getElementById('remove-test-panel').addEventListener('click', function() {
        testPanel.remove();
      });
    }
  }
  
  // Fix common issues
  function autoFix() {
    // Auto-initialize components if needed
    if (typeof window.AnalyticsService !== 'undefined' && 
        typeof window.AnalyticsService.initialize === 'function' &&
        !window.AnalyticsService.initialized) {
      console.log("Auto-initializing analytics...");
      window.AnalyticsService.initialize();
    }
    
    // Fix buttons if button fix utility is available
    if (typeof window.fixButtons === 'function') {
      console.log("Auto-fixing buttons...");
      window.fixButtons();
    }
    
    console.log("Auto-fixes applied");
  }
  
  // Expose functions to global scope
  window.appTest = {
    testCoreFunctions,
    testPageContent,
    testButtons,
    testNavigation,
    testSection,
    testAllSections,
    getTestSummary,
    autoFix,
    startInteractionTest,
    nextPhase,
    skipPhase,
    endTest,
    results: testResults
  };
  
  console.log("App testing utilities loaded");
})();
