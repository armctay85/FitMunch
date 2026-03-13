// User Account Management
// Stub implementation for test compatibility

class UserAccount {
  constructor() {
    this.users = new Map();
  }

  async initialize() {
    console.log('UserAccount initialized');
    return true;
  }

  async register(name, email, password) {
    const userId = `user_${Date.now()}`;
    this.users.set(userId, { name, email, password });
    return { success: true, userId };
  }

  async login(email, password) {
    for (const [id, user] of this.users) {
      if (user.email === email && user.password === password) {
        return { success: true, userId: id };
      }
    }
    return { success: false, error: 'Invalid credentials' };
  }

  async getProfile(userId) {
    const user = this.users.get(userId);
    return user || null;
  }

  async updateProfile(userId, updates) {
    const user = this.users.get(userId);
    if (user) {
      Object.assign(user, updates);
      return { success: true };
    }
    return { success: false, error: 'User not found' };
  }

  async cleanupTestUsers() {
    this.users.clear();
    return true;
  }
}

module.exports = UserAccount;
