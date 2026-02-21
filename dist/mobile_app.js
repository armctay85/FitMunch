
// FitMunch Mobile App Configuration
document.addEventListener('deviceready', onDeviceReady, false);

// Global settings for mobile app
const MOBILE_CONFIG = {
  minLoadTime: 2000, // Minimum loading screen time in ms
  scaleFactor: window.devicePixelRatio || 1,
  deviceType: detectDeviceType(),
  isNative: window.Capacitor && window.Capacitor.isNative,
  hasNetworkConnection: true,
  appLaunchTimestamp: Date.now()
};

// Initialize app when device is ready
function onDeviceReady() {
  console.log('Device ready event fired');
  
  // Set up platform-specific behavior
  setupPlatformSpecifics();
  
  // Show loading screen
  showLoadingScreen();
  
  // Check network status
  checkNetworkStatus();
  
  // Initialize analytics for mobile
  initMobileAnalytics();
  
  // Register back button handler
  setupBackButtonHandler();
  
  // Initialize deep linking
  setupDeepLinking();
  
  // Initialize app after minimum loading time
  setTimeout(() => {
    initializeApp();
  }, MOBILE_CONFIG.minLoadTime);
}

function detectDeviceType() {
  const width = window.screen.width;
  const height = window.screen.height;
  const ratio = window.devicePixelRatio || 1;
  
  if (width * ratio < 600) return 'phone';
  if (width * ratio < 1024) return 'tablet';
  return 'desktop';
}

function setupPlatformSpecifics() {
  // Apply platform-specific styling
  document.body.classList.add(window.Capacitor.getPlatform());
  
  // Set viewport scale for device
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }
  
  // Apply platform-specific CSS variables
  document.documentElement.style.setProperty('--app-status-bar-height', getStatusBarHeight() + 'px');
}

function getStatusBarHeight() {
  if (!MOBILE_CONFIG.isNative) return 0;
  
  if (window.Capacitor.getPlatform() === 'ios') {
    return window.screen.height - window.screen.availHeight;
  } else {
    return 24; // Default Android status bar height
  }
}

