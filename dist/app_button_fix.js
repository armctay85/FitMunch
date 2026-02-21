
// FitMunch Button Fix Utility
// Ensures all buttons work correctly across the application

(function() {
  // Main function to fix button functionality
  function fixButtonFunctionality() {
    console.log("Fixing button functionality...");
    
    // Fix nav buttons
    fixNavButtons();
    
    // Fix action buttons
    fixActionButtons();
    
    // Fix form buttons
    fixFormButtons();
    
    // Add missing event listeners
    addMissingListeners();
    
    console.log("Button fixes applied");
  }
  
  // Fix navigation buttons
  function fixNavButtons() {
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(button => {
      // Clone to remove old listeners
      const newButton = button.cloneNode(true);
      if (button.parentNode) {
        button.parentNode.replaceChild(newButton, button);
      }
      
      // Add click event
      newButton.addEventListener('click', function(e) {
        e.preventDefault();
        const section = this.getAttribute('data-section');
        if (section && typeof window.showSection === 'function') {
          console.log("Navigation clicked for section:", section);
          window.showSection(section);
        }
      });
    });
  }
  
  // Fix action buttons
  function fixActionButtons() {
    // Fix workout buttons
    const regenerateBtn = document.querySelector('button[onclick="regenerateWorkoutPlan()"]');
    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Regenerating workout plan...");
        if (typeof window.regenerateWorkoutPlan === 'function') {
          window.regenerateWorkoutPlan();
        } else if (typeof window.generateActivityPlan === 'function') {
          window.generateActivityPlan();
        }
      });
    }
    
    // Fix food log buttons
    const addFoodBtn = document.getElementById('addFoodBtn');
    if (addFoodBtn) {
      addFoodBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Add food button clicked");
        if (typeof window.showFoodSearch === 'function') {
          window.showFoodSearch();
        }
      });
    }
    
    // Fix meal plan buttons
    const generateMealBtn = document.querySelector('.meal-plan-controls .primary-btn');
    if (generateMealBtn) {
      generateMealBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Generate meal plan button clicked");
        if (typeof window.generateMealPlan === 'function') {
          window.generateMealPlan();
        }
      });
    }
  }
  
  // Fix form buttons
  function fixFormButtons() {
    // Fix profile edit button
    const editProfileBtn = document.querySelector('button[onclick="editProfile()"]');
    if (editProfileBtn) {
      editProfileBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Edit profile button clicked");
        if (typeof window.editProfile === 'function') {
          window.editProfile();
        }
      });
    }
    
    // Fix save goals button
    const saveGoalsBtn = document.querySelector('button[onclick="saveGoals()"]');
    if (saveGoalsBtn) {
      saveGoalsBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Save goals button clicked");
        if (typeof window.saveGoals === 'function') {
          window.saveGoals();
        }
      });
    }
  }
  
  // Add missing event listeners
  function addMissingListeners() {
    // Fix workout log buttons
    document.addEventListener('click', function(e) {
      const logBtn = e.target.closest('.exercise-log-btn');
      if (logBtn) {
        e.preventDefault();
        e.stopPropagation();
        const exerciseName = logBtn.getAttribute('data-exercise') || 
                           logBtn.closest('.exercise-row')?.querySelector('.exercise-name')?.textContent;
        
        if (exerciseName && typeof window.showWorkoutLog === 'function') {
          console.log("Logging workout for:", exerciseName);
          window.showWorkoutLog(exerciseName);
        }
      }
    });
    
    // Fix price check button
    document.addEventListener('click', function(e) {
      const priceCheckBtn = e.target.closest('#priceCheckBtn');
      if (priceCheckBtn) {
        e.preventDefault();
        console.log("Price check button clicked");
        if (typeof window.checkProductPrice === 'function') {
          window.checkProductPrice();
        }
      }
    });
  }
  
  // Run on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    // Apply fixes after a short delay to ensure all other scripts have loaded
    setTimeout(fixButtonFunctionality, 500);
  });
  
  // Also fix buttons when content is updated
  window.addEventListener('contentUpdated', function() {
    // Apply fixes after content updates
    setTimeout(fixButtonFunctionality, 300);
  });
  
  // Make available globally
  window.fixButtons = fixButtonFunctionality;
})();
