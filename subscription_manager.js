// Subscription Manager
// Handles user subscriptions and billing

class SubscriptionManager {
  constructor() {
    this.subscriptions = new Map();
  }

  async createSubscription(userId, planId, paymentMethod) {
    const subscriptionId = `sub_${Date.now()}`;
    this.subscriptions.set(subscriptionId, {
      userId,
      planId,
      paymentMethod,
      status: 'active',
      createdAt: new Date()
    });
    return { success: true, subscriptionId };
  }

  async getSubscription(subscriptionId) {
    return this.subscriptions.get(subscriptionId) || null;
  }

  async cancelSubscription(subscriptionId) {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.status = 'cancelled';
      return { success: true };
    }
    return { success: false, error: 'Subscription not found' };
  }

  async renewSubscription(subscriptionId) {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.status = 'active';
      sub.renewedAt = new Date();
      return { success: true };
    }
    return { success: false, error: 'Subscription not found' };
  }

  async getActiveSubscriptions(userId) {
    const userSubs = [];
    for (const [id, sub] of this.subscriptions) {
      if (sub.userId === userId && sub.status === 'active') {
        userSubs.push({ id, ...sub });
      }
    }
    return userSubs;
  }
}

module.exports = SubscriptionManager;
