// FitMunch Subscription Manager

class SubscriptionManager {
  constructor() {
    this.subscriptions = [];
    this.initialized = false;
    this.plans = {};
    this.discountPromotions = [];
  }

  async initialize() {
    console.log("Initializing subscription manager...");

    if (this.initialized) {
      console.warn("Subscription manager already initialized");
      return true;
    }

    try {
      // Set up default plans
      this.setupPlans();

      // Load user subscription
      this.loadUserSubscription();

      // Set up discount promotions
      this.setupDiscountPromotions();

      this.initialized = true;
      console.log("Subscription manager initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize subscription manager:", error);
      return false;
    }
  }

  // Set up default plans
  setupPlans() {
    this.plans = {
      free: {
        name: "Free",
        price: 0,
        monthlyPrice: 0,
        annualPrice: 0,
        features: [
          "Basic meal plans",
          "Simple workout tracking",
          "Limited recipe database",
          "Basic progress tracking"
        ],
        limitedFeatures: [
          "No meal plan export",
          "No detailed analytics",
          "No custom workouts",
          "Limited recipe database"
        ],
        color: "#004225" // British Racing Green
      },
      basic: {
        name: "Basic",
        price: 5.99,
        monthlyPrice: 5.99,
        annualPrice: 59.99, // ~$5/month, 17% discount
        features: [
          "Advanced meal plans",
          "Detailed workout tracking",
          "Full recipe database",
          "Progress tracking with charts",
          "Shopping list generation"
        ],
        limitedFeatures: [
          "No custom meal plans",
          "No barcode scanner",
          "Limited analytics"
        ],
        color: "#004225" // British Racing Green
      },
      premium: {
        name: "Premium",
        price: 12.99,
        monthlyPrice: 12.99,
        annualPrice: 129.99, // ~$10.83/month, 17% discount
        features: [
          "Everything in Basic",
          "Custom meal plans",
          "Barcode scanner for food logging",
          "Advanced analytics",
          "Body measurement tracking",
          "Exportable data"
        ],
        limitedFeatures: [
          "No AI recommendations",
          "No premium recipes"
        ],
        color: "#004225" // British Racing Green
      },
      proCoach: {
        name: "Pro Coach",
        price: 29.99,
        monthlyPrice: 29.99,
        annualPrice: 299.99, // ~$25/month, 17% discount
        features: [
          "Everything in Premium",
          "AI-powered recommendations",
          "Premium recipe collection",
          "Priority support",
          "Early access to new features",
          "No advertising"
        ],
        limitedFeatures: [],
        color: "#004225" // British Racing Green
      }
    };
  }

  // Set up discount promotions
  setupDiscountPromotions() {
    this.discountPromotions = [
      {
        id: 'annual_discount',
        name: 'Annual Subscription Discount',
        description: 'Save up to 17% with an annual subscription',
        eligible: true,
        discountType: 'annual',
        active: true
      },
      {
        id: 'new_user_welcome',
        name: 'New User Welcome Offer',
        description: 'Get 20% off your first month',
        eligible: this.isNewUser(),
        discountType: 'percentage',
        discountValue: 20,
        durationMonths: 1,
        promocode: 'WELCOME20',
        active: true
      },
      {
        id: 'win_back',
        name: 'Special Return Offer',
        description: 'Return to FitMunch and save 30% for 3 months',
        eligible: this.isFormerSubscriber(),
        discountType: 'percentage',
        discountValue: 30,
        durationMonths: 3,
        promocode: 'WELCOME30',
        active: true
      },
      {
        id: 'streak_reward',
        name: 'Challenge Streak Reward',
        description: 'Complete a 7-day streak and get 15% off',
        eligible: this.hasCompletedStreak(7),
        discountType: 'percentage',
        discountValue: 15,
        durationMonths: 1,
        promocode: 'STREAK15',
        active: true
      }
    ];
  }

