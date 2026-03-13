// FitnessConnector for FitMunch App

// Define fitness connectors and integrations for popular fitness apps
const FitnessConnector = {
  connectionStatus: false,
  supportedApps: {
    'Apple Health': { name: 'Apple Health', logo: 'fa-apple', connected: false },
    'Google Fit': { name: 'Google Fit', logo: 'fa-google', connected: false },
    'Fitbit': { name: 'Fitbit', logo: 'fa-heartbeat', connected: false },
    'Garmin': { name: 'Garmin', logo: 'fa-stopwatch', connected: false },
    'Samsung Health': { name: 'Samsung Health', logo: 'fa-mobile-alt', connected: false }
  },

  // Initialize the fitness connector
  initialize: function() {
    console.log('Fitness connector initialized');

    // Check for existing connections in localStorage
    const storedConnections = localStorage.getItem('fitnessConnections');
    if (storedConnections) {
      try {
        const connections = JSON.parse(storedConnections);
        for (const app in connections) {
          if (this.supportedApps[app]) {
            this.supportedApps[app].connected = connections[app].connected || false;
            this.supportedApps[app].lastSync = connections[app].lastSync || null;
          }
        }

        // Update connection status
        this.updateConnectionStatus();
      } catch (e) {
        console.error('Error parsing stored fitness connections:', e);
      }
    }

    // Initialize UI if available
    this.initializeUI();
  },

  // Update the overall connection status
  updateConnectionStatus: function() {
    const hasConnection = Object.values(this.supportedApps).some(app => app.connected);
    this.connectionStatus = hasConnection;

    // Update status in UI if available
    const statusEl = document.getElementById('fitnessConnectionStatus');
    if (statusEl) {
      if (hasConnection) {
        statusEl.innerHTML = `<i class="fas fa-link" style="color: #4CAF50;"></i> Connected to fitness apps`;
      } else {
        statusEl.innerHTML = `<i class="fas fa-unlink" style="color: #777;"></i> No fitness apps connected`;
      }
    }

    return hasConnection;
  },

  // Connect to a fitness app
  connectApp: function(appName, onSuccess, onError) {
    if (!this.supportedApps[appName]) {
      console.error(`Unsupported fitness app: ${appName}`);
      if (onError) onError(`Unsupported fitness app: ${appName}`);
      return false;
    }

    console.log(`Connecting to ${appName}...`);

    // Simulate API connection
    setTimeout(() => {
      // Simulate successful connection
      this.supportedApps[appName].connected = true;
      this.supportedApps[appName].lastSync = new Date().toISOString();

      // Save connections to localStorage
      this.saveConnections();

      // Update status
      this.updateConnectionStatus();

      if (onSuccess) onSuccess(appName);

      // Simulate data retrieval
      if (appName === 'Apple Health' || appName === 'Google Fit' || appName === 'Fitbit') {
        this.fetchActivityData(appName);
      }
    }, 1500);

    return true;
  },

  // Disconnect from a fitness app
  disconnectApp: function(appName, onSuccess, onError) {
    if (!this.supportedApps[appName]) {
      console.error(`Unsupported fitness app: ${appName}`);
      if (onError) onError(`Unsupported fitness app: ${appName}`);
      return false;
    }

    console.log(`Disconnecting from ${appName}...`);

    // Simulate API disconnection
    setTimeout(() => {
      // Simulate successful disconnection
      this.supportedApps[appName].connected = false;

      // Save connections to localStorage
      this.saveConnections();

      // Update status
      this.updateConnectionStatus();

      if (onSuccess) onSuccess(appName);
    }, 1000);

    return true;
  },

  // Save connections to localStorage
  saveConnections: function() {
    const connections = {};
    for (const app in this.supportedApps) {
      connections[app] = {
        connected: this.supportedApps[app].connected,
        lastSync: this.supportedApps[app].lastSync
      };
    }

    localStorage.setItem('fitnessConnections', JSON.stringify(connections));
  },

  // Fetch activity data from a connected app
  fetchActivityData: function(appName) {
    if (!this.supportedApps[appName] || !this.supportedApps[appName].connected) {
      console.error(`App ${appName} is not connected`);
      return null;
    }

    console.log(`Fetching activity data from ${appName}...`);

    // Simulate data retrieval
    const mockData = {
      steps: Math.floor(Math.random() * 5000) + 3000,
      caloriesBurned: Math.floor(Math.random() * 500) + 200,
      activeMinutes: Math.floor(Math.random() * 120) + 30,
      distance: (Math.random() * 5 + 1).toFixed(2)
    };

    // Update daily log
    if (window.dailyLog) {
      window.dailyLog.totalSteps = mockData.steps;

      // Save to localStorage
      localStorage.setItem('dailyLog', JSON.stringify(window.dailyLog));

      // Update UI if available
      const stepsProgress = document.getElementById('stepsProgress');
      if (stepsProgress) {
        const stepsGoal = window.userProfile?.goals?.steps || 10000;
        stepsProgress.textContent = `${mockData.steps}/${stepsGoal}`;

        // Update progress bar
        const stepsProgressBar = document.querySelector('.steps-progress .progress-fill');
        if (stepsProgressBar) {
          const percentage = Math.min(100, (mockData.steps / stepsGoal) * 100);
          stepsProgressBar.style.width = `${percentage}%`;
        }
      }
    }

    return mockData;
  },

  // Initialize the UI for fitness connections
  initializeUI: function() {
    // Populate the connection container if it exists
    const connectionContainer = document.getElementById('fitnessConnectionsContainer');
    if (connectionContainer) {
      let html = '';

      for (const appName in this.supportedApps) {
        const app = this.supportedApps[appName];
        const isConnected = app.connected;
        const lastSync = app.lastSync ? new Date(app.lastSync).toLocaleString() : 'Never';

        html += `
          <div class="connection-card ${isConnected ? 'connected' : ''}">
            <div class="connection-icon">
              <i class="fas ${app.logo}"></i>
            </div>
            <div class="connection-details">
              <h3>${app.name}</h3>
              <p class="connection-status">
                ${isConnected ? 
                  `<span class="status-connected"><i class="fas fa-check-circle"></i> Connected</span>` : 
                  `<span class="status-disconnected"><i class="fas fa-times-circle"></i> Not connected</span>`
                }
              </p>
              ${isConnected ? `<p class="last-sync">Last synced: ${lastSync}</p>` : ''}
            </div>
            <div class="connection-action">
              <button class="connection-btn ${isConnected ? 'disconnect-btn' : 'connect-btn'}" data-app="${appName}">
                ${isConnected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          </div>
        `;
      }

      connectionContainer.innerHTML = html;

      // Add event listeners to buttons
      const buttons = connectionContainer.querySelectorAll('.connection-btn');
      buttons.forEach(button => {
        button.addEventListener('click', (e) => {
          const appName = button.getAttribute('data-app');

          if (button.classList.contains('connect-btn')) {
            // Connect
            button.textContent = 'Connecting...';
            button.disabled = true;

            this.connectApp(appName, () => {
              // Update UI after connection
              const card = button.closest('.connection-card');
              card.classList.add('connected');

              const statusEl = card.querySelector('.connection-status');
              statusEl.innerHTML = `<span class="status-connected"><i class="fas fa-check-circle"></i> Connected</span>`;

              // Add last sync info
              const detailsEl = card.querySelector('.connection-details');
              if (!card.querySelector('.last-sync')) {
                const lastSyncEl = document.createElement('p');
                lastSyncEl.className = 'last-sync';
                lastSyncEl.textContent = `Last synced: ${new Date().toLocaleString()}`;
                detailsEl.appendChild(lastSyncEl);
              } else {
                card.querySelector('.last-sync').textContent = `Last synced: ${new Date().toLocaleString()}`;
              }

              // Update button
              button.textContent = 'Disconnect';
              button.classList.remove('connect-btn');
              button.classList.add('disconnect-btn');
              button.disabled = false;
            });
          } else {
            // Disconnect
            button.textContent = 'Disconnecting...';
            button.disabled = true;

            this.disconnectApp(appName, () => {
              // Update UI after disconnection
              const card = button.closest('.connection-card');
              card.classList.remove('connected');

              const statusEl = card.querySelector('.connection-status');
              statusEl.innerHTML = `<span class="status-disconnected"><i class="fas fa-times-circle"></i> Not connected</span>`;

              // Remove last sync info
              const lastSyncEl = card.querySelector('.last-sync');
              if (lastSyncEl) {
                lastSyncEl.remove();
              }

              // Update button
              button.textContent = 'Connect';
              button.classList.remove('disconnect-btn');
              button.classList.add('connect-btn');
              button.disabled = false;
            });
          }
        });
      });
    }
  }
};

