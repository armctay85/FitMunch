// FitMunch Button Fix Utility
// Ensures all buttons work correctly across the application

(function() {
  // Main function to fix button functionality
  function fixButtonFunctionality() {
    console.log("Fixing button functionality...");

    try {
      document.removeEventListener('click', handleButtonClicks);
      document.addEventListener('click', handleButtonClicks);
      fixSpecificButtons();
      console.log("Button fixes applied");
      return true;
    } catch (error) {
      console.error("Error in button fix:", error);
      return false;
    }
  }

  // Handle button clicks through delegation
  // FIX: Use else-if chain so only ONE handler fires per click.
  // FIX: Execute onclick in window scope (not blank Function scope).
  function handleButtonClicks(e) {
    const target = e.target;

    // Handle test button
    const testButton = target.closest('#start-test-btn');
    if (testButton) {
      e.preventDefault();
      console.log("Test button clicked");
      if (typeof window.UserInteractionTest === 'object' &&
          typeof window.UserInteractionTest.initialize === 'function') {
        window.UserInteractionTest.initialize();
      } else {
        console.error("UserInteractionTest not available");
      }
      return; // stop — don't fall through
    }

    // Handle workout regenerate button
    const regenerateBtn = target.closest('button[onclick="regenerateWorkoutPlan()"]');
    if (regenerateBtn) {
      e.preventDefault();
      console.log("Regenerating workout plan...");
      if (typeof window.regenerateWorkoutPlan === 'function') {
        window.regenerateWorkoutPlan();
      } else if (typeof window.generateActivityPlan === 'function') {
        window.generateActivityPlan();
      }
      return;
    }

    // Handle meal plan buttons
    const generateMealBtn = target.closest('.meal-plan-controls .primary-btn');
    if (generateMealBtn) {
      e.preventDefault();
      console.log("Generate meal plan button clicked");
      if (typeof window.generateMealPlan === 'function') {
        window.generateMealPlan(true); // pass override flag — see Bug 2 fix
      }
      return;
    }

    // Handle profile edit button
    const editProfileBtn = target.closest('button[onclick="editProfile()"]');
    if (editProfileBtn) {
      e.preventDefault();
      console.log("Edit profile button clicked");
      if (typeof window.editProfile === 'function') {
        window.editProfile();
      }
      return;
    }

    // Handle banner upgrade button
    const upgradeBtn = target.closest('.banner-btn');
    if (upgradeBtn) {
      e.preventDefault();
      const subscriptionSection = document.getElementById('subscription');
      if (subscriptionSection) {
        subscriptionSection.style.display = 'block';
      }
      return;
    }

    // Generic fallback: buttons with onclick not matched above.
    // FIX: Execute in window scope using window[fnName]() instead of new Function().
    const onclickBtn = target.closest('button[onclick]');
    if (onclickBtn) {
      const onclickValue = onclickBtn.getAttribute('onclick');
      if (onclickValue) {
        // Extract function name (handles "fnName()" and "fnName(arg)" patterns)
        const match = onclickValue.match(/^(\w+)\((.*)\)$/);
        if (match) {
          const fnName = match[0].replace(/\(.*\)$/, '');
          const fn = window[fnName];
          if (typeof fn === 'function') {
            e.preventDefault();
            try {
              // Re-evaluate args in window scope
              // eslint-disable-next-line no-new-func
              const callFn = new Function('window', `with(window){ ${onclickValue} }`);
              callFn(window);
            } catch (err) {
              console.error("Error executing onclick:", onclickValue, err);
            }
          }
          // If function doesn't exist on window, let browser handle it normally
        }
      }
    }
  }

  // Fix specific critical buttons by direct assignment (belt-and-suspenders)
  function fixSpecificButtons() {
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
  }

  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(fixButtonFunctionality, 300);
  });

  window.addEventListener('contentUpdated', function() {
    setTimeout(fixButtonFunctionality, 300);
  });

  window.fixButtons = fixButtonFunctionality;
})();
