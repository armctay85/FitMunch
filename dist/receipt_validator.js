// FitMunch Receipt Validator
// This module validates receipts from different app stores and payment providers

const stripeApiKey = process.env.STRIPE_SECRET_KEY;
let stripe;

if (typeof require !== 'undefined') {
  try {
    stripe = require('stripe')(stripeApiKey);
  } catch (error) {
    console.error('Error initializing Stripe:', error);
  }
}

class ReceiptValidator {
  constructor() {
    this.validationResults = {};
  }

  // Validate a Stripe receipt
  async validateStripeReceipt(sessionId) {
    if (!stripe) {
      throw new Error('Stripe API not initialized');
    }

    try {
      // Retrieve the checkout session
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      });

      // Check if the payment was successful
      if (session.payment_status !== 'paid') {
        return {
          valid: false,
          reason: `Payment not completed. Status: ${session.payment_status}`
        };
      }

      // Get subscription details if available
      let subscriptionDetails = null;
      if (session.subscription) {
        subscriptionDetails = {
          id: session.subscription.id,
          status: session.subscription.status,
          currentPeriodEnd: new Date(session.subscription.current_period_end * 1000),
          planId: session.subscription.items.data[0].price.id
        };
      }

      // Return validation result
      return {
        valid: true,
        receiptId: sessionId,
        customerId: session.customer.id,
        customerEmail: session.customer.email,
        amount: session.amount_total / 100, // Convert from cents
        currency: session.currency,
        paymentMethod: session.payment_method_types[0],
        timestamp: new Date(session.created * 1000),
        subscription: subscriptionDetails
      };
    } catch (error) {
      console.error('Error validating Stripe receipt:', error);
      return {
        valid: false,
        reason: error.message
      };
    }
  }

  // Validate Apple App Store receipt
  async validateAppleReceipt(receiptData) {
    // This would connect to Apple's validation servers
    // For now, returning a placeholder
    return {
      valid: false,
      reason: 'Apple receipt validation not implemented yet'
    };
  }

  // Validate Google Play Store receipt
  async validateGoogleReceipt(purchaseToken, productId) {
    // This would connect to Google's validation servers
    // For now, returning a placeholder
    return {
      valid: false,
      reason: 'Google receipt validation not implemented yet'
    };
  }

  // Generic receipt validation that routes to the appropriate validator
  async validateReceipt(receipt) {
    if (!receipt || !receipt.type) {
      throw new Error('Invalid receipt format');
    }

    switch (receipt.type) {
      case 'stripe':
        return this.validateStripeReceipt(receipt.sessionId);
      case 'apple':
        return this.validateAppleReceipt(receipt.data);
      case 'google':
        return this.validateGoogleReceipt(receipt.purchaseToken, receipt.productId);
      default:
        return {
          valid: false,
          reason: `Unknown receipt type: ${receipt.type}`
        };
    }
  }
}

// Export for use in Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReceiptValidator;
} else {
  // Make available in browser
  window.ReceiptValidator = ReceiptValidator;
}