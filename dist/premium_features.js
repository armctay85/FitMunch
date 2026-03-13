
// FitMunch Premium Features Module

const PremiumFeaturesManager = {
  // Premium feature categories
  featureCategories: {
    NUTRITION: 'nutrition',
    FITNESS: 'fitness',
    TRACKING: 'tracking',
    RECIPES: 'recipes',
    INTEGRATION: 'integration',
    PERSONALIZATION: 'personalization'
  },
  
  // Premium features list with details
  premiumFeatures: {
    aiNutritionCoach: {
      id: 'aiNutritionCoach',
      name: 'AI Nutrition Coach',
      description: 'Get personalized nutrition guidance with our AI-powered coach that adapts to your progress',
      category: 'nutrition',
      requiredTier: 'premium',
      icon: 'fa-robot',
      demoVideo: 'videos/ai-coach-demo.mp4',
      benefits: [
        'Personalized macronutrient targets',
        'Diet adjustment based on progress',
        'Food substitution recommendations',
        'Meal timing optimization'
      ]
    },
    advancedAnalytics: {
      id: 'advancedAnalytics',
      name: 'Advanced Progress Analytics',
      description: 'Detailed insights into your fitness and nutrition journey with visual charts and predictions',
      category: 'tracking',
      requiredTier: 'premium',
      icon: 'fa-chart-line',
      demoVideo: 'videos/analytics-demo.mp4',
      benefits: [
        'Visual progress charts',
        'Body composition analysis',
        'Trend predictions',
        'Exportable PDF reports'
      ]
    },
    premiumWorkouts: {
      id: 'premiumWorkouts',
      name: 'Premium Workout Library',
      description: 'Access to exclusive workout programs designed by certified fitness professionals',
      category: 'fitness',
      requiredTier: 'basic',
      icon: 'fa-dumbbell',
      demoVideo: 'videos/workout-demo.mp4',
      benefits: [
        'Expert-designed workout programs',
        'HD instructional videos',
        'Form check with AI feedback',
        'Custom workout builder'
      ]
    },
    gourmetRecipes: {
      id: 'gourmetRecipes',
      name: 'Gourmet Recipe Collection',
      description: 'Exclusive access to chef-created, nutritionist-approved meal recipes',
      category: 'recipes',
      requiredTier: 'basic',
      icon: 'fa-utensils',
      demoVideo: 'videos/recipes-demo.mp4',
      benefits: [
        'Chef-created recipes',
        'Nutritionist-approved meals',
        'Cooking tutorials',
        'Weekly menu planner'
      ]
    },
    deviceSync: {
      id: 'deviceSync',
      name: 'Multi-device Synchronization',
      description: 'Keep your data in sync across all your devices with cloud storage',
      category: 'integration',
      requiredTier: 'basic',
      icon: 'fa-sync',
      demoVideo: 'videos/sync-demo.mp4',
      benefits: [
        'Real-time data syncing',
        'Workout history storage',
        'Cross-platform compatibility',
        'Offline access with sync on reconnect'
      ]
    },
    mealPlanner: {
      id: 'mealPlanner',
      name: 'Advanced Meal Planner',
      description: 'Plan your meals weeks in advance with automatic grocery list generation',
      category: 'nutrition',
      requiredTier: 'premium',
      icon: 'fa-calendar-alt',
      demoVideo: 'videos/meal-planner-demo.mp4',
      benefits: [
        'Weekly meal scheduling',
        'Automatic grocery lists',
        'Leftover integration',
        'Budget optimization'
      ]
    },
    bodyComposition: {
      id: 'bodyComposition',
      name: 'Body Composition Tracker',
      description: 'Track detailed body composition metrics beyond just weight',
      category: 'tracking',
      requiredTier: 'premium',
      icon: 'fa-weight',
      demoVideo: 'videos/body-comp-demo.mp4',
      benefits: [
        'Body fat percentage tracking',
        'Muscle mass monitoring',
        'Visual body model',
        'Progress photo storage'
      ]
    },
    personalCoaching: {
      id: 'personalCoaching',
      name: 'Personal Coaching Sessions',
      description: 'One-on-one virtual sessions with certified nutritionists and fitness trainers',
      category: 'personalization',
      requiredTier: 'proCoach',
      icon: 'fa-user-friends',
      demoVideo: 'videos/coaching-demo.mp4',
      benefits: [
        'Monthly video consultations',
        'Personalized workout design',
        'Custom meal planning',
        'Progress assessment and feedback'
      ]
    }
  },
  
  // Get features by category
  getFeaturesByCategory: function(category) {
    return Object.values(this.premiumFeatures).filter(feature => feature.category === category);
  },
  
  // Get features by subscription tier
  getFeaturesByTier: function(tier) {
    const tierLevels = {
      'free': 0,
      'basic': 1,
      'premium': 2,
      'proCoach': 3
    };
    
    const tierLevel = tierLevels[tier];
    return Object.values(this.premiumFeatures).filter(feature => {
      const featureTierLevel = tierLevels[feature.requiredTier];
      return featureTierLevel <= tierLevel;
    });
  },
  
  // Check if user can access feature
  canAccessFeature: function(featureId, userTier) {
    const feature = this.premiumFeatures[featureId];
    if (!feature) return false;
    
    const tierLevels = {
      'free': 0,
      'basic': 1,
      'premium': 2,
      'proCoach': 3
    };
    
    return tierLevels[userTier] >= tierLevels[feature.requiredTier];
  },
  
  // Render premium features showcase
  renderFeaturesShowcase: function(containerId, userTier = 'free') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const categories = Object.values(this.featureCategories);
    let html = `
      <div class="premium-showcase">
        <h2>Premium Features</h2>
        <p>Discover all the powerful tools available with your subscription</p>
        
        <div class="feature-categories">
          <button class="category-btn active" data-category="all">All Features</button>
          ${categories.map(category => `
            <button class="category-btn" data-category="${category}">${this.formatCategoryName(category)}</button>
          `).join('')}
        </div>
        
        <div class="premium-features-grid">
    `;
    
    // Add all features to the grid
    Object.values(this.premiumFeatures).forEach(feature => {
      const canAccess = this.canAccessFeature(feature.id, userTier);
      
      html += `
        <div class="feature-card" data-category="${feature.category}" data-tier="${feature.requiredTier}">
          <div class="feature-icon">
            <i class="fas ${feature.icon}"></i>
          </div>
          <div class="feature-content">
            <h3>${feature.name}</h3>
            <p>${feature.description}</p>
            <div class="feature-benefits">
              <ul>
                ${feature.benefits.map(benefit => `<li>${benefit}</li>`).join('')}
              </ul>
            </div>
            <div class="feature-footer">
              ${canAccess ? 
                `<button class="access-btn primary-btn">Access Feature</button>` :
                `<div class="locked-badge"><i class="fas fa-lock"></i> ${feature.requiredTier.charAt(0).toUpperCase() + feature.requiredTier.slice(1)}</div>
                 <button class="upgrade-btn secondary-btn">Upgrade</button>`
              }
            </div>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
    
    container.innerHTML = html;
    this.attachEventListeners(containerId, userTier);
  },
  
  // Format category name for display
  formatCategoryName: function(category) {
    return category.charAt(0).toUpperCase() + category.slice(1);
  },
  
  // Attach event listeners
  attachEventListeners: function(containerId, userTier) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Category filter buttons
    const categoryButtons = container.querySelectorAll('.category-btn');
    categoryButtons.forEach(button => {
      button.addEventListener('click', () => {
        categoryButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        const category = button.getAttribute('data-category');
        const featureCards = container.querySelectorAll('.feature-card');
        
        featureCards.forEach(card => {
          if (category === 'all' || card.getAttribute('data-category') === category) {
            card.style.display = 'flex';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
    
    // Upgrade buttons
    const upgradeButtons = container.querySelectorAll('.upgrade-btn');
    upgradeButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Navigate to subscription page
        if (typeof showSection === 'function') {
          showSection('subscription');
        } else {
          window.location.href = 'subscription.html';
        }
      });
    });
    
    // Access feature buttons
    const accessButtons = container.querySelectorAll('.access-btn');
    accessButtons.forEach(button => {
      button.addEventListener('click', () => {
        const featureCard = button.closest('.feature-card');
        const featureId = this.getFeatureIdFromCard(featureCard);
        
        if (featureId) {
          this.launchFeature(featureId);
        }
      });
    });
  },
  
  // Get feature ID from card element
  getFeatureIdFromCard: function(cardElement) {
    const featureName = cardElement.querySelector('h3').textContent;
    const feature = Object.values(this.premiumFeatures).find(f => f.name === featureName);
    return feature ? feature.id : null;
  },
  
  // Launch a premium feature
  launchFeature: function(featureId) {
    const feature = this.premiumFeatures[featureId];
    if (!feature) return;
    
    console.log(`Launching premium feature: ${feature.name}`);
    
    // Here you would implement the logic to open the specific feature
    // For now we'll just show an alert
    alert(`Launching ${feature.name}. This feature would open in the app.`);
    
    // Track feature usage
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackFeatureUse(featureId, { premium: true });
    }
  }
};

// If in a module context, export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PremiumFeaturesManager;
} else {
  // Make available globally in browser
  window.PremiumFeaturesManager = PremiumFeaturesManager;
}
