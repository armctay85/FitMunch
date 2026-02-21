
// FitMunch Navigation Fix
// Comprehensive fix for navigation issues across the app

function initializeNavigation() {
  console.log("Navigation fix initializing...");
  
  // Define showSection globally to ensure it's always available
  window.showSection = function(sectionId) {
    console.log("Showing section:", sectionId);
    
    // Track analytics if available
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackPageView(sectionId);
    }
    
    // Hide all sections
    const sections = document.querySelectorAll('section, #dashboard');
    sections.forEach(section => {
      section.style.display = 'none';
      section.classList.remove('active-section');
    });
    
    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
      selectedSection.style.display = 'block';
      selectedSection.classList.add('active-section');
      
      // Initialize section-specific functionality if needed
      if (sectionId === 'meal' && typeof generateMealPlan === 'function') {
        generateMealPlan();
      } else if (sectionId === 'workout' && typeof generateActivityPlan === 'function') {
        generateActivityPlan();
      }
    } else {
      console.warn(`Section with ID '${sectionId}' not found`);
    }
    
    // Update active nav item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      if (item.getAttribute('data-section') === sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  };
  
  // Set up navigation click handlers
  const setupNavigation = function() {
    // Fix navigation buttons
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        const section = this.getAttribute('data-section');
        if (section && typeof window.showSection === 'function') {
          window.showSection(section);
        }
      });
    });
    
    // Fix navigation cards
    const navCards = document.querySelectorAll('.nav-card');
    navCards.forEach(card => {
      card.addEventListener('click', function(e) {
        e.preventDefault();
        const section = this.getAttribute('data-page') || this.getAttribute('data-section');
        if (section && typeof window.showSection === 'function') {
          window.showSection(section);
        }
      });
    });
    
    // Fix promo cards
    const promoCards = document.querySelectorAll('.promo-card');
    promoCards.forEach(card => {
      card.addEventListener('click', function(e) {
        e.preventDefault();
        const section = this.getAttribute('data-page') || this.getAttribute('data-section');
        if (section && typeof window.showSection === 'function') {
          window.showSection(section);
        }
      });
    });
  };
  
  // Apply navigation fixes on DOM content loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNavigation);
  } else {
    // DOM already loaded, run setup immediately
    setupNavigation();
  }
  
  console.log("Navigation initialization complete");
}

// Initialize navigation when script is loaded
initializeNavigation();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializeNavigation };
} else {
  // Make available globally in browser
  window.initializeNavigation = initializeNavigation;
}

// Navigation Fix for FitMunch App
// This script ensures navigation works properly throughout the app

(function() {
  console.log("Navigation fix initializing...");

  // Main function to set up robust navigation
  function initializeNavigation() {
    console.log("Initializing robust navigation...");

    // Define the showSection function if it doesn't exist
    if (typeof window.showSection !== 'function') {
      console.log("Defining showSection function...");

      window.showSection = function(sectionId) {
        console.log("Showing section:", sectionId);

        // Track section view in analytics
        if (typeof AnalyticsService !== 'undefined') {
          AnalyticsService.trackPageView(sectionId);
        }

        // Update SEO metadata
        if (typeof SEOOptimizationService !== 'undefined') {
          SEOOptimizationService.updateMetadata(sectionId);
          console.log("Updated metadata for page:", sectionId);
        }

        // Hide all sections
        const sections = document.querySelectorAll('section, #dashboard');
        sections.forEach(section => {
          section.style.display = 'none';
          section.classList.remove('active-section');
        });

        // Show selected section
        const selectedSection = document.getElementById(sectionId);
        if (selectedSection) {
          selectedSection.style.display = 'block';
          selectedSection.classList.add('active-section');

          // Initialize section specific content
          if (sectionId === 'meal' && typeof window.generateMealPlan === 'function') {
            setTimeout(window.generateMealPlan, 100);
          } else if (sectionId === 'workout' && typeof window.generateActivityPlan === 'function') {
            setTimeout(window.generateActivityPlan, 100);
          } else if (sectionId === 'shopping' && typeof window.updateShoppingList === 'function') {
            setTimeout(window.updateShoppingList, 100);
          }
        } else {
          console.error("Section not found:", sectionId);
        }

        // Update active navigation item
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          item.classList.remove('active');
          if (item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
          }
        });

        // Scroll to top
        window.scrollTo(0, 0);
      };
    }

    // Remove any existing direct navigation listeners to prevent duplicates
    console.log("Direct navigation listeners removed");

    // Set up navigation delegation at document level
    document.body.addEventListener('click', function(e) {
      const navItem = e.target.closest('.nav-item');
      if (navItem && typeof window.showSection === 'function') {
        e.preventDefault();
        const section = navItem.getAttribute('data-section');
        if (section) {
          console.log("Navigation clicked for section:", section);
          window.showSection(section);
        }
      }
    });

    console.log("Navigation delegation handler set up");

    // Add touch enhancements for mobile devices
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      const touchableElements = document.querySelectorAll('.nav-item, button, .card');
      touchableElements.forEach(element => {
        element.addEventListener('touchstart', function() {
          this.classList.add('touch-active');
        }, { passive: true });

        element.addEventListener('touchend', function() {
          this.classList.remove('touch-active');
          setTimeout(() => this.classList.remove('touch-active'), 300);
        }, { passive: true });
      });
      console.log("Touch navigation enhancements applied");
    }

    console.log("Navigation initialization complete");
  }


  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();

    // Show dashboard by default if no section is active
    setTimeout(function() {
      const activeSection = document.querySelector('section.active-section');
      if (!activeSection && typeof window.showSection === 'function') {
        window.showSection('dashboard');
      }
    }, 100);

    console.log("Navigation initialization complete");
  });
})();


// Helper function to show error notifications
function showErrorNotification(message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'notification error';
  notification.innerHTML = `
    <i class="fas fa-exclamation-circle"></i>
    ${message}
    <button class="close-notification">&times;</button>
  `;

  // Add to document
  document.body.appendChild(notification);

  // Add event listener to close button
  notification.querySelector('.close-notification').addEventListener('click', function() {
    document.body.removeChild(notification);
  });

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5000);
}

// Fix window.regenerateWorkoutPlan function to properly handle the case when generateActivityPlan is missing
window.regenerateWorkoutPlan = function() {
  console.log("Regenerating workout plan...");

  // Check if generateActivityPlan exists in window scope
  if (typeof window.generateActivityPlan === 'function') {
    try {
      // Call the function to regenerate the plan
      window.generateActivityPlan();

      // Show success message
      const workoutSection = document.getElementById('workout');
      if (workoutSection) {
        const successMsg = document.createElement('div');
        successMsg.className = 'success-message';
        successMsg.innerHTML = `
          <i class="fas fa-check-circle"></i>
          Workout plan regenerated successfully!
        `;

        workoutSection.appendChild(successMsg);

        // Remove message after 3 seconds
        setTimeout(() => {
          if (successMsg.parentNode) {
            successMsg.parentNode.removeChild(successMsg);
          }
        }, 3000);
      }
    } catch (error) {
      console.error("Error regenerating workout plan:", error);
      showErrorNotification("Sorry, couldn't regenerate the workout plan. Error: " + error.message);
    }
  } else {
    console.error("generateActivityPlan function not available");

    // Create an error notification
    showErrorNotification("Sorry, couldn't regenerate the workout plan. Please try refreshing the page.");
  }
};

// Export for use in other modules
window.fixNavigation = initializeNavigation;