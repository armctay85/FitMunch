
// FitMunch Receipt Validator
// Handles receipt validation for App Store and Google Play purchases

class ReceiptValidator {
  constructor() {
    this.initialized = false;
    this.verificationEndpoints = {
      ios: {
        sandbox: 'https://sandbox.itunes.apple.com/verifyReceipt',
        production: 'https://buy.itunes.apple.com/verifyReceipt'
      },
      android: {
        api: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
      },
      web: {
        api: 'https://api.fitmunch.app/validate-web-receipt'
      }
    };
    this.appleSharedSecret = 'YOUR_APPLE_SHARED_SECRET'; // Would be securely stored in production
    this.googleServiceAccount = null; // Would be loaded in production
  }

  // Initialize the validator
  async initialize() {
    if (this.initialized) {
      console.log("Receipt validator already initialized");
      return true;
    }

    console.log("Initializing receipt validator...");
    
    try {
      // In a real implementation, this would load credentials from secure storage
      // For demo, we'll simulate successful initialization
      
      this.initialized = true;
      console.log("Receipt validator initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize receipt validator:", error);
      return false;
    }
  }

  // Validate receipt from any platform
  async validateReceipt(receipt, platform) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!receipt) {
      console.error("No receipt provided for validation");
      return false;
    }

    console.log(`Validating ${platform} receipt...`);

    try {
      let result;
      switch (platform) {
        case 'ios':
          result = await this.validateAppleReceipt(receipt);
          break;
        case 'android':
          result = await this.validateGoogleReceipt(receipt);
          break;
        case 'web':
          result = await this.validateWebReceipt(receipt);
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      if (result.valid) {
        console.log("Receipt validation successful");
      } else {
        console.error(`Receipt validation failed: ${result.error}`);
      }

      return result.valid;
    } catch (error) {
      console.error("Receipt validation error:", error);
      return false;
    }
  }

  // Validate Apple App Store receipt
  async validateAppleReceipt(receipt) {
    console.log("Validating Apple receipt...");
    
    // In a real implementation, this would send the receipt to Apple's servers
    // For demo, we'll simulate validation
    
    try {
      // Simulate server validation
      const validationResult = await this.simulateAppleReceiptValidation(receipt);
      
      // Process the validation result
      if (validationResult.status === 0) {
        // Success - now we need to verify the subscription details
        const subscription = this.findLatestSubscription(validationResult.latest_receipt_info);
        
        if (!subscription) {
          return {
            valid: false,
            error: "No active subscription found in receipt"
          };
        }
        
        // Check if subscription is still active
        const expiresDate = parseInt(subscription.expires_date_ms);
        const isActive = expiresDate > Date.now();
        
        if (isActive) {
          return {
            valid: true,
            productId: subscription.product_id,
            expiresDate: new Date(expiresDate).toISOString(),
            isTrialPeriod: subscription.is_trial_period === "true",
            isInIntroOfferPeriod: subscription.is_in_intro_offer_period === "true",
            originalTransactionId: subscription.original_transaction_id
          };
        } else {
          return {
            valid: false,
            error: "Subscription has expired"
          };
        }
      } else {
        return {
          valid: false,
          error: `Apple validation failed with status ${validationResult.status}`
        };
      }
    } catch (error) {
      console.error("Apple receipt validation error:", error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Validate Google Play receipt
  async validateGoogleReceipt(receipt) {
    console.log("Validating Google Play receipt...");
    
    // In a real implementation, this would use the Google Play Developer API
    // For demo, we'll simulate validation
    
    try {
      // Extract required information from receipt
      const { packageName, productId, purchaseToken } = receipt;
      
      if (!packageName || !productId || !purchaseToken) {
        return {
          valid: false,
          error: "Missing required information in receipt"
        };
      }
      
      // Simulate server validation
      const validationResult = await this.simulateGoogleReceiptValidation(packageName, productId, purchaseToken);
      
      // Check if subscription is still active
      if (validationResult.expiryTimeMillis > Date.now()) {
        return {
          valid: true,
          productId: productId,
          expiresDate: new Date(validationResult.expiryTimeMillis).toISOString(),
          paymentState: validationResult.paymentState,
          autoRenewing: validationResult.autoRenewing,
          orderId: validationResult.orderId
        };
      } else {
        return {
          valid: false,
          error: "Subscription has expired"
        };
      }
    } catch (error) {
      console.error("Google Play receipt validation error:", error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Validate Web receipt
  async validateWebReceipt(receipt) {
    console.log("Validating Web receipt...");
    
    // In a real implementation, this would validate against a server
    // For demo, we'll simulate validation
    
    try {
      // Simulate server validation
      const validationResult = await this.simulateWebReceiptValidation(receipt);
      
      if (validationResult.valid) {
        return {
          valid: true,
          productId: validationResult.productId,
          expiresDate: validationResult.expiresAt,
          customerId: validationResult.customerId
        };
      } else {
        return {
          valid: false,
          error: validationResult.error
        };
      }
    } catch (error) {
      console.error("Web receipt validation error:", error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Find the latest subscription in a receipt
  findLatestSubscription(receiptInfo) {
    if (!receiptInfo || !Array.isArray(receiptInfo)) {
      return null;
    }
    
    // Sort by expiration date, descending
    const sortedReceipts = [...receiptInfo].sort((a, b) => {
      const aExpires = parseInt(a.expires_date_ms || 0);
      const bExpires = parseInt(b.expires_date_ms || 0);
      return bExpires - aExpires;
    });
    
    // Return the most recent subscription
    return sortedReceipts[0];
  }

  // ===== SIMULATION METHODS (for demo) =====

  // Simulate Apple receipt validation
  async simulateAppleReceiptValidation(receipt) {
    return new Promise(resolve => {
      console.log("[Simulated Apple Validation] Verifying receipt with Apple servers...");
      
      // Simulate server processing time
      setTimeout(() => {
        // For demo, we'll always return success with sample data
        const receiptData = receipt.receiptData || '';
        
        // Generate some realistic-looking data based on the transaction
        const transactionId = receipt.transactionId || `transaction_${Date.now()}`;
        const productId = receipt.productId || 'fitmunch.sub.premium';
        const purchaseDate = receipt.purchaseDate || new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
        
        // Calculate expiration date (1 month from purchase for demo)
        const purchaseMs = new Date(purchaseDate).getTime();
        const expiresMs = purchaseMs + (30 * 24 * 60 * 60 * 1000);
        
        resolve({
          status: 0, // 0 indicates success
          environment: 'Sandbox',
          receipt: {
            bundle_id: 'com.fitmunch.app',
            application_version: '1.0',
            in_app: [
              {
                quantity: '1',
                product_id: productId,
                transaction_id: transactionId,
                original_transaction_id: transactionId,
                purchase_date_ms: purchaseMs.toString(),
                expires_date_ms: expiresMs.toString(),
                is_trial_period: 'false',
                is_in_intro_offer_period: 'false'
              }
            ]
          },
          latest_receipt: receiptData,
          latest_receipt_info: [
            {
              quantity: '1',
              product_id: productId,
              transaction_id: transactionId,
              original_transaction_id: transactionId,
              purchase_date: new Date(purchaseMs).toISOString(),
              purchase_date_ms: purchaseMs.toString(),
              expires_date: new Date(expiresMs).toISOString(),
              expires_date_ms: expiresMs.toString(),
              is_trial_period: 'false',
              is_in_intro_offer_period: 'false'
            }
          ]
        });
      }, 1000);
    });
  }

  // Simulate Google Play receipt validation
  async simulateGoogleReceiptValidation(packageName, productId, purchaseToken) {
    return new Promise(resolve => {
      console.log("[Simulated Google Validation] Verifying purchase token...");
      
      // Simulate server processing time
      setTimeout(() => {
        // For demo, we'll generate some realistic-looking data
        const now = Date.now();
        const purchaseTime = now - (15 * 24 * 60 * 60 * 1000); // 15 days ago
        const expiryTime = now + (15 * 24 * 60 * 60 * 1000); // 15 days in the future
        
        resolve({
          kind: 'androidpublisher#subscriptionPurchase',
          startTimeMillis: purchaseTime.toString(),
          expiryTimeMillis: expiryTime.toString(),
          autoRenewing: true,
          priceCurrencyCode: 'USD',
          priceAmountMicros: productId.includes('premium') ? '12990000' : '5990000',
          countryCode: 'US',
          developerPayload: '',
          paymentState: 1, // 1 = confirmed
          orderId: `GPA.${now}-${Math.floor(Math.random() * 10000)}`
        });
      }, 1000);
    });
  }

  // Simulate Web receipt validation
  async simulateWebReceiptValidation(receipt) {
    return new Promise(resolve => {
      console.log("[Simulated Web Validation] Verifying web receipt...");
      
      // Simulate server processing time
      setTimeout(() => {
        // Extract info from receipt
        const { id, productId, timestamp, expiresAt, customerId } = receipt;
        
        // Check if expiration is in the future
        const isValid = new Date(expiresAt).getTime() > Date.now();
        
        if (isValid) {
          resolve({
            valid: true,
            verified: true,
            productId: productId,
            purchaseDate: new Date(timestamp).toISOString(),
            expiresAt: expiresAt,
            customerId: customerId
          });
        } else {
          resolve({
            valid: false,
            error: "Subscription has expired"
          });
        }
      }, 1000);
    });
  }
}

// Create singleton instance
const receiptValidator = new ReceiptValidator();

// Export for different environments
if (typeof window !== 'undefined') {
  window.receiptValidator = receiptValidator;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = receiptValidator;
}
