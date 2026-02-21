
// FitMunch App Wrapper for Native Mobile Integration
// This script provides the bridge between the web app and native functionality

const FitMunchMobile = {
  // Initialization function to be called when app starts
  initialize: function() {
    document.addEventListener('DOMContentLoaded', this.onDocumentReady.bind(this));
    document.addEventListener('deviceready', this.onDeviceReady.bind(this), false);
    
    // Flag to track if we're running in a native container
    this.isNative = window.Capacitor && window.Capacitor.isNative;
    this.platform = this.isNative ? window.Capacitor.getPlatform() : 'web';
    
    console.log(`Initializing FitMunch Mobile: Platform ${this.platform}, Native: ${this.isNative}`);
  },
  
  // When document is ready (works on web and native)
  onDocumentReady: function() {
    // Apply mobile-specific UI enhancements
    this.enhanceMobileUI();
    
    // Register event listeners for deep linking
    window.addEventListener('appUrlOpen', (event) => {
      this.handleDeepLink(event.url);
    });
  },
  
  // When Capacitor/Cordova is ready (native only)
  onDeviceReady: function() {
    if (!this.isNative) return;
    
    console.log('Device is ready, setting up native features');
    
    // Setup platform specific features
    this.setupPushNotifications();
    this.setupHealthIntegration();
    this.setupAppReview();
    this.setupInAppPurchases();
    
    // Register app lifecycle events
    document.addEventListener('pause', this.onAppPause.bind(this), false);
    document.addEventListener('resume', this.onAppResume.bind(this), false);
    
    // Register for network status changes
    window.addEventListener('networkStatusChange', (status) => {
      this.handleNetworkChange(status.connected);
    });
    
    // Get initial installation data
    this.checkFirstRun();
  },
  
  // Mobile UI enhancements
  enhanceMobileUI: function() {
    // Add mobile-specific classes to body
    document.body.classList.add('native-app');
    document.body.classList.add(`platform-${this.platform}`);
    
    // Adjust viewport for native display
    const metaViewport = document.querySelector('meta[name="viewport"]');
    if (metaViewport) {
      metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover');
    }
    
    // Fix iOS-specific issues
    if (this.platform === 'ios') {
      // Add padding for the notch and home indicator
      document.body.classList.add('has-notch');
      
      // Prevent overscroll/bounce effect
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
    }
    
    // Adjust navigation for native experience
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('touchstart', () => {
        item.classList.add('touch-active');
      }, { passive: true });
      
      item.addEventListener('touchend', () => {
        setTimeout(() => {
          item.classList.remove('touch-active');
        }, 150);
      }, { passive: true });
    });
  },
  
  // Health platform integration (HealthKit or Google Fit)
  setupHealthIntegration: function() {
    if (!this.isNative) return;
    
    console.log('Setting up health integration');
    
    if (this.platform === 'ios') {
      // iOS HealthKit setup
      this.setupHealthKit();
    } else if (this.platform === 'android') {
      // Android Google Fit setup
      this.setupGoogleFit();
    }
  },
  
  // iOS HealthKit integration
  setupHealthKit: function() {
    // Request HealthKit permissions when user connects fitness data
    const connectFitnessBtn = document.getElementById('connectFitnessData');
    if (connectFitnessBtn) {
      connectFitnessBtn.addEventListener('click', async () => {
        try {
          const permissions = {
            read: ['steps', 'distance', 'calories', 'activity'],
            write: ['steps', 'calories']
          };
          
          // Request permissions via Capacitor HealthKit plugin
          if (window.Capacitor.Plugins.HealthKit) {
            const result = await window.Capacitor.Plugins.HealthKit.requestAuthorization(permissions);
            
            if (result.authorized) {
              // Start syncing data
              this.startHealthDataSync();
              
              // Update UI to show connected state
              this.updateFitnessConnectionUI(true);
              
              // Track in analytics
              if (typeof AnalyticsService !== 'undefined') {
                AnalyticsService.trackEvent('fitness_connected', { platform: 'HealthKit' });
              }
            }
          }
        } catch (error) {
          console.error('HealthKit authorization error:', error);
        }
      });
    }
  },
  
  // Android Google Fit integration
  setupGoogleFit: function() {
    // Request Google Fit permissions when user connects fitness data
    const connectFitnessBtn = document.getElementById('connectFitnessData');
    if (connectFitnessBtn) {
      connectFitnessBtn.addEventListener('click', async () => {
        try {
          const permissions = {
            fitnessOptions: [
              'FITNESS_ACTIVITY_READ',
              'FITNESS_ACTIVITY_WRITE',
              'FITNESS_LOCATION_READ',
              'FITNESS_NUTRITION_READ',
              'FITNESS_NUTRITION_WRITE',
              'FITNESS_BODY_READ',
              'FITNESS_BODY_WRITE'
            ]
          };
          
          // Request permissions via Capacitor Google Fit plugin
          if (window.Capacitor.Plugins.GoogleFit) {
            const result = await window.Capacitor.Plugins.GoogleFit.requestAuthorization(permissions);
            
            if (result.authorized) {
              // Start syncing data
              this.startHealthDataSync();
              
              // Update UI to show connected state
              this.updateFitnessConnectionUI(true);
              
              // Track in analytics
              if (typeof AnalyticsService !== 'undefined') {
                AnalyticsService.trackEvent('fitness_connected', { platform: 'GoogleFit' });
              }
            }
          }
        } catch (error) {
          console.error('Google Fit authorization error:', error);
        }
      });
    }
  },
  
  // Push notification setup
  setupPushNotifications: function() {
    if (!this.isNative) return;
    
    console.log('Setting up push notifications');
    
    // Request permission and register for push
    if (window.Capacitor.Plugins.PushNotifications) {
      window.Capacitor.Plugins.PushNotifications.requestPermissions().then(result => {
        if (result.granted) {
          // Register with Apple/Google notification services
          window.Capacitor.Plugins.PushNotifications.register();
          
          // Listen for push registration
          window.Capacitor.Plugins.PushNotifications.addListener('registration', token => {
            // Send token to your server
            this.updatePushToken(token.value);
          });
          
          // Listen for push notification received
          window.Capacitor.Plugins.PushNotifications.addListener('pushNotificationReceived', notification => {
            // Handle received notification
            this.handlePushNotification(notification);
          });
          
          // Listen for push notification action clicked
          window.Capacitor.Plugins.PushNotifications.addListener('pushNotificationActionPerformed', notification => {
            // Handle notification action
            this.handlePushAction(notification.actionId, notification.notification);
          });
        }
      });
    }
  },
  
  // In-app purchases setup
  setupInAppPurchases: function() {
    if (!this.isNative) return;
    
    console.log('Setting up in-app purchases');
    
    // Initialize the IAP plugin when subscription page is loaded
    document.addEventListener('subscription_page_loaded', () => {
      if (window.Capacitor.Plugins.InAppPurchase) {
        // Get available products
        window.Capacitor.Plugins.InAppPurchase.getProducts({
          productIds: [
            'com.fitmunch.subscription.monthly',
            'com.fitmunch.subscription.yearly',
            'com.fitmunch.subscription.premium'
          ]
        }).then(result => {
          // Update the subscription UI with native products
          this.updateSubscriptionProductsUI(result.products);
        });
        
        // Listen for purchases
        window.Capacitor.Plugins.InAppPurchase.addListener('purchaseCompleted', purchase => {
          // Validate receipt with server
          this.validatePurchaseReceipt(purchase);
        });
      }
    });
    
    // Override the web purchase buttons with native purchase flow
    this.overrideSubscriptionButtons();
  },
  
  // App review prompt
  setupAppReview: function() {
    if (!this.isNative) return;
    
    // Track user actions to determine good time to ask for review
    let positiveActions = parseInt(localStorage.getItem('positiveAppActions') || '0');
    
    // Listen for positive actions like completing workouts, etc.
    document.addEventListener('workout_completed', () => {
      positiveActions++;
      localStorage.setItem('positiveAppActions', positiveActions);
      
      // After several positive experiences, prompt for review
      if (positiveActions >= 5) {
        this.promptForReview();
        localStorage.setItem('positiveAppActions', '0');
      }
    });
  },
  
  // Prompt user to review the app
  promptForReview: function() {
    // Don't ask too frequently
    const lastPrompt = localStorage.getItem('lastReviewPrompt');
    const now = new Date().getTime();
    
    if (lastPrompt && (now - parseInt(lastPrompt)) < (30 * 24 * 60 * 60 * 1000)) {
      return; // Don't ask more than once per month
    }
    
    console.log('Prompting for app review');
    
    if (this.platform === 'ios' && window.Capacitor.Plugins.AppReview) {
      window.Capacitor.Plugins.AppReview.requestReview();
    } else if (this.platform === 'android' && window.Capacitor.Plugins.AppReview) {
      window.Capacitor.Plugins.AppReview.openReviewPage();
    }
    
    localStorage.setItem('lastReviewPrompt', now.toString());
  },
  
  // Deep linking handler
  handleDeepLink: function(url) {
    console.log('Deep link received:', url);
    
    // Parse the URL
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;
      const params = new URLSearchParams(parsedUrl.search);
      
      // Handle different paths
      if (path.includes('/workout/')) {
        const workoutId = path.split('/').pop();
        this.openWorkoutDetail(workoutId);
      } else if (path.includes('/meal/')) {
        const mealPlanId = path.split('/').pop();
        this.openMealPlanDetail(mealPlanId);
      } else if (path.includes('/social/')) {
        const shareId = path.split('/').pop();
        this.handleSocialShare(shareId);
      } else if (path.includes('/premium')) {
        // Open premium subscription page
        if (typeof window.showSection === 'function') {
          window.showSection('subscription');
        }
      }
      
      // Track deep link in analytics
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackEvent('deep_link_opened', {
          path: path,
          full_url: url
        });
      }
    } catch (e) {
      console.error('Error parsing deep link URL:', e);
    }
  },
  
  // App lifecycle: paused
  onAppPause: function() {
    console.log('App paused (background)');
    
    // Save any unsaved data
    if (window.dailyLog) {
      localStorage.setItem('dailyLog', JSON.stringify(window.dailyLog));
    }
    
    // Track session length
    if (this.appResumeTime) {
      const sessionLength = (new Date().getTime() - this.appResumeTime) / 1000;
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackEvent('app_session', {
          duration_seconds: sessionLength
        });
      }
    }
  },
  
  // App lifecycle: resumed
  onAppResume: function() {
    console.log('App resumed (foreground)');
    
    // Record resume time for session tracking
    this.appResumeTime = new Date().getTime();
    
    // Refresh data if needed
    this.refreshHealthData();
    
    // Check notifications
    this.checkPendingNotifications();
    
    // Track app open in analytics
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('app_open', {
        source: 'resume'
      });
    }
  },
  
  // Handle network status changes
  handleNetworkChange: function(isConnected) {
    console.log('Network status changed. Connected:', isConnected);
    
    if (isConnected) {
      // Sync any offline data
      this.syncOfflineData();
      
      // Remove offline indicator
      document.body.classList.remove('offline-mode');
    } else {
      // Show offline indicator
      document.body.classList.add('offline-mode');
    }
  },
  
  // Check if this is first run of the app
  checkFirstRun: function() {
    const isFirstRun = !localStorage.getItem('appFirstRunCompleted');
    
    if (isFirstRun) {
      // Show onboarding
      if (typeof GrowthOptimizationService !== 'undefined') {
        GrowthOptimizationService.showOnboarding(0);
      }
      
      // Track first open in analytics
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackEvent('first_app_open', {
          platform: this.platform,
          deviceInfo: this.getDeviceInfo()
        });
      }
      
      localStorage.setItem('appFirstRunCompleted', 'true');
    }
  },
  
  // Get device information
  getDeviceInfo: function() {
    if (!this.isNative || !window.Capacitor.Plugins.Device) {
      return {};
    }
    
    return window.Capacitor.Plugins.Device.getInfo();
  },
  
  // Helper methods (implementations would be added as needed)
  updatePushToken: function(token) {
    console.log('Push token received:', token);
    // Send to server
  },
  
  handlePushNotification: function(notification) {
    console.log('Push notification received:', notification);
    // Display in-app notification
  },
  
  handlePushAction: function(actionId, notification) {
    console.log('Push action performed:', actionId, notification);
    // Handle the action
  },
  
  startHealthDataSync: function() {
    console.log('Starting health data sync');
    // Implement health data sync logic
  },
  
  updateFitnessConnectionUI: function(connected) {
    console.log('Updating fitness connection UI:', connected);
    // Update UI elements
  },
  
  validatePurchaseReceipt: function(purchase) {
    console.log('Validating purchase receipt:', purchase);
    // Send to server for validation
  },
  
  updateSubscriptionProductsUI: function(products) {
    console.log('Updating subscription products UI:', products);
    // Update UI with product information
  },
  
  overrideSubscriptionButtons: function() {
    console.log('Overriding subscription buttons for native purchase flow');
    // Replace web purchase flow with native
  },
  
  refreshHealthData: function() {
    console.log('Refreshing health data');
    // Fetch latest health data
  },
  
  checkPendingNotifications: function() {
    console.log('Checking pending notifications');
    // Check for new notifications
  },
  
  syncOfflineData: function() {
    console.log('Syncing offline data');
    // Sync local data with server
  },
  
  openWorkoutDetail: function(workoutId) {
    console.log('Opening workout detail:', workoutId);
    // Navigate to workout detail
  },
  
  openMealPlanDetail: function(mealPlanId) {
    console.log('Opening meal plan detail:', mealPlanId);
    // Navigate to meal plan detail
  },
  
  handleSocialShare: function(shareId) {
    console.log('Handling social share:', shareId);
    // Process social share
  }
};

// Initialize when script loads
FitMunchMobile.initialize();

// Make available globally
window.FitMunchMobile = FitMunchMobile;
