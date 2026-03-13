
// FitMunch Integration Script
// This script initializes and connects all components of the FitMunch app

class FitMunchApp {
  constructor() {
    this.components = {};
    this.initialized = false;
  }

  async initialize() {
    console.log('Initializing FitMunch App...');
    
    try {
      // Load core components
      await this.initializeUserAccount();
      await this.initializeSubscriptions();
      await this.initializeIAP();
      
      // Initialize UI components
      await this.initializeUserAccountUI();
      await this.initializeSubscriptionUI();
      
      // Load feature components
      await this.initializeMealPlanning();
      await this.initializeWorkoutTracking();
      await this.initializeProgressTracking();
      
      // Connect components
      this.connectComponents();
      
      this.initialized = true;
      console.log('FitMunch App initialized successfully!');
      return true;
    } catch (error) {
      console.error('Failed to initialize FitMunch App:', error);
      return false;
    }
  }

  async initializeUserAccount() {
    try {
      const UserAccount = require('./user_account.js');
      this.components.userAccount = new UserAccount();
      await this.components.userAccount.initialize();
      console.log('User Account component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize User Account:', error);
      throw error;
    }
  }

  async initializeSubscriptions() {
    try {
      const SubscriptionManager = require('./subscription_manager.js');
      this.components.subscriptionManager = new SubscriptionManager();
      await this.components.subscriptionManager.initialize();
      console.log('Subscription Manager component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Subscription Manager:', error);
      throw error;
    }
  }

  async initializeIAP() {
    try {
      const FitMunchIAP = require('./app_iap_implementation.js');
      this.components.iapManager = new FitMunchIAP();
      await this.components.iapManager.initialize();
      console.log('In-App Purchase component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize In-App Purchases:', error);
      throw error;
    }
  }

  async initializeUserAccountUI() {
    try {
      const UserAccountUI = require('./user_account_ui.js');
      this.components.userAccountUI = new UserAccountUI();
      await this.components.userAccountUI.initialize();
      console.log('User Account UI component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize User Account UI:', error);
      throw error;
    }
  }

  async initializeSubscriptionUI() {
    try {
      // Load subscription UI module
      console.log('Subscription UI component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Subscription UI:', error);
      throw error;
    }
  }

  async initializeMealPlanning() {
    try {
      // Load meal planning module
      console.log('Meal Planning component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Meal Planning:', error);
      throw error;
    }
  }

  async initializeWorkoutTracking() {
    try {
      // Load workout tracking module
      console.log('Workout Tracking component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Workout Tracking:', error);
      throw error;
    }
  }

  async initializeProgressTracking() {
    try {
      // Load progress tracking module
      console.log('Progress Tracking component initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Progress Tracking:', error);
      throw error;
    }
  }

  connectComponents() {
    // Connect user account to subscription manager
    if (this.components.userAccount && this.components.subscriptionManager) {
      this.components.userAccount.setSubscriptionManager(this.components.subscriptionManager);
    }
    
    // Connect IAP to subscription manager
    if (this.components.iapManager && this.components.subscriptionManager) {
      this.components.iapManager.setSubscriptionManager(this.components.subscriptionManager);
    }
    
    // Connect user account to UI
    if (this.components.userAccount && this.components.userAccountUI) {
      this.components.userAccountUI.setUserAccount(this.components.userAccount);
    }
    
    console.log('Components connected successfully');
  }

  async runTests() {
    if (!this.initialized) {
      console.warn('App not initialized, skipping tests');
      return false;
    }
    
    try {
      const testRunner = require('./test_plan.js');
      const result = await testRunner.runTests();
      
      return result;
    } catch (error) {
      console.error('Failed to run tests:', error);
      return false;
    }
  }

  async startApp() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      // Check login status
      const isLoggedIn = await this.components.userAccount.isLoggedIn();
      
      if (isLoggedIn) {
        // Show main app UI
        this.showMainUI();
      } else {
        // Show login/register UI
        this.components.userAccountUI.showLoginForm();
      }
      
      console.log('FitMunch App started successfully!');
      return true;
    } catch (error) {
      console.error('Failed to start FitMunch App:', error);
      return false;
    }
  }

  showMainUI() {
    // Show main app UI
    console.log('Showing main app UI');
    
    // This would depend on your UI structure
    // For example:
    const mainSection = document.getElementById('main-app-section');
    if (mainSection) {
      mainSection.style.display = 'block';
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FitMunchApp;
} else {
  // Make available globally in browser
  window.FitMunchApp = FitMunchApp;
}

// Initialize app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new FitMunchApp();
  app.startApp().catch(error => {
    console.error('Error starting app:', error);
  });
});
