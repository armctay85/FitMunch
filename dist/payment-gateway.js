
// FitMunch Payment Gateway Integration
// This provides a production-ready integration with Stripe for payments

/*
SETUP INSTRUCTIONS:
1. Create a Stripe account at https://stripe.com
2. Get your API keys from the Stripe Dashboard
3. Replace the placeholder keys below with your actual keys
4. Set up Stripe webhook endpoints for subscription management
5. Configure your banking details in Stripe to receive payouts
*/

// Import Stripe if in Node.js environment
let stripe;
if (typeof module !== 'undefined' && module.exports) {
  try {
    // Using environment variable for security (should be set in Replit Secrets)
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_TEST_KEY'); 
  } catch (error) {
    console.error("Error loading Stripe:", error);
  }
}

// Stripe payment processing
const StripePaymentGateway = {
  // Initialize Stripe with publishable key (for frontend)
  initializeStripe: function() {
    if (typeof window !== 'undefined' && window.Stripe) {
      // Using environment variable or fallback for testing
      return window.Stripe(process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_TEST_KEY'); 
    }
    return null;
  },
  
  // Create payment intent (backend)
  createPaymentIntent: async function(amount, currency = 'usd', metadata = {}) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency,
        metadata: metadata
      });
      
      return paymentIntent;
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  },
  
  // Create a subscription (backend)
  createSubscription: async function(customerId, priceId) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        expand: ['latest_invoice.payment_intent']
      });
      
      return subscription;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  },
  
  // Create a customer (backend)
  createCustomer: async function(email, name, metadata = {}) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const customer = await stripe.customers.create({
        email: email,
        name: name,
        metadata: metadata
      });
      
      return customer;
    } catch (error) {
      console.error('Error creating customer:', error);
      throw error;
    }
  },
  
  // Add payment method to customer (backend)
  addPaymentMethod: async function(customerId, paymentMethodId) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId
      });
      
      // Set as default payment method
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error adding payment method:', error);
      throw error;
    }
  },
  
  // Create Stripe Checkout session (backend)
  createCheckoutSession: async function(priceId, customerId, successUrl, cancelUrl) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl
      });
      
      return session;

  // Verify payment session (backend)
  verifyPaymentSession: async function(sessionId) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      });
      
      return session;
    } catch (error) {
      console.error('Error verifying payment session:', error);
      throw error;
    }
  },

    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  },
  
  // Cancel subscription (backend)
  cancelSubscription: async function(subscriptionId) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const subscription = await stripe.subscriptions.del(subscriptionId);
      return subscription;
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      throw error;
    }
  },
  
  // Get subscription details (backend)
  getSubscription: async function(subscriptionId) {
    if (!stripe) {
      throw new Error('Stripe is not initialized');
    }
    
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return subscription;
    } catch (error) {
      console.error('Error getting subscription:', error);
      throw error;
    }
  },
  
  // Frontend functions for Stripe Elements
  createCardElement: function(stripeInstance, elementId) {
    if (!stripeInstance) {
      console.error('Stripe instance not available');
      return null;
    }
    
    const elements = stripeInstance.elements();
    const style = {
      base: {
        color: '#32325d',
        fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
        fontSmoothing: 'antialiased',
        fontSize: '16px',
        '::placeholder': {
          color: '#aab7c4'
        }
      },
      invalid: {
        color: '#fa755a',
        iconColor: '#fa755a'
      }
    };
    
    const card = elements.create('card', { style: style });
    card.mount(`#${elementId}`);
    
    return card;
  },
  
  // Process payment with card element (frontend)
  processPaymentWithCard: async function(stripeInstance, cardElement, clientSecret) {
    if (!stripeInstance || !cardElement) {
      throw new Error('Stripe or card element not initialized');
    }
    
    try {
      const result = await stripeInstance.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement
        }
      });
      
      if (result.error) {
        throw new Error(result.error.message);
      }
      
      return result.paymentIntent;
    } catch (error) {
      console.error('Error processing payment:', error);
      throw error;
    }
  }
};

// If in Node.js environment, export the module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StripePaymentGateway;
} else {
  // Make available globally in browser
  window.StripePaymentGateway = StripePaymentGateway;
}