// Initialize the Grok agent
const GrokAgent = {
  initialized: false,

  initialize: function() {
    console.log("Initializing Grok Agent for fitness data analysis...");
    this.initialized = true;
  },

  isInitialized: function() {
    return this.initialized;
  },

  analyzeActivityTrends: function(data, days = 30) {
    // This would analyze activity data for trends in a real implementation
    return {
      trends: {
        stepsIncreasing: Math.random() > 0.5,
        caloriesBurned: Math.random() > 0.5 ? 'increasing' : 'decreasing',
        activeMinutes: Math.random() > 0.5 ? 'consistent' : 'variable'
      },
      recommendations: [
        'Try to increase your step count by 500 steps each day',
        'Consider adding more active minutes in the afternoon',
        'Your activity pattern shows good consistency on weekdays'
      ]
    };
  },

  recommendOptimalWorkoutTimes: function(userData) {
    // This would recommend optimal workout times based on user data
    const times = ['Morning (6-9)', 'Mid-morning (9-12)', 'Afternoon (12-5)', 'Evening (5-8)', 'Night (8-11)'];
    return {
      primaryRecommendation: times[Math.floor(Math.random() * times.length)],
      secondaryRecommendation: times[Math.floor(Math.random() * times.length)],
      reasoning: 'Based on your activity patterns and calendar availability'
    };
  }
};

function initializeGrokAgent() {
  GrokAgent.initialize();
}

// Initialize if the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Initialize Fitness Connector
  if (typeof FitnessConnector === 'object' && FitnessConnector.initialize) {
    FitnessConnector.initialize();
  }

  // Initialize Grok Agent
  initializeGrokAgent();
});