  async connectToPaymentGateway() {
    // Simulate connection to payment gateway
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Connected to payment gateway');
        resolve(true);
      }, 500);
    });
  }

  async getActivePlan(userId) {
    if (!this.initialized) {
      await this.initialize();
    }

    const subscription = this.subscriptions.find(sub => sub.userId === userId);
    return subscription ? subscription.planId : 'free';
  }

  async purchaseSubscription(userId, planId) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Validate plan
    if (!this.plans[planId]) {
      throw new Error(`Invalid plan: ${planId}`);
    }

    // Process payment (would connect to payment processor in production)
    const paymentSuccess = await this.processPayment(userId, planId);

    if (paymentSuccess) {
      // Add or update subscription
      const existingSubIndex = this.subscriptions.findIndex(sub => sub.userId === userId);

      const newSubscription = {
        userId,
        planId,
        startDate: new Date().toISOString(),
        endDate: this.calculateEndDate(30), // 30 days subscription
        status: 'active'
      };

      if (existingSubIndex >= 0) {
        this.subscriptions[existingSubIndex] = newSubscription;
      } else {
        this.subscriptions.push(newSubscription);
      }

      // Save to storage
      localStorage.setItem('subscriptions', JSON.stringify(this.subscriptions));

      return true;
    }

    return false;
  }

  async cancelSubscription(userId) {
    if (!this.initialized) {
      await this.initialize();
    }

    const subIndex = this.subscriptions.findIndex(sub => sub.userId === userId);

    if (subIndex >= 0) {
      this.subscriptions[subIndex].status = 'cancelled';
      localStorage.setItem('subscriptions', JSON.stringify(this.subscriptions));
      return true;
    }

    return false;
  }

  async processPayment(userId, planId) {
    // In a real app, this would connect to a payment processor
    console.log(`Processing payment for user ${userId}, plan ${planId}`);

    // Simulate payment processing
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate 90% success rate
        const success = Math.random() < 0.9;
        console.log(`Payment ${success ? 'successful' : 'failed'}`);
        resolve(success);
      }, 1000);
    });
  }

  getPlanDetails(planId) {
    return this.plans[planId] || null;
  }

  calculateEndDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }

  getAllPlans() {
    return this.plans;
  }

  // Get all plans
  getPlans() {
    return this.plans;
  }

  // Get a specific plan
  getPlan(planId) {
    return this.plans[planId];
  }

  // Get available discounts for the user
  getAvailableDiscounts() {
    if (!this.initialized) {
      this.initialize();
    }

    return this.discountPromotions.filter(promo => promo.active && promo.eligible);
  }

  // Apply a discount to a plan
  applyDiscount(planId, discountId) {
    const plan = this.getPlan(planId);
    if (!plan) {
      return null;
    }

    const discount = this.discountPromotions.find(p => p.id === discountId);
    if (!discount || !discount.active || !discount.eligible) {
      return plan;
    }

    // Create a copy of the plan to modify
    const discountedPlan = {...plan};

    if (discount.discountType === 'percentage') {
      const discountAmount = (plan.price * discount.discountValue) / 100;
      discountedPlan.price = Math.round((plan.price - discountAmount) * 100) / 100;
      discountedPlan.discountInfo = {
        originalPrice: plan.price,
        discountPercentage: discount.discountValue,
        discountAmount: discountAmount,
        durationMonths: discount.durationMonths || null,
        promocode: discount.promocode || null
      };
    } else if (discount.discountType === 'fixed') {
      discountedPlan.price = Math.max(0, plan.price - discount.discountValue);
      discountedPlan.discountInfo = {
        originalPrice: plan.price,
        discountFixed: discount.discountValue,
        durationMonths: discount.durationMonths || null,
        promocode: discount.promocode || null
      };
    } else if (discount.discountType === 'annual') {
      discountedPlan.price = plan.annualPrice / 12; // Show monthly equivalent
      discountedPlan.billingPeriod = 'annual';
      discountedPlan.annualBilling = true;
      discountedPlan.discountInfo = {
        originalPrice: plan.price,
        annualPrice: plan.annualPrice,
        savingsPercentage: Math.round((1 - (plan.annualPrice / (plan.price * 12))) * 100),
        savingsAmount: Math.round((plan.price * 12 - plan.annualPrice) * 100) / 100
      };
    }

    return discountedPlan;
  }

  // Check if user is new (registered less than 7 days ago)
  isNewUser() {
    // For demonstration, we'll check localStorage to see when the user was created
    const userDataStr = localStorage.getItem('fitmunch_user_data');
    if (!userDataStr) {
      return true; // No user data means they're new
    }

    try {
      const userData = JSON.parse(userDataStr);
      if (!userData.user || !userData.user.createdAt) {
        return true;
      }

      const createdAt = new Date(userData.user.createdAt);
      const now = new Date();
      const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);

      return daysSinceCreation < 7;
    } catch (error) {
      console.error("Error checking if user is new:", error);
      return false;
    }
  }

  // Check if user is a former subscriber
  isFormerSubscriber() {
    // For demonstration, check if they had a subscription that ended
    const subscriptionHistory = localStorage.getItem('fitmunch_subscription_history');
    if (!subscriptionHistory) {
      return false;
    }

    try {
      const history = JSON.parse(subscriptionHistory);
      if (!Array.isArray(history) || history.length === 0) {
        return false;
      }

      // Check if they had a paid subscription that expired
      const hadPaidSubscription = history.some(sub =>
        sub.plan !== 'free' &&
        sub.status === 'expired' &&
        new Date(sub.expiryDate) < new Date() &&
        new Date(sub.expiryDate) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Within last 90 days
      );

      return hadPaidSubscription;
    } catch (error) {
      console.error("Error checking if user is former subscriber:", error);
      return false;
    }
  }

  // Check if user has completed a streak of a certain length
  hasCompletedStreak(days) {
    // For demonstration, we'll check if dailyChallenges exists and has streak data
    if (typeof window === 'undefined' || !window.dailyChallenges) {
      return false;
    }

    try {
      const streakInfo = window.dailyChallenges.getStreakInfo();
      return streakInfo && streakInfo.currentStreak >= days;
    } catch (error) {
      console.error("Error checking streak:", error);
      return false;
    }
  }


  loadUserSubscription() {
    // Placeholder: Load user subscription from local storage or database.  This method needs to be implemented based on your data storage method.
    // This is a placeholder and needs to be replaced with your actual implementation
      console.log("Loading user subscription (placeholder implementation)");
  }
}

// Create a singleton instance
const subscriptionManager = new SubscriptionManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = subscriptionManager;
} else if (typeof window !== 'undefined') {
  // Make available globally in browser
  window.subscriptionManager = subscriptionManager;
}