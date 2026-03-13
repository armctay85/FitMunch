
// FitMunch Upgrade Verification Script
document.addEventListener('DOMContentLoaded', function() {
  console.log("Verifying FitMunch upgrades...");
  
  // Create status container if it doesn't exist
  let statusContainer = document.getElementById('upgrade-status');
  if (!statusContainer) {
    statusContainer = document.createElement('div');
    statusContainer.id = 'upgrade-status';
    statusContainer.style.position = 'fixed';
    statusContainer.style.bottom = '70px';
    statusContainer.style.right = '10px';
    statusContainer.style.backgroundColor = 'var(--card-bg)';
    statusContainer.style.padding = '15px';
    statusContainer.style.borderRadius = 'var(--radius)';
    statusContainer.style.boxShadow = 'var(--shadow)';
    statusContainer.style.zIndex = '1001';
    statusContainer.style.maxWidth = '350px';
    statusContainer.style.maxHeight = '80vh';
    statusContainer.style.overflowY = 'auto';
    statusContainer.style.display = 'none';
    document.body.appendChild(statusContainer);
    
    // Add toggle button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Test App';
    toggleButton.style.position = 'fixed';
    toggleButton.style.bottom = '10px';
    toggleButton.style.right = '10px';
    toggleButton.style.zIndex = '1002';
    toggleButton.classList.add('primary');
    toggleButton.style.padding = '8px 16px';
    toggleButton.style.fontWeight = 'bold';
    toggleButton.addEventListener('click', function() {
      statusContainer.style.display = statusContainer.style.display === 'none' ? 'block' : 'none';
      if (statusContainer.style.display === 'block') {
        verifyUpgrades();
      }
    });
    document.body.appendChild(toggleButton);
  }
  
  // Test navigation to different sections
  function testNavigation() {
    const results = {
      dashboard: typeof window.showSection === 'function',
      food: typeof window.showSection === 'function',
      workout: typeof window.showSection === 'function',
      meal: typeof window.showSection === 'function',
      shopping: typeof window.showSection === 'function'
    };
    
    return results;
  }
  
  // Test buttons across pages
  function testButtons() {
    const buttons = {
      navButtons: document.querySelectorAll('.nav-item').length > 0,
      themeToggle: document.getElementById('themeToggle') !== null,
      mealControls: document.querySelector('.meal-plan-controls') !== null,
      workoutButtons: document.querySelector('.workout-controls') !== null,
      editProfileBtn: document.querySelector('.edit-profile-btn') !== null,
      foodLog: document.querySelector('.meal-section') !== null,
      shoppingList: document.querySelector('.shopping-list-controls') !== null
    };
    
    return buttons;
  }
  
  // Test core functionality
  function testCoreFunctions() {
    return {
      showSection: typeof window.showSection === 'function',
      generateMealPlan: typeof window.generateMealPlan === 'function',
      calculateMacros: typeof window.calculateMacros === 'function',
      generateActivityPlan: typeof window.generateActivityPlan === 'function',
      updateShoppingList: typeof window.updateShoppingList === 'function',
      editProfile: typeof window.editProfile === 'function',
      showFoodSearch: typeof window.showFoodSearch === 'function'
    };
  }
  
  // Test specific page content
  function testPageContent() {
    return {
      dashboardContent: document.querySelector('#dashboard') !== null,
      foodContent: document.querySelector('#food') !== null,
      workoutContent: document.querySelector('#workout') !== null,
      mealContent: document.querySelector('#meal') !== null,
      shoppingContent: document.querySelector('#shopping') !== null,
      fitnessContent: document.querySelector('#fitness') !== null
    };
  }
  
  // Fix button functionality
  function fixButtonFunctionality() {
    try {
      if (typeof window.fixButtons === 'function') {
        window.fixButtons();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error fixing buttons:", error);
      return false;
    }
  }
  
  function verifyUpgrades() {
    statusContainer.innerHTML = '<h3>FitMunch App Test Results:</h3>';
    
    // Test and display results for core components
    const coreComponentsDiv = document.createElement('div');
    coreComponentsDiv.innerHTML = '<h4>Core Components:</h4>';
    
    // Check theme manager
    const themeActive = typeof window.ThemeManager !== 'undefined' || 
                       localStorage.getItem('fitmunch_theme') !== null;
    coreComponentsDiv.innerHTML += `<p>Theme System: <span style="color:${themeActive ? 'green' : 'red'}">${themeActive ? 'Active ✓' : 'Inactive ✗'}</span></p>`;
    
    // Check analytics
    const analyticsActive = typeof window.AnalyticsService !== 'undefined' && 
                           (window.AnalyticsService.initialized === true || 
                            typeof window.AnalyticsService.initialize === 'function');
    coreComponentsDiv.innerHTML += `<p>Analytics: <span style="color:${analyticsActive ? 'green' : 'red'}">${analyticsActive ? 'Active ✓' : 'Inactive ✗'}</span></p>`;
    
    // Check session tracking
    const sessionActive = sessionStorage.getItem('fitmunch_last_active') !== null;
    coreComponentsDiv.innerHTML += `<p>Session Tracking: <span style="color:${sessionActive ? 'green' : 'red'}">${sessionActive ? 'Active ✓' : 'Inactive ✗'}</span></p>`;
    
    // Check subscription system
    const subscriptionActive = typeof window.subscriptionManager !== 'undefined';
    coreComponentsDiv.innerHTML += `<p>Subscription System: <span style="color:${subscriptionActive ? 'green' : 'red'}">${subscriptionActive ? 'Active ✓' : 'Inactive ✗'}</span></p>`;
    
    // Check background styling
    const hasBackgroundImage = getComputedStyle(document.body).backgroundImage !== 'none';
    coreComponentsDiv.innerHTML += `<p>Minimalist Background: <span style="color:${!hasBackgroundImage ? 'green' : 'orange'}">${!hasBackgroundImage ? 'Active ✓' : 'Using Images'}</span></p>`;
    
    statusContainer.appendChild(coreComponentsDiv);
    
    // Test and display results for navigation
    const navigationDiv = document.createElement('div');
    navigationDiv.innerHTML = '<h4>Navigation Testing:</h4>';
    const navResults = testNavigation();
    Object.entries(navResults).forEach(([section, working]) => {
      navigationDiv.innerHTML += `<p>${section} navigation: <span style="color:${working ? 'green' : 'red'}">${working ? 'Working ✓' : 'Not Working ✗'}</span></p>`;
    });
    statusContainer.appendChild(navigationDiv);
    
    // Test and display results for buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.innerHTML = '<h4>Button Testing:</h4>';
    const buttonResults = testButtons();
    Object.entries(buttonResults).forEach(([buttonType, present]) => {
      buttonsDiv.innerHTML += `<p>${buttonType}: <span style="color:${present ? 'green' : 'red'}">${present ? 'Present ✓' : 'Missing ✗'}</span></p>`;
    });
    statusContainer.appendChild(buttonsDiv);
    
    // Test and display results for core functions
    const functionsDiv = document.createElement('div');
    functionsDiv.innerHTML = '<h4>Core Functions:</h4>';
    const functionResults = testCoreFunctions();
    Object.entries(functionResults).forEach(([funcName, exists]) => {
      functionsDiv.innerHTML += `<p>${funcName}: <span style="color:${exists ? 'green' : 'red'}">${exists ? 'Available ✓' : 'Missing ✗'}</span></p>`;
    });
    statusContainer.appendChild(functionsDiv);
    
    // Test and display results for page content
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = '<h4>Page Content:</h4>';
    const contentResults = testPageContent();
    Object.entries(contentResults).forEach(([page, exists]) => {
      contentDiv.innerHTML += `<p>${page}: <span style="color:${exists ? 'green' : 'red'}">${exists ? 'Loaded ✓' : 'Not Loaded ✗'}</span></p>`;
    });
    statusContainer.appendChild(contentDiv);
    
    // Add test action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.innerHTML = '<h4>Fix Actions:</h4>';
    
    const fixButtonsBtn = document.createElement('button');
    fixButtonsBtn.textContent = 'Fix Buttons';
    fixButtonsBtn.classList.add('primary-btn');
    fixButtonsBtn.style.marginRight = '10px';
    fixButtonsBtn.addEventListener('click', function() {
      const fixed = fixButtonFunctionality();
      alert(`Button fix ${fixed ? 'successfully applied' : 'failed to apply'}`);
      verifyUpgrades(); // Re-run verification
    });
    actionsDiv.appendChild(fixButtonsBtn);
    
    const initAnalyticsBtn = document.createElement('button');
    initAnalyticsBtn.textContent = 'Init Analytics';
    initAnalyticsBtn.classList.add('primary-btn');
    initAnalyticsBtn.addEventListener('click', function() {
      if (typeof window.AnalyticsService !== 'undefined' && 
          typeof window.AnalyticsService.initialize === 'function') {
        window.AnalyticsService.initialize();
        alert('Analytics initialized successfully');
        verifyUpgrades(); // Re-run verification
      } else {
        alert('Analytics service not available');
      }
    });
    actionsDiv.appendChild(initAnalyticsBtn);
    
    statusContainer.appendChild(actionsDiv);
    
    // Add section to manually test different pages
    const pageTestDiv = document.createElement('div');
    pageTestDiv.innerHTML = '<h4>Test Specific Page:</h4>';
    
    const pageSelector = document.createElement('select');
    pageSelector.innerHTML = `
      <option value="dashboard">Dashboard</option>
      <option value="food">Food Log</option>
      <option value="workout">Workout Plan</option>
      <option value="meal">Meal Plan</option>
      <option value="shopping">Shopping List</option>
      <option value="fitness">Fitness</option>
    `;
    pageTestDiv.appendChild(pageSelector);
    
    const goToPageBtn = document.createElement('button');
    goToPageBtn.textContent = 'Go To Page';
    goToPageBtn.classList.add('primary-btn');
    goToPageBtn.style.marginLeft = '10px';
    goToPageBtn.addEventListener('click', function() {
      const selectedPage = pageSelector.value;
      if (typeof window.showSection === 'function') {
        window.showSection(selectedPage);
        alert(`Navigated to ${selectedPage}`);
      } else {
        alert('Navigation function not available');
      }
    });
    pageTestDiv.appendChild(goToPageBtn);
    
    statusContainer.appendChild(pageTestDiv);
    
    // Log results to console
    console.log("Theme system active:", themeActive);
    console.log("Analytics active:", analyticsActive);
    console.log("Session tracking active:", sessionActive);
    console.log("Subscription system active:", subscriptionActive);
    console.log("Using minimalist background:", !hasBackgroundImage);
    console.log("Button tests:", buttonResults);
    console.log("Function tests:", functionResults);
    
    // Fix any issues if needed
    if (!analyticsActive && typeof window.AnalyticsService !== 'undefined' && 
        typeof window.AnalyticsService.initialize === 'function') {
      console.log("Initializing analytics...");
      window.AnalyticsService.initialize();
    }
    
    // Update session timestamp
    sessionStorage.setItem('fitmunch_last_active', Date.now().toString());
  }
});
