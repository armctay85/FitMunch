
// FitMunch JavaScript Error Fixes
// This script addresses critical JavaScript errors in the app

(function() {
  console.log("Running JavaScript error fixes...");
  
  // Create subscription manager if it doesn't exist
  console.log("Creating subscriptionManager...");
  if (typeof window.subscriptionManager === 'undefined') {
    window.subscriptionManager = {
      initialize: function() {
        console.log("Subscription manager initialized");
      },
      checkSubscription: function() {
        return {
          status: 'active',
          plan: 'free',
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
      },
      addEventListener: function(callback) {
        this.eventListeners = this.eventListeners || [];
        this.eventListeners.push(callback);
      }
    };
    
    // Initialize subscription manager
    if (typeof window.subscriptionManager.initialize === 'function') {
      window.subscriptionManager.initialize();
    }
  }
  
  // Create showSection function if it doesn't exist
  console.log("Creating showSection function...");
  if (typeof window.showSection !== 'function') {
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
  }
  
  // Create updateProfileDisplay function if it doesn't exist
  console.log("Creating updateProfileDisplay function...");
  if (typeof window.updateProfileDisplay !== 'function') {
    window.updateProfileDisplay = function() {
      // Basic implementation to prevent errors
      const userName = document.getElementById('userName');
      if (userName) userName.textContent = localStorage.getItem('userName') || 'User';
      
      const currentDate = document.getElementById('currentDate');
      if (currentDate) currentDate.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    };
  }
  
  // Fix Get Started button
  document.addEventListener('DOMContentLoaded', function() {
    console.log("Running DOM loaded JavaScript error fixes...");
    
    // Fix Get Started button
    const getStartedBtn = document.querySelector('button.get-started-btn');
    if (getStartedBtn) {
      getStartedBtn.addEventListener('click', function() {
        console.log("Get Started button fixed");
        if (typeof window.showSection === 'function') {
          window.showSection('dashboard');
        }
      });
    }
    
    // Apply fixes to all buttons
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(button => {
      // Fix any buttons with broken event listeners
      if (!button.onclick && button.getAttribute('data-section')) {
        button.addEventListener('click', function() {
          const section = this.getAttribute('data-section');
          if (section && typeof window.showSection === 'function') {
            window.showSection(section);
          }
        });
      }
    });
    
    console.log("JavaScript DOM loaded fixes applied");
  });
  
  console.log("JavaScript error fixes applied");
})();
