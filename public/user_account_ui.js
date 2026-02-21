
// User Account UI Implementation for FitMunch
// Handles the UI components for account management

class UserAccountUI {
  constructor() {
    this.userAccount = null;
    this.loginForm = null;
    this.registerForm = null;
    this.accountSection = null;
    this.profileSection = null;
  }

  async initialize() {
    try {
      // Get reference to UserAccount implementation
      const UserAccount = require('./user_account.js');
      this.userAccount = new UserAccount();
      await this.userAccount.initialize();
      
      // Get references to DOM elements
      this.setupDOMReferences();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Check if user is already logged in
      await this.checkLoginStatus();
      
      console.log('User Account UI initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize User Account UI:', error);
      return false;
    }
  }

  setupDOMReferences() {
    // Login form
    this.loginForm = document.getElementById('login-form');
    
    // Register form
    this.registerForm = document.getElementById('register-form');
    
    // Account section
    this.accountSection = document.getElementById('account-section');
    
    // Profile section
    this.profileSection = document.getElementById('profile-section');
    
    // Create forms if they don't exist
    if (!this.loginForm) {
      this.createLoginForm();
    }
    
    if (!this.registerForm) {
      this.createRegisterForm();
    }
    
    if (!this.accountSection) {
      this.createAccountSection();
    }
    
    if (!this.profileSection) {
      this.createProfileSection();
    }
  }

  createLoginForm() {
    const form = document.createElement('form');
    form.id = 'login-form';
    form.classList.add('auth-form');
    form.innerHTML = `
      <h2>Login to FitMunch</h2>
      <div class="form-group">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" required>
      </div>
      <div class="form-group">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" required>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Login</button>
        <button type="button" id="forgot-password-btn" class="btn-link">Forgot Password?</button>
      </div>
      <div class="social-login">
        <p>Or login with:</p>
        <button type="button" id="google-login-btn" class="btn-social">Google</button>
        <button type="button" id="apple-login-btn" class="btn-social">Apple</button>
      </div>
      <p class="form-toggle">Don't have an account? <a href="#" id="show-register">Register</a></p>
    `;
    
    document.body.appendChild(form);
    this.loginForm = form;
    this.hideElement(this.loginForm);
  }

  createRegisterForm() {
    const form = document.createElement('form');
    form.id = 'register-form';
    form.classList.add('auth-form');
    form.innerHTML = `
      <h2>Create FitMunch Account</h2>
      <div class="form-group">
        <label for="register-name">Full Name</label>
        <input type="text" id="register-name" required>
      </div>
      <div class="form-group">
        <label for="register-email">Email</label>
        <input type="email" id="register-email" required>
      </div>
      <div class="form-group">
        <label for="register-password">Password</label>
        <input type="password" id="register-password" required>
      </div>
      <div class="form-group">
        <label for="register-confirm-password">Confirm Password</label>
        <input type="password" id="register-confirm-password" required>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Register</button>
      </div>
      <div class="social-register">
        <p>Or register with:</p>
        <button type="button" id="google-register-btn" class="btn-social">Google</button>
        <button type="button" id="apple-register-btn" class="btn-social">Apple</button>
      </div>
      <p class="form-toggle">Already have an account? <a href="#" id="show-login">Login</a></p>
    `;
    
    document.body.appendChild(form);
    this.registerForm = form;
    this.hideElement(this.registerForm);
  }

