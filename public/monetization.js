
// FitMunch Monetization System

// Subscription Plans
const subscriptionPlans = {
  free: {
    name: "Free Plan",
    price: 0,
    interval: "month",
    features: [
      "Basic meal planning",
      "Simple workout tracking",
      "Limited recipe access",
      "Ad-supported experience"
    ],
    limitations: {
      mealPlans: 1,
      workoutPlans: 1,
      recipesPerDay: 5,
      customizationOptions: false,
      personalCoaching: false,
      premiumContent: false
    }
  },
  basic: {
    name: "FitMunch Basic",
    price: 5.99,
    interval: "month",
    features: [
      "Ad-free experience",
      "Expanded meal planning",
      "Custom workout plans",
      "Full recipe database access",
      "Shopping list integration"
    ],
    limitations: {
      mealPlans: 3,
      workoutPlans: 2,
      recipesPerDay: 15,
      customizationOptions: true,
      personalCoaching: false,
      premiumContent: false
    }
  },
  premium: {
    name: "FitMunch Premium",
    price: 12.99,
    interval: "month",
    features: [
      "All Basic features",
      "Unlimited meal & workout plans",
      "Advanced analytics",
      "Nutritionist-designed meal plans",
      "AI-powered personalization",
      "Export to PDF/calendar",
      "Premium recipes and workouts"
    ],
    limitations: {
      mealPlans: "unlimited",
      workoutPlans: "unlimited",
      recipesPerDay: "unlimited",
      customizationOptions: true,
      personalCoaching: false,
      premiumContent: true
    }
  },
  proCoach: {
    name: "FitMunch Pro Coach",
    price: 29.99,
    interval: "month",
    features: [
      "All Premium features",
      "Personal nutrition coaching",
      "1-on-1 fitness consultations",
      "Custom fitness program design",
      "Priority support",
      "Weekly check-ins and adjustments",
      "Exclusive content and workshops"
    ],
    limitations: {
      mealPlans: "unlimited",
      workoutPlans: "unlimited",
      recipesPerDay: "unlimited",
      customizationOptions: true,
      personalCoaching: true,
      premiumContent: true
    }
  }
};

// Annual discount option
const annualDiscount = 0.20; // 20% discount for annual subscriptions

// Special offers and promotions
const specialOffers = [
  {
    id: "NEWYEAR2025",
    name: "New Year Special",
    discount: 0.30, // 30% off
    validUntil: new Date(2025, 0, 31), // Jan 31, 2025
    applicablePlans: ["basic", "premium", "proCoach"],
    description: "Start your fitness journey with 30% off any subscription plan!"
  },
  {
    id: "REFERRAL",
    name: "Friend Referral",
    discount: 0.15, // 15% off
    validUntil: null, // No expiration
    applicablePlans: ["basic", "premium"],
    description: "Get 15% off when you refer a friend!"
  }
];

// Premium features list with details
const premiumFeatures = {
  customWorkoutPlans: {
    name: "Custom Workout Plans",
    description: "Get personalized workout plans based on your goals, equipment, and fitness level",
    requiredTier: "basic"
  },
  advancedNutrition: {
    name: "Advanced Nutrition Analysis",
    description: "Detailed macro and micronutrient tracking with personalized recommendations",
    requiredTier: "premium"
  },
  mealPrepGuidance: {
    name: "Meal Prep Guidance",
    description: "Step-by-step guides and videos for efficient meal preparation",
    requiredTier: "basic"
  },
  personalCoaching: {
    name: "Personal Coaching Sessions",
    description: "Virtual coaching sessions with certified nutritionists and trainers",
    requiredTier: "proCoach"
  },
  exportFunctionality: {
    name: "Export & Calendar Integration",
    description: "Export your plans to PDF or sync with your calendar",
    requiredTier: "premium"
  },
  aiRecommendations: {
    name: "AI-Powered Recommendations",
    description: "Smart suggestions that adapt to your progress and preferences",
    requiredTier: "premium"
  }
};

// User subscription state management
class SubscriptionManager {
  constructor() {
    this.currentUser = null;
    this.currentPlan = "free";
    this.subscriptionStatus = "active";
    this.subscriptionStartDate = null;
    this.nextBillingDate = null;
    this.paymentMethod = null;
    this.subscriptionHistory = [];
    this.activePromoCode = null;
  }

  // Initialize subscription from localStorage if available
  initialize() {
    const savedSubscription = localStorage.getItem('userSubscription');
    if (savedSubscription) {
      const subData = JSON.parse(savedSubscription);
      this.currentPlan = subData.plan || "free";
      this.subscriptionStatus = subData.status || "active";
      this.subscriptionStartDate = subData.startDate ? new Date(subData.startDate) : null;
      this.nextBillingDate = subData.nextBillingDate ? new Date(subData.nextBillingDate) : null;
      this.paymentMethod = subData.paymentMethod || null;
      this.activePromoCode = subData.promoCode || null;
      console.log("Subscription loaded:", this.currentPlan, this.subscriptionStatus);
    } else {
      console.log("No subscription found, using free plan");
      this.setFreePlan();
    }
  }

  // Set the user to free plan
  setFreePlan() {
    this.currentPlan = "free";
    this.subscriptionStatus = "active";
    this.subscriptionStartDate = new Date();
    this.nextBillingDate = null;
    this.saveSubscription();
  }

