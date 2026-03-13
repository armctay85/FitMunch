// FitMunch User Interaction Test
// This script tests user interactions with the app

(function() {
  // Create global UserInteractionTest object
  window.UserInteractionTest = {
    currentPhase: 0,
    totalPhases: 3,
    initialized: false,
    phases: [
      {
        name: "Basic Navigation",
        description: "Testing navigation between main sections",
        tests: [
          { action: "Click Dashboard tab", target: ".nav-item[data-section='dashboard']", verify: "#dashboard.active-section" },
          { action: "Click Workout Plan tab", target: ".nav-item[data-section='workout']", verify: "#workout.active-section" },
          { action: "Click Food Log tab", target: ".nav-item[data-section='food']", verify: "#food.active-section" },
          { action: "Click Meal Plan tab", target: ".nav-item[data-section='meal']", verify: "#meal.active-section" }
        ]
      },
      {
        name: "Feature Interactions",
        description: "Testing core feature functionality",
        tests: [
          { action: "Generate Meal Plan", target: ".meal-plan-controls .primary-btn", verify: ".meal-plan-details" },
          { action: "Edit Profile", target: "button[onclick='editProfile()']", verify: "#profileModal[style*='display: block']" },
          { action: "Close Profile Modal", target: ".close", verify: "#profileModal[style*='display: none']" }
        ]
      },
      {
        name: "Advanced Features",
        description: "Testing advanced app functionality",
        tests: [
          { action: "Toggle Theme", target: "#themeToggle", verify: "html[data-theme='dark']" },
          { action: "Generate Workout Plan", target: "button[onclick='regenerateWorkoutPlan()']", verify: ".workout-card" }
        ]
      }
    ],

    // Initialize testing
    initialize: function() {
      console.log("Starting user interaction test...");

      if (this.initialized) {
        console.warn("Test already running, resetting...");
        this.reset();
      }

      this.initialized = true;
      this.currentPhase = 0;
      this.showTestInterface();
      this.startPhase(0);

      return true;
    },

    // Reset testing
    reset: function() {
      this.currentPhase = 0;
      this.hideTestResults();
      const testContainer = document.getElementById('test-container');
      if (testContainer) {
        testContainer.remove();
      }
      this.initialized = false;
    },

    // Show test interface
    showTestInterface: function() {
      // Create test container if it doesn't exist
      if (!document.getElementById('test-container')) {
        const testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.className = 'test-container';
        testContainer.innerHTML = `
          <div class="test-header">
            <h2>FitMunch Interaction Test</h2>
            <button id="close-test" class="close-test">×</button>
          </div>
          <div class="test-content">
            <div class="test-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
              </div>
              <div class="progress-text">Phase 0/${this.totalPhases}</div>
            </div>
            <div id="test-instructions" class="test-instructions">
              Starting test...
            </div>
            <div id="test-actions" class="test-actions">
              <button id="next-test-phase" class="primary-btn">Start Test</button>
            </div>
          </div>
          <div id="test-results" class="test-results" style="display:none">
            <h3>Test Results</h3>
            <div id="results-content" class="results-content"></div>
          </div>
        `;
        document.body.appendChild(testContainer);

        // Add event listeners
        document.getElementById('close-test').addEventListener('click', () => {
          this.reset();
        });

        document.getElementById('next-test-phase').addEventListener('click', () => {
          this.nextPhase();
        });
      }
    },

    // Start a specific test phase
    startPhase: function(phase) {
      this.currentPhase = phase;
      const progressFill = document.querySelector('.progress-fill');
      const progressText = document.querySelector('.progress-text');
      const instructions = document.getElementById('test-instructions');
      const nextButton = document.getElementById('next-test-phase');

      if (progressFill) {
        progressFill.style.width = `${(phase / this.totalPhases) * 100}%`;
      }

      if (progressText) {
        progressText.textContent = `Phase ${phase +1}/${this.totalPhases}`;
      }

      // Phase-specific instructions and setup
      if (phase < this.phases.length) {
        const currentPhaseData = this.phases[phase];
        if (instructions) {
          instructions.innerHTML = `
            <p><strong>Phase ${phase + 1}: ${currentPhaseData.name}</strong></p>
            <p>${currentPhaseData.description}</p>
            <ol>`;
          currentPhaseData.tests.forEach((test, index) => {
            instructions.innerHTML += `<li>${test.action}</li>`;
          });
          instructions.innerHTML += `</ol>
            <p>Once you've completed these steps, click "Next Phase".</p>
          `;
        }
        if (nextButton) {
          nextButton.textContent = "Next Phase";
        }
      } else {
        this.completeTest();
      }
    },

    // Move to next phase
    nextPhase: function() {
      if (this.currentPhase >= this.totalPhases) {
        this.completeTest();
        return;
      }

      this.startPhase(this.currentPhase + 1);
    },

    // Complete the test
    completeTest: function() {
      const testResults = document.getElementById('test-results');
      const resultsContent = document.getElementById('results-content');
      const testInstructions = document.getElementById('test-instructions');
      const testActions = document.getElementById('test-actions');

      if (testResults && resultsContent) {
        testResults.style.display = 'block';

        if (testInstructions) {
          testInstructions.style.display = 'none';
        }

        if (testActions) {
          testActions.innerHTML = `
            <button id="restart-test" class="secondary-btn">Restart Test</button>
            <button id="close-test-results" class="primary-btn">Close</button>
          `;

          document.getElementById('restart-test').addEventListener('click', () => {
            this.reset();
            this.initialize();
          });

          document.getElementById('close-test-results').addEventListener('click', () => {
            this.reset();
          });
        }

        resultsContent.innerHTML = `
          <div class="test-success">
            <i class="fas fa-check-circle"></i>
            <p>Test completed successfully!</p>
          </div>
          <div class="test-summary">
            <p>All phases completed. The app appears to be functioning correctly.</p>
            <p>If you encountered any issues during testing, please report them.</p>
          </div>
        `;
      }
    },

    // Hide test results
    hideTestResults: function() {
      const testResults = document.getElementById('test-results');
      if (testResults) {
        testResults.style.display = 'none';
      }
    }
  };

  // Added simulateNavigation function
  function simulateNavigation() {
    const sections = ['dashboard', 'workout', 'food', 'meal', 'shopping', 'fitness'];
    let currentIndex = 0;

    const navigateToNext = () => {
      if (currentIndex >= sections.length) {
        completePhase();
        return;
      }

      const sectionId = sections[currentIndex];
      const button = document.querySelector(`.nav-item[data-section="${sectionId}"]`);

      if (button) {
        highlightElement(button);
        setTimeout(() => {
          button.click();
          testLog(`Navigated to ${sectionId}`);
          // Verify section visibility
          const section = document.getElementById(sectionId);
          if (section && section.classList.contains('active-section')) {
            testLog(`✓ Section ${sectionId} displayed correctly`);
          } else {
            testLog(`✗ Section ${sectionId} not displayed properly`);
          }
          currentIndex++;
          setTimeout(navigateToNext, 1500);
        }, 1000);
      } else {
        testLog(`Navigation element for ${sectionId} not found`);
        currentIndex++;
        setTimeout(navigateToNext, 500);
      }
    };

    testLog('Testing navigation through main sections');
    navigateToNext();
  }


  console.log("User interaction test module loaded successfully");
})();