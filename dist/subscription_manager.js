// payment-gateway.js
class StripePaymentGateway {
  static async createCustomer(email, name, metadata) {
    const response = await fetch('/api/stripe/customers', { // Assuming an API endpoint for creating customers
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, name, metadata })
    });

    if (!response.ok) {
      throw new Error(`Failed to create customer: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  static async createCheckoutSession(priceId, customerId, successUrl, cancelUrl) {
    const response = await fetch('/api/stripe/checkout-sessions', { // Assuming an API endpoint for creating checkout sessions
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ priceId, customerId, successUrl, cancelUrl })
    });

    if (!response.ok) {
      throw new Error(`Failed to create checkout session: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}


const subscriptionPlans = {
  // ... your subscription plan data ...  Example:
  'basic': {
    name: 'Basic',
    priceMonthly: 9.99,
    priceAnnual: 99.99,
    stripePriceIdMonthly: 'price_1...', // Replace with your actual Stripe price IDs
    stripePriceIdAnnual: 'price_2...'
  },
  'premium': {
    name: 'Premium',
    priceMonthly: 19.99,
    priceAnnual: 199.99,
    stripePriceIdMonthly: 'price_3...', // Replace with your actual Stripe price IDs
    stripePriceIdAnnual: 'price_4...'

  }

};


class SubscriptionManager {
  constructor(currentUser) {
    this.currentUser = currentUser;
    this.currentPlan = null;
    this.subscriptionStatus = "inactive";
    this.subscriptionStartDate = null;
  }

  // Subscribe user to a plan
  async subscribeToPlan(planId, isAnnual = false, promoCode = null) {
    if (!subscriptionPlans[planId]) {
      console.error("Invalid plan ID:", planId);
      return { success: false, error: "Invalid plan ID" };
    }

    try {
      // Get the corresponding Stripe price ID
      const stripePriceId = isAnnual ?
        subscriptionPlans[planId].stripePriceIdAnnual :
        subscriptionPlans[planId].stripePriceIdMonthly;

      if (!stripePriceId) {
        throw new Error("Stripe price ID not configured for this plan");
      }

      // Create or get customer
      let customerId = this.currentUser?.stripeCustomerId;
      if (!customerId) {
        // Create a customer in Stripe
        const customerResponse = await StripePaymentGateway.createCustomer(
          this.currentUser.email,
          this.currentUser.name,
          { userId: this.currentUser.id }
        );
        customerId = customerResponse.id;

        // Save the customer ID to the user profile
        // This would typically be done through your user management system
        this.currentUser.stripeCustomerId = customerId;
      }

      // Create checkout session
      const session = await StripePaymentGateway.createCheckoutSession(
        stripePriceId,
        customerId,
        window.location.origin + '/payment-success',
        window.location.origin + '/payment-cancel'
      );

      // Redirect to checkout
      window.location = session.url;

      // Update subscription status
      this.currentPlan = planId;
      this.subscriptionStatus = "pending";
      this.subscriptionStartDate = new Date();
      return { success: true };

    } catch (error) {
      console.error("Error subscribing to plan:", error);
      return { success: false, error: error.message };
    }
  }


  // ... other subscription management methods ...
}

export { SubscriptionManager, subscriptionPlans };