  // Subscribe user to a plan
  subscribeToPlan(planId, isAnnual = false, promoCode = null) {
    if (!subscriptionPlans[planId]) {
      console.error("Invalid plan ID:", planId);
      return false;
    }

    // In a real implementation, this would handle payment processing
    // and then update the subscription details

    // For demo purposes, we'll just update the subscription status
    this.currentPlan = planId;
    this.subscriptionStatus = "active";
    this.subscriptionStartDate = new Date();
    
    // Calculate next billing date
    const nextBilling = new Date();
    if (isAnnual) {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    } else {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    }
    this.nextBillingDate = nextBilling;
    
    // Apply promo code if valid
    if (promoCode) {
      const promo = this.validatePromoCode(promoCode);
      if (promo && promo.applicablePlans.includes(planId)) {
        this.activePromoCode = promoCode;
      }
    }
    
    // Add to subscription history
    this.subscriptionHistory.push({
      plan: planId,
      startDate: new Date(),
      isAnnual: isAnnual,
      promoCode: this.activePromoCode
    });
    
    // Save to localStorage
    this.saveSubscription();
    
    return true;
  }
  
  // Cancel subscription
  cancelSubscription() {
    this.subscriptionStatus = "canceled";
    this.saveSubscription();
    return true;
  }
  
  // Update payment method
  updatePaymentMethod(paymentDetails) {
    // In a real implementation, this would validate and store payment info securely
    this.paymentMethod = {
      type: paymentDetails.type,
      lastFour: paymentDetails.lastFour,
      expiryDate: paymentDetails.expiryDate
    };
    this.saveSubscription();
    return true;
  }
  
  // Check if a feature is available on current plan
  canAccessFeature(featureId) {
    if (!premiumFeatures[featureId]) {
      console.error("Invalid feature ID:", featureId);
      return false;
    }
    
    const requiredTier = premiumFeatures[featureId].requiredTier;
    const currentTierIndex = Object.keys(subscriptionPlans).indexOf(this.currentPlan);
    const requiredTierIndex = Object.keys(subscriptionPlans).indexOf(requiredTier);
    
    return currentTierIndex >= requiredTierIndex;
  }
  
  // Calculate price with applicable discounts
  calculatePrice(planId, isAnnual = false) {
    if (!subscriptionPlans[planId]) {
      return 0;
    }
    
    let basePrice = subscriptionPlans[planId].price;
    
    // Apply annual discount if applicable
    if (isAnnual) {
      basePrice = basePrice * 12 * (1 - annualDiscount);
    }
    
    // Apply promo code discount if applicable
    if (this.activePromoCode) {
      const promo = this.validatePromoCode(this.activePromoCode);
      if (promo && promo.applicablePlans.includes(planId)) {
        basePrice = basePrice * (1 - promo.discount);
      }
    }
    
    return basePrice.toFixed(2);
  }
  
  // Validate a promo code
  validatePromoCode(code) {
    const promo = specialOffers.find(offer => offer.id === code);
    
    if (!promo) {
      return null;
    }
    
    // Check if promo is expired
    if (promo.validUntil && new Date() > promo.validUntil) {
      return null;
    }
    
    return promo;
  }
  
  // Save subscription to localStorage
  saveSubscription() {
    const subscriptionData = {
      plan: this.currentPlan,
      status: this.subscriptionStatus,
      startDate: this.subscriptionStartDate,
      nextBillingDate: this.nextBillingDate,
      paymentMethod: this.paymentMethod,
      promoCode: this.activePromoCode
    };
    
    localStorage.setItem('userSubscription', JSON.stringify(subscriptionData));
  }
  
  // Get current plan details
  getCurrentPlanDetails() {
    return subscriptionPlans[this.currentPlan];
  }
  
  // Get formatted next billing date
  getFormattedNextBillingDate() {
    if (!this.nextBillingDate) {
      return "N/A";
    }
    
    return this.nextBillingDate.toLocaleDateString();
  }
}

// Payment processing simulation
const PaymentProcessor = {
  processPayment: function(planId, isAnnual, cardDetails) {
    return new Promise((resolve, reject) => {
      // Simulate payment processing
      setTimeout(() => {
        // In a real implementation, this would integrate with a payment gateway
        // such as Stripe, PayPal, etc.
        
        // Basic validation
        if (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvc) {
          reject(new Error("Invalid card details"));
          return;
        }
        
        // 90% success rate for simulation
        if (Math.random() > 0.1) {
          resolve({
            success: true,
            transactionId: "tx_" + Math.random().toString(36).substr(2, 9),
            lastFour: cardDetails.number.slice(-4),
            message: "Payment processed successfully"
          });
        } else {
          reject(new Error("Payment processing failed. Please try again."));
        }
      }, 1500); // Simulate network delay
    });
  },
  
  generateInvoice: function(subscriptionData) {
    // In a real implementation, this would generate a PDF invoice
    return {
      invoiceId: "inv_" + Math.random().toString(36).substr(2, 9),
      dateGenerated: new Date(),
      planName: subscriptionPlans[subscriptionData.plan].name,
      amount: subscriptionData.isAnnual ? 
        (subscriptionPlans[subscriptionData.plan].price * 12 * (1 - annualDiscount)).toFixed(2) : 
        subscriptionPlans[subscriptionData.plan].price.toFixed(2),
      interval: subscriptionData.isAnnual ? "year" : "month",
      customerName: userProfile.name || "Customer"
    };
  }
};

// Initialize the subscription manager
const subscriptionManager = new SubscriptionManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    subscriptionPlans,
    premiumFeatures,
    specialOffers,
    SubscriptionManager,
    PaymentProcessor,
    subscriptionManager
  };
}
