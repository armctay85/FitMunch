
// User Interaction Test Module for FitMunch
// Tests logging functionality and button interactions, guiding users through the app

const UserInteractionTest = {
  // Track the current testing phase
  currentPhase: 0,
  phases: [
    { name: 'Dashboard', section: 'dashboard', buttons: ['.nav-card'], nextSection: 'food' },
    { name: 'Food Logging', section: 'food', buttons: ['#addFoodBtn'], nextSection: 'meal' },
    { name: 'Meal Planning', section: 'meal', buttons: ['#goalType'], nextSection: 'workout' },
    { name: 'Workout Planning', section: 'workout', buttons: ['.workout-details-btn'], nextSection: 'shopping' },
    { name: 'Shopping List', section: 'shopping', buttons: ['#priceCheckBtn'], nextSection: 'dashboard' }
  ],
  
  // Initialize the test
  initialize: function() {
    console.log("Starting user interaction test...");
    this.currentPhase = 0;
    this.interactionCount = 0;
    this.showTestOverlay();
    this.startPhaseTest(this.currentPhase);
    
    // Track all clicks for analytics
    document.addEventListener('click', this.trackInteraction.bind(this));
    
    // Listen for section changes
    window.addEventListener('contentUpdated', this.handleSectionChange.bind(this));
  },
  
  // Create a test overlay to guide the user
  showTestOverlay: function() {
    // Remove existing overlay if present
    const existingOverlay = document.getElementById('test-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'test-overlay';
    overlay.innerHTML = `
      <div class="test-panel">
        <h3>FitMunch Interaction Test</h3>
        <div id="test-phase-info">Loading test...</div>
        <div id="test-instructions"></div>
        <div class="test-progress">
          <div id="test-progress-bar"></div>
        </div>
        <div class="test-buttons">
          <button id="test-next-phase" class="primary-btn">Next Phase</button>
          <button id="test-skip-phase" class="secondary-btn">Skip</button>
          <button id="test-complete" class="primary-btn" style="display: none;">Complete Test</button>
        </div>
      </div>
    `;
    
    // Apply styles
    const style = document.createElement('style');
    style.textContent = `
      #test-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        font-family: Arial, sans-serif;
      }
      .test-panel {
        background: #ffffff;
        border: 1px solid #cccccc;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 15px;
        max-width: 300px;
        color: #333;
      }
      .test-panel h3 {
        margin-top: 0;
        margin-bottom: 10px;
        color: #4CAF50;
      }
      #test-phase-info {
        font-weight: bold;
        margin-bottom: 8px;
      }
      #test-instructions {
        margin-bottom: 15px;
        font-size: 14px;
        line-height: 1.4;
      }
      .test-progress {
        height: 6px;
        background: #eeeeee;
        border-radius: 3px;
        margin-bottom: 15px;
      }
      #test-progress-bar {
        height: 100%;
        background: #4CAF50;
        border-radius: 3px;
        width: 0%;
        transition: width 0.3s ease;
      }
      .test-buttons {
        display: flex;
        justify-content: space-between;
      }
      .test-buttons button {
        padding: 8px 12px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-size: 12px;
      }
      .primary-btn {
        background: #4CAF50;
        color: white;
      }
      .secondary-btn {
        background: #f1f1f1;
        color: #666;
      }
      .instruction-highlight {
        color: #4CAF50;
        font-weight: bold;
        margin-top: 10px;
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    // Add event listeners
    document.getElementById('test-next-phase').addEventListener('click', () => this.nextPhase());
    document.getElementById('test-skip-phase').addEventListener('click', () => this.skipPhase());
    document.getElementById('test-complete').addEventListener('click', () => this.completeTest());
  },
  
  // Start testing a specific phase
  startPhaseTest: function(phaseIndex) {
    if (phaseIndex >= this.phases.length) {
      this.completeTest();
      return;
    }
    
    const phase = this.phases[phaseIndex];
    const phaseInfo = document.getElementById('test-phase-info');
    const instructions = document.getElementById('test-instructions');
    const progressBar = document.getElementById('test-progress-bar');
    
    // Update progress
    const progress = ((phaseIndex) / this.phases.length) * 100;
    progressBar.style.width = progress + '%';
    
    // Set content
    phaseInfo.textContent = `Phase ${phaseIndex + 1}/${this.phases.length}: ${phase.name}`;
    instructions.innerHTML = `
      <p>Please navigate to the <strong>${phase.name}</strong> section and test the following:</p>
      <ol>
        <li>Check if all elements are displayed correctly</li>
        <li>Test interactive elements like buttons and forms</li>
        <li>Verify that data is saved when you make changes</li>
      </ol>
      <p class="instruction-highlight">Next: Navigate to the <strong>${phase.nextSection}</strong> section</p>
    `;
    
    // Navigate to the section if needed
    if (typeof window.showSection === 'function') {
      window.showSection(phase.section);
    }
    
    // Highlight buttons in this section
    this.highlightElements(phase.buttons);
    
    // Update UI for final phase
    if (phaseIndex === this.phases.length - 1) {
      document.getElementById('test-next-phase').style.display = 'none';
      document.getElementById('test-complete').style.display = 'block';
    } else {
      document.getElementById('test-next-phase').style.display = 'block';
      document.getElementById('test-complete').style.display = 'none';
    }
    
    // Log analytics event
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent(AnalyticsService.eventTypes.TEST_PHASE_STARTED, {
        phase: phase.name,
        phaseNumber: phaseIndex + 1
      });
    }
  },
  
  // Highlight elements that should be tested
  highlightElements: function(selectors) {
    // Remove existing highlights
    const existing = document.querySelectorAll('.test-highlight');
    existing.forEach(el => el.classList.remove('test-highlight', 'test-pulse'));
    
    // Add highlight style if it doesn't exist
    if (!document.getElementById('highlight-style')) {
      const style = document.createElement('style');
      style.id = 'highlight-style';
      style.textContent = `
        .test-highlight {
          box-shadow: 0 0 0 2px #ff6b6b !important;
          position: relative;
          z-index: 1;
        }
        .test-pulse {
          animation: testPulse 2s infinite;
        }
        @keyframes testPulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(255, 107, 107, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Apply highlights
    selectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          el.classList.add('test-highlight', 'test-pulse');
        });
      } catch (err) {
        console.error("Error highlighting elements:", err);
      }
    });
  },
  
  // Move to next test phase
  nextPhase: function() {
    // Log completed phase
    if (typeof AnalyticsService !== 'undefined') {
      const currentPhase = this.phases[this.currentPhase];
      AnalyticsService.trackEvent(AnalyticsService.eventTypes.TEST_PHASE_COMPLETED, {
        phase: currentPhase.name,
        phaseNumber: this.currentPhase + 1,
        interactionsInPhase: this.interactionCount || 0
      });
    }
    
    this.currentPhase++;
    if (this.currentPhase < this.phases.length) {
      this.startPhaseTest(this.currentPhase);
    } else {
      this.completeTest();
    }
  },
  
  // Skip current phase
  skipPhase: function() {
    // Log skipped phase
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent(AnalyticsService.eventTypes.TEST_PHASE_SKIPPED, {
        phase: this.phases[this.currentPhase].name,
        phaseNumber: this.currentPhase + 1
      });
    }
    
    this.nextPhase();
  },
  
  // Complete the test
  completeTest: function() {
    const overlay = document.getElementById('test-overlay');
    
    // Show completion message
    overlay.innerHTML = `
      <div class="test-panel">
        <h3>Test Completed!</h3>
        <p>Thank you for testing the FitMunch application. All user interactions have been logged for analysis.</p>
        <div class="test-summary">
          <p>Phases completed: ${this.currentPhase}/${this.phases.length}</p>
          <p>Total interactions: ${this.interactionCount || 0}</p>
        </div>
        <button id="test-close" class="primary-btn" style="width: 100%;">Close Test Mode</button>
      </div>
    `;
    
    document.getElementById('test-close').addEventListener('click', () => {
      overlay.remove();
      
      // Log test completion
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackEvent(AnalyticsService.eventTypes.TEST_COMPLETED, {
          phasesCompleted: this.currentPhase,
          totalInteractions: this.interactionCount || 0
        });
      }
    });
  },
  
  // Track user interactions
  trackInteraction: function(event) {
    this.interactionCount = (this.interactionCount || 0) + 1;
    
    // Get element details
    const target = event.target;
    const elementType = target.tagName.toLowerCase();
    const elementId = target.id || '';
    const elementClass = target.className || '';
    const elementText = target.textContent ? target.textContent.trim().substring(0, 20) : '';
    
    // Log interaction
    console.log(`Interaction #${this.interactionCount}: ${elementType}#${elementId}.${elementClass} "${elementText}"`);
    
    // Track in analytics
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent(AnalyticsService.eventTypes.TEST_INTERACTION, {
        elementType,
        elementId,
        elementClass,
        elementText,
        interactionNumber: this.interactionCount,
        currentPhase: this.currentPhase + 1,
        currentSection: this.phases[this.currentPhase].section
      });
    }
    
    // Check if the user clicked on a navigation element that leads to the next section
    if (target.classList.contains('nav-item') || target.parentElement.classList.contains('nav-item')) {
      const navItem = target.classList.contains('nav-item') ? target : target.parentElement;
      const targetSection = navItem.getAttribute('data-section');
      
      if (targetSection === this.phases[this.currentPhase].nextSection) {
        // Auto-advance to next phase after a short delay
        setTimeout(() => this.nextPhase(), 1000);
      }
    }
  },
  
  // Handle section change events
  handleSectionChange: function(event) {
    const currentSection = event.detail.section;
    const currentPhaseData = this.phases[this.currentPhase];
    
    // Check if user navigated to next section
    if (currentPhaseData && currentPhaseData.nextSection === currentSection) {
      // Auto-advance to next phase
      setTimeout(() => this.nextPhase(), 1000);
    }
  },
  
  // Function to test all buttons in a section
  testSectionButtons: function(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return "Section not found";
    
    const buttons = section.querySelectorAll('button, .btn, .nav-item, [role="button"]');
    let results = {
      total: buttons.length,
      accessible: 0,
      missing: [],
      report: []
    };
    
    buttons.forEach((btn, index) => {
      const id = btn.id || '';
      const text = btn.textContent.trim();
      const classes = btn.className;
      const isDisabled = btn.disabled || btn.classList.contains('disabled');
      const hasClick = (typeof btn.onclick === 'function') || 
                       btn.getAttribute('onclick') ||
                       (btn.getAttribute('data-section'));
      
      const buttonInfo = {
        index,
        id,
        text: text.substring(0, 30) + (text.length > 30 ? '...' : ''),
        classes,
        isAccessible: !isDisabled && hasClick,
        isDisabled,
        hasClickHandler: hasClick
      };
      
      if (buttonInfo.isAccessible) {
        results.accessible++;
      } else if (!buttonInfo.isDisabled && !buttonInfo.hasClickHandler) {
        results.missing.push(buttonInfo);
      }
      
      results.report.push(buttonInfo);
    });
    
    // Log results
    console.log(`Button test for section "${sectionId}":`, results);
    
    return results;
  }
};

