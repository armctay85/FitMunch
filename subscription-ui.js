
// FitMunch Subscription UI Components

// Import subscription manager if in module context
let subscriptionManager, subscriptionPlans, premiumFeatures, specialOffers, PaymentProcessor;

if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  const monetization = require('./monetization.js');
  subscriptionManager = monetization.subscriptionManager;
  subscriptionPlans = monetization.subscriptionPlans;
  premiumFeatures = monetization.premiumFeatures;
  specialOffers = monetization.specialOffers;
  PaymentProcessor = monetization.PaymentProcessor;
} else {
  // Browser environment
  subscriptionManager = window.subscriptionManager;
  subscriptionPlans = window.subscriptionPlans;
  premiumFeatures = window.premiumFeatures;
  specialOffers = window.specialOffers;
  PaymentProcessor = window.PaymentProcessor;
}

// Create and render subscription page
function renderSubscriptionPage() {
  const container = document.getElementById('subscription-container');
  if (!container) return;

  // Initialize subscription manager if not already done
  if (typeof subscriptionManager.initialize === 'function') {
    subscriptionManager.initialize();
  }

  // Get current plan details
  const currentPlan = subscriptionManager.getCurrentPlanDetails();
  const planStatus = subscriptionManager.subscriptionStatus;

  // Create subscription UI
  container.innerHTML = `
    <div class="subscription-header">
      <h2>FitMunch Subscription</h2>
      <p>Choose the plan that fits your fitness journey</p>
    </div>
    
    <div class="current-plan-container">
      <div class="current-plan-header">
        <h3>Current Plan: <span>${currentPlan.name}</span></h3>
        <div class="plan-status ${planStatus}">${planStatus}</div>
      </div>
      
      ${planStatus === 'active' && subscriptionManager.currentPlan !== 'free' ? `
        <div class="plan-details">
          <div class="detail-item">
            <span class="detail-label">Next billing:</span>
            <span class="detail-value">${subscriptionManager.getFormattedNextBillingDate()}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Amount:</span>
            <span class="detail-value">$${subscriptionManager.calculatePrice(subscriptionManager.currentPlan)}/mo</span>
          </div>
          ${subscriptionManager.paymentMethod ? `
            <div class="detail-item">
              <span class="detail-label">Payment method:</span>
              <span class="detail-value">${subscriptionManager.paymentMethod.type} ending in ${subscriptionManager.paymentMethod.lastFour}</span>
            </div>
          ` : ''}
        </div>
        <div class="plan-actions">
          <button class="secondary-btn" id="cancel-subscription">Cancel Subscription</button>
          <button class="primary-btn" id="update-payment">Update Payment Method</button>
        </div>
      ` : ''}
    </div>
    
    <div class="annual-toggle">
      <span>Monthly</span>
      <label class="switch">
        <input type="checkbox" id="annual-billing-toggle">
        <span class="slider round"></span>
      </label>
      <span>Annual (Save 20%)</span>
    </div>
    
    <div class="subscription-plans">
      ${Object.keys(subscriptionPlans).map(planId => {
        const plan = subscriptionPlans[planId];
        return `
          <div class="plan-card ${subscriptionManager.currentPlan === planId ? 'current-plan' : ''}">
            <div class="plan-header">
              <h3>${plan.name}</h3>
              <div class="plan-price">
                <span class="price">$${plan.price.toFixed(2)}</span>
                <span class="interval">/${plan.interval}</span>
              </div>
            </div>
            <div class="plan-features">
              <ul>
                ${plan.features.map(feature => `<li><i class="fas fa-check"></i> ${feature}</li>`).join('')}
              </ul>
            </div>
            <div class="plan-action">
              ${subscriptionManager.currentPlan === planId ? 
                `<button class="current-plan-btn" disabled>Current Plan</button>` : 
                `<button class="subscribe-btn" data-plan="${planId}">Select Plan</button>`
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
    
    <div class="promo-code-container">
      <input type="text" id="promo-code" placeholder="Promo Code">
      <button id="apply-promo">Apply</button>
    </div>
    
    <div class="subscription-benefits">
      <h3>Why Upgrade to Premium?</h3>
      <div class="benefits-grid">
        ${Object.keys(premiumFeatures).map(featureId => {
          const feature = premiumFeatures[featureId];
          return `
            <div class="benefit-card">
              <div class="benefit-icon">
                <i class="fas fa-star"></i>
              </div>
              <div class="benefit-details">
                <h4>${feature.name}</h4>
                <p>${feature.description}</p>
                <span class="required-tier">Available on: ${feature.requiredTier.charAt(0).toUpperCase() + feature.requiredTier.slice(1)} Plan</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    
    <div id="payment-modal" class="modal">
      <div class="modal-content">
        <span class="close-modal">&times;</span>
        <h3>Update Payment Method</h3>
        <div class="payment-form">
          <div class="form-group">
            <label for="card-number">Card Number</label>
            <input type="text" id="card-number" placeholder="1234 5678 9012 3456">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="card-expiry">Expiry Date</label>
              <input type="text" id="card-expiry" placeholder="MM/YY">
            </div>
            <div class="form-group">
              <label for="card-cvc">CVC</label>
              <input type="text" id="card-cvc" placeholder="123">
            </div>
          </div>
          <div class="form-group">
            <label for="card-name">Name on Card</label>
            <input type="text" id="card-name" placeholder="John Doe">
          </div>
          <button id="save-payment" class="primary-btn">Save Payment Method</button>
        </div>
      </div>
    </div>
  `;

  // Add event listeners
  attachSubscriptionEventListeners();
}

// Attach event listeners to subscription UI elements
function attachSubscriptionEventListeners() {
  // Annual billing toggle
  const annualToggle = document.getElementById('annual-billing-toggle');
  if (annualToggle) {
    annualToggle.addEventListener('change', updatePriceDisplay);
  }
  
  // Subscribe buttons
  const subscribeButtons = document.querySelectorAll('.subscribe-btn');
  subscribeButtons.forEach(button => {
    button.addEventListener('click', function() {
      const planId = this.getAttribute('data-plan');
      showPaymentModal(planId);
    });
  });
  
  // Cancel subscription button
  const cancelButton = document.getElementById('cancel-subscription');
  if (cancelButton) {
    cancelButton.addEventListener('click', function() {
      if (confirm('Are you sure you want to cancel your subscription? You will lose access to premium features at the end of your billing period.')) {
        subscriptionManager.cancelSubscription();
        renderSubscriptionPage(); // Refresh the UI
        showNotification('Subscription canceled successfully. You will have access until the end of your billing period.');
      }
    });
  }
  
  // Update payment method button
  const updatePaymentButton = document.getElementById('update-payment');
  if (updatePaymentButton) {
    updatePaymentButton.addEventListener('click', function() {
      showPaymentModal(subscriptionManager.currentPlan, true);
    });
  }
  
  // Close modal button
  const closeModal = document.querySelector('.close-modal');
  if (closeModal) {
    closeModal.addEventListener('click', function() {
      document.getElementById('payment-modal').style.display = 'none';
    });
  }
  
  // Apply promo code button
  const applyPromoButton = document.getElementById('apply-promo');
  if (applyPromoButton) {
    applyPromoButton.addEventListener('click', function() {
      const promoCode = document.getElementById('promo-code').value.trim();
      if (promoCode) {
        const validPromo = subscriptionManager.validatePromoCode(promoCode);
        if (validPromo) {
          subscriptionManager.activePromoCode = promoCode;
          showNotification(`Promo code "${promoCode}" applied successfully! You'll receive ${validPromo.discount * 100}% off.`);
          updatePriceDisplay();
        } else {
          showNotification('Invalid or expired promo code. Please try again.', 'error');
        }
      }
    });
  }
  
  // Save payment method button
  const savePaymentButton = document.getElementById('save-payment');
  if (savePaymentButton) {
    savePaymentButton.addEventListener('click', processPayment);
  }
}

// Update price display when annual toggle is changed
function updatePriceDisplay() {
  const isAnnual = document.getElementById('annual-billing-toggle').checked;
  const priceElements = document.querySelectorAll('.plan-price .price');
  const intervalElements = document.querySelectorAll('.plan-price .interval');
  
  Object.keys(subscriptionPlans).forEach((planId, index) => {
    const plan = subscriptionPlans[planId];
    let price = plan.price;
    
    if (isAnnual) {
      // Apply annual discount and show yearly price
      price = price * 12 * (1 - 0.20); // 20% discount
      intervalElements[index].textContent = '/year';
    } else {
      intervalElements[index].textContent = `/${plan.interval}`;
    }
    
    // Apply promo code if active
    if (subscriptionManager.activePromoCode) {
      const promo = subscriptionManager.validatePromoCode(subscriptionManager.activePromoCode);
      if (promo && promo.applicablePlans.includes(planId)) {
        price = price * (1 - promo.discount);
      }
    }
    
    priceElements[index].textContent = `$${price.toFixed(2)}`;
  });
}

// Show the payment modal for subscribing or updating payment
function showPaymentModal(planId, isUpdate = false) {
  const modal = document.getElementById('payment-modal');
  const modalTitle = modal.querySelector('h3');
  const saveButton = document.getElementById('save-payment');
  
  // Update modal content based on action type
  if (isUpdate) {
    modalTitle.textContent = 'Update Payment Method';
    saveButton.textContent = 'Update Payment Method';
  } else {
    const isAnnual = document.getElementById('annual-billing-toggle').checked;
    const plan = subscriptionPlans[planId];
    const price = isAnnual ? 
      (plan.price * 12 * (1 - 0.20)).toFixed(2) : 
      plan.price.toFixed(2);
    
    modalTitle.textContent = `Subscribe to ${plan.name}`;
    saveButton.textContent = `Pay $${price} ${isAnnual ? 'Annually' : 'Monthly'}`;
  }
  
  // Store plan info for payment processing
  saveButton.setAttribute('data-plan', planId);
  saveButton.setAttribute('data-update', isUpdate);
  saveButton.setAttribute('data-annual', document.getElementById('annual-billing-toggle').checked);
  
  // Show the modal
  modal.style.display = 'block';
}

// Process payment when form is submitted
function processPayment() {
  const saveButton = document.getElementById('save-payment');
  const planId = saveButton.getAttribute('data-plan');
  const isUpdate = saveButton.getAttribute('data-update') === 'true';
  const isAnnual = saveButton.getAttribute('data-annual') === 'true';
  
  // Get form data
  const cardNumber = document.getElementById('card-number').value.trim();
  const cardExpiry = document.getElementById('card-expiry').value.trim();
  const cardCVC = document.getElementById('card-cvc').value.trim();
  const cardName = document.getElementById('card-name').value.trim();
  
  // Basic validation
  if (!cardNumber || !cardExpiry || !cardCVC || !cardName) {
    showNotification('Please fill in all payment fields.', 'error');
    return;
  }
  
  // Disable button and show loading state
  saveButton.disabled = true;
  saveButton.textContent = 'Processing...';
  
  // Process payment
  if (isUpdate) {
    // Just update payment method
    setTimeout(() => {
      subscriptionManager.updatePaymentMethod({
        type: 'Credit Card',
        lastFour: cardNumber.slice(-4),
        expiryDate: cardExpiry
      });
      
      document.getElementById('payment-modal').style.display = 'none';
      renderSubscriptionPage();
      showNotification('Payment method updated successfully!');
      
      saveButton.disabled = false;
    }, 1500);
  } else {
    // Process subscription payment
    PaymentProcessor.processPayment(planId, isAnnual, {
      number: cardNumber,
      expiry: cardExpiry,
      cvc: cardCVC,
      name: cardName
    }).then(result => {
      // Save payment method
      subscriptionManager.updatePaymentMethod({
        type: 'Credit Card',
        lastFour: result.lastFour,
        expiryDate: cardExpiry
      });
      
      // Subscribe to plan
      subscriptionManager.subscribeToPlan(
        planId, 
        isAnnual, 
        subscriptionManager.activePromoCode
      );
      
      document.getElementById('payment-modal').style.display = 'none';
      renderSubscriptionPage();
      
      showNotification(`Successfully subscribed to ${subscriptionPlans[planId].name}!`);
    }).catch(error => {
      showNotification(error.message, 'error');
    }).finally(() => {
      saveButton.disabled = false;
      saveButton.textContent = 'Save Payment Method';
    });
  }
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
      <p>${message}</p>
    </div>
    <button class="close-notification">&times;</button>
  `;
  
  document.body.appendChild(notification);
  
  // Add close handler
  notification.querySelector('.close-notification').addEventListener('click', function() {
    document.body.removeChild(notification);
  });
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      document.body.removeChild(notification);
    }
  }, 5000);
}

// Feature access check function - use this to protect premium features
function checkFeatureAccess(featureId) {
  if (!subscriptionManager) {
    console.error("Subscription manager not initialized");
    return false;
  }
  
  const hasAccess = subscriptionManager.canAccessFeature(featureId);
  
  if (!hasAccess) {
    // Show upgrade prompt
    showUpgradePrompt(featureId);
    return false;
  }
  
  return true;
}

// Show upgrade prompt when user tries to access premium feature
function showUpgradePrompt(featureId) {
  const feature = premiumFeatures[featureId];
  if (!feature) return;
  
  const requiredPlan = subscriptionPlans[feature.requiredTier];
  
  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.innerHTML = `
    <div class="upgrade-modal-content">
      <span class="close-modal">&times;</span>
      <div class="upgrade-header">
        <i class="fas fa-lock"></i>
        <h3>Premium Feature</h3>
      </div>
      <p class="upgrade-message">
        <strong>${feature.name}</strong> is available on the ${requiredPlan.name} and higher plans.
      </p>
      <p class="feature-description">${feature.description}</p>
      <div class="upgrade-actions">
        <button class="secondary-btn" id="cancel-upgrade">Maybe Later</button>
        <button class="primary-btn" id="view-plans">View Plans</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  modal.querySelector('.close-modal').addEventListener('click', function() {
    document.body.removeChild(modal);
  });
  
  modal.querySelector('#cancel-upgrade').addEventListener('click', function() {
    document.body.removeChild(modal);
  });
  
  modal.querySelector('#view-plans').addEventListener('click', function() {
    document.body.removeChild(modal);
    // Navigate to subscription page
    showSection('subscription');
  });
}

// Add subscription tab to navigation
function addSubscriptionNavItem() {
  const navBar = document.querySelector('.side-nav');
  if (!navBar) return;
  
  // Create subscription nav item
  const subscriptionNav = document.createElement('div');
  subscriptionNav.className = 'nav-item';
  subscriptionNav.setAttribute('data-section', 'subscription');
  subscriptionNav.innerHTML = `
    <i class="fas fa-crown"></i>
    <span>Subscription</span>
  `;
  
  // Add to nav bar
  navBar.appendChild(subscriptionNav);
  
  // Add event listener
  subscriptionNav.addEventListener('click', function() {
    showSection('subscription');
  });
}

// Initialize subscription UI
function initSubscriptionUI() {
  // Add subscription section to DOM if it doesn't exist
  if (!document.getElementById('subscription')) {
    const subscriptionSection = document.createElement('section');
    subscriptionSection.id = 'subscription';
    subscriptionSection.innerHTML = `
      <div id="subscription-container"></div>
    `;
    
    document.querySelector('main').appendChild(subscriptionSection);
  }
  
  // Add navigation item
  addSubscriptionNavItem();
  
  // Initialize subscription manager
  if (typeof subscriptionManager !== 'undefined' && typeof subscriptionManager.initialize === 'function') {
    subscriptionManager.initialize();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderSubscriptionPage,
    checkFeatureAccess,
    showUpgradePrompt,
    initSubscriptionUI
  };
} else {
  // Make functions globally available in browser
  window.renderSubscriptionPage = renderSubscriptionPage;
  window.checkFeatureAccess = checkFeatureAccess;
  window.showUpgradePrompt = showUpgradePrompt;
  window.initSubscriptionUI = initSubscriptionUI;
}
