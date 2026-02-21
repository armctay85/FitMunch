
// FitMunch In-App Purchase Implementation
// Handles subscription purchases on iOS and Android platforms

class FitMunchIAP {
  constructor() {
    this.initialized = false;
    this.platform = this.detectPlatform();
    this.products = [];
    this.availableProducts = [];
    this.listeners = [];
    this.currentPurchase = null;
    this.restoreTimeout = null;
    this.processingPurchase = false;
    this.lastError = null;
  }

  // Initialize the IAP system
  async initialize() {
    if (this.initialized) {
      console.log("IAP already initialized");
      return true;
    }

    console.log(`Initializing IAP for platform: ${this.platform}`);
    
    try {
      // Set up products
      this.setupProducts();

      // Platform-specific initialization
      await this.initializePlatform();

      this.initialized = true;
      this.notifyListeners({type: 'init', success: true});
      console.log("IAP initialized successfully");
      return true;
    } catch (error) {
      this.lastError = error.message;
      console.error("Failed to initialize IAP:", error);
      this.notifyListeners({type: 'init', success: false, error: error.message});
      return false;
    }
  }

  // Platform-specific initialization
  async initializePlatform() {
    switch (this.platform) {
      case 'ios':
        await this.initializeIOS();
        break;
      case 'android':
        await this.initializeAndroid();
        break;
      case 'web':
        await this.initializeWeb();
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  // Initialize for iOS
  async initializeIOS() {
    console.log("Initializing iOS IAP...");
    
    // In a real implementation, this would use StoreKit
    // For demo, we'll simulate StoreKit behavior
    
    // Simulate fetching products from App Store Connect
    const response = await this.simulateStoreKitProductsRequest();
    
    if (response.success) {
      this.availableProducts = response.products;
      console.log(`Loaded ${this.availableProducts.length} products from App Store`);
    } else {
      throw new Error(response.error || "Failed to load products from App Store");
    }
    
    // Set up transaction observer
    this.setupIOSTransactionObserver();
    
    console.log("iOS IAP initialized successfully");
  }

  // Initialize for Android
  async initializeAndroid() {
    console.log("Initializing Android IAP...");
    
    // In a real implementation, this would use Google Play Billing
    // For demo, we'll simulate Google Play Billing behavior
    
    // Simulate connecting to Google Play Billing
    const connectionResult = await this.simulateGooglePlayConnection();
    
    if (!connectionResult.success) {
      throw new Error(connectionResult.error || "Failed to connect to Google Play Billing");
    }
    
    // Simulate fetching products from Google Play
    const response = await this.simulateGooglePlayProductsRequest();
    
    if (response.success) {
      this.availableProducts = response.products;
      console.log(`Loaded ${this.availableProducts.length} products from Google Play`);
    } else {
      throw new Error(response.error || "Failed to load products from Google Play");
    }
    
    // Set up purchase updates listener
    this.setupAndroidPurchaseUpdates();
    
    console.log("Android IAP initialized successfully");
  }

  // Initialize for Web
  async initializeWeb() {
    console.log("Initializing Web IAP...");
    
    // For web, we'll use a simple simulation for demo purposes
    this.availableProducts = this.products;
    
    console.log("Web IAP initialized successfully");
  }

  // Setup products
  setupProducts() {
    this.products = [
      {
        id: 'fitmunch.sub.basic',
        name: 'Basic',
        title: 'FitMunch Basic',
        description: 'Access to basic meal plans and workout tracking',
        price: 5.99,
        currency: 'USD',
        period: 'month',
        features: [
          'Basic meal plans',
          'Workout tracking',
          'Progress monitoring',
          'Shopping list generation'
        ]
      },
      {
        id: 'fitmunch.sub.premium',
        name: 'Premium',
        title: 'FitMunch Premium',
        description: 'Complete access to all meal plans, workouts, and analytics',
        price: 12.99,
        currency: 'USD',
        period: 'month',
        features: [
          'Advanced meal plans',
          'Custom workout creation',
          'Detailed analytics',
          'Nutrition tracking',
          'Barcode scanner',
          'Recipe database'
        ]
      },
      {
        id: 'fitmunch.sub.procoach',
        name: 'Pro Coach',
        title: 'FitMunch Pro Coach',
        description: 'Premium features plus personalized coaching and advanced analytics',
        price: 29.99,
        currency: 'USD',
        period: 'month',
        features: [
          'All Premium features',
          'Personalized meal recommendations',
          'AI workout adjustments',
          'Premium recipes',
          'Community challenges',
          'Priority support'
        ]
      },
      {
        id: 'fitmunch.sub.basic.annual',
        name: 'Basic Annual',
        title: 'FitMunch Basic (Annual)',
        description: 'Access to basic features with annual discount',
        price: 59.99,
        currency: 'USD',
        period: 'year',
        features: [
          'Basic meal plans',
          'Workout tracking',
          'Progress monitoring',
          'Shopping list generation',
          '17% discount vs monthly'
        ]
      },
      {
        id: 'fitmunch.sub.premium.annual',
        name: 'Premium Annual',
        title: 'FitMunch Premium (Annual)',
        description: 'Complete access with annual discount',
        price: 129.99,
        currency: 'USD',
        period: 'year',
        features: [
          'Advanced meal plans',
          'Custom workout creation',
          'Detailed analytics',
          'Nutrition tracking',
          'Barcode scanner',
          'Recipe database',
          '17% discount vs monthly'
        ]
      },
      {
        id: 'fitmunch.sub.procoach.annual',
        name: 'Pro Coach Annual',
        title: 'FitMunch Pro Coach (Annual)',
        description: 'Premium features plus coaching with annual discount',
        price: 299.99,
        currency: 'USD',
        period: 'year',
        features: [
          'All Premium features',
          'Personalized meal recommendations',
          'AI workout adjustments',
          'Premium recipes',
          'Community challenges',
          'Priority support',
          '17% discount vs monthly'
        ]
      }
    ];

    console.log(`Set up ${this.products.length} subscription products`);
  }

  // Get available products
  getProducts() {
    if (!this.initialized) {
      console.warn("IAP not initialized, returning pre-defined products");
      return this.products;
    }
    
    return this.availableProducts.length > 0 ? this.availableProducts : this.products;
  }

  // Purchase a subscription
  async purchaseSubscription(productId) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.processingPurchase) {
      return {
        success: false,
        error: "Another purchase is in progress"
      };
    }
    
    this.processingPurchase = true;
    this.currentPurchase = null;
    
    try {
      console.log(`Initiating purchase for product: ${productId}`);
      
      // Find the product
      const product = this.findProduct(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      
      // Platform-specific purchase
      let result;
      switch (this.platform) {
        case 'ios':
          result = await this.purchaseIOS(product);
          break;
        case 'android':
          result = await this.purchaseAndroid(product);
          break;
        case 'web':
          result = await this.purchaseWeb(product);
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
      
      this.processingPurchase = false;
      
      if (result.success) {
        this.currentPurchase = {
          ...result,
          product: product
        };
        
        this.notifyListeners({
          type: 'purchase',
          success: true,
          productId: productId,
          receipt: result.receipt,
          transaction: result.transaction
        });
        
        console.log(`Purchase successful for ${product.name}`);
      } else {
        this.lastError = result.error;
        
        this.notifyListeners({
          type: 'purchase',
          success: false,
          productId: productId,
          error: result.error
        });
        
        console.error(`Purchase failed for ${product.name}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      this.processingPurchase = false;
      this.lastError = error.message;
      
      this.notifyListeners({
        type: 'purchase',
        success: false,
        productId: productId,
        error: error.message
      });
      
      console.error("Purchase error:", error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Purchase on iOS
  async purchaseIOS(product) {
    console.log(`Processing iOS purchase for ${product.name}...`);
    
    // In a real implementation, this would use StoreKit
    // For demo, we'll simulate a purchase flow
    
    // Simulate user confirmation
    const userConfirmed = await this.simulateUserConfirmation(product);
    if (!userConfirmed) {
      return {
        success: false,
        error: "Purchase cancelled by user"
      };
    }
    
    // Simulate App Store purchase process
    const purchaseResult = await this.simulateIOSPurchaseProcess(product);
    
    if (purchaseResult.success) {
      return {
        success: true,
        productId: product.id,
        receipt: purchaseResult.receipt,
        transaction: purchaseResult.transaction,
        platform: 'ios'
      };
    } else {
      return {
        success: false,
        error: purchaseResult.error || "Purchase failed"
      };
    }
  }

  // Purchase on Android
  async purchaseAndroid(product) {
    console.log(`Processing Android purchase for ${product.name}...`);
    
    // In a real implementation, this would use Google Play Billing
    // For demo, we'll simulate a purchase flow
    
    // Simulate user confirmation
    const userConfirmed = await this.simulateUserConfirmation(product);
    if (!userConfirmed) {
      return {
        success: false,
        error: "Purchase cancelled by user"
      };
    }
    
    // Simulate Google Play purchase process
    const purchaseResult = await this.simulateAndroidPurchaseProcess(product);
    
    if (purchaseResult.success) {
      return {
        success: true,
        productId: product.id,
        receipt: purchaseResult.receipt,
        transaction: purchaseResult.transaction,
        platform: 'android'
      };
    } else {
      return {
        success: false,
        error: purchaseResult.error || "Purchase failed"
      };
    }
  }

  // Purchase on Web
  async purchaseWeb(product) {
    console.log(`Processing Web purchase for ${product.name}...`);
    
    // Simulate user confirmation
    const userConfirmed = await this.simulateUserConfirmation(product);
    if (!userConfirmed) {
      return {
        success: false,
        error: "Purchase cancelled by user"
      };
    }
    
    // Simulate web purchase process (e.g., Stripe, PayPal)
    const purchaseResult = await this.simulateWebPurchaseProcess(product);
    
    if (purchaseResult.success) {
      return {
        success: true,
        productId: product.id,
        receipt: purchaseResult.receipt,
        transaction: purchaseResult.transaction,
        platform: 'web'
      };
    } else {
      return {
        success: false,
        error: purchaseResult.error || "Purchase failed"
      };
    }
  }

  // Restore purchases
  async restorePurchases() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.restoreTimeout) {
      clearTimeout(this.restoreTimeout);
    }
    
    try {
      console.log("Restoring purchases...");
      
      // Platform-specific restore
      let result;
      switch (this.platform) {
        case 'ios':
          result = await this.restoreIOS();
          break;
        case 'android':
          result = await this.restoreAndroid();
          break;
        case 'web':
          result = await this.restoreWeb();
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
      
      if (result.success) {
        this.notifyListeners({
          type: 'restore',
          success: true,
          purchases: result.purchases
        });
        
        console.log(`Restored ${result.purchases?.length || 0} purchases`);
      } else {
        this.lastError = result.error;
        
        this.notifyListeners({
          type: 'restore',
          success: false,
          error: result.error
        });
        
        console.error(`Restore failed: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      this.lastError = error.message;
      
      this.notifyListeners({
        type: 'restore',
        success: false,
        error: error.message
      });
      
      console.error("Restore error:", error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Restore purchases on iOS
  async restoreIOS() {
    console.log("Restoring iOS purchases...");
    
    // In a real implementation, this would use StoreKit
    // For demo, we'll simulate restore process
    
    // Simulate restore process
    const restoreResult = await this.simulateIOSRestoreProcess();
    
    return restoreResult;
  }

  // Restore purchases on Android
  async restoreAndroid() {
    console.log("Restoring Android purchases...");
    
    // In a real implementation, this would use Google Play Billing
    // For demo, we'll simulate restore process
    
    // Simulate restore process
    const restoreResult = await this.simulateAndroidRestoreProcess();
    
    return restoreResult;
  }

  // Restore purchases on Web
  async restoreWeb() {
    console.log("Restoring Web purchases...");
    
    // For web, we might use a backend API to check purchases
    // For demo, we'll simulate restore process
    
    // Simulate restore process
    const restoreResult = await this.simulateWebRestoreProcess();
    
    return restoreResult;
  }

  // Get receipt for the most recent purchase
  getLatestReceipt() {
    if (this.currentPurchase && this.currentPurchase.receipt) {
      return {
        receipt: this.currentPurchase.receipt,
        platform: this.platform
      };
    }
    
    return null;
  }

  // Get the current platform
  getPlatform() {
    return this.platform;
  }

  // Get last error
  getLastError() {
    return this.lastError;
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
        console.error("Error in IAP event listener:", error);
      }
    });
  }

  // Find product by ID
  findProduct(productId) {
    const products = this.availableProducts.length > 0 ? this.availableProducts : this.products;
    return products.find(p => p.id === productId);
  }

  // Detect platform
  detectPlatform() {
    // Check for iOS (iPhone, iPad, iPod)
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      return 'ios';
    }
    
    // Check for Android
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      return 'android';
    }
    
    // Default to web
    return 'web';
  }

  // ===== SIMULATION METHODS (for demo) =====

  // Simulate StoreKit products request
  async simulateStoreKitProductsRequest() {
    return new Promise(resolve => {
      setTimeout(() => {
        // Add iOS-specific details to products
        const iosProducts = this.products.map(product => ({
          ...product,
          localizedPrice: `$${product.price}`,
          localizedTitle: product.title,
          localizedDescription: product.description,
          storeSpecific: {
            introductoryPrice: product.name.includes('Annual') ? `$${product.price / 12}/month for a year` : null,
            discounts: []
          }
        }));
        
        resolve({
          success: true,
          products: iosProducts
        });
      }, 500);
    });
  }

  // Simulate Google Play connection
  async simulateGooglePlayConnection() {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: true
        });
      }, 300);
    });
  }

  // Simulate Google Play products request
  async simulateGooglePlayProductsRequest() {
    return new Promise(resolve => {
      setTimeout(() => {
        // Add Android-specific details to products
        const androidProducts = this.products.map(product => ({
          ...product,
          priceAmountMicros: Math.round(product.price * 1000000),
          priceCurrencyCode: product.currency,
          originalJson: JSON.stringify({
            productId: product.id,
            type: 'subs',
            title: product.title,
            description: product.description,
            skuDetailsToken: `token_${product.id}`
          })
        }));
        
        resolve({
          success: true,
          products: androidProducts
        });
      }, 500);
    });
  }

  // Simulate user confirmation
  async simulateUserConfirmation(product) {
    return new Promise(resolve => {
      console.log(`[Simulated User Dialog] Confirm purchase: ${product.title} (${product.price} ${product.currency}/${product.period})`);
      
      // Auto-confirm for demo
      setTimeout(() => {
        resolve(true);
      }, 700);
    });
  }

  // Simulate iOS purchase process
  async simulateIOSPurchaseProcess(product) {
    return new Promise(resolve => {
      console.log(`[Simulated iOS Purchase] Processing payment for ${product.id}...`);
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          const transaction = {
            transactionId: `ios_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            productId: product.id,
            transactionDate: new Date().toISOString(),
            originalTransactionId: null,
            transactionState: 'purchased',
            discountId: null
          };
          
          const receipt = {
            receiptData: `base64_receipt_data_${transaction.transactionId}`,
            bundleId: 'com.fitmunch.app',
            productId: product.id,
            transactionId: transaction.transactionId,
            purchaseDate: transaction.transactionDate
          };
          
          resolve({
            success: true,
            transaction: transaction,
            receipt: receipt
          });
        } else {
          resolve({
            success: false,
            error: "Payment failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }

  // Simulate Android purchase process
  async simulateAndroidPurchaseProcess(product) {
    return new Promise(resolve => {
      console.log(`[Simulated Android Purchase] Processing payment for ${product.id}...`);
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          const purchaseToken = `android_purchase_token_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          
          const transaction = {
            orderId: `GPA.${Date.now()}-${Math.floor(Math.random() * 10000)}-${Math.floor(Math.random() * 10000)}`,
            packageName: 'com.fitmunch.app',
            productId: product.id,
            purchaseTime: Date.now(),
            purchaseState: 0,
            purchaseToken: purchaseToken,
            autoRenewing: true
          };
          
          const receipt = {
            orderId: transaction.orderId,
            packageName: transaction.packageName,
            productId: product.id,
            purchaseToken: purchaseToken,
            purchaseTime: transaction.purchaseTime,
            purchaseState: 0,
            acknowledged: false
          };
          
          resolve({
            success: true,
            transaction: transaction,
            receipt: receipt
          });
        } else {
          resolve({
            success: false,
            error: "Payment failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }

  // Simulate Web purchase process
  async simulateWebPurchaseProcess(product) {
    return new Promise(resolve => {
      console.log(`[Simulated Web Purchase] Processing payment for ${product.id}...`);
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          const transaction = {
            id: `web_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            productId: product.id,
            timestamp: Date.now(),
            customerEmail: 'user@example.com',
            paymentMethod: 'card'
          };
          
          const receipt = {
            id: transaction.id,
            productId: product.id,
            timestamp: transaction.timestamp,
            expiresAt: new Date(Date.now() + (product.period === 'year' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString(),
            customerId: 'cus_mock_id',
            verificationToken: `verification_token_${transaction.id}`
          };
          
          resolve({
            success: true,
            transaction: transaction,
            receipt: receipt
          });
        } else {
          resolve({
            success: false,
            error: "Payment failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }

  // Set up iOS transaction observer
  setupIOSTransactionObserver() {
    console.log("[Simulated iOS] Setting up transaction observer...");
    
    // In a real app, this would register for App Store transaction notifications
  }

  // Set up Android purchase updates
  setupAndroidPurchaseUpdates() {
    console.log("[Simulated Android] Setting up purchase updates listener...");
    
    // In a real app, this would register for Google Play Billing purchase updates
  }

  // Simulate iOS restore process
  async simulateIOSRestoreProcess() {
    return new Promise(resolve => {
      console.log("[Simulated iOS] Restoring purchases...");
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          // For demo, let's say user has Premium subscription
          const purchase = {
            productId: 'fitmunch.sub.premium',
            transactionId: `ios_restored_${Date.now()}`,
            purchaseDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
            expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
            receipt: {
              receiptData: `base64_receipt_data_restored`,
              bundleId: 'com.fitmunch.app'
            }
          };
          
          resolve({
            success: true,
            purchases: [purchase]
          });
        } else {
          resolve({
            success: false,
            error: "Restore failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }

  // Simulate Android restore process
  async simulateAndroidRestoreProcess() {
    return new Promise(resolve => {
      console.log("[Simulated Android] Restoring purchases...");
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          // For demo, let's say user has Premium subscription
          const purchase = {
            productId: 'fitmunch.sub.premium',
            orderId: `GPA.restored-${Date.now()}`,
            purchaseToken: `android_purchase_token_restored`,
            purchaseTime: Date.now() - 15 * 24 * 60 * 60 * 1000,
            expiryTime: Date.now() + 15 * 24 * 60 * 60 * 1000,
            autoRenewing: true
          };
          
          resolve({
            success: true,
            purchases: [purchase]
          });
        } else {
          resolve({
            success: false,
            error: "Restore failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }

  // Simulate Web restore process
  async simulateWebRestoreProcess() {
    return new Promise(resolve => {
      console.log("[Simulated Web] Restoring purchases...");
      
      // Simulate processing time
      setTimeout(() => {
        // 90% success rate for demo
        const success = Math.random() <= 0.9;
        
        if (success) {
          // For demo, let's say user has no active subscriptions
          resolve({
            success: true,
            purchases: []
          });
        } else {
          resolve({
            success: false,
            error: "Restore failed [Simulated Error]"
          });
        }
      }, 1500);
    });
  }
}

// Create singleton instance
const fitMunchIAP = new FitMunchIAP();

// Export for different environments
if (typeof window !== 'undefined') {
  window.fitMunchIAP = fitMunchIAP;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = fitMunchIAP;
}
