// FitMunch App Initialization Script
// This ensures proper app startup and navigation

console.log("🚀 FitMunch Initialization Script Loading...");

// Global initialization state
window.fitmunchInitialized = false;

// Main initialization function
function ensureAppInitialization() {
  console.log("🔧 Ensuring FitMunch app initialization...");

  try {
    // Hide emergency fallback
    const fallback = document.getElementById('emergencyFallback');
    if (fallback) {
      fallback.style.display = 'none';
      console.log("✅ Emergency fallback hidden");
    }

    // Show main app
    const mainApp = document.getElementById('mainApp');
    if (mainApp) {
      mainApp.style.display = 'block';
      console.log("✅ Main app container shown");
    }

    // Ensure dashboard section is visible
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      dashboard.style.display = 'block';
      dashboard.classList.add('active-section');
      console.log("✅ Dashboard section activated");
    }

    // Hide other sections
    const sections = ['workout', 'food', 'meal', 'shopping', 'fitness'];
    sections.forEach(sectionId => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.style.display = 'none';
        section.classList.remove('active-section');
      }
    });

    // Activate first nav item (dashboard)
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach((item, index) => {
      if (index === 0) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Initialize core functions
    if (typeof updateProfileDisplay === 'function') {
      updateProfileDisplay();
      console.log("✅ Profile display updated");
    }

    // Mark as initialized
    window.fitmunchInitialized = true;
    console.log("🎉 FitMunch app successfully initialized!");

  } catch (error) {
    console.error("❌ Error in app initialization:", error);
    // Show fallback on error
    const fallback = document.getElementById('emergencyFallback');
    if (fallback) {
      fallback.style.display = 'block';
    }
  }
}

// Force initialization with multiple triggers
function forceInitialization() {
  console.log("🔥 Force initializing FitMunch...");

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureAppInitialization);
  } else {
    ensureAppInitialization();
  }

  // Backup initialization after a delay
  setTimeout(() => {
    if (!window.fitmunchInitialized) {
      console.log("⚠️ Backup initialization triggered");
      ensureAppInitialization();
    }
  }, 500);

  // Final fallback
  setTimeout(() => {
    if (!window.fitmunchInitialized) {
      console.log("🚨 Final fallback initialization");
      ensureAppInitialization();
    }
  }, 1000);
}

// Initialize immediately
forceInitialization();

// Export for global use
window.ensureAppInitialization = ensureAppInitialization;
window.forceInitialization = forceInitialization;