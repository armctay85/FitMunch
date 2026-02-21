// FitMunch Button Fix Utility
// Ensures all buttons work correctly across the application

(function() {
  // Main function to fix button functionality
  function fixButtonFunctionality() {
    console.log("Fixing button functionality...");

    try {
      // Apply event delegation for all buttons
      document.removeEventListener('click', handleButtonClicks);
      document.addEventListener('click', handleButtonClicks);

      // Fix specific buttons
      fixSpecificButtons();

      console.log("Button fixes applied");
      return true;
    } catch (error) {
      console.error("Error in button fix:", error);
      return false;
    }
  }

  // Handle button clicks through delegation
  function handleButtonClicks(e) {
    // Handle regular buttons with onclick attributes
    const button = e.target.closest('button[onclick]');
    if (button) {
      e.preventDefault();
      const onclickValue = button.getAttribute('onclick');
      if (onclickValue) {
        try {
          // Execute the function directly
          new Function(onclickValue)();
        } catch (error) {
          console.error("Error executing button function:", error);
        }
      }
    }

    // Handle workout buttons
    const regenerateBtn = e.target.closest('button[onclick="regenerateWorkoutPlan()"]');
    if (regenerateBtn) {
      e.preventDefault();
      console.log("Regenerating workout plan...");
      if (typeof window.regenerateWorkoutPlan === 'function') {
        window.regenerateWorkoutPlan();
      } else if (typeof window.generateActivityPlan === 'function') {
        window.generateActivityPlan();
      }
    }

    // Handle meal plan buttons
    const generateMealBtn = e.target.closest('.meal-plan-controls .primary-btn');
    if (generateMealBtn) {
      e.preventDefault();
      console.log("Generate meal plan button clicked");
      if (typeof window.generateMealPlan === 'function') {
        window.generateMealPlan();
      }
    }

    // Handle profile buttons
    const editProfileBtn = e.target.closest('button[onclick="editProfile()"]');
    if (editProfileBtn) {
      e.preventDefault();
      console.log("Edit profile button clicked");
      if (typeof window.editProfile === 'function') {
        window.editProfile();
      }
    }

    // Handle test button
    const testButton = e.target.closest('#start-test-btn');
    if (testButton) {
      e.preventDefault();
      console.log("Test button clicked");
      if (typeof window.UserInteractionTest === 'object' && 
          typeof window.UserInteractionTest.initialize === 'function') {
        window.UserInteractionTest.initialize();
      }
    }
  }

  // Fix specific critical buttons
  function fixSpecificButtons() {
    // Fix test button
    const testButton = document.getElementById('start-test-btn');
    if (testButton) {
      testButton.onclick = function(e) {
        e.preventDefault();
        if (typeof window.UserInteractionTest === 'object' && 
            typeof window.UserInteractionTest.initialize === 'function') {
          window.UserInteractionTest.initialize();
        } else {
          console.error("UserInteractionTest not available");
        }
      };
      console.log("Test button fixed");
    }

    // Fix banner upgrade button
    const upgradeBtn = document.querySelector('.banner-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        // Show subscription section if available
        const subscriptionSection = document.getElementById('subscription');
        if (subscriptionSection) {
          subscriptionSection.style.display = 'block';
        }
      });
    }
  }

  // Run on page load
  document.addEventListener('DOMContentLoaded', function() {
    // Apply fixes after a short delay to ensure all other scripts have loaded
    setTimeout(fixButtonFunctionality, 300);
  });

  // Also fix buttons when content is updated
  window.addEventListener('contentUpdated', function() {
    // Apply fixes after content updates
    setTimeout(fixButtonFunctionality, 300);
  });

  // Make available globally
  window.fixButtons = fixButtonFunctionality;
})();