// Make available in global scope
window.UserInteractionTest = UserInteractionTest;

// Auto-initialize if loaded directly
document.addEventListener('DOMContentLoaded', function() {
  // Add test button to the header
  const header = document.querySelector('header');
  if (header) {
    const testButton = document.createElement('button');
    testButton.id = 'start-interaction-test';
    testButton.className = 'test-btn';
    testButton.innerHTML = '<i class="fas fa-vial"></i> Test UI';
    testButton.style.cssText = `
      position: absolute;
      right: 15px;
      top: 15px;
      background: #6200ea;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
      z-index: 1000;
    `;
    
    testButton.addEventListener('click', function() {
      UserInteractionTest.initialize();
    });
    
    header.appendChild(testButton);
  }
  
  // Add test button to nav bar if header doesn't exist
  if (!header) {
    const navBar = document.querySelector('.side-nav, .sidebar');
    if (navBar) {
      const testButton = document.createElement('button');
      testButton.id = 'start-interaction-test';
      testButton.className = 'nav-item test-btn';
      testButton.innerHTML = '<i class="fas fa-vial"></i> Test UI';
      
      testButton.addEventListener('click', function() {
        UserInteractionTest.initialize();
      });
      
      navBar.appendChild(testButton);
    }
  }
  
  // Check for URL parameter to auto-start test
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('test') === 'ui') {
    setTimeout(() => UserInteractionTest.initialize(), 1000);
  }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UserInteractionTest;
}
