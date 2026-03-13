// User Account Management for FitMunch
// Handles user registration, authentication, and profile management

class UserAccount {
  constructor() {
    this.currentUser = null;
    this.authToken = null;
    this.initialized = false;
    this.userProfiles = {};
    this.authProvider = null;
    this.serverUrl = 'https://api.fitmunch.app'; // Will be configured based on environment
    this.localStorageKey = 'fitmunch_user_data';
    this.listeners = [];
  }

  async initialize() {
    console.log("Initializing user account system...");

    try {
      // Load user data from local storage if available
      this.loadUserFromStorage();

      // Check if token is still valid
      if (this.authToken) {
        const isValid = await this.validateToken();
        if (!isValid) {
          this.logout(false);
        }
      }

      this.initialized = true;
      this.notifyListeners({type: 'init', user: this.currentUser});
      console.log("User account system initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize user account system:", error);
      return false;
    }
  }

  // Register a new user
  async register(name, email, password) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Validate input
      if (!name || !email || !password) {
        throw new Error("All fields are required");
      }

      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }

      if (!this.isValidEmail(email)) {
        throw new Error("Invalid email format");
      }

      // Create user - in a real implementation, this would call an API
      // For demo, we'll create a local user
      const userId = 'user_' + Date.now();
      const userData = {
        id: userId,
        name: name,
        email: email,
        createdAt: new Date().toISOString(),
        preferences: {
          theme: 'light',
          notifications: true,
          units: 'metric'
        },
        subscription: {
          plan: 'free',
          expiresAt: null
        }
      };

      // Store user data
      this.userProfiles[userId] = userData;

      // Generate auth token
      this.authToken = 'token_' + Date.now();

      // Set current user
      this.currentUser = userData;

      // Store in local storage
      this.saveUserToStorage();

      // Notify listeners
      this.notifyListeners({type: 'register', user: userData});

      console.log(`User registered successfully: ${name} (${email})`);

      return {
        success: true,
        user: userData
      };
    } catch (error) {
      console.error("Registration failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Login with email and password
  async login(email, password) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Validate input
      if (!email || !password) {
        throw new Error("Email and password are required");
      }

      // In a real implementation, this would validate against an API
      // For demo, we'll check local storage
      const userId = Object.keys(this.userProfiles).find(
        id => this.userProfiles[id].email === email
      );

      if (!userId) {
        throw new Error("User not found");
      }

      // In a real implementation, this would verify the password
      // For demo, we'll assume it's correct

      // Set current user
      this.currentUser = this.userProfiles[userId];

      // Generate auth token
      this.authToken = 'token_' + Date.now();

      // Store in local storage
      this.saveUserToStorage();

      // Notify listeners
      this.notifyListeners({type: 'login', user: this.currentUser});

      console.log(`User logged in: ${this.currentUser.name}`);

      return {
        success: true,
        user: this.currentUser
      };
    } catch (error) {
      console.error("Login failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Log in with Google
  async loginWithGoogle() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // In a real implementation, this would integrate with Google Sign-In
      console.log("Initiating Google Sign-In...");

      // Simulate Google Sign-In process
      const googleUser = {
        id: 'google_' + Date.now(),
        name: 'Google User',
        email: 'google_user@example.com',
        profile: 'https://example.com/profile.jpg'
      };

      // Check if user already exists
      let userId = Object.keys(this.userProfiles).find(
        id => this.userProfiles[id].email === googleUser.email
      );

      if (!userId) {
        // Create new user if not exists
        userId = 'user_' + Date.now();
        this.userProfiles[userId] = {
          id: userId,
          name: googleUser.name,
          email: googleUser.email,
          profilePicture: googleUser.profile,
          googleId: googleUser.id,
          createdAt: new Date().toISOString(),
          preferences: {
            theme: 'light',
            notifications: true,
            units: 'metric'
          },
          subscription: {
            plan: 'free',
            expiresAt: null
          }
        };
      }

      // Set current user
      this.currentUser = this.userProfiles[userId];
      this.authProvider = 'google';

      // Generate auth token
      this.authToken = 'google_token_' + Date.now();

      // Store in local storage
      this.saveUserToStorage();

      // Notify listeners
      this.notifyListeners({type: 'login', provider: 'google', user: this.currentUser});

      console.log(`User logged in with Google: ${this.currentUser.name}`);

      return {
        success: true,
        user: this.currentUser
      };
    } catch (error) {
      console.error("Google login failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Logout
  logout(notifyServer = true) {
    if (notifyServer && this.authToken) {
      // In a real implementation, this would notify the server
      console.log("Notifying server about logout...");
    }

    // Clear user data
    this.currentUser = null;
    this.authToken = null;
    this.authProvider = null;

    // Clear from local storage
    localStorage.removeItem(this.localStorageKey);

    // Notify listeners
    this.notifyListeners({type: 'logout'});

    console.log("User logged out");

    return {
      success: true
    };
  }

  // Update user profile
  async updateProfile(updates) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentUser) {
      return {
        success: false,
        error: "User not logged in"
      };
    }

    try {
      // Update user data
      this.currentUser = {
        ...this.currentUser,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      // Update in user profiles
      this.userProfiles[this.currentUser.id] = this.currentUser;

      // Store in local storage
      this.saveUserToStorage();

      // Notify listeners
      this.notifyListeners({type: 'profile_update', user: this.currentUser});

      console.log("User profile updated");

      return {
        success: true,
        user: this.currentUser
      };
    } catch (error) {
      console.error("Profile update failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update user preferences
  async updatePreferences(preferences) {
    if (!this.currentUser) {
      return {
        success: false,
        error: "User not logged in"
      };
    }

    try {
      // Update preferences
      this.currentUser.preferences = {
        ...this.currentUser.preferences,
        ...preferences
      };

      // Update in user profiles
      this.userProfiles[this.currentUser.id] = this.currentUser;

      // Store in local storage
      this.saveUserToStorage();

      // Notify listeners
      this.notifyListeners({type: 'preferences_update', user: this.currentUser});

      console.log("User preferences updated");

      return {
        success: true,
        preferences: this.currentUser.preferences
      };
    } catch (error) {
      console.error("Preferences update failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check if user is logged in
  isLoggedIn() {
    return !!this.currentUser;
  }

  // Get current user
  getCurrentUser() {
    return this.currentUser;
  }

  // Get user subscription info
  getSubscription() {
    if (!this.currentUser) {
      return null;
    }

    return this.currentUser.subscription;
  }

  // Validate auth token
  async validateToken() {
    // In a real implementation, this would verify the token with the server
    // For demo, we'll assume tokens expire after 1 hour
    if (!this.authToken) {
      return false;
    }

    const tokenTimeStr = this.authToken.split('_')[1];
    if (!tokenTimeStr) {
      return false;
    }

    const tokenTime = parseInt(tokenTimeStr);
    const currentTime = Date.now();
    const oneHour = 60 * 60 * 1000;

    return (currentTime - tokenTime) < oneHour;
  }

  // Reset password (request)
  async requestPasswordReset(email) {
    if (!email || !this.isValidEmail(email)) {
      return {
        success: false,
        error: "Valid email is required"
      };
    }

    try {
      // In a real implementation, this would send a reset email
      console.log(`Password reset requested for: ${email}`);

      return {
        success: true,
        message: `Password reset link sent to ${email}`
      };
    } catch (error) {
      console.error("Password reset request failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Reset password (confirm)
  async resetPassword(resetToken, newPassword) {
    if (!resetToken || !newPassword || newPassword.length < 8) {
      return {
        success: false,
        error: "Valid token and new password (min 8 chars) required"
      };
    }

    try {
      // In a real implementation, this would verify the token and update the password
      console.log("Password reset successful");

      return {
        success: true,
        message: "Password has been reset successfully"
      };
    } catch (error) {
      console.error("Password reset failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Sync user data with server
  async syncUserData() {
    if (!this.currentUser) {
      return {
        success: false,
        error: "User not logged in"
      };
    }

    try {
      // In a real implementation, this would sync data with the server
      console.log("Syncing user data with server...");

      return {
        success: true,
        message: "User data synced successfully"
      };
    } catch (error) {
      console.error("Data sync failed:", error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Save user to local storage
  saveUserToStorage() {
    if (!this.currentUser) {
      localStorage.removeItem(this.localStorageKey);
      return;
    }

    const userData = {
      user: this.currentUser,
      token: this.authToken,
      provider: this.authProvider,
      timestamp: Date.now()
    };

    localStorage.setItem(this.localStorageKey, JSON.stringify(userData));
  }

  // Load user from local storage
  loadUserFromStorage() {
    const userDataStr = localStorage.getItem(this.localStorageKey);
    if (!userDataStr) {
      return;
    }

    try {
      const userData = JSON.parse(userDataStr);
      this.currentUser = userData.user;
      this.authToken = userData.token;
      this.authProvider = userData.provider;

      // Ensure user profile is in memory
      if (this.currentUser && this.currentUser.id) {
        this.userProfiles[this.currentUser.id] = this.currentUser;
      }

      console.log(`User loaded from storage: ${this.currentUser?.name}`);
    } catch (error) {
      console.error("Failed to load user from storage:", error);
      this.currentUser = null;
      this.authToken = null;
      this.authProvider = null;
    }
  }

  // Validate email format
  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // Add event listener
  addEventListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
      return true;
    }
    return false;
  }

  // Remove event listener
  removeEventListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index !== -1) {
      this.listeners.splice(index, 1);
      return true;
    }
    return false;
  }

  // Notify all listeners
  notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in user account event listener:", error);
      }
    });
  }
}

// Create singleton instance
const userAccount = new UserAccount();

// Export for different environments
if (typeof window !== 'undefined') {
  window.userAccount = userAccount;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = userAccount;
}