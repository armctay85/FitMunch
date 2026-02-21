
// FitMunch App - Main Application File
// This is the entry point for the FitMunch application

// Import required modules
const FitMunchApp = require('./fitMunch_integration.js');

// Initialize the application
async function initializeApp() {
  try {
    console.log('Starting FitMunch application...');
    
    // Create app instance
    const app = new FitMunchApp();
    
    // Initialize all components
    await app.initialize();
    
    // Run tests in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('Running tests in development mode...');
      await app.runTests();
    }
    
    // Start the application
    await app.startApp();
    
    console.log('FitMunch application started successfully!');
    return app;
  } catch (error) {
    console.error('Failed to initialize FitMunch application:', error);
    // Show error to user
    displayErrorMessage('Failed to start the application. Please try again.');
    return null;
  }
}

// Helper function to display error messages to the user
function displayErrorMessage(message) {
  console.error(message);
  
  // Create error element if it doesn't exist
  let errorElement = document.getElementById('app-error-message');
  
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.id = 'app-error-message';
    errorElement.classList.add('error-message');
    document.body.appendChild(errorElement);
  }
  
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeApp().catch(error => {
    console.error('Unhandled error during app initialization:', error);
    displayErrorMessage('An unexpected error occurred. Please reload the page.');
  });
});

// Handle service worker for offline functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch(error => {
        console.error('ServiceWorker registration failed: ', error);
      });
  });
}

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeApp
  };
}