function showLoadingScreen() {
  // Create and show loading screen
  const loadingScreen = document.createElement('div');
  loadingScreen.id = 'app-loading-screen';
  loadingScreen.innerHTML = `
    <div class="loading-container">
      <img src="icon-192.png" alt="FitMunch" class="loading-logo">
      <div class="loading-spinner"></div>
      <p>Loading your fitness journey...</p>
    </div>
  `;
  
  document.body.appendChild(loadingScreen);
  
  // Add loading screen styles
  const style = document.createElement('style');
  style.textContent = `
    #app-loading-screen {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: #4361ee;
      z-index: 9999;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: opacity 0.5s ease;
    }
    .loading-container {
      text-align: center;
      color: white;
    }
    .loading-logo {
      width: 120px;
      height: 120px;
      margin-bottom: 20px;
      animation: pulse 1.5s infinite;
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      margin: 0 auto 20px;
      border: 4px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top: 4px solid #fff;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('app-loading-screen');
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
      loadingScreen.remove();
    }, 500);
  }
}

function checkNetworkStatus() {
  // Handle network status changes
  if (navigator.connection) {
    MOBILE_CONFIG.hasNetworkConnection = navigator.connection.type !== 'none';
    
    document.addEventListener('online', () => {
      MOBILE_CONFIG.hasNetworkConnection = true;
      document.dispatchEvent(new CustomEvent('network-status-changed', { 
        detail: { isOnline: true } 
      }));
    });
    
    document.addEventListener('offline', () => {
      MOBILE_CONFIG.hasNetworkConnection = false;
      document.dispatchEvent(new CustomEvent('network-status-changed', { 
        detail: { isOnline: false } 
      }));
    });
  }
}

function initMobileAnalytics() {
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.trackEvent(AnalyticsService.eventTypes.APP_OPENED, {
      deviceType: MOBILE_CONFIG.deviceType,
      platform: window.Capacitor.getPlatform(),
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      pixelRatio: window.devicePixelRatio || 1
    });
  }
}

function setupBackButtonHandler() {
  if (!MOBILE_CONFIG.isNative) return;
  
  document.addEventListener('backbutton', (e) => {
    e.preventDefault();
    
    // Get current active section
    const activeSection = document.querySelector('.active-section');
    
    // If we're in a sub-section, go back to dashboard
    if (activeSection && activeSection.id !== 'dashboard') {
      window.showSection('dashboard');
    } else {
      // Ask user if they want to exit
      navigator.notification.confirm(
        'Are you sure you want to exit FitMunch?', 
        (buttonIndex) => {
          if (buttonIndex === 2) { // Exit button
            navigator.app.exitApp();
          }
        },
        'Exit App',
        ['Cancel', 'Exit']
      );
    }
  });
}

function setupDeepLinking() {
  if (!MOBILE_CONFIG.isNative) return;
  
  // Handle deep links
  window.Capacitor.addListener('appUrlOpen', (data) => {
    const slug = data.url.split('fitmunch://').pop();
    
    // Route based on deep link
    if (slug.startsWith('workout/')) {
      const workoutId = slug.split('workout/')[1];
      // Handle workout deep link
      window.showSection('workout');
      // Add code to load specific workout
    } else if (slug.startsWith('meal/')) {
      const mealId = slug.split('meal/')[1];
      // Handle meal deep link
      window.showSection('meal');
      // Add code to load specific meal
    } else {
      // Default route
      window.showSection('dashboard');
    }
  });
}

function initializeApp() {
  // Apply mobile optimizations
  applyMobileOptimizations();
  
  // Initialize app core features
  if (typeof initializeNavigation === 'function') {
    initializeNavigation();
  }
  
  // Show app content
  hideLoadingScreen();
  
  // Run any deferred scripts
  runDeferredScripts();
  
  // Initial route (default to dashboard)
  window.showSection('dashboard');
  
  // Listen for store review prompts
  setupReviewPrompts();
}

function applyMobileOptimizations() {
  // Apply mobile-specific optimizations
  document.querySelectorAll('img').forEach(img => {
    // Prevent image drag
    img.setAttribute('draggable', 'false');
    
    // Add loading attribute
    img.setAttribute('loading', 'lazy');
  });
  
  // Add touch feedback to buttons
  document.querySelectorAll('button, .button, .nav-item, .card').forEach(el => {
    el.addEventListener('touchstart', () => {
      el.classList.add('touch-active');
    });
    el.addEventListener('touchend', () => {
      el.classList.remove('touch-active');
    });
    el.addEventListener('touchcancel', () => {
      el.classList.remove('touch-active');
    });
  });
}

function runDeferredScripts() {
  // Run any scripts that were deferred
  document.querySelectorAll('script[data-defer="true"]').forEach(script => {
    const newScript = document.createElement('script');
    
    if (script.src) {
      newScript.src = script.src;
    } else {
      newScript.textContent = script.textContent;
    }
    
    script.parentNode.replaceChild(newScript, script);
  });
}

function setupReviewPrompts() {
  // Setup logic for prompting app store reviews
  if (!MOBILE_CONFIG.isNative) return;
  
  // Track app usage count in localStorage
  let appOpenCount = parseInt(localStorage.getItem('appOpenCount') || '0') + 1;
  localStorage.setItem('appOpenCount', appOpenCount.toString());
  
  // Prompt for review after 5 uses and then every 20 after that
  if (appOpenCount === 5 || (appOpenCount > 5 && appOpenCount % 20 === 0)) {
    // Wait until user has had a positive experience
    setTimeout(() => {
      if (window.Capacitor.getPlatform() === 'ios') {
        // iOS app review API
        window.AppRate.promptForRating();
      } else {
        // Android in-app review API
        try {
          const reviewManager = window.Capacitor.Plugins.ReviewManager;
          reviewManager.requestReviewFlow()
            .then(result => {
              if (result.isSuccessful) {
                reviewManager.launchReviewFlow();
              }
            });
        } catch (e) {
          console.error('In-app review error:', e);
        }
      }
    }, 120000); // Wait 2 minutes into the session
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MOBILE_CONFIG,
    onDeviceReady
  };
} else {
  // Make available globally
  window.MOBILE_CONFIG = MOBILE_CONFIG;
}