  createAccountSection() {
    const section = document.createElement('div');
    section.id = 'account-section';
    section.classList.add('section', 'account-section');
    section.innerHTML = `
      <h2>Your Account</h2>
      <div class="account-overview">
        <div class="user-info">
          <div class="avatar-container">
            <img src="https://via.placeholder.com/150" alt="Profile" class="user-avatar">
            <button class="edit-avatar-btn">Change</button>
          </div>
          <div class="user-details">
            <h3 id="user-name">User Name</h3>
            <p id="user-email">user@example.com</p>
            <p id="account-type">Free Plan</p>
          </div>
        </div>
        <div class="account-actions">
          <button id="edit-profile-btn" class="btn-secondary">Edit Profile</button>
          <button id="subscription-btn" class="btn-primary">Manage Subscription</button>
          <button id="sync-data-btn" class="btn-secondary">Sync Data</button>
          <button id="logout-btn" class="btn-link">Logout</button>
        </div>
      </div>
      <div class="account-stats">
        <h3>Your Stats</h3>
        <div class="stats-grid">
          <div class="stat-box">
            <span class="stat-count" id="workout-count">0</span>
            <span class="stat-label">Workouts</span>
          </div>
          <div class="stat-box">
            <span class="stat-count" id="meal-count">0</span>
            <span class="stat-label">Meals</span>
          </div>
          <div class="stat-box">
            <span class="stat-count" id="recipe-count">0</span>
            <span class="stat-label">Recipes</span>
          </div>
          <div class="stat-box">
            <span class="stat-count" id="days-active">0</span>
            <span class="stat-label">Days Active</span>
          </div>
        </div>
      </div>
      <div class="data-management">
        <h3>Data Management</h3>
        <div class="data-actions">
          <button id="export-data-btn" class="btn-secondary">Export Data</button>
          <button id="delete-account-btn" class="btn-danger">Delete Account</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(section);
    this.accountSection = section;
    this.hideElement(this.accountSection);
  }

  createProfileSection() {
    const section = document.createElement('div');
    section.id = 'profile-section';
    section.classList.add('section', 'profile-section');
    section.innerHTML = `
      <h2>Edit Profile</h2>
      <form id="profile-form">
        <div class="form-group">
          <label for="profile-name">Full Name</label>
          <input type="text" id="profile-name" required>
        </div>
        <div class="form-group">
          <label for="profile-email">Email</label>
          <input type="email" id="profile-email" required>
        </div>
        <div class="form-group">
          <label for="profile-age">Age</label>
          <input type="number" id="profile-age" min="1" max="120">
        </div>
        <div class="form-group">
          <label for="profile-height">Height (cm)</label>
          <input type="number" id="profile-height" min="50" max="250">
        </div>
        <div class="form-group">
          <label for="profile-weight">Weight (kg)</label>
          <input type="number" id="profile-weight" min="30" max="300">
        </div>
        <div class="form-group">
          <label for="profile-goal">Fitness Goal</label>
          <select id="profile-goal">
            <option value="lose-weight">Lose Weight</option>
            <option value="build-muscle">Build Muscle</option>
            <option value="improve-fitness">Improve Fitness</option>
            <option value="maintain">Maintain</option>
          </select>
        </div>
        <div class="form-group">
          <label for="profile-activity">Activity Level</label>
          <select id="profile-activity">
            <option value="sedentary">Sedentary</option>
            <option value="light">Lightly Active</option>
            <option value="moderate">Moderately Active</option>
            <option value="very">Very Active</option>
            <option value="extreme">Extremely Active</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Save Changes</button>
          <button type="button" id="cancel-profile-edit" class="btn-secondary">Cancel</button>
        </div>
      </form>
    `;
    
    document.body.appendChild(section);
    this.profileSection = section;
    this.hideElement(this.profileSection);
  }

  setupEventHandlers() {
    // Login form
    if (this.loginForm) {
      this.loginForm.addEventListener('submit', this.handleLogin.bind(this));
      const showRegisterLink = this.loginForm.querySelector('#show-register');
      if (showRegisterLink) {
        showRegisterLink.addEventListener('click', this.showRegisterForm.bind(this));
      }
      
      const forgotPasswordBtn = this.loginForm.querySelector('#forgot-password-btn');
      if (forgotPasswordBtn) {
        forgotPasswordBtn.addEventListener('click', this.handleForgotPassword.bind(this));
      }
      
      const googleLoginBtn = this.loginForm.querySelector('#google-login-btn');
      if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', this.handleGoogleLogin.bind(this));
      }
      
      const appleLoginBtn = this.loginForm.querySelector('#apple-login-btn');
      if (appleLoginBtn) {
        appleLoginBtn.addEventListener('click', this.handleAppleLogin.bind(this));
      }
    }
    
    // Register form
    if (this.registerForm) {
      this.registerForm.addEventListener('submit', this.handleRegister.bind(this));
      const showLoginLink = this.registerForm.querySelector('#show-login');
      if (showLoginLink) {
        showLoginLink.addEventListener('click', this.showLoginForm.bind(this));
      }
      
      const googleRegisterBtn = this.registerForm.querySelector('#google-register-btn');
      if (googleRegisterBtn) {
        googleRegisterBtn.addEventListener('click', this.handleGoogleRegister.bind(this));
      }
      
      const appleRegisterBtn = this.registerForm.querySelector('#apple-register-btn');
      if (appleRegisterBtn) {
        appleRegisterBtn.addEventListener('click', this.handleAppleRegister.bind(this));
      }
    }
    
    // Account section
    if (this.accountSection) {
      const editProfileBtn = this.accountSection.querySelector('#edit-profile-btn');
      if (editProfileBtn) {
        editProfileBtn.addEventListener('click', this.showProfileSection.bind(this));
      }
      
      const subscriptionBtn = this.accountSection.querySelector('#subscription-btn');
      if (subscriptionBtn) {
        subscriptionBtn.addEventListener('click', this.showSubscriptions.bind(this));
      }
      
      const syncDataBtn = this.accountSection.querySelector('#sync-data-btn');
      if (syncDataBtn) {
        syncDataBtn.addEventListener('click', this.handleSyncData.bind(this));
      }
      
      const logoutBtn = this.accountSection.querySelector('#logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', this.handleLogout.bind(this));
      }
      
      const exportDataBtn = this.accountSection.querySelector('#export-data-btn');
      if (exportDataBtn) {
        exportDataBtn.addEventListener('click', this.handleExportData.bind(this));
      }
      
      const deleteAccountBtn = this.accountSection.querySelector('#delete-account-btn');
      if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', this.handleDeleteAccount.bind(this));
      }
    }
    
    // Profile section
    if (this.profileSection) {
      const profileForm = this.profileSection.querySelector('#profile-form');
      if (profileForm) {
        profileForm.addEventListener('submit', this.handleProfileUpdate.bind(this));
      }
      
      const cancelProfileEdit = this.profileSection.querySelector('#cancel-profile-edit');
      if (cancelProfileEdit) {
        cancelProfileEdit.addEventListener('click', this.hideProfileSection.bind(this));
      }
    }
  }

  async checkLoginStatus() {
    try {
      const isLoggedIn = await this.userAccount.isLoggedIn();
      
      if (isLoggedIn) {
        await this.updateAccountUI();
        this.showAccountSection();
      } else {
        this.showLoginForm();
      }
    } catch (error) {
      console.error('Error checking login status:', error);
      this.showLoginForm();
    }
  }

  async updateAccountUI() {
    try {
      const user = await this.userAccount.getCurrentUser();
      
      if (user) {
        // Update account section
        const userNameElement = this.accountSection.querySelector('#user-name');
        if (userNameElement) {
          userNameElement.textContent = user.name || 'User';
        }
        
        const userEmailElement = this.accountSection.querySelector('#user-email');
        if (userEmailElement) {
          userEmailElement.textContent = user.email || 'No email';
        }
        
        const accountTypeElement = this.accountSection.querySelector('#account-type');
        if (accountTypeElement) {
          accountTypeElement.textContent = user.subscriptionType || 'Free Plan';
        }
        
        // Update profile section
        const profileNameInput = this.profileSection.querySelector('#profile-name');
        if (profileNameInput) {
          profileNameInput.value = user.name || '';
        }
        
        const profileEmailInput = this.profileSection.querySelector('#profile-email');
        if (profileEmailInput) {
          profileEmailInput.value = user.email || '';
        }
        
        const profileAgeInput = this.profileSection.querySelector('#profile-age');
        if (profileAgeInput) {
          profileAgeInput.value = user.age || '';
        }
        
        const profileHeightInput = this.profileSection.querySelector('#profile-height');
        if (profileHeightInput) {
          profileHeightInput.value = user.height || '';
        }
        
        const profileWeightInput = this.profileSection.querySelector('#profile-weight');
        if (profileWeightInput) {
          profileWeightInput.value = user.weight || '';
        }
        
        const profileGoalSelect = this.profileSection.querySelector('#profile-goal');
        if (profileGoalSelect && user.fitnessGoal) {
          profileGoalSelect.value = user.fitnessGoal;
        }
        
        const profileActivitySelect = this.profileSection.querySelector('#profile-activity');
        if (profileActivitySelect && user.activityLevel) {
          profileActivitySelect.value = user.activityLevel;
        }
      }
    } catch (error) {
      console.error('Error updating account UI:', error);
    }
  }

  // UI control methods
  showLoginForm() {
    this.hideElement(this.registerForm);
    this.hideElement(this.accountSection);
    this.hideElement(this.profileSection);
    this.showElement(this.loginForm);
  }

  showRegisterForm() {
    this.hideElement(this.loginForm);
    this.hideElement(this.accountSection);
    this.hideElement(this.profileSection);
    this.showElement(this.registerForm);
  }

  showAccountSection() {
    this.hideElement(this.loginForm);
    this.hideElement(this.registerForm);
    this.hideElement(this.profileSection);
    this.showElement(this.accountSection);
  }

  showProfileSection() {
    this.hideElement(this.loginForm);
    this.hideElement(this.registerForm);
    this.hideElement(this.accountSection);
    this.showElement(this.profileSection);
  }

  hideProfileSection() {
    this.hideElement(this.profileSection);
    this.showAccountSection();
  }

  showElement(element) {
    if (element) {
      element.style.display = 'block';
    }
  }

  hideElement(element) {
    if (element) {
      element.style.display = 'none';
    }
  }

  // Event handlers
  async handleLogin(event) {
    event.preventDefault();
    
    const emailInput = this.loginForm.querySelector('#login-email');
    const passwordInput = this.loginForm.querySelector('#login-password');
    
    if (emailInput && passwordInput) {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      
      try {
        const result = await this.userAccount.login(email, password);
        
        if (result.success) {
          await this.updateAccountUI();
          this.showAccountSection();
        } else {
          alert(result.error || 'Login failed. Please try again.');
        }
      } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login. Please try again.');
      }
    }
  }

  async handleRegister(event) {
    event.preventDefault();
    
    const nameInput = this.registerForm.querySelector('#register-name');
    const emailInput = this.registerForm.querySelector('#register-email');
    const passwordInput = this.registerForm.querySelector('#register-password');
    const confirmPasswordInput = this.registerForm.querySelector('#register-confirm-password');
    
    if (nameInput && emailInput && passwordInput && confirmPasswordInput) {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const confirmPassword = confirmPasswordInput.value;
      
      if (password !== confirmPassword) {
        alert('Passwords do not match.');
        return;
      }
      
      try {
        const result = await this.userAccount.register(name, email, password);
        
        if (result.success) {
          await this.updateAccountUI();
          this.showAccountSection();
        } else {
          alert(result.error || 'Registration failed. Please try again.');
        }
      } catch (error) {
        console.error('Registration error:', error);
        alert('An error occurred during registration. Please try again.');
      }
    }
  }

  async handleForgotPassword() {
    const emailInput = this.loginForm.querySelector('#login-email');
    
    if (emailInput) {
      const email = emailInput.value.trim();
      
      if (!email) {
        alert('Please enter your email address.');
        return;
      }
      
      try {
        const result = await this.userAccount.resetPassword(email);
        
        if (result.success) {
          alert('Password reset instructions have been sent to your email.');
        } else {
          alert(result.error || 'Failed to send password reset email. Please try again.');
        }
      } catch (error) {
        console.error('Forgot password error:', error);
        alert('An error occurred while requesting password reset. Please try again.');
      }
    }
  }

  async handleGoogleLogin() {
    try {
      const result = await this.userAccount.loginWithGoogle();
      
      if (result.success) {
        await this.updateAccountUI();
        this.showAccountSection();
      } else {
        alert(result.error || 'Google login failed. Please try again.');
      }
    } catch (error) {
      console.error('Google login error:', error);
      alert('An error occurred during Google login. Please try again.');
    }
  }

  async handleAppleLogin() {
    try {
      const result = await this.userAccount.loginWithApple();
      
      if (result.success) {
        await this.updateAccountUI();
        this.showAccountSection();
      } else {
        alert(result.error || 'Apple login failed. Please try again.');
      }
    } catch (error) {
      console.error('Apple login error:', error);
      alert('An error occurred during Apple login. Please try again.');
    }
  }

  async handleGoogleRegister() {
    try {
      const result = await this.userAccount.registerWithGoogle();
      
      if (result.success) {
        await this.updateAccountUI();
        this.showAccountSection();
      } else {
        alert(result.error || 'Google registration failed. Please try again.');
      }
    } catch (error) {
      console.error('Google registration error:', error);
      alert('An error occurred during Google registration. Please try again.');
    }
  }

  async handleAppleRegister() {
    try {
      const result = await this.userAccount.registerWithApple();
      
      if (result.success) {
        await this.updateAccountUI();
        this.showAccountSection();
      } else {
        alert(result.error || 'Apple registration failed. Please try again.');
      }
    } catch (error) {
      console.error('Apple registration error:', error);
      alert('An error occurred during Apple registration. Please try again.');
    }
  }

  async handleProfileUpdate(event) {
    event.preventDefault();
    
    const nameInput = this.profileSection.querySelector('#profile-name');
    const emailInput = this.profileSection.querySelector('#profile-email');
    const ageInput = this.profileSection.querySelector('#profile-age');
    const heightInput = this.profileSection.querySelector('#profile-height');
    const weightInput = this.profileSection.querySelector('#profile-weight');
    const goalSelect = this.profileSection.querySelector('#profile-goal');
    const activitySelect = this.profileSection.querySelector('#profile-activity');
    
    if (nameInput && emailInput) {
      const profile = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        age: ageInput ? ageInput.value : null,
        height: heightInput ? heightInput.value : null,
        weight: weightInput ? weightInput.value : null,
        fitnessGoal: goalSelect ? goalSelect.value : null,
        activityLevel: activitySelect ? activitySelect.value : null
      };
      
      try {
        const result = await this.userAccount.updateProfile(profile);
        
        if (result.success) {
          await this.updateAccountUI();
          this.showAccountSection();
          alert('Profile updated successfully.');
        } else {
          alert(result.error || 'Failed to update profile. Please try again.');
        }
      } catch (error) {
        console.error('Profile update error:', error);
        alert('An error occurred while updating profile. Please try again.');
      }
    }
  }

  async handleLogout() {
    try {
      const result = await this.userAccount.logout();
      
      if (result.success) {
        this.showLoginForm();
      } else {
        alert(result.error || 'Logout failed. Please try again.');
      }
    } catch (error) {
      console.error('Logout error:', error);
      alert('An error occurred during logout. Please try again.');
    }
  }

  async handleSyncData() {
    try {
      const result = await this.userAccount.syncData();
      
      if (result.success) {
        alert('Data synced successfully.');
      } else {
        alert(result.error || 'Data sync failed. Please try again.');
      }
    } catch (error) {
      console.error('Data sync error:', error);
      alert('An error occurred during data sync. Please try again.');
    }
  }

  async handleExportData() {
    try {
      const result = await this.userAccount.exportData();
      
      if (result.success) {
        // Create download link for exported data
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.data));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "fitmunch_data.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
      } else {
        alert(result.error || 'Data export failed. Please try again.');
      }
    } catch (error) {
      console.error('Data export error:', error);
      alert('An error occurred during data export. Please try again.');
    }
  }

  async handleDeleteAccount() {
    const confirmed = confirm('Are you sure you want to delete your account? This action cannot be undone.');
    
    if (confirmed) {
      try {
        const result = await this.userAccount.deleteAccount();
        
        if (result.success) {
          alert('Your account has been deleted.');
          this.showLoginForm();
        } else {
          alert(result.error || 'Account deletion failed. Please try again.');
        }
      } catch (error) {
        console.error('Account deletion error:', error);
        alert('An error occurred during account deletion. Please try again.');
      }
    }
  }

  showSubscriptions() {
    // Show subscription management UI
    alert('Subscription management UI will be shown here.');
    // This would typically navigate to or display the subscription UI component
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UserAccountUI;
} else {
  // Make available globally in browser
  window.UserAccountUI = UserAccountUI;
}
