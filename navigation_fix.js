// FitMunch Navigation Fix
// Comprehensive fix for navigation issues across the app

(function() {
  console.log("Navigation fix initializing...");

  // Define the showSection function globally
  window.showSection = function(sectionId) {
    console.log("Showing section:", sectionId);

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
      if (sectionId === 'meal' && typeof window.generateMealPlan === 'function') {
        setTimeout(window.generateMealPlan, 100);
      } else if (sectionId === 'workout' && typeof window.generateActivityPlan === 'function') {
        setTimeout(window.generateActivityPlan, 100);
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

    // Scroll to top
    window.scrollTo(0, 0);
  };

  // Setup event delegation for all navigation elements
  document.addEventListener('click', function(e) {
    // Handle main navigation items
    const navItem = e.target.closest('.nav-item');
    if (navItem) {
      e.preventDefault();
      const section = navItem.getAttribute('data-section');
      if (section) {
        console.log("Navigation clicked for section:", section);
        window.showSection(section);
        
        // Update active class on navigation items
        document.querySelectorAll('.nav-item').forEach(item => {
          item.classList.remove('active');
        });
        navItem.classList.add('active');
      }
    }

    // Handle promo cards
    const promoCard = e.target.closest('.promo-card');
    if (promoCard) {
      e.preventDefault();
      const section = promoCard.getAttribute('data-page') || promoCard.getAttribute('data-section');
      if (section) {
        window.showSection(section);
        
        // Update active class on related navigation item
        document.querySelectorAll('.nav-item').forEach(item => {
          if (item.getAttribute('data-section') === section) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      }
    }

    // Handle nav cards
    const navCard = e.target.closest('.nav-card');
    if (navCard) {
      e.preventDefault();
      const section = navCard.getAttribute('data-page') || navCard.getAttribute('data-section');
      if (section) {
        window.showSection(section);
        
        // Update active class on related navigation item
        document.querySelectorAll('.nav-item').forEach(item => {
          if (item.getAttribute('data-section') === section) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      }
    }

    // Handle footer navigation
    const footerNav = e.target.closest('footer.nav a');
    if (footerNav) {
      e.preventDefault();
      const section = footerNav.getAttribute('data-section');
      if (section) {
        window.showSection(section);
        
        // Update active class on footer items
        document.querySelectorAll('footer.nav a').forEach(item => {
          item.classList.remove('active');
        });
        footerNav.classList.add('active');
        
        // Also update main nav
        document.querySelectorAll('.nav-item').forEach(item => {
          if (item.getAttribute('data-section') === section) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      }
    }
  });

  // Show dashboard by default when loaded
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (typeof window.showSection === 'function') {
        window.showSection('dashboard');
        console.log("🏠 Dashboard section activated via navigation fix");
      }
    }, 150);
  });

  // Also activate dashboard if DOM is already ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function() {
      if (typeof window.showSection === 'function') {
        window.showSection('dashboard');
        console.log("🏠 Dashboard section activated immediately");
      }
    }, 50);
  }

  console.log("Navigation initialization complete");
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
window.fixNavigation = window.showSection; // Exposing the core function