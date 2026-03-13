// FitMunch App Core Functions

// Global variables
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || {
  name: 'Guest User',
  height: '175',
  weight: '70',
  goals: {
    calories: 2000,
    steps: 10000,
    activityPlan: {
      type: 'gym',
      frequency: 3,
      level: 'Beginner',
      duration: 1,
      preferredTime: 'Morning (6-9)'
    },
    description: 'Maintain weight and improve fitness'
  }
};

let dailyLog = {
  meals: {
    breakfast: [],
    lunch: [],
    dinner: [],
    snacks: []
  },
  totalCalories: 0,
  totalSteps: 0
};

// Navigation function
window.showSection = function(sectionId) {
  console.log("Showing section:", sectionId);
  
  // Hide all sections
  const sections = document.querySelectorAll('section, #dashboard');
  sections.forEach(section => {
    section.style.display = 'none';
    section.classList.remove('active-section');
  });

  // Show selected section
  const selectedSection = document.getElementById(sectionId);
  if (selectedSection) {
    selectedSection.style.display = 'block';
    selectedSection.classList.add('active-section');
    
    // Initialize section content if needed
    if (sectionId === 'meal') {
      if (typeof generateMealPlan === 'function') {
        setTimeout(generateMealPlan, 100);
      }
    } else if (sectionId === 'workout') {
      if (typeof generateActivityPlan === 'function') {
        setTimeout(generateActivityPlan, 100);
      }
    } else if (sectionId === 'shopping') {
      if (typeof updateShoppingList === 'function') {
        setTimeout(updateShoppingList, 100);
      }
    }
    
    // Scroll to top when changing sections (better mobile experience)
    window.scrollTo(0, 0);
    
    // Dispatch content updated event to reapply fixes
    setTimeout(() => {
      const contentUpdatedEvent = new CustomEvent('contentUpdated', { detail: { section: sectionId } });
      window.dispatchEvent(contentUpdatedEvent);
    }, 200);
  } else {
    console.warn(`Section with ID '${sectionId}' not found`);
  }

  // Update active nav item
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-section') === sectionId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Track page view in analytics if available
  if (typeof AnalyticsService !== 'undefined') {
    try {
      AnalyticsService.trackPageView(sectionId);
    } catch (e) {
      console.warn('Error tracking page view:', e);
    }
  }
}

// Mobile detection and special handling
function isMobileDevice() {
  return (window.innerWidth <= 768) || 
         (navigator.userAgent.match(/Android/i) ||
          navigator.userAgent.match(/webOS/i) ||
          navigator.userAgent.match(/iPhone/i) ||
          navigator.userAgent.match(/iPad/i) ||
          navigator.userAgent.match(/iPod/i) ||
          navigator.userAgent.match(/BlackBerry/i) ||
          navigator.userAgent.match(/Windows Phone/i));
}

function optimizeForMobile() {
  if (isMobileDevice()) {
    // Optimize layout for mobile
    document.documentElement.style.setProperty('--sidebar-width', '0px');
    
    // Add mobile class to body for CSS targeting
    document.body.classList.add('mobile-device');
    
    // Make dashboard cards stack
    const statCards = document.querySelectorAll('.stats-grid');
    statCards.forEach(grid => {
      grid.style.gridTemplateColumns = '1fr';
    });
    
    // Ensure workout tables are scrollable
    const tables = document.querySelectorAll('.exercise-table');
    tables.forEach(table => {
      table.style.overflowX = 'auto';
      table.style.display = 'block';
    });
    
    // Fix button sizing for better touch targeting
    const buttons = document.querySelectorAll('button, .nav-item, .primary-btn, .secondary-btn');
    buttons.forEach(button => {
      button.style.minHeight = '44px';
      button.style.minWidth = '44px';
      button.style.touchAction = 'manipulation';
    });
    
    // Ensure modals are properly sized
    const modals = document.querySelectorAll('.modal-content');
    modals.forEach(modal => {
      modal.style.width = '95%';
      modal.style.maxHeight = '80vh';
    });
    
    // Fix form elements for mobile
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.style.fontSize = '16px'; // Prevents iOS zoom
    });
    
    // Fix navigation items
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      // Enhance tap area
      item.style.padding = '12px 8px';
    });
  } else {
    document.body.classList.remove('mobile-device');
  }
}

// Call when document is loaded
document.addEventListener('DOMContentLoaded', function() {
  if (typeof optimizeForMobile === 'function') {
    optimizeForMobile();
    window.addEventListener('resize', optimizeForMobile);
  }
  
  // Add event delegation for better touch handling
  document.body.addEventListener('touchstart', function(e) {
    const target = e.target.closest('button, .nav-item, .primary-btn, .secondary-btn');
    if (target) {
      // Visual feedback on touch
      target.style.opacity = '0.8';
      setTimeout(() => {
        target.style.opacity = '1';
      }, 150);
    }
  }, { passive: true });
  
  // Ensure showSection is defined
  if (typeof window.showSection !== 'function') {
    window.showSection = function(sectionId) {
      console.log("Showing section:", sectionId);
      
      // Hide all sections
      const sections = document.querySelectorAll('section, #dashboard');
      sections.forEach(section => {
        section.style.display = 'none';
        section.classList.remove('active-section');
      });

      // Show selected section
      const selectedSection = document.getElementById(sectionId);
      if (selectedSection) {
        selectedSection.style.display = 'block';
        selectedSection.classList.add('active-section');
        
        // Initialize section content if needed
        if (sectionId === 'meal' && typeof generateMealPlan === 'function') {
          setTimeout(generateMealPlan, 100);
        } else if (sectionId === 'workout' && typeof generateActivityPlan === 'function') {
          setTimeout(generateActivityPlan, 100);
        } else if (sectionId === 'shopping' && typeof updateShoppingList === 'function') {
          setTimeout(updateShoppingList, 100);
        }
        
        // Scroll to top when changing sections
        window.scrollTo(0, 0);
      } else {
        console.warn(`Section with ID '${sectionId}' not found`);
      }

      // Update active nav item
      const navItems = document.querySelectorAll('.nav-item');
      navItems.forEach(item => {
        if (item.getAttribute('data-section') === sectionId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    };
  }
  
  // Show dashboard by default
  setTimeout(() => {
    if (typeof window.showSection === 'function') {
      window.showSection('dashboard');
    } else {
      console.error("showSection function not available");
      // Fallback for showing dashboard
      const dashboard = document.getElementById('dashboard');
      if (dashboard) dashboard.style.display = 'block';
    }
  }, 100);
});

// Update profile display
function updateProfileDisplay() {
  console.log("Updating profile display");
  const userName = document.getElementById('userName');
  const currentDate = document.getElementById('currentDate');
  const calorieDisplay = document.getElementById('calorieDisplay');
  const stepsDisplay = document.getElementById('stepsDisplay');
  const macroDisplay = document.getElementById('macroDisplay');

  if (userName) userName.textContent = userProfile.name || 'User';
  if (currentDate) currentDate.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  // Update profile stats
  const profileStats = document.querySelector('.profile-stats');
  if (profileStats) {
    profileStats.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${userProfile.height || '--'}cm</span>
        <span class="stat-label">Height</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${userProfile.weight || '--'}kg</span>
        <span class="stat-label">Weight</span>
      </div>
    `;
  }

  // Update goal displays
  if (calorieDisplay) calorieDisplay.textContent = userProfile.goals?.calories || 2000;
  if (stepsDisplay) stepsDisplay.textContent = userProfile.goals?.steps || 8000;

  // Load daily log from localStorage if available
  const storedDailyLog = localStorage.getItem('dailyLog');
  if (storedDailyLog) {
    try {
      const parsedDailyLog = JSON.parse(storedDailyLog);
      // Only update fields that exist in the stored log
      if (parsedDailyLog.totalCalories !== undefined) {
        dailyLog.totalCalories = parsedDailyLog.totalCalories;
      }
      if (parsedDailyLog.totalSteps !== undefined) {
        dailyLog.totalSteps = parsedDailyLog.totalSteps;
      }
      if (parsedDailyLog.meals) {
        dailyLog.meals = parsedDailyLog.meals;
      }
    } catch (error) {
      console.error('Error parsing daily log from localStorage:', error);
    }
  }

  // Update progress bars
  const calorieProgress = document.getElementById('calorieProgress');
  const stepsProgress = document.getElementById('stepsProgress');
  const activityProgress = document.getElementById('activityProgress');

  if (calorieProgress) {
    calorieProgress.textContent = `${dailyLog?.totalCalories || 0}/${userProfile.goals?.calories || 2000}`;
  }

  if (stepsProgress) {
    stepsProgress.textContent = `${dailyLog?.totalSteps || 0}/${userProfile.goals?.steps || 8000}`;
  }

  if (activityProgress) {
    activityProgress.textContent = userProfile.goals?.activityPlan?.type || '--';
  }

  // Check if fitness data is connected
  const hasFitnessConnections = document.getElementById('fitnessConnectionStatus');
  if (hasFitnessConnections) {
    // Get fitness connections from localStorage
    const fitnessConnections = JSON.parse(localStorage.getItem('fitnessConnections') || '{}');
    const connectedSources = Object.keys(fitnessConnections).filter(source => fitnessConnections[source].connected);

    if (connectedSources.length > 0) {
      hasFitnessConnections.innerHTML = `
        <i class="fas fa-link" style="color: #4CAF50;"></i>
        Connected to ${connectedSources.length} fitness ${connectedSources.length === 1 ? 'source' : 'sources'}
      `;
    } else {
      hasFitnessConnections.innerHTML = `
        <i class="fas fa-unlink" style="color: #777;"></i>
        No fitness apps connected
      `;
    }
  }
}

// Generate meal plan
function generateMealPlan() {
  console.log("Generating meal plan");
  // Only proceed if meal section is active
  const mealSection = document.getElementById('meal');
  if (!mealSection || !mealSection.classList.contains('active-section')) return;

  // Get selected goal type
  const goalType = document.getElementById('goalType')?.value || "Maintenance";

  // Sample meal plans based on goal
  const mealPlans = {
    "Weight Loss": {
      breakfast: ["Egg white omelet with spinach", "Greek yogurt with berries", "Protein smoothie"],
      lunch: ["Grilled chicken salad", "Tuna salad with crackers", "Veggie wrap with hummus"],
      dinner: ["Baked salmon with asparagus", "Turkey breast with steamed vegetables", "Tofu stir-fry"],
      snacks: ["Apple with almond butter", "Greek yogurt", "Protein bar"]
    },
    "Maintenance": {
      breakfast: ["Oatmeal with fruits and nuts", "Whole grain toast with avocado", "Smoothie bowl"],
      lunch: ["Turkey sandwich on whole grain", "Quinoa bowl with vegetables", "Lentil soup with bread"],
      dinner: ["Grilled fish with brown rice", "Chicken stir-fry with vegetables", "Pasta with lean meat sauce"],
      snacks: ["Handful of mixed nuts", "Fruit with yogurt", "Hummus with vegetables"]
    },
    "Muscle Gain": {
      breakfast: ["Protein pancakes with banana", "Scrambled eggs with toast", "Oatmeal with protein powder"],
      lunch: ["Chicken pasta with whole grain noodles", "Beef and vegetable stir-fry", "Salmon with quinoa"],
      dinner: ["Steak with sweet potato", "Chicken with brown rice and broccoli", "Turkey meatballs with pasta"],
      snacks: ["Protein shake", "Trail mix", "Cottage cheese with fruit"]
    }
  };

  // Get selected plan
  const selectedPlan = mealPlans[goalType] || mealPlans["Maintenance"];

  // Display meal plan
  const mealDisplay = document.getElementById('mealDisplay');
  if (mealDisplay) {
    let mealHTML = `
      <div class="meal-plan-details">
        <h3>${goalType} Meal Plan</h3>
        <div class="meal-category">
          <h4>Breakfast Options</h4>
          <ul>
            ${selectedPlan.breakfast.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
        <div class="meal-category">
          <h4>Lunch Options</h4>
          <ul>
            ${selectedPlan.lunch.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
        <div class="meal-category">
          <h4>Dinner Options</h4>
          <ul>
            ${selectedPlan.dinner.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
        <div class="meal-category">
          <h4>Snack Options</h4>
          <ul>
            ${selectedPlan.snacks.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;

    mealDisplay.innerHTML = mealHTML;
  }

  return selectedPlan;
}

// Calculate macros
function calculateMacros(foods) {
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  if (Array.isArray(foods)) {
    foods.forEach(food => {
      protein += food.protein || 0;
      carbs += food.carbs || 0;
      fat += food.fat || 0;
    });
  }

  return { protein, carbs, fat };
}

// Update shopping list based on meal plan, using API when available
async function updateShoppingList(plan) {
  console.log("Updating shopping list");
  // Only proceed if shopping section exists
  const shoppingSection = document.getElementById('shopping');
  if (!shoppingSection) return;

  // Show loading state
  const shopList = document.getElementById('shopList');
  if (shopList) {
    shopList.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Loading shopping list items and prices...</div>';
  }

  // Update shopping stats
  const totalCostEl = document.getElementById('totalCost');
  const totalItemsEl = document.getElementById('totalItems');
  
  if (totalCostEl) totalCostEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  if (totalItemsEl) totalItemsEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  // Sample shopping items (in a real app, this would be derived from the meal plan)
  const shoppingItems = [
    { name: "Chicken Breast", quantity: "1kg", price: 12.50, category: "Proteins" },
    { name: "Eggs", quantity: "1 dozen", price: 6.50, category: "Dairy & Eggs" },
    { name: "Greek Yogurt", quantity: "750g", price: 5.50, category: "Dairy & Eggs" },
    { name: "Salmon", quantity: "500g", price: 15.00, category: "Proteins" },
    { name: "Brown Rice", quantity: "1kg", price: 4.50, category: "Grains & Pasta" },
    { name: "Sweet Potato", quantity: "1kg", price: 4.00, category: "Fruits & Vegetables" },
    { name: "Broccoli", quantity: "500g", price: 3.50, category: "Fruits & Vegetables" },
    { name: "Spinach", quantity: "250g", price: 3.00, category: "Fruits & Vegetables" },
    { name: "Bananas", quantity: "1kg", price: 4.90, category: "Fruits & Vegetables" },
    { name: "Berries", quantity: "250g", price: 6.00, category: "Fruits & Vegetables" },
    { name: "Almonds", quantity: "250g", price: 6.50, category: "Nuts & Seeds" },
    { name: "Oats", quantity: "750g", price: 5.00, category: "Grains & Pasta" },
    { name: "Whole Grain Bread", quantity: "1 loaf", price: 4.20, category: "Grains & Pasta" },
    { name: "Olive Oil", quantity: "500ml", price: 8.00, category: "Other" },
    { name: "Protein Powder", quantity: "500g", price: 29.99, category: "Other" }
  ];

  try {
    // Get live prices if supermarket API is available
    let itemsWithPrices = shoppingItems;
    
    if (window.supermarketAPI && typeof window.supermarketAPI.getPricedShoppingList === 'function') {
      itemsWithPrices = await window.supermarketAPI.getPricedShoppingList(shoppingItems);
      console.log("Got live prices:", itemsWithPrices);
    }

    // Display shopping list
    if (shopList) {
      let listHTML = '';
      let totalCost = 0;
      let totalItems = itemsWithPrices.length;

      // Group items by category
      const categories = {
        'Proteins': [],
        'Fruits & Vegetables': [],
        'Grains & Pasta': [],
        'Dairy & Eggs': [],
        'Nuts & Seeds': [],
        'Other': []
      };

      // Assign items to categories
      itemsWithPrices.forEach(item => {
        // Calculate total cost
        if (item.bestPrice) {
          const priceValue = parseFloat(item.bestPrice.replace('$', ''));
          if (!isNaN(priceValue)) {
            totalCost += priceValue;
          }
        } else if (item.price) {
          totalCost += item.price;
        }
        
        if (item.category in categories) {
          categories[item.category].push(item);
        } else {
          categories['Other'].push(item);
        }
      });

      // Build HTML for each category
      for (const [category, items] of Object.entries(categories)) {
        if (items.length > 0) {
          listHTML += `<h3 class="shop-category">${category}</h3><ul class="shopping-items">`;

          items.forEach(item => {
            // Determine price display
            let priceDisplay = '';
            let storeTag = '';
            
            if (item.bestPrice) {
              priceDisplay = `<span class="best-price">${item.bestPrice}</span>`;
              if (item.bestStore) {
                storeTag = `<span class="store-tag">${item.bestStore}</span>`;
              }
            } else {
              priceDisplay = `$${item.price.toFixed(2)}`;
            }
            
            listHTML += `
              <li class="shop-item">
                <div class="item-details">
                  <span class="item-name">${item.name}</span>
                  <span class="item-quantity">${item.quantity}</span>
                </div>
                <div class="item-price-container">
                  <div class="item-price">${priceDisplay}</div>
                  ${storeTag}
                </div>
              </li>
            `;
          });

          listHTML += '</ul>';
        }
      }

      // Add price comparison feature
      listHTML += `
        <div class="supermarket-comparison">
          <h3>Price Check Feature</h3>
          <div class="price-check-container">
            <div class="price-check-input">
              <input type="text" id="priceCheckInput" placeholder="Enter product name...">
              <button id="priceCheckBtn" class="price-check-btn">
                <i class="fas fa-search"></i> Check Prices
              </button>
            </div>
            <div id="priceCheckResults" class="price-check-results"></div>
          </div>
        </div>
      `;

      shopList.innerHTML = listHTML;

      // Update shopping stats
      if (totalCostEl) totalCostEl.textContent = `$${totalCost.toFixed(2)}`;
      if (totalItemsEl) totalItemsEl.textContent = totalItems;
      
      // Add event listener for price checking
      const priceCheckBtn = document.getElementById('priceCheckBtn');
      if (priceCheckBtn) {
        priceCheckBtn.addEventListener('click', checkProductPrice);
      }
      
      const priceCheckInput = document.getElementById('priceCheckInput');
      if (priceCheckInput) {
        priceCheckInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            checkProductPrice();
          }
        });
      }
    }
  } catch (error) {
    console.error("Error updating shopping list:", error);
    if (shopList) {
      shopList.innerHTML = `<div class="error-indicator">Error loading shopping list: ${error.message}</div>`;
    }
  }
}

// Function to check product price
async function checkProductPrice() {
  const productInput = document.getElementById('priceCheckInput');
  const resultsContainer = document.getElementById('priceCheckResults');
  
  if (!productInput || !resultsContainer) return;
  
  const product = productInput.value.trim();
  if (!product) {
    resultsContainer.innerHTML = '<div class="error-message">Please enter a product name</div>';
    return;
  }
  
  resultsContainer.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Checking prices...</div>';
  
  try {
    // Use supermarket API if available
    if (window.supermarketAPI && typeof window.supermarketAPI.compareProductPrices === 'function') {
      const priceInfo = await window.supermarketAPI.compareProductPrices(product);
      
      if (priceInfo) {
        const html = `
          <div class="price-comparison-result">
            <h4>${priceInfo.product}</h4>
            <div class="supermarket-prices">
              <div class="store-price ${priceInfo.cheapest === 'Woolworths' ? 'best-price' : ''}">
                <div class="store-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/en/thumb/a/a3/Woolworths_Supermarkets_logo.svg/200px-Woolworths_Supermarkets_logo.svg.png" alt="Woolworths">
                </div>
                <div class="store-price-value">$${priceInfo.woolworths.price}</div>
                ${priceInfo.cheapest === 'Woolworths' ? '<div class="best-price-tag">Best Price</div>' : ''}
              </div>
              
              <div class="store-price ${priceInfo.cheapest === 'Coles' ? 'best-price' : ''}">
                <div class="store-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Coles_logo.svg/200px-Coles_logo.svg.png" alt="Coles">
                </div>
                <div class="store-price-value">$${priceInfo.coles.price}</div>
                ${priceInfo.cheapest === 'Coles' ? '<div class="best-price-tag">Best Price</div>' : ''}
              </div>
            </div>
            
            <div class="price-compare-footer">
              <p>Save $${priceInfo.savings} by shopping at ${priceInfo.cheapest}</p>
              <p class="price-update-time">Prices last updated: ${new Date().toLocaleString()}</p>
              <button class="add-to-list-btn" onclick="addItemToShoppingList('${priceInfo.product}')">
                <i class="fas fa-cart-plus"></i> Add to Shopping List
              </button>
            </div>
          </div>
        `;
        
        resultsContainer.innerHTML = html;
      } else {
        resultsContainer.innerHTML = '<div class="error-message">Could not find price information for this product</div>';
      }
    } else {
      resultsContainer.innerHTML = '<div class="error-message">Price comparison service is not available</div>';
    }
  } catch (error) {
    console.error("Error checking product price:", error);
    resultsContainer.innerHTML = `<div class="error-message">Error checking prices: ${error.message}</div>`;
  }
}

// Function to add an item to the shopping list
function addItemToShoppingList(productName) {
  if (!productName) return;
  
  // Get current shopping list
  const shoppingItems = JSON.parse(localStorage.getItem('shoppingList') || '[]');
  
  // Add new item
  shoppingItems.push({
    name: productName,
    quantity: "1 item",
    price: 0,
    category: "Other"
  });
  
  // Save to localStorage
  localStorage.setItem('shoppingList', JSON.stringify(shoppingItems));
  
  // Update the UI
  updateShoppingList();
  
  // Show confirmation message
  const resultsContainer = document.getElementById('priceCheckResults');
  if (resultsContainer) {
    resultsContainer.innerHTML += `
      <div class="success-message">
        <i class="fas fa-check-circle"></i> ${productName} added to your shopping list
      </div>
    `;
  }
}

// Generate workout/activity plan
function generateActivityPlan() {
  console.log("Generating activity plan");
  // Only proceed if workout section is active
  const workoutSection = document.getElementById('workout');
  if (!workoutSection || !workoutSection.classList.contains('active-section')) return;

  // Get activity plan from user profile
  const activityPlan = userProfile.goals?.activityPlan || {
    type: 'gym',
    frequency: 3,
    level: 'Beginner',
    duration: 1,
    preferredTime: 'Morning (6-9)'
  };

  // Generate sophisticated workout plan based on type and level
  let workouts = [];

  // ======== PREMIUM WORKOUT PLANS INSPIRED BY PROFESSIONAL TRAINING PROGRAMS ========

  // GYM WORKOUTS - Using scientifically-backed training splits and progressive overload principles
  if (activityPlan.type === 'gym') {
    if (activityPlan.level === 'Beginner') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Foundation Strength Training',
          exercises: [
            { name: 'Goblet Squat', sets: 3, reps: '10-12', rest: '60s', notes: 'Focus on form and depth' },
            { name: 'Push-ups (or Incline Push-ups)', sets: 3, reps: '8-10', rest: '60s', notes: 'Full range of motion' },
            { name: 'Dumbbell Row', sets: 3, reps: '10 each side', rest: '60s', notes: 'Squeeze shoulder blades together' },
            { name: 'Glute Bridge', sets: 3, reps: '15', rest: '45s', notes: 'Focus on hip extension' },
            { name: 'Plank', sets: 3, time: '30s', rest: '30s', notes: 'Maintain neutral spine' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Full Body', 'Foundation', 'Technique'],
          warmup: '5-10 minutes light cardio + dynamic stretching',
          cooldown: '5 minutes static stretching, focusing on worked muscle groups'
        },
        { 
          day: 'Wednesday', 
          workout: 'Cardio & Core Conditioning',
          exercises: [
            { name: 'Treadmill/Bike/Elliptical', time: '5 min', intensity: 'Warm-up', notes: 'Easy pace to start' },
            { name: 'Interval Training', sets: '6-8', work: '30s', rest: '90s', notes: 'Moderate to high intensity' },
            { name: 'Bicycle Crunches', sets: 3, reps: '15 each side', rest: '45s', notes: 'Control the motion' },
            { name: 'Mountain Climbers', sets: 3, time: '30s', rest: '30s', notes: 'Maintain plank position' },
            { name: 'Russian Twists', sets: 3, reps: '12-15 each side', rest: '45s', notes: 'Keep chest up' },
            { name: 'Steady State Cardio', time: '10 min', intensity: 'Cool-down', notes: 'Gradually decrease intensity' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Cardiovascular', 'Core Stability', 'Fat Burning'],
          warmup: '5 minutes light cardio + dynamic movements',
          cooldown: '5 minutes walking + breathing exercises'
        },
        { 
          day: 'Friday', 
          workout: 'Functional Movement Development',
          exercises: [
            { name: 'Dumbbell Romanian Deadlift', sets: 3, reps: '10-12', rest: '60s', notes: 'Hip hinge movement' },
            { name: 'Incline Push-ups', sets: 3, reps: '10-12', rest: '60s', notes: 'Control the descent' },
            { name: 'TRX/Inverted Row', sets: 3, reps: '8-10', rest: '60s', notes: 'Pull shoulder blades together' },
            { name: 'Split Squat', sets: 3, reps: '10 each leg', rest: '60s', notes: 'Keep front knee aligned' },
            { name: 'Side Plank', sets: 3, time: '20s each side', rest: '30s', notes: 'Stack shoulders and hips' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Functional Strength', 'Balance', 'Stability'],
          warmup: '5-10 minutes of mobility work focusing on joints',
          cooldown: '5-10 minutes of gentle stretching and deep breathing'
        }
      ];
    } else if (activityPlan.level === 'Intermediate') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Upper Body Push Focus',
          exercises: [
            { name: 'Barbell Bench Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Control the eccentric' },
            { name: 'Seated Dumbbell Shoulder Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Full range of motion' },
            { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: '75s', notes: '45° incline angle' },
            { name: 'Cable Lateral Raises', sets: 3, reps: '12-15', rest: '60s', notes: 'Lead with elbows' },
            { name: 'Tricep Rope Pushdown', sets: 3, reps: '12-15', rest: '60s', notes: 'Keep elbows tucked' },
            { name: 'Overhead Tricep Extension', sets: 3, reps: '12-15', rest: '60s', notes: 'Full extension' }
          ],
          duration: activityPlan.duration,
          intensity: 'Challenging',
          focusAreas: ['Chest', 'Shoulders', 'Triceps', 'Upper Body Power'],
          warmup: '5 minutes light cardio + rotator cuff activation',
          cooldown: 'Chest and shoulder stretches, 5-10 minutes'
        },
        { 
          day: 'Tuesday', 
          workout: 'Upper Body Pull Focus',
          exercises: [
            { name: 'Barbell Bent-over Rows', sets: 4, reps: '8-10', rest: '90s', notes: 'Drive elbows back' },
            { name: 'Pull-ups (or Lat Pulldown)', sets: 4, reps: '6-8', rest: '90s', notes: 'Full hang at bottom' },
            { name: 'Cable Face Pulls', sets: 3, reps: '12-15', rest: '60s', notes: 'External rotation at end' },
            { name: 'Single-arm Dumbbell Row', sets: 3, reps: '10-12 each', rest: '60s', notes: 'Stabilize core' },
            { name: 'EZ Bar Bicep Curl', sets: 3, reps: '10-12', rest: '60s', notes: 'Control the motion' },
            { name: 'Hammer Curls', sets: 3, reps: '10-12', rest: '60s', notes: 'Neutral grip' }
          ],
          duration: activityPlan.duration,
          intensity: 'Challenging',
          focusAreas: ['Back', 'Biceps', 'Rear Delts', 'Grip Strength'],
          warmup: '5 minutes cardio + band pull-aparts and dislocations',
          cooldown: 'Back, biceps and forearm stretches, 5-10 minutes'
        },
        { 
          day: 'Thursday', 
          workout: 'Lower Body & Core',
          exercises: [
            { name: 'Barbell Back Squat', sets: 4, reps: '8-10', rest: '120s', notes: 'Break parallel' },
            { name: 'Romanian Deadlift', sets: 4, reps: '8-10', rest: '120s', notes: 'Maintain neutral spine' },
            { name: 'Walking Lunges', sets: 3, reps: '12 steps total', rest: '90s', notes: 'Step into lunge' },
            { name: 'Leg Press', sets: 3, reps: '12-15', rest: '90s', notes: 'Control the eccentric phase' },
            { name: 'Cable Crunch', sets: 3, reps: '15', rest: '60s', notes: 'Round the spine' },
            { name: 'Hanging Leg Raise', sets: 3, reps: '12', rest: '60s', notes: 'Avoid swinging' }
          ],
          duration: activityPlan.duration,
          intensity: 'Challenging',
          focusAreas: ['Quadriceps', 'Hamstrings', 'Glutes', 'Core'],
          warmup: '5-10 minutes cardio + hip/ankle mobility work',
          cooldown: 'Lower body and spine stretches, 5-10 minutes'
        },
        { 
          day: 'Friday', 
          workout: 'Conditioning & Mobility',
          exercises: [
            { name: 'HIIT Sprint Intervals', sets: '10', work: '30s', rest: '60s', notes: 'Max effort sprints' },
            { name: 'Foam Rolling Circuit', muscle: 'IT Bands, Quads, Lats, Upper Back', time: '2 min each', notes: 'Roll slowly' },
            { name: 'Dynamic Stretching Routine', time: '10 min', notes: 'World\'s Greatest Stretch, Walking Lunges with Rotation' },
            { name: 'Yoga Flow Sequence', time: '10-15 min', notes: 'Focus on hip openers and thoracic mobility' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate to High',
          focusAreas: ['Cardiovascular', 'Recovery', 'Mobility', 'Flexibility'],
          warmup: '5 minutes light cardio to raise body temperature',
          cooldown: 'Full body relaxation sequence, 5 minutes'
        }
      ];
    } else if (activityPlan.level === 'Advanced') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Push - Strength Focus',
          exercises: [
            { name: 'Barbell Bench Press', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, focus on power' },
            { name: 'Military Press', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, strict form' },
            { name: 'Weighted Dips', sets: 4, reps: '6-8', rest: '2 min', notes: 'Control the descent' },
            { name: 'Incline Dumbbell Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Full range of motion' },
            { name: 'Cable Flyes', sets: 3, reps: '12', rest: '60s', notes: 'Slight bend in elbows' },
            { name: 'Tricep Rope Extension', sets: 3, reps: '12', rest: '60s', notes: 'Superset with next exercise' },
            { name: 'Overhead Tricep Extension', sets: 3, reps: '12', rest: '60s', notes: 'Superset with previous exercise' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Chest', 'Shoulders', 'Triceps', 'Strength Development'],
          warmup: '5-10 minutes cardio + progressive warm-up sets',
          cooldown: 'Chest and shoulder stretches, nerve flossing for triceps'
        },
        { 
          day: 'Tuesday', 
          workout: 'Pull - Strength Focus',
          exercises: [
            { name: 'Deadlifts', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, maintain form' },
            { name: 'Weighted Pull-ups', sets: 4, reps: '6-8', rest: '2 min', notes: 'Control the movement' },
            { name: 'Barbell Rows', sets: 4, reps: '8', rest: '90s', notes: 'Bent at 45° angle' },
            { name: 'T-bar Rows', sets: 3, reps: '10', rest: '90s', notes: 'Close grip attachment' },
            { name: 'Cable Face Pulls', sets: 3, reps: '15', rest: '60s', notes: 'External rotation focus' },
            { name: 'Preacher Curls', sets: 3, reps: '10', rest: '60s', notes: 'Superset with next exercise' },
            { name: 'Hammer Curls', sets: 3, reps: '12', rest: '60s', notes: 'Superset with previous exercise' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Back', 'Biceps', 'Traps', 'Grip Strength'],
          warmup: 'Progressive warm-up with light deadlifts and hanging scapular retractions',
          cooldown: 'Back, biceps and forearm stretches, spinal decompression'
        },
        { 
          day: 'Wednesday', 
          workout: 'Active Recovery',
          exercises: [
            { name: 'Light Cardio (Zone 2)', time: '30 min', heart_rate: '60-70% max', notes: 'Conversation pace' },
            { name: 'Foam Rolling Circuit', muscle: 'Full Body', time: '15 min', notes: 'Focus on trigger points' },
            { name: 'Mobility Routine', focus: 'Joint ROM', time: '10 min', notes: 'Controlled articulations' },
            { name: 'Static Stretching', focus: 'Problem Areas', time: '10 min', notes: '30s holds minimum' }
          ],
          duration: activityPlan.duration * 0.5,
          intensity: 'Light',
          focusAreas: ['Recovery', 'Mobility', 'Blood Flow', 'Tissue Quality'],
          warmup: 'Light movement to increase body temperature',
          cooldown: 'Deep breathing and relaxation techniques'
        },
        { 
          day: 'Thursday', 
          workout: 'Legs - Strength Focus',
          exercises: [
            { name: 'Back Squat', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, break parallel' },
            { name: 'Front Squat', sets: 4, reps: '8', rest: '2 min', notes: 'Maintain upright torso' },
            { name: 'Romanian Deadlift', sets: 4, reps: '8', rest: '2 min', notes: 'Feel stretch in hamstrings' },
            { name: 'Bulgarian Split Squats', sets: 3, reps: '10 each', rest: '90s', notes: 'Control descent' },
            { name: 'Leg Extensions', sets: 3, reps: '12', rest: '60s', notes: 'Superset with next exercise' },
            { name: 'Leg Curls', sets: 3, reps: '12', rest: '60s', notes: 'Superset with previous exercise' },
            { name: 'Standing Calf Raises', sets: 4, reps: '15', rest: '60s', notes: 'Full range of motion' }
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Strength Development'],
          warmup: '5-10 minutes cardio + progressive warm-up squats, hip/ankle mobility',
          cooldown: 'Lower body stretches, foam rolling for quads and IT bands'
        },
        { 
          day: 'Friday', 
          workout: 'Upper Body - Hypertrophy',
          exercises: [
            { name: 'Incline Bench Press', sets: 4, reps: '10', rest: '90s', notes: 'Control tempo: 2-0-2' },
            { name: 'Seated DB Shoulder Press', sets: 4, reps: '10', rest: '90s', notes: 'Full range of motion' },
            { name: 'Wide Grip Lat Pulldown', sets: 4, reps: '12', rest: '90s', notes: 'Drive elbows down' },
            { name: 'Seated Cable Row', sets: 4, reps: '12', rest: '90s', notes: 'Squeeze at contraction' },
            { name: 'Lateral Raises', sets: 3, reps: '15', rest: '45s', notes: 'Superset with next exercise' },
            { name: 'Rear Delt Flyes', sets: 3, reps: '15', rest: '45s', notes: 'Superset with previous exercise' },
            { name: 'EZ Bar Curl', sets: 3, reps: '12', rest: '45s', notes: 'Superset with next exercise' },
            { name: 'Skull Crushers', sets: 3, reps: '12', rest: '45s', notes: 'Superset with previous exercise' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Upper Body', 'Muscle Growth', 'Mind-Muscle Connection', 'Metabolic Stress'],
          warmup: 'Light upper body circuit with bands and light weights',
          cooldown: 'Upper body stretches, focusing on chest and lats'
        },
        { 
          day: 'Saturday', 
          workout: 'Conditioning & Athletic Development',
          exercises: [
            { name: 'Circuit Training', rounds: 5, work: '45s', rest: '15s', between_rounds: '2 min', exercises: 'Battle Ropes, KB Swings, Box Jumps, Burpees, Rower, Ball Slams' },
            { name: 'Core Circuit', rounds: 4, rest: '60s', exercises: 'Ab Wheel, Hanging Leg Raises, Weighted Russian Twists, Plank Variations' },
            { name: 'Weighted Carries', sets: 4, distance: '20m each', variations: 'Farmers Walk, Overhead Carry, Suitcase Carry, Front Rack Carry' },
            { name: 'Medicine Ball Throws', sets: 4, reps: '8', focus: 'Explosive Power', variations: 'Chest Pass, Overhead Slam, Rotational Throw' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Conditioning', 'Core Strength', 'Power Development', 'Work Capacity'],
          warmup: 'Dynamic movement prep and activation drills',
          cooldown: 'Gradual heart rate reduction, full body stretch routine'
        }
      ];
    }
  } else if (activityPlan.type === 'run') {
    if (activityPlan.level === 'Beginner') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Walk/Run Intervals',
          structure: [
            { phase: 'Warm-up', action: 'Brisk Walk', time: '5 min', notes: 'Gradually increase pace' },
            { phase: 'Work Intervals', sets: '6-8', work: 'Run 1 min', recovery: 'Walk 2 min', notes: 'Maintain good form, focus on breathing' },
            { phase: 'Cool-down', action: 'Easy Walk', time: '5 min', notes: 'Gradually decrease heart rate' }
          ],
          tips: [
            'Focus on maintaining good posture throughout',
            'Land midfoot, not on heels or toes',
            'Keep a consistent, comfortable pace during run intervals',
            'Breathe rhythmically - try 3-step inhale, 2-step exhale pattern'
          ],
          duration: activityPlan.duration,
          intensity: 'Light to Moderate',
          focusAreas: ['Cardiovascular Base', 'Running Form', 'Endurance Building'],
          equipmentNeeded: 'Running shoes, comfortable clothes, optional: fitness watch',
          terrainSuggestion: 'Flat, softer surfaces like tracks or grass when possible'
        },
        { 
          day: 'Wednesday', 
          workout: 'Recovery Walk & Strength',
          structure: [
            { phase: 'Active Recovery', action: 'Brisk Walking', time: '30 min', notes: 'Moderate pace, focus on arm swing and posture' },
            { phase: 'Strength Circuit', rounds: 2, exercises: [
              { name: 'Bodyweight Squats', reps: 15, rest: '30s', notes: 'Knee over toes, depth as comfortable' },
              { name: 'Walking Lunges', reps: '10 each leg', rest: '30s', notes: 'Step into lunge position, maintain balance' },
              { name: 'Standing Calf Raises', reps: 15, rest: '30s', notes: 'Use wall or chair for balance if needed' }
            ]}
          ],
          tips: [
            'Use walking as active recovery to promote blood flow',
            'Focus on proper exercise technique rather than speed',
            'These exercises support running mechanics',
            ''Add arm movements to walking to increase intensity slightly'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Active Recovery', 'Leg Strength', 'Technique'],
          equipmentNeeded: 'Running shoes, comfortable clothes',
          terrainSuggestion: 'Mix of surfaces if possible to challenge stability'
        },
        { 
          day: 'Friday', 
          workout: 'Steady State Run',
          structure: [
            { phase: 'Warm-up', action: 'Brisk Walk', time: '5 min', notes: 'Gradually increase pace' },
            { phase: 'Main Session', action: 'Continuous Easy Run', time: '15-20 min', notes: 'Conversational pace - should be able to talk in complete sentences' },
            { phase: 'Cool-down', action: 'Easy Walk', time: '5 min', notes: 'Gradually decrease heart rate' }
          ],
          tips: [
            'Focus on maintaining even effort throughout, not pace',
            'This builds aerobic endurance - your foundation for running',
            'If you need to walk briefly, that\'s fine - then resume running',
            'Pay attention to your breathing pattern and keep it regular'
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Aerobic Development', 'Running Economy', 'Mental Endurance'],
          equipmentNeeded: 'Running shoes, comfortable clothes, optional: fitness watch',
          terrainSuggestion: 'Consistent surface, avoid hills if possible'
        }
      ];
    } else if (activityPlan.level === 'Intermediate') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Tempo Run',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog', time: '10 min', notes: 'Gradually increase pace' },
            { phase: 'Main Session', action: 'Comfortably Hard Pace', time: '20 min', notes: 'Should be able to speak in short phrases, RPE 6-7/10' },
            { phase: 'Cool-down', action: 'Easy Jog/Walk', time: '10 min', notes: 'Gradually decrease heart rate' }
          ],
          paceGuidelines: {
            description: 'Tempo pace is approximately 20-30 seconds slower than your 5K race pace',
            effort: '75-85% of maximum heart rate',
            perceived: 'Comfortably hard - you could maintain for 30-40 minutes'
          },
          tips: [
            'Focus on consistent pacing throughout the tempo portion',
            'This workout builds lactate threshold and running economy',
            'If you\'re using heart rate, stay in zone 3-4',
            'Maintain good form even as fatigue sets in'
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate to High',
          focusAreas: ['Lactate Threshold', 'Running Economy', 'Mental Toughness'],
          equipmentNeeded: 'Running shoes, comfortable clothes, fitness watch recommended',
          terrainSuggestion: 'Flat to slightly rolling terrain'
        },
        { 
          day: 'Wednesday', 
          workout: 'Interval Training',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog + Drills', time: '10 min', notes: 'Include high knees, butt kicks, skipping' },
            { phase: 'Main Session', intervals: '8-10', work: '400m at 5K pace', recovery: '200m easy jog', notes: 'Focus on consistent interval times' },
            { phase: 'Cool-down', action: 'Easy Jog/Walk', time: '10 min', notes: 'Gradually decrease heart rate' }
          ],
          paceGuidelines: {
            description: '400m intervals should be at your current 5K race pace',
            effort: '85-90% of maximum heart rate during intervals',
            recovery: 'Active recovery at 60-65% max heart rate'
          },
          tips: [
            'These intervals improve VO2 max and running efficiency',
            'Focus on maintaining form during high intensity portions',
            'Recovery portions are important - don\'t skip them',
            'Try to maintain consistent speeds for all intervals'
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Speed', 'VO2 Max', 'Running Form Under Fatigue'],
          equipmentNeeded: 'Running shoes, comfortable clothes, fitness watch, optional: access to track',
          terrainSuggestion: 'Track or flat measured route'
        },
        { 
          day: 'Thursday', 
          workout: 'Recovery Run & Strength',
          structure: [
            { phase: 'Easy Run', action: 'Very Easy Pace', time: '30 min', notes: 'Truly conversational pace, RPE 3-4/10' },
            { phase: 'Strength Circuit', rounds: 2, exercises: [
              { name: 'Walking Lunges', reps: '12 each leg', rest: '30s', notes: 'Focus on stability' },
              { name: 'Single-leg Deadlifts', reps: '10 each leg', rest: '30s', notes: 'Balance focus' },
              { name: 'Plank', time: '45s', rest: '30s', notes: 'Maintain neutral spine' },
              { name: 'Calf Raises', reps: '20', rest: '30s', notes: 'Both legs, then single leg' }
            ]}
          ],
          paceGuidelines: {
            description: 'Recovery run pace should be 1:30-2:00 min/mile slower than marathon pace',
            effort: '60-65% of maximum heart rate',
            perceived: 'Easy - you should be able to hold a full conversation'
          },
          tips: [
            'Recovery runs improve capillary density and clear waste products',
            'Run by effort, not pace - this should feel very easy',
            'The strength exercises target running-specific muscles',
            'Focus on form with strength work to prevent injury'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Recovery', 'Running-Specific Strength', 'Injury Prevention'],
          equipmentNeeded: 'Running shoes, comfortable clothes',
          terrainSuggestion: 'Mix of surfaces if possible to challenge stability'
        },
        { 
          day: 'Saturday', 
          workout: 'Long Run',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog', time: '10 min', notes: 'Start slower than planned long run pace' },
            { phase: 'Main Session', action: 'Steady Endurance Pace', time: '60-75 min', notes: 'Conversational pace, RPE 4-5/10' },
            { phase: 'Cool-down', action: 'Easy Walk', time: '5 min', notes: 'Active recovery' }
          ],
          paceGuidelines: {
            description: 'Long run pace should be 1:00-1:30 min/mile slower than marathon pace',
            effort: '65-75% of maximum heart rate',
            perceived: 'Comfortable - conversation should be possible throughout'
          },
          fueling: {
            before: 'Light meal 2-3 hours prior, small snack 30-60 min before if needed',
            during: 'Consider fluids every 15-20 min, carbohydrates if run exceeds 75 min',
            after: 'Protein and carbohydrates within 30 min of finishing'
          },
          tips: [
            'The long run builds endurance and fat-burning capacity',
            'Start conservatively - it should feel too easy in the first third',
            'Practice your hydration/fueling strategy during long runs',
            'Focus on maintaining form as fatigue develops'
          ],
          duration: activityPlan.duration * 1.5,
          intensity: 'Moderate',
          focusAreas: ['Endurance', 'Fat Adaptation', 'Mental Endurance'],
          equipmentNeeded: 'Running shoes, comfortable clothes, optional: fitness watch',
          terrainSuggestion: 'Mix of surfaces, simulate race conditions if training for event'
        }
      ];
    } else if (activityPlan.level === 'Advanced') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Recovery Run',
          structure: [
            { phase: 'Warm-up', action: 'Very Easy Jog', time: '5 min', notes: 'Gradual start' },
            { phase: 'Main Session', action: 'Easy Aerobic Running', time: '40 min', notes: 'True recovery pace, RPE 3-4/10' },
            { phase: 'Cool-down', action: 'Walk', time: '5 min', notes: 'Gradual decrease in heart rate' }
          ],
          paceGuidelines: {
            description: '2:00+ min/mile slower than marathon pace',
            effort: '60-65% of maximum heart rate',
            perceived: 'Very easy - should be able to hold full conversation'
          },
          tips: [
            'Purpose is active recovery - resist urge to run faster',
            'Focus on relaxed, efficient form',
            'Run on soft surfaces when possible to reduce impact',
            'Use heart rate monitor to ensure intensity stays low'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Active Recovery', 'Blood Flow', 'Easy Aerobic Development'],
          equipmentNeeded: 'Running shoes, comfortable clothes, heart rate monitor recommended',
          terrainSuggestion: 'Soft surfaces preferred (trails, grass)'
        },
        { 
          day: 'Tuesday', 
          workout: 'Interval Session',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog + Dynamic Drills', time: '15 min', notes: 'Include running form drills' },
            { phase: 'Main Workout', intervals: '6-8', work: '800m at 5K pace', recovery: '400m easy jog', notes: 'Focus on consistent interval times' },
            { phase: 'Secondary Set', intervals: '4', work: '200m fast', recovery: '200m very easy jog', notes: 'Fast but controlled strides' },
            { phase: 'Cool-down', action: 'Easy Jog', time: '10 min', notes: 'Gradual reduction in heart rate' }
          ],
          paceGuidelines: {
            '800m intervals': 'At or slightly faster than current 5K pace',
            '200m strides': '800m-1500m race pace, focus on form and turnover',
            'Recovery jog': '65% of maximum heart rate'
          },
          tips: [
            'This is a key VO2 max session - quality over quantity',
            'Focus on maintaining form even when fatigued',
            'Keep recovery periods active to maintain blood flow',
            'The 200m strides help develop neuromuscular coordination'
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['VO2 Max', 'Running Economy', 'Speed Endurance', 'Lactate Tolerance'],
          equipmentNeeded: 'Running shoes, comfortable clothes, GPS watch, optional: heart rate monitor',
          terrainSuggestion: 'Track or measured flat route'
        },
        { 
          day: 'Wednesday', 
          workout: 'Medium-Long Run',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog', time: '10 min', notes: 'Gradually increase pace' },
            { phase: 'Main Session', action: 'Progression Run', time: '75 min', notes: 'Start easy, finish at moderate effort' },
            { phase: 'Cool-down', action: 'Easy Walk', time: '5 min', notes: 'Gradual decrease in heart rate' }
          ],
          paceGuidelines: {
            'First 25 min': '70-75% max heart rate (very comfortable)',
            'Middle 25 min': '75-80% max heart rate (moderate effort)',
            'Final 25 min': '80-85% max heart rate (comfortably hard)'
          },
          fueling: {
            before: 'Normal pre-run nutrition, light meal 2-3 hours prior',
            during: 'Hydration as needed, consider small carbohydrate intake',
            after: 'Recovery nutrition within 30 minutes of completion'
          },
          tips: [
            'Progression runs teach pace control and running on tired legs',
            'Focus on gradually increasing effort, not necessarily pace',
            'Pay attention to running economy as fatigue develops',
            'Practice mental focus in the final third of the run'
          ],
          duration: activityPlan.duration * 1.25,
          intensity: 'Moderate',
          focusAreas: ['Endurance', 'Pace Control', 'Fatigue Resistance'],
          equipmentNeeded: 'Running shoes, comfortable clothes, hydration, GPS watch',
          terrainSuggestion: 'Rolling terrain preferred to build strength'
        },
        { 
          day: 'Thursday', 
          workout: 'Recovery + Strength',
          structure: [
            { phase: 'Easy Run', action: 'Very Easy Pace', time: '30 min', notes: 'True recovery pace' },
            { phase: 'Strength Circuit', rounds: 3, exercises: [
              { name: 'Weighted Squats', reps: 10, rest: '45s', notes: 'Moderate weight, focus on form' },
              { name: 'Single-leg Romanian Deadlifts', reps: '8 each side', rest: '45s', notes: 'Balance focus' },
              { name: 'Plank Variations', time: '45s', rest: '30s', notes: 'Mix standard, side, and dynamic planks' },
              { name: 'Hip Thrusts', reps: 12, rest: '45s', notes: 'Focus on glute activation' },
              { name: 'Calf Raises (weighted)', reps: '15', rest: '30s', notes: 'Both double and single leg' }
            ]},
            { phase: 'Plyometrics', rounds: 2, exercises: [
              { name: 'Box Jumps', reps: 8, rest: '60s', notes: 'Focus on soft landing' },
              { name: 'Lateral Bounds', reps: '8 each side', rest: '60s', notes: 'Controlled movement' },
              { name: 'Single Leg Hops', reps: '8 each leg', rest: '60s', notes: 'Minimal ground contact time' }
            ]}
          ],
          tips: [
            'The run should be true recovery - prioritize easy effort',
            'Strength work builds power and injury resistance',
            'Plyometrics improve running economy and power',
            'Focus on quality movement patterns in all exercises'
          ],
          duration: activityPlan.duration,
          intensity: 'Light to Moderate',
          focusAreas: ['Recovery', 'Strength', 'Power Development', 'Injury Prevention'],
          equipmentNeeded: 'Running shoes, weights or resistance bands, box for jumps',
          terrainSuggestion: 'Flat, soft surfaces for the run portion'
        },
        { 
          day: 'Friday', 
          workout: 'Tempo Session',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog + Drills', time: '15 min', notes: 'Include dynamic stretches' },
            { phase: 'Main Session', action: 'Threshold Pace', time: '25-30 min', notes: 'Comfortably hard effort, RPE 7/10' },
            { phase: 'Cool-down', action: 'Easy Jog', time: '15 min', notes: 'Gradual reduction in heart rate' }
          ],
          paceGuidelines: {
            description: 'Tempo/threshold pace is approximately half marathon to marathon pace',
            effort: '85-90% of lactate threshold or 80-85% of max heart rate',
            perceived: 'Comfortably hard - can speak in short phrases'
          },
          variations: {
            option1: 'Continuous tempo (25-30 min steady)',
            option2: 'Cruise intervals (e.g., 3 × 10 min with 2 min recovery)',
            option3: 'Progressive tempo (start at marathon pace, finish at 10K pace)'
          },
          tips: [
            'This workout improves lactate threshold and running economy',
            'Focus on maintaining consistent effort throughout',
            'Practice race-specific pace if preparing for an event',
            'Pay attention to breathing patterns and running form'
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Lactate Threshold', 'Mental Toughness', 'Race Pace Practice'],
          equipmentNeeded: 'Running shoes, comfortable clothes, GPS watch, heart rate monitor recommended',
          terrainSuggestion: 'Similar to race terrain if preparing for an event'
        },
        { 
          day: 'Saturday', 
          workout: 'Easy Run + Strides',
          structure: [
            { phase: 'Warm-up', action: 'Very Easy Jog', time: '10 min', notes: 'Gradually increase pace' },
            { phase: 'Main Session', action: 'Easy Run', time: '45 min', notes: 'Comfortable conversational pace' },
            { phase: 'Strides', sets: '6-8', distance: '100m', recovery: 'Walk back to start', notes: 'Controlled acceleration to fast but relaxed pace' }
          ],
          paceGuidelines: {
            'Easy run': '65-70% of maximum heart rate',
            'Strides': 'Accelerate to 90-95% of max speed, maintain for 5-6 seconds, then gradually slow'
          },
          tips: [
            'Easy run builds aerobic fitness while allowing recovery',
            'Strides improve neuromuscular coordination and efficiency',
            'Focus on relaxed, fluid form during strides - not all-out sprinting',
            'This is a key preparation session for Sunday\'s long run'
          ],
          duration: activityPlan.duration,
          intensity: 'Light to Moderate',
          focusAreas: ['Recovery', 'Form', 'Neuromuscular Coordination'],
          equipmentNeeded: 'Running shoes, comfortable clothes',
          terrainSuggestion: 'Flat area for strides, mixed terrain for easy run'
        },
        { 
          day: 'Sunday', 
          workout: 'Long Run',
          structure: [
            { phase: 'Warm-up', action: 'Easy Jog', time: '15 min', notes: 'Start slower than planned long run pace' },
            { phase: 'Main Session', action: 'Steady Endurance Pace', time: '90-120 min', notes: 'Comfortable effort, RPE 5-6/10' },
            { phase: 'Cool-down', action: 'Easy Walk', time: '10 min', notes: 'Active recovery' }
          ],
          paceGuidelines: {
            description: '30-60 seconds per mile slower than goal marathon pace',
            effort: '70-75% of maximum heart rate',
            perceived: 'Moderately comfortable - conversation should be possible'
          },
          fueling: {
            before: 'Substantial meal 3 hours prior, small carb snack 30-60 min before',
            during: 'Hydration every 15 min, 30-60g carbs/hour for runs over 75 min',
            after: 'Recovery nutrition with 3:1 carb:protein ratio within 30 min'
          },
          tips: [
            'Practice race day fueling strategy during long runs',
            'Consider splitting into segments (e.g., middle section at marathon pace)',
            'Focus on maintaining good form even when fatigued',
            'Mentally practice race strategies during challenging portions'
          ],
          duration: activityPlan.duration * 2,
          intensity: 'Moderate to High',
          focusAreas: ['Endurance', 'Glycogen Depletion Training', 'Mental Fortitude', 'Fueling Strategy'],
          equipmentNeeded: 'Running shoes, comfortable clothes, nutrition, hydration, GPS watch',
          terrainSuggestion: 'Similar to goal race terrain if training for specific event'
        }
      ];
    }
  } else if (activityPlan.type === 'yoga') {
    if (activityPlan.level === 'Beginner') {
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Gentle Flow for Beginners',
          sequence: [
            { phase: 'Centering', time: '5 min', focus: 'Breath awareness and intention setting', poses: ['Seated meditation', 'Diaphragmatic breathing'] },
            { phase: 'Warm-up', time: '10 min', focus: 'Gentle joint mobility', poses: ['Neck rolls', 'Shoulder circles', 'Wrist rotations', 'Spinal twists', 'Cat-Cow flow'] },
            { phase: 'Sun Salutations', time: '15 min', focus: 'Basic sun salutation variations', poses: ['Mountain Pose', 'Forward Fold', 'Half-lift', 'Plank modification', 'Knees-Chest-Chin or Modified Chaturanga', 'Baby Cobra', 'Downward Dog', 'Mountain Pose'] },
            { phase: 'Standing Poses', time: '15 min', focus: 'Foundation and alignment', poses: ['Mountain Pose', 'Tree Pose (with modifications)', 'Warrior I', 'Warrior II (brief holds)'] },
            { phase: 'Floor Sequence', time: '10 min', focus: 'Gentle stretching', poses: ['Seated Forward Fold', 'Reclined Twist', 'Bridge Pose', 'Happy Baby'] },
            { phase: 'Final Relaxation', time: '5 min', focus: 'Integration and relaxation', poses: ['Savasana (Corpse Pose)'] }
          ],
          breathwork: {
            primary: 'Ujjayi breathing (Ocean Breath)',
            ratio: 'Equal inhale and exhale (4-4 count)',
            focus: 'Awareness of breath with movement'
          },
          props: ['Yoga mat', 'Two blocks', 'Blanket or bolster', 'Strap'],
          tips: [
            'Focus on proper alignment rather than depth in poses',
            'Use modifications and props liberally',
            'Honor your body\'s limitations',
            'Maintain steady breathing throughout practice'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Foundations', 'Breath Control', 'Basic Postures', 'Body Awareness'],
          benefits: ['Improved flexibility', 'Stress reduction', 'Foundation for yoga practice', 'Mind-body connection']
        },
        { 
          day: 'Wednesday', 
          workout: 'Balance & Flexibility Foundations',
          sequence: [
            { phase: 'Centering', time: '5 min', focus: 'Breath awareness and intention setting', poses: ['Seated meditation', 'Three-part breath'] },
            { phase: 'Warm-up', time: '10 min', focus: 'Dynamic movement', poses: ['Seated side bends', 'Neck stretches', 'Cat-Cow variations', 'Thread the Needle', 'Child\'s Pose'] },
            { phase: 'Standing Balance', time: '15 min', focus: 'Finding stability', poses: ['Mountain Pose with eyes closed', 'Tree Pose with variations', 'Warrior III preparation', 'Chair Pose'] },
            { phase: 'Hip Opening', time: '15 min', focus: 'Gentle hip mobility', poses: ['Low lunge variations', 'Reclined Figure Four', 'Butterfly Pose', 'Wide-legged seated forward fold'] },
            { phase: 'Gentle Backbends', time: '10 min', focus: 'Heart opening', poses: ['Sphinx Pose', 'Cobra Pose', 'Locust Pose', 'Bridge Pose'] },
            { phase: 'Final Relaxation', time: '5 min', focus: 'Integration', poses: ['Legs up the wall or Savasana'] }
          ],
          breathwork: {
            primary: 'Dirga Pranayama (Three-part breath)',
            focus: 'Using breath to find stability in challenging poses'
          },
          props: ['Yoga mat', 'Two blocks', 'Blanket', 'Wall space'],
          tips: [
            'Fix gaze on a non-moving point (drishti) during balance poses',
            'Practice near a wall for support in balance poses',
            'Hold poses for 3-5 breaths to build endurance',
            'Notice the relationship between breath and balance'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Balance', 'Flexibility', 'Mindfulness', 'Hip Mobility'],
          benefits: ['Improved proprioception', 'Increased range of motion', 'Better posture', 'Mental focus']
        },
        { 
          day: 'Friday', 
          workout: 'Restorative Yoga Practice',
          sequence: [
            { phase: 'Centering', time: '5 min', focus: 'Setting intention for restoration', poses: ['Seated meditation with props', 'Calming breath practice'] },
            { phase: 'Gentle Movement', time: '10 min', focus: 'Releasing tension', poses: ['Supine spinal twist', 'Knee to chest', 'Windshield wiper legs', 'Cat-Cow'] },
            { phase: 'Supported Poses', time: '30 min', focus: 'Deep relaxation (5-10 min per pose)', poses: ['Supported Child\'s Pose', 'Supported Heart Opener', 'Legs up the Wall', 'Supported Bound Angle'] },
            { phase: 'Guided Relaxation', time: '15 min', focus: 'Body scan and conscious relaxation', poses: ['Savasana with props'] }
          ],
          breathwork: {
            primary: 'Extended exhale breathing (4-6 count)',
            focus: 'Activating parasympathetic nervous system'
          },
          props: ['Yoga mat', 'Two blocks', '2-3 blankets', 'Bolster or pillow', 'Eye pillow (optional)'],
          tips: [
            'Use as many props as needed for complete comfort',
            'Focus on surrendering weight to props',
            'Minimize muscular effort in poses',
            'If discomfort arises, adjust props immediately'
          ],
          duration: activityPlan.duration,
          intensity: 'Very Light',
          focusAreas: ['Relaxation', 'Stress Relief', 'Deep Stretching', 'Nervous System Regulation'],
          benefits: ['Deep relaxation', 'Stress and anxiety reduction', 'Improved sleep quality', 'Enhanced recovery']
        }
      ];
    } else if (activityPlan.level === 'Intermediate' || activityPlan.level === 'Advanced') {
      // More advanced yoga plans 
      workouts = [
        { 
          day: 'Monday', 
          workout: 'Power Vinyasa Flow',
          sequence: [
            { phase: 'Centering', time: '5 min', focus: 'Breath awareness and dynamic intention', poses: ['Seated meditation', 'Ujjayi breath establishment'] },
            { phase: 'Dynamic Warm-up', time: '10 min', focus: 'Building heat', poses: ['Cat-Cow with variations', 'Sunbird balance flow', 'Core activation series', 'Dynamic Table Top variations'] },
            { phase: 'Sun Salutations', time: '15 min', focus: 'Building heat and establishing rhythm', poses: ['Classical Surya Namaskar A (5 rounds)', 'Surya Namaskar B with Chair and Warrior I (3 rounds)'] },
            { phase: 'Standing Sequence', time: '20 min', focus: 'Strength and dynamic balance', poses: ['Warrior II to Extended Side Angle flow', 'Revolved Side Angle preparation', 'Warrior III to Half Moon transitions', 'Standing splits', 'Crescent Lunge variations'] },
            { phase: activityPlan.level === 'Advanced' ? 'Peak Pose Exploration' : 'Standing Balance Challenge', time: '10 min', focus: activityPlan.level === 'Advanced' ? 'Working toward challenging asana' : 'Balance refinement', poses: activityPlan.level === 'Advanced' ? ['Crow Pose', 'Side Crow preparation', 'Flying Pigeon preparation'] : ['Eagle Pose', 'Dancer\'s Pose', 'Sugar Cane variation'] },
            { phase: 'Floor Series', time: '15 min', focus: 'Deep opening and release', poses: ['Pigeon variations', 'Lizard Pose', 'Seated forward folds', 'Core strengthening'] },
            { phase: 'Cool Down & Integration', time: '15 min', focus: 'Returning to center', poses: ['Bridge Pose', 'Reclined Twist', 'Happy Baby', 'Savasana'] }
          ],
          breathwork: {
            primary: 'Ujjayi breath throughout practice',
            secondary: 'Kapalabhati (Breath of Fire) during core work',
            focus: 'Synchronizing breath with movement, one breath per movement'
          },
          props: ['Yoga mat', 'Two blocks', 'Strap for modifications', 'Sweat towel'],
          tips: [
            'Focus on connecting breath to movement throughout flow sequences',
            'Build heat intelligently - challenge yourself while maintaining proper form',
            'Utilize modifications when needed to maintain integrity',
            'Advanced practitioners: work on transitions as much as poses'
          ],
          duration: activityPlan.duration,
          intensity: activityPlan.level === 'Advanced' ? 'High' : 'Moderate',
          focusAreas: ['Strength', 'Endurance', 'Flow', 'Mind-Body Connection'],
          benefits: ['Cardiovascular conditioning', 'Muscular endurance', 'Mental focus', 'Stress reduction']
        },
        { 
          day: 'Wednesday', 
          workout: 'Ashtanga Primary Series',
          sequence: [
            { phase: 'Opening', time: '10 min', focus: 'Traditional opening sequence', poses: ['Sun Salutation A (5 rounds)', 'Sun Salutation B (5 rounds)'] },
            { phase: 'Standing Sequence', time: '25 min', focus: 'Traditional standing poses', poses: ['All standing poses from Primary Series including: Padangusthasana, Padahastasana, Utthita Trikonasana, Utthita Parsvakonasana, Prasarita Padottanasana A-D, Parsvottanasana, Utthita Hasta Padangusthasana, Ardha Baddha Padmottanasana, Utkatasana, Virabhadrasana I, Virabhadrasana II'] },
            { phase: 'Seated Sequence', time: '30 min', focus: 'Traditional seated poses', poses: ['Dandasana', 'Paschimottanasana', 'Purvottanasana', 'Ardha Baddha Padma Paschimottanasana', 'Triangmukhaikapada Paschimottanasana', 'Janu Sirsasana A-C', 'Marichyasana A-D', 'Navasana', 'Bhujapidasana'] },
            { phase: 'Backbends', time: '10 min', focus: 'Traditional closing backbends', poses: ['Urdhva Dhanurasana (3-5 repetitions)'] },
            { phase: 'Closing Sequence', time: '15 min', focus: 'Traditional closing sequence', poses: ['Paschimottanasana', 'Sarvangasana', 'Halasana', 'Karna Pidasana', 'Urdhva Padmasana', 'Pindasana', 'Matsyasana', 'Uttana Padasana', 'Sirsasana', 'Baddha Padmasana', 'Padmasana', 'Tolasana'] }
          ],
          breathwork: {
            primary: 'Traditional Ujjayi breath with drishti focus',
            count: '5-count inhale, 5-count exhale when possible',
            focus: 'Traditional vinyasa count system'
          },
          modifications: {
            intermediate: 'Practice half primary series (through Navasana)',
            advanced: 'Complete primary series with exploration of intermediate poses',
            general: 'Honor appropriate modifications while maintaining the traditional sequence'
          },
          props: ['Yoga mat', 'Mysore rug (optional)', 'Blocks for modifications'],
          tips: [
            'Focus on the traditional rhythm and breath count',
            'For intermediate practitioners, work steadily through the seated sequence',
            'Advanced practitioners should refine bandhas (energy locks) throughout',
            'Practice with traditional Sanskrit counting if possible'
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate to High',
          focusAreas: ['Discipline', 'Traditional Practice', 'Full-Body Integration', 'Breath Control'],
          benefits: ['Physical purification', 'Mental discipline', 'Systematic progress', 'Deep internal awareness']
        },
        { 
          day: 'Friday', 
          workout: 'Yin & Restoration',
          sequence: [
            { phase: 'Centering', time: '10 min', focus: 'Setting intention and breath awareness', poses: ['Seated meditation', 'Developing awareness of physical sensations'] },
            { phase: 'Yin Sequence', time: '40 min', focus: 'Deep connective tissue release (3-5 min per pose)', poses: ['Butterfly', 'Dragon (low lunge variations)', 'Sleeping Swan', 'Caterpillar', 'Sphinx/Seal', 'Banana', 'Twisted Roots'] },
            { phase: 'Restorative Bridge', time: '5 min', focus: 'Transition from yin to restoration', poses: ['Supported Bridge Pose with Block'] },
            { phase: 'Restorative Sequence', time: '20 min', focus: 'Complete surrender (5-10 min per pose)', poses: ['Supported Heart Opener', 'Supported Reclining Bound Angle', 'Legs Up the Wall with Bolster Support'] },
            { phase: 'Breath & Meditation', time: '15 min', focus: 'Pranayama and meditation', poses: ['Savasana transitioning to seated meditation', 'Alternate nostril breathing', 'Breath retention practice (for advanced)'] }
          ],
          breathwork: {
            yin: 'Natural breath with occasional sighing exhales',
            restorative: 'Extended exhale breathing (4-6-8 pattern)',
            final: 'Nadi Shodhana (alternate nostril) and/or breath retention (Kumbhaka)'
          },
          props: ['Yoga mat', 'Two blocks', 'Bolster', '2-3 blankets', 'Strap', 'Eye pillow'],
          tips: [
            'In Yin poses, find appropriate edge and then be still',
            'Stay mindful of sensation vs. pain (sensation is productive, pain is not)',
            'In Restorative poses, focus on complete surrender to gravity',
            'Advanced practitioners can add bandhas and longer breath retention during final pranayama'
          ],
          duration: activityPlan.duration,
          intensity: 'Light',
          focusAreas: ['Deep Tissue Release', 'Mindfulness', 'Recovery', 'Nervous System Regulation'],
          benefits: ['Fascia hydration', 'Joint mobility', 'Stress reduction', 'Enhanced recovery between active practices']
        },
        { 
          day: 'Sunday', 
          workout: activityPlan.level === 'Advanced' ? 'Advanced Inversions & Arm Balances' : 'Gentle Flow & Meditation',
          sequence: activityPlan.level === 'Advanced' ? [
            { phase: 'Centering', time: '5 min', focus: 'Establishing focus and intention', poses: ['Seated meditation', 'Breath and bandha awareness'] },
            { phase: 'Dynamic Warm-up', time: '15 min', focus: 'Preparing body for inversions', poses: ['Sun Salutations', 'Core activation series', 'Shoulder opening sequence', 'Wrist preparation']},
            { phase: 'Inversion Prep', time: '10 min', focus: 'Building toward peak poses', poses: ['Dolphin Pose variations', 'Headstand prep at wall', 'Pike position work', ''L-shaped handstand at wall'] },
            { phase: 'Inversion Lab', time: '25 min', focus: 'Exploring advanced inversions', poses: ['Tripod Headstand variations', 'Forearm Balance (Pincha Mayurasana)', 'Handstand practice', 'Hollow back work'] },
            { phase: 'Arm Balance Lab', time: '25 min', focus: 'Exploring arm balances', poses: ['Crow Pose and variations', 'Side Crow', 'Eight-Angle Pose', 'Flying Pigeon', 'Grasshopper preparation'] },
            { phase: 'Counter Poses', time: '15 min', focus: 'Balancing the practice', poses: ['Gentle backbends', 'Forward folds', 'Twists', 'Child\'s Pose variations'] },
            { phase: 'Integration', time: '10 min', focus: 'Absorbing practice benefits', poses: ['Savasana', 'Seated reflection'] }
          ] : [
            { phase: 'Centering', time: '10 min', focus: 'Breath awareness and setting intention', poses: ['Seated meditation', 'Gentle seated movements'] },
            { phase: 'Gentle Warm-up', time: '15 min', focus: 'Awakening the body', poses: ['Cat-Cow variations', 'Gentle spinal twists', 'Side body stretching', 'Neck releases'] },
            { phase: 'Standing Flow', time: '20 min', focus: 'Mindful movement', poses: ['Mountain variations', 'Gentle Warrior flows', 'Simple balancing poses', 'Standing forward folds'] },
            { phase: 'Floor Sequence', time: '20 min', focus: 'Gentle opening', poses: ['Seated forward folds', 'Gentle hip openers', 'Supine twists', 'Legs up the wall'] },
            { phase: 'Extended Meditation', time: '15 min', focus: 'Deepening awareness', poses: ['Meditation on breath', 'Body scan', 'Mindfulness practice'] },
            { phase: 'Integration', time: '10 min', focus: 'Absorbing practice benefits', poses: ['Savasana', 'Gentle transition to seated'] }
          ],
          breathwork: activityPlan.level === 'Advanced' ? {
            primary: 'Ujjayi breath with strong bandha engagement',
            inversions: 'Kumbhaka (breath retention) practice for stability',
            focus: 'Using breath to find equilibrium and core stability'
          } : {
            primary: 'Natural breathing with periodic breath awareness',
            meditation: 'Meditation on breath sensations',
            focus: 'Using breath as an anchor for present moment awareness'
          },
          props: activityPlan.level === 'Advanced' ? 
            ['Yoga mat', 'Wall space', 'Two blocks', 'Crash pad or extra blankets'] : 
            ['Yoga mat', 'Two blocks', 'Bolster or blankets', 'Meditation cushion'],
          tips: activityPlan.level === 'Advanced' ? [
            'Practice most challenging inversions with a spotter or near a wall',
            'Focus on alignment and technique before duration',
            'Build progressively - attempt less challenging variations first',
            'Listen to your body and respect its limitations, even at advanced levels'
          ] : [
            'Focus on the meditative quality of movement',
            'Emphasize breath awareness over physical challenge',
            'Allow the practice to be nurturing and restorative',
            'Use this practice to build mindfulness skills'
          ],
          duration: activityPlan.duration,
          intensity: activityPlan.level === 'Advanced' ? 'Very High' : 'Light',
          focusAreas: activityPlan.level === 'Advanced' ? 
            ['Upper Body Strength', 'Balance', 'Body Control', 'Mental Focus'] : 
            ['Recovery', 'Technique', 'Mindfulness', 'Breath Awareness'],
          benefits: activityPlan.level === 'Advanced' ? 
            ['Increased upper body strength', 'Enhanced proprioception', 'Mental focus', 'Fear management'] : 
            ['Stress reduction', 'Enhanced body awareness', 'Improved mindfulness', 'Mental clarity']
        }
      ];
    }
  }

  // If no specific plan was generated, use default plan
  if (workouts.length === 0) {
    workouts = [
      { 
        day: 'Monday', 
        workout: 'Full Body Workout',
        exercises: [
          { name: 'Bodyweight Squats', sets: 3, reps: '12-15', rest: '60s', notes: 'Focus on form and depth' },
          { name: 'Push-ups', sets: 3, reps: '8-12', rest: '60s', notes: 'Modify on knees if needed' },
          { name: 'Dumbbell Rows', sets: 3, reps: '10-12 each', rest: '60s', notes: 'Focus on squeezing back muscles' },
          { name: 'Glute Bridges', sets: 3, reps: '15', rest: '45s', notes: 'Focus on full hip extension' },
          { name: 'Plank', sets: 3, time: '30s', rest: '30s', notes: 'Maintain straight body position' }
        ],
        duration: activityPlan.duration,
        intensity: 'Moderate',
        focusAreas: ['Full Body', 'Strength', 'Foundation']
      },
      { 
        day: 'Wednesday', 
        workout: 'Cardiovascular Training',
        structure: [
          { phase: 'Warm-up', action: 'Light Cardio', time: '5 min', notes: 'Easy pace to elevate heart rate' },
          { phase: 'Main Session', action: 'Moderate Intensity Cardio', time: '20 min', notes: 'Treadmill, bike, elliptical or rowing machine' },
          { phase: 'Finisher', action: 'Interval Burst', sets: 5, work: '30s', rest: '30s', notes: 'Higher intensity effort' },
          { phase: 'Cool-down', action: 'Light Activity', time: '5 min', notes: 'Gradually reduce heart rate' }
        ],
        duration: activityPlan.duration,
        intensity: 'Moderate',
        focusAreas: ['Cardiovascular', 'Endurance', 'Recovery']
      },
      { 
        day: 'Friday', 
        workout: 'Functional Strength Training',
        exercises: [
          { name: 'Walking Lunges', sets: 3, reps: '10 each leg', rest: '60s', notes: 'Focus on stability and control' },
          { name: 'Incline Push-ups', sets: 3, reps: '10-12', rest: '60s', notes: 'Control the movement' },
          { name: 'Supermans', sets: 3, reps: '12', rest: '45s', notes: 'Engage back muscles' },
          { name: 'Russian Twists', sets: 3, reps: '15 each side', rest: '45s', notes: 'Control the rotation' },
          { name: 'Wall Sits', sets: 3, time: '45s', rest: '45s', notes: 'Maintain proper alignment' }
        ],
        duration: activityPlan.duration,
        intensity: 'Moderate',
        focusAreas: ['Full Body', 'Functional Movement', 'Core Stability']
      }
    ];
  }

  // Display workout plan
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (workoutPlanDisplay) {
    // Initialize workout history if it doesn't exist
    if (!window.workoutHistory) {
      window.workoutHistory = JSON.parse(localStorage.getItem('workoutHistory') || '{}');
    }

    let planHTML = `
      <div class="plan-header">
        <h3>${activityPlan.level} ${activityPlan.type.charAt(0).toUpperCase() + activityPlan.type.slice(1)} Program</h3>
        <p>Weekly Frequency: ${workouts.length} days | Duration: ${activityPlan.duration} hour${activityPlan.duration > 1 ? 's' : ''}/session | Preferred Time: ${activityPlan.preferredTime}</p>
      </div>
      <div class="workouts-container">
    `;

    workouts.forEach(workout => {
      // Check if workout is completed
      const isCompleted = window.workoutHistory[workout.day] && window.workoutHistory[workout.day].completed;

      planHTML += `
        <div class="workout-card ${isCompleted ? 'workout-completed' : ''}">
          <div class="workout-day">${workout.day}</div>
          <div class="workout-title">${workout.workout}</div>
          <div class="workout-meta">
            <span class="workout-time"><i class="fas fa-clock"></i> ${workout.duration} hour${workout.duration !== 1 ? 's' : ''}</span>
            <span class="workout-intensity"><i class="fas fa-fire"></i> ${workout.intensity || 'Moderate'}</span>
            <span class="workout-status">
              <label class="workout-completed-label">
                <input type="checkbox" class="workout-completed-checkbox" data-day="${workout.day}" ${isCompleted ? 'checked' : ''}>
                Completed
              </label>
            </span>
          </div>

          ${workout.exercises ? `
          <div class="workout-exercises">
            <h4>Exercise Program</h4>
            <div class="exercise-table">
              <div class="exercise-header">
                <div class="exercise-name">Exercise</div>
                <div class="exercise-sets">Sets</div>
                <div class="exercise-reps">Reps/Time</div>
                <div class="exercise-rest">Rest</div>
              </div>
              ${workout.exercises.map(exercise => `
                <div class="exercise-row">
                  <div class="exercise-name">${exercise.name}</div>
                  <div class="exercise-sets">${exercise.sets || '-'}</div>
                  <div class="exercise-reps">${exercise.reps || exercise.time || '-'}</div>
                  <div class="exercise-rest">${exercise.rest || '-'}</div>
                </div>
                ${exercise.notes ? `<div class="exercise-notes"><i class="fas fa-info-circle"></i> ${exercise.notes}</div>` : ''}
              `).join('')}
            </div>
          </div>
          ` : ''}

          ${workout.structure ? `
          <div class="workout-structure">
            <h4>Workout Structure</h4>
            <div class="structure-timeline">
              ${workout.structure.map((phase, index) => `
                <div class="phase-block">
                  <div class="phase-name">${phase.phase}</div>
                  <div class="phase-details">
                    ${phase.time ? `<span class="phase-time"><i class="fas fa-clock"></i> ${phase.time}</span>` : ''}
                    ${phase.action ? `<span class="phase-action">${phase.action}</span>` : ''}
                    ${phase.sets ? `<span class="phase-sets">${phase.sets} ${phase.work ? `× (${phase.work}/${phase.recovery || phase.rest})` : 'rounds'}</span>` : ''}
                    ${phase.notes ? `<span class="phase-notes"><i class="fas fa-info-circle"></i> ${phase.notes}</span>` : ''}
                  </div>
                </div>
                ${index < workout.structure.length - 1 ? '<div class="phase-connector"></div>' : ''}
              `).join('')}
            </div>
          </div>
          ` : ''}

          ${workout.sequence ? `
          <div class="workout-sequence">
            <h4>Practice Sequence</h4>
            <div class="sequence-timeline">
              ${workout.sequence.map((phase, index) => `
                <div class="phase-block">
                  <div class="phase-name">${phase.phase} (${phase.time})</div>
                  <div class="phase-focus">Focus: ${phase.focus}</div>
                  ${phase.poses ? `
                  <div class="phase-poses">
                    <span class="poses-label">Key poses:</span> ${Array.isArray(phase.poses) ? phase.poses.slice(0, 3).join(', ') + (phase.poses.length > 3 ? ' and more...' : '') : phase.poses}
                  </div>
                  ` : ''}
                </div>
                ${index < workout.sequence.length - 1 ? '<div class="phase-connector"></div>' : ''}
              `).join('')}
            </div>
          </div>
          ` : ''}

          ${workout.description ? `<div class="workout-desc">${workout.description}</div>` : ''}

          ${workout.tips ? `
          <div class="workout-tips">
            <h4><i class="fas fa-lightbulb"></i> Pro Tips</h4>
            <ul>
              ${workout.tips.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          ${workout.focusAreas ? `
          <div class="workout-focus">
            <span class="focus-label">Focus Areas:</span>
            <div class="focus-tags">
              ${workout.focusAreas.map(area => `<span class="focus-tag">${area}</span>`).join('')}
            </div>
          </div>` : ''}

          ${(workout.warmup || workout.cooldown) ? `
          <div class="workout-warmup-cooldown">
            ${workout.warmup ? `<div class="warmup"><i class="fas fa-temperature-low"></i> Warm-up: ${workout.warmup}</div>` : ''}
            ${workout.cooldown ? `<div class="cooldown"><i class="fas fa-temperature-high"></i> Cool-down: ${workout.cooldown}</div>` : ''}
          </div>
          ` : ''}

          <div class="workout-card-actions">
            <button class="workout-details-btn" data-day="${workout.day}">
              <i class="fas fa-clipboard-list"></i> Add Notes & Details
            </button>
          </div>
        </div>
      `;
    });

    planHTML += '</div>';

    // Add workout details modal to the body instead of inside the workout display
    const modalHtml = `
      <div id="workoutDetailsModal" class="workout-details-modal">
        <div class="workout-details-content">
          <div class="workout-details-header">
            <h3 id="detailsWorkoutTitle">Workout Details</h3>
            <button class="close-details-modal">&times;</button>
          </div>
          <div class="workout-details-body">
            <div class="workout-notes-section">
              <h4>Workout Notes</h4>
              <textarea id="workoutNotes" placeholder="Add your notes about today's workout (how you felt, any modifications, etc.)"></textarea>
            </div>
            <div id="workoutDetailExercises" class="workout-details-exercises"></div>
            <div class="workout-metrics">
              <h4>Additional Metrics</h4>
              <div class="metrics-grid">
                <div class="metric-item">
                  <label for="workoutDuration">Actual Duration (minutes)</label>
                  <input type="number" id="workoutDuration" placeholder="e.g., 45">
                </div>
                <div class="metric-item">
                  <label for="workoutIntensity">Perceived Intensity (1-10)</label>
                  <input type="number" id="workoutIntensity" min="1" max="10" placeholder="e.g., 7">
                </div>
                <div class="metric-item">
                  <label for="caloriesBurned">Estimated Calories Burned</label>
                  <input type="number" id="caloriesBurned" placeholder="e.g., 350">
                </div>
                <div class="metric-item">
                  <label for="workoutRating">Workout Rating (1-5)</label>
                  <div class="rating-stars">
                    <span class="star" data-value="1">★</span>
                    <span class="star" data-value="2">★</span>
                    <span class="star" data-value="3">★</span>
                    <span class="star" data-value="4">★</span>
                    <span class="star" data-value="5">★</span>
                  </div>
                  <input type="hidden" id="workoutRating" value="0">
                </div>
              </div>
            </div>
            <button id="saveWorkoutDetails" class="save-workout-details">Save Workout Details</button>
          </div>
        </div>
      </div>
    `;

    // Add modal to body if it doesn't exist already
    if (!document.getElementById('workoutDetailsModal')) {
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // Set the workout plan content
    workoutPlanDisplay.innerHTML = planHTML;

    // Add event listeners for workout completed checkboxes
    const checkboxes = workoutPlanDisplay.querySelectorAll('.workout-completed-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const day = this.dataset.day;
        const card = this.closest('.workout-card');
        const workoutTitle = card.querySelector('.workout-title').textContent;

        if (this.checked) {
          card.classList.add('workout-completed');

          // Save to workout history
          window.workoutHistory[day] = window.workoutHistory[day] || {};
          window.workoutHistory[day].completed = true;
          window.workoutHistory[day].workout = workoutTitle;
          window.workoutHistory[day].date = new Date().toLocaleDateString();
        } else {
          card.classList.remove('workout-completed');

          // Update workout history
          if (window.workoutHistory[day]) {
            window.workoutHistory[day].completed = false;
          }
        }

        // Save to localStorage
        localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));
      });
    });

    // Add event listeners for details buttons
    const detailButtons = workoutPlanDisplay.querySelectorAll('.workout-details-btn');
    const modal = document.getElementById('workoutDetailsModal');
    const closeButton = modal.querySelector('.close-details-modal');
    const saveButton = document.getElementById('saveWorkoutDetails');
    const stars = modal.querySelectorAll('.star');
    
    // Add workout log buttons to each exercise in the workout cards
    const exerciseRows = workoutPlanDisplay.querySelectorAll('.exercise-row');
    exerciseRows.forEach(row => {
      const exerciseName = row.querySelector('.exercise-name').textContent;
      const logButton = document.createElement('button');
      logButton.className = 'log-exercise-btn';
      logButton.innerHTML = '<i class="fas fa-dumbbell"></i>';
      logButton.title = 'Log workout weight/data';
      logButton.onclick = function(e) {
        e.stopPropagation(); // Prevent parent handlers from firing
        if (typeof showWorkoutLog === 'function') {
          showWorkoutLog(exerciseName, null);
        } else {
          console.error("showWorkoutLog function not available");
        }
      };
      
      // Add button to row
      if (!row.querySelector('.log-exercise-btn')) {
        row.querySelector('.exercise-sets').appendChild(logButton);
      }
    });

    // Handle star rating
    stars.forEach(star => {
      star.addEventListener('click', function() {
        const value = this.dataset.value;
        document.getElementById('workoutRating').value = value;

        // Update star display
        stars.forEach(s => {
          if (s.dataset.value <= value) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
    });

    detailButtons.forEach(button => {
      button.addEventListener('click', function() {
        const day = this.dataset.day;
        const card = this.closest('.workout-card');
        const workoutTitle = card.querySelector('.workout-title').textContent;

        // Update modal title
        document.getElementById('detailsWorkoutTitle').textContent = `${day} - ${workoutTitle}`;

        // Fill in details if they exist
        if (window.workoutHistory[day]) {
          document.getElementById('workoutNotes').value = window.workoutHistory[day].notes || '';
          document.getElementById('workoutDuration').value = window.workoutHistory[day].duration || '';
          document.getElementById('workoutIntensity').value = window.workoutHistory[day].intensity || '';
          document.getElementById('caloriesBurned').value = window.workoutHistory[day].calories || '';

          // Set rating
          const rating = window.workoutHistory[day].rating || 0;
          document.getElementById('workoutRating').value = rating;
          stars.forEach(s => {
            if (s.dataset.value <= rating) {
              s.classList.add('active');
            } else {
              s.classList.remove('active');
            }
          });
        } else {
          // Clear form
          document.getElementById('workoutNotes').value = '';
          document.getElementById('workoutDuration').value = '';
          document.getElementById('workoutIntensity').value = '';
          document.getElementById('caloriesBurned').value = '';
          document.getElementById('workoutRating').value = 0;
          stars.forEach(s => s.classList.remove('active'));
        }

        // Populate exercise details if available
        const detailExercisesDiv = document.getElementById('workoutDetailExercises');
        const workout = workouts.find(w => w.day === day);

        if (workout && workout.exercises && workout.exercises.length > 0) {
          let exercisesHTML = `
            <h4>Exercise Details</h4>
            <div class="exercise-details-list">
          `;

          workout.exercises.forEach(exercise => {
            const savedNotes = window.workoutHistory[day]?.exerciseNotes?.[exercise.name] || '';

            exercisesHTML += `
              <div class="exercise-detail-item">
                <div class="exercise-detail-name">${exercise.name}</div>
                <textarea class="exercise-notes-input" data-exercise="${exercise.name}" placeholder="Notes for ${exercise.name}...">${savedNotes}</textarea>
              </div>
            `;
          });

          exercisesHTML += `</div>`;
          detailExercisesDiv.innerHTML = exercisesHTML;
        } else {
          detailExercisesDiv.innerHTML = '';
        }

        // Store the current day for the save function
        saveButton.dataset.day = day;

        // Show modal
        modal.style.display = 'block';
      });
    });

    // Close modal when clicking the close button
    closeButton.addEventListener('click', function() {
      modal.style.display = 'none';
    });

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });

    // Save details
    saveButton.addEventListener('click', function() {
      const day = this.dataset.day;
      const notes = document.getElementById('workoutNotes').value;
      const duration = document.getElementById('workoutDuration').value;
      const intensity = document.getElementById('workoutIntensity').value;
      const calories = document.getElementById('caloriesBurned').value;
      const rating = document.getElementById('workoutRating').value;

      // Initialize workout history for this day if it doesn't exist
      window.workoutHistory[day] = window.workoutHistory[day] || {};

      // Update with new values
      window.workoutHistory[day].notes = notes;
      window.workoutHistory[day].duration = duration;
      window.workoutHistory[day].intensity = intensity;
      window.workoutHistory[day].calories = calories;
      window.workoutHistory[day].rating = rating;

      // Save exercise notes
      const exerciseNotes = {};
      const exerciseInputs = document.querySelectorAll('.exercise-notes-input');
      exerciseInputs.forEach(input => {
        exerciseNotes[input.dataset.exercise] = input.value;
      });
      window.workoutHistory[day].exerciseNotes = exerciseNotes;

      // Save to localStorage
      localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));

      // Close modal
      modal.style.display = 'none';

      // Show confirmation
      alert('Workout details saved successfully!');
    });
  }

  // Generate and display weekly schedule
  const weeklyScheduleDisplay = document.getElementById('weeklyScheduleDisplay');
  if (weeklyScheduleDisplay) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let scheduleHTML = `
      <div class="schedule-header">
        <h3>Weekly Schedule</h3>
        <p>Preferred Time: ${activityPlan.preferredTime || 'Morning (6-9)'}</p>
      </div>
      <div class="schedule-grid">
    `;

    days.forEach(day => {
      const dayWorkout = workouts.find(w => w.day === day);
      scheduleHTML += `
        <div class="schedule-day ${dayWorkout ? 'has-workout' : ''}">
          <div class="day-name">${day}</div>
          ${dayWorkout ? `
            <div class="day-workout">
              <div class="workout-title">${dayWorkout.workout}</div>
              <div class="workout-time"><i class="fas fa-clock"></i> ${dayWorkout.duration} hr</div>
              <div class="workout-intensity-indicator" data-intensity="${dayWorkout.intensity.toLowerCase().replace(/\s+/g, '-')}">
                ${dayWorkout.intensity}
              </div>
            </div>
          ` : '<div class="day-rest">Rest & Recovery</div>'}
        </div>
      `;
    });

    scheduleHTML += '</div>';
    weeklyScheduleDisplay.innerHTML = scheduleHTML;
  }
}

// Edit profile function
function editProfile() {
  // Get the profile modal
  const profileModal = document.getElementById('profileModal');

  // Set values from userProfile
  if (profileModal) {
    const heightField = document.getElementById('userHeight');
    const weightField = document.getElementById('userWeight');
    const caloriesField = document.getElementById('calories');
    const stepsField = document.getElementById('steps');
    const activityTypeField = document.getElementById('activityType');
    const frequencyField = document.getElementById('frequency');
    const activityLevelField = document.getElementById('activityLevel');
    const durationField = document.getElementById('duration');
    const preferredTimeField = document.getElementById('preferredTime');
    const goalsField = document.getElementById('userGoals');

    if (heightField) heightField.value = userProfile.height || '';
    if (weightField) weightField.value = userProfile.weight || '';
    if (caloriesField) caloriesField.value = userProfile.goals?.calories || '2000';
    if (stepsField) stepsField.value = userProfile.goals?.steps || '10000';
    if (goalsField) goalsField.value = userProfile.goals?.description || '';

    // Set activity plan values
    if (activityTypeField) activityTypeField.value = userProfile.goals?.activityPlan?.type || 'gym';
    if (frequencyField) frequencyField.value = userProfile.goals?.activityPlan?.frequency || '3';
    if (activityLevelField) activityLevelField.value = userProfile.goals?.activityPlan?.level || 'Beginner';
    if (durationField) durationField.value = userProfile.goals?.activityPlan?.duration || '1';
    if (preferredTimeField) preferredTimeField.value = userProfile.goals?.activityPlan?.preferredTime || 'Morning (6-9)';

    // Show the modal
    profileModal.style.display = 'block';
  }
}

function closeModal() {
  const profileModal = document.getElementById('profileModal');
  if (profileModal) {
    profileModal.style.display = 'none';
  }
}

function saveGoals() {
  const heightField = document.getElementById('userHeight');
  const weightField = document.getElementById('userWeight');
  const caloriesField = document.getElementById('calories');
  const stepsField = document.getElementById('steps');
  const activityTypeField = document.getElementById('activityType');
  const frequencyField = document.getElementById('frequency');
  const activityLevelField = document.getElementById('activityLevel');
  const durationField = document.getElementById('duration');
  const preferredTimeField = document.getElementById('preferredTime');
  const goalsField = document.getElementById('userGoals');

  // Update userProfile with form values
  userProfile.height = heightField?.value || userProfile.height;
  userProfile.weight = weightField?.value || userProfile.weight;

  // Update goals
  userProfile.goals = {
    description: goalsField?.value || userProfile.goals?.description || '',
    calories: parseInt(caloriesField?.value) || userProfile.goals?.calories || 2000,
    steps: parseInt(stepsField?.value) || userProfile.goals?.steps || 10000,
    activityPlan: {
      type: activityTypeField?.value || userProfile.goals?.activityPlan?.type || 'gym',
      frequency: parseInt(frequencyField?.value) || userProfile.goals?.activityPlan?.frequency || 3,
      level: activityLevelField?.value || userProfile.goals?.activityPlan?.level || 'Beginner',
      duration: parseFloat(durationField?.value) || userProfile.goals?.activityPlan?.duration || 1,
      preferredTime: preferredTimeField?.value || userProfile.goals?.activityPlan?.preferredTime || 'Morning (6-9)'
    }
  };

  // Save to localStorage
  localStorage.setItem('userProfile', JSON.stringify(userProfile));

  // Update display
  updateProfileDisplay();

  // Close modal
  closeModal();

  // If on workout section, regenerate activity plan
  if (document.getElementById('workout')?.classList.contains('active-section')) {
    generateActivityPlan();
  }
}

function regenerateWorkoutPlan() {
  generateActivityPlan();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Initialize subscription system
  if (typeof initSubscriptionUI === 'function') {
    initSubscriptionUI();
  }

  // Set up navigation buttons
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    // Add a span wrapper for the text to help with mobile styling
    const text = item.textContent.trim();
    const icon = item.querySelector('i');
    
    if (icon && !item.querySelector('span')) {
      item.textContent = '';
      item.appendChild(icon);
      const span = document.createElement('span');
      span.textContent = text;
      item.appendChild(span);
    }
    
    // Add click event listener
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');
      if (section) {
        console.log("Navigation clicked for section:", section);
        showSection(section);
      }
    });
  });

  // Set up nav cards on dashboard
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    card.addEventListener('click', function() {
      const section = this.getAttribute('data-section') || this.getAttribute('data-page');
      if (section) {
        showSection(section);
      }
    });
  });

  // Initialize profile display
  updateProfileDisplay();

  // Set up meal plan generator
  const goalType = document.getElementById('goalType');
  if (goalType) {
    goalType.addEventListener('change', generateMealPlan);
    // Generate initial meal plan
    setTimeout(generateMealPlan, 100);
  }

  // Set up Grok toggle
  const toggleGrok = document.getElementById('toggleGrok');
  const closeGrok = document.getElementById('closeGrok');
  const grokPanel = document.getElementById('grokPanel');

  if (toggleGrok && grokPanel) {
    toggleGrok.addEventListener('click', function() {
      grokPanel.classList.add('open');
    });
  }

  if (closeGrok && grokPanel) {
    closeGrok.addEventListener('click', function() {
      grokPanel.classList.remove('open');
    });
  }

  // Show dashboard by default
  showSection('dashboard');
});

// Make functions available globally
window.showSection = showSection;
if (typeof updateProfileDisplay === 'function') window.updateProfileDisplay = updateProfileDisplay;
if (typeof generateMealPlan === 'function') window.generateMealPlan = generateMealPlan;
if (typeof calculateMacros === 'function') window.calculateMacros = calculateMacros;
if (typeof updateShoppingList === 'function') window.updateShoppingList = updateShoppingList;
if (typeof generateActivityPlan === 'function') window.generateActivityPlan = generateActivityPlan;
if (typeof editProfile === 'function') window.editProfile = editProfile;
if (typeof closeModal === 'function') window.closeModal = closeModal;
if (typeof saveGoals === 'function') window.saveGoals = saveGoals;
if (typeof regenerateWorkoutPlan === 'function') window.regenerateWorkoutPlan = regenerateWorkoutPlan;
// Add new functions to the global scope
if (typeof addFoodToLog === 'function') window.addFoodToLog = addFoodToLog;
if (typeof updateFoodLogDisplay === 'function') window.updateFoodLogDisplay = updateFoodLogDisplay;
if (typeof removeFood === 'function') window.removeFood = removeFood;
if (typeof updateMacroTotals === 'function') window.updateMacroTotals = updateMacroTotals;
if (typeof showFoodSearch === 'function') window.showFoodSearch = showFoodSearch;
if (typeof searchFood === 'function') window.searchFood = searchFood;
if (typeof addSelectedFood === 'function') window.addSelectedFood = addSelectedFood;
if (typeof updateMacroChart === 'function') window.updateMacroChart = updateMacroChart;


// Make sure app_fixes.js functions are used if the original ones aren't available
document.addEventListener('DOMContentLoaded', function() {
  // Apply fixes to the app
  applyAppFixes();

  // Initialize analytics
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.initialize();

    // Track page load
    AnalyticsService.trackPageView();

    // Track app open
    const appOpenCount = parseInt(localStorage.getItem('appOpenCount') || '0') + 1;
    localStorage.setItem('appOpenCount', appOpenCount.toString());
    localStorage.setItem('lastAppOpen', new Date().toISOString());
    AnalyticsService.trackAppOpen(appOpenCount);
  }

  // Initialize the subscription UI
  if (typeof initSubscriptionUI === 'function') {
    initSubscriptionUI();
  }

  // Initialize the fitness connector
  console.log("Initializing fitness connector...");

  // Initialize social sharing
  if (typeof SocialSharingService !== 'undefined') {
    SocialSharingService.initialize();
  }

  // Initialize growth optimization features
  if (typeof GrowthOptimizationService !== 'undefined') {
    GrowthOptimizationService.initialize();
  }

  // Initialize SEO optimization
  if (typeof SEOService !== 'undefined') {
    SEOService.initialize();
  }

  // Add social sharing widgets to meal plans and workouts
  if (typeof SocialSharingService !== 'undefined') {
    // Add to meal plan section
    const mealPlanSection = document.querySelector('#meal .meal-plan-container');
    if (mealPlanSection) {
      SocialSharingService.createSharingWidget(
        mealPlanSection, 
        SocialSharingService.contentTypes.MEAL_PLAN,
        { days: 7 }
      );
    }

    // Add to workout section
    const workoutSection = document.querySelector('#workout .workout-plan-container');
    if (workoutSection) {
      SocialSharingService.createSharingWidget(
        workoutSection,
        SocialSharingService.contentTypes.WORKOUT,
        { type: 'weekly' }
      );
    }
  }

  console.log("Script.js initialization complete");
});

// Track navigation between sections
document.addEventListener('click', event => {
  const navItem = event.target.closest('.nav-item');
  if (navItem) {
    const section = navItem.getAttribute('data-section');    if (section && typeof AnalyticsService !== 'undefined') {
      // Track page view with more details
      AnalyticsService.trackPageView(section);

      // Track experiment data if applicable
      if (typeof GrowthOptimizationService !== 'undefined') {
        if (section === 'subscription') {
          GrowthOptimizationService.trackExperimentConversion('subscription_layout', 'page_view');
        }
      }
    }
  }
});

// Add food to food log
function addFoodToLog(food, meal) {
  console.log("Adding food to log:", food, "to", meal);

  // Initialize food log if it doesn't exist
  if (!window.dailyLog) {
    window.dailyLog = {
      meals: {
        breakfast: [],
        lunch: [],
        dinner: [],
        snacks: []
      },
      totalCalories: 0,
      totalSteps: 0
    };
  }

  if (!window.dailyLog.meals[meal]) {
    window.dailyLog.meals[meal] = [];
  }

  // Add food to the meal
  window.dailyLog.meals[meal].push(food);

  // Update total calories
  window.dailyLog.totalCalories += food.calories || 0;

  // Save to localStorage
  localStorage.setItem('dailyLog', JSON.stringify(window.dailyLog));

  // Update the UI
  updateFoodLogDisplay();
  updateProfileDisplay();
}

// Update food log display
function updateFoodLogDisplay() {
  const meals = ['breakfast', 'lunch', 'dinner', 'snacks'];

  meals.forEach(meal => {
    const logElement = document.getElementById(`${meal}Log`);
    if (!logElement) return;

    // Clear existing entries
    logElement.innerHTML = '';

    // Get foods for this meal
    const foods = dailyLog.meals[meal] || [];

    if (foods.length === 0) {
      logElement.innerHTML = '<li class="empty-meal">No foods logged yet</li>';
      return;
    }

    // Add each food to the list
    foods.forEach((food, index) => {
      const foodItem = document.createElement('li');
      foodItem.className = 'food-entry';
      foodItem.innerHTML = `
        <div class="food-entry-details">
          <span class="food-name">${food.name || 'Unknown Food'}</span>
          <span class="food-calories">${food.calories || 0} cal</span>
        </div>
        <div class="food-macros">
          <span class="macro">P: ${food.protein || 0}g</span>
          <span class="macro">C: ${food.carbs ||0}g</span>
          <span class="macro">F: ${food.fat || 0}g</span>
        </div>
        <button class="remove-food" onclick="removeFood('${meal}', ${index})">
          <i class="fas fa-times"></i>
        </button>
      `;
      logElement.appendChild(foodItem);
    });
  });

  // Update macro totals
  updateMacroTotals();
}

// Remove food from log
function removeFood(meal, index) {
  if (!dailyLog.meals[meal] || !dailyLog.meals[meal][index]) return;

  // Subtract calories
  dailyLog.totalCalories -= dailyLog.meals[meal][index].calories || 0;

  // Remove the food
  dailyLog.meals[meal].splice(index, 1);

  // Save to localStorage
  localStorage.setItem('dailyLog', JSON.stringify(dailyLog));

  // Update the UI
  updateFoodLogDisplay();
  updateProfileDisplay();
}

// Update macro totals
function updateMacroTotals() {
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let totalCalories = 0;

  // Calculate totals from all meals
  Object.values(dailyLog.meals).forEach(foods => {
    foods.forEach(food => {
      totalProtein += food.protein || 0;
      totalCarbs += food.carbs || 0;
      totalFat += food.fat || 0;
      totalCalories += food.calories || 0;
    });
  });

  // Update UI elements
  const totalProteinElement = document.getElementById('totalProtein');
  const totalCarbsElement = document.getElementById('totalCarbs');
  const totalFatElement = document.getElementById('totalFat');
  const totalCalsElement = document.getElementById('totalCals');

  if (totalProteinElement) totalProteinElement.textContent = Math.round(totalProtein);
  if (totalCarbsElement) totalCarbsElement.textContent = Math.round(totalCarbs);
  if (totalFatElement) totalFatElement.textContent = Math.round(totalFat);
  if (totalCalsElement) totalCalsElement.textContent = Math.round(totalCalories);

  // Update macro display on dashboard
  document.getElementById('macroDisplay').textContent = 
    `P: ${Math.round(totalProtein)}g | C: ${Math.round(totalCarbs)}g | F: ${Math.round(totalFat)}g`;

  // Update chart if it exists
  updateMacroChart(totalProtein, totalCarbs, totalFat);
}

// Search for food
function showFoodSearch() {
  try {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) {
      console.error("Search results element not found");
      return;
    }
    
    searchResults.innerHTML = `
      <div class="search-container">
        <div class="search-input-group">
          <input type="text" id="foodSearchInput" placeholder="Search for a food...">
          <button id="searchFoodBtn" class="search-btn">
            <i class="fas fa-search"></i>
          </button>
        </div>
        <div id="foodSearchResults" class="food-search-results"></div>
      </div>
    `;

    // Add event listeners
    const searchInput = document.getElementById('foodSearchInput');
    const searchBtn = document.getElementById('searchFoodBtn');

    if (searchBtn) {
      searchBtn.addEventListener('click', function() {
        if (searchInput) searchFood(searchInput.value);
      });
    }

    if (searchInput) {
      searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          searchFood(searchInput.value);
        }
      });
      
      // Focus input
      searchInput.focus();
    }
  } catch (error) {
    console.error("Error in showFoodSearch:", error);
  }
}

// Search for food in database
function searchFood(query) {
  if (!query || query.length < 2) return;

  const resultsContainer = document.getElementById('foodSearchResults');
  resultsContainer.innerHTML = '<div class="loading">Searching...</div>';

  // Sample food database for demo
  const foodDatabase = [
    { name: "Chicken Breast", calories: 165, protein: 31, carbs: 0, fat: 3.6, image: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=600&q=80" },
    { name: "Salmon", calories: 208, protein: 22, carbs: 0, fat: 13, image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&q=80" },
    { name: "Brown Rice", calories: 216, protein: 5, carbs: 45, fat: 1.8, image: "https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=600&q=80" },
    { name: "White Rice", calories: 200, protein: 4, carbs: 44, fat: 0.5, image: "https://images.unsplash.com/photo-1516684732162-798a0062be99?w=600&q=80" },
    { name: "Sweet Potato", calories: 86, protein: 1.6, carbs: 20, fat: 0.1, image: "https://images.unsplash.com/photo-1596434300655-e48d3ff3dd5e?w=600&q=80" },
    { name: "Spinach", calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, image: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600&q=80" },
    { name: "Broccoli", calories: 55, protein: 3.7, carbs: 11.2, fat: 0.6, image: "https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?w=600&q=80" },
    { name: "Egg", calories: 68, protein: 5.5, carbs: 0.6, fat: 4.8, image: "https://images.unsplash.com/photo-1607690424560-5e6f93c18838?w=600&q=80" },
    { name: "Greek Yogurt", calories: 100, protein: 10, carbs: 4, fat: 5, image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80" },
    { name: "Banana", calories: 105, protein: 1.3, carbs: 27, fat: 0.3, image: "https://images.unsplash.com/photo-1528825871115-3581a5387919?w=600&q=80" },
    { name: "Apple", calories: 95, protein: 0.5, carbs: 25, fat: 0.3, image: "https://images.unsplash.com/photo-1570913149827-d2ac84ab3f9a?w=600&q=80" },
    { name: "Peanut Butter", calories: 188, protein: 8, carbs: 6, fat: 16, image: "https://images.unsplash.com/photo-1621243804936-775306a8f2e3?w=600&q=80" },
    { name: "Oatmeal", calories: 150, protein: 5, carbs: 27, fat: 3, image: "https://images.unsplash.com/photo-1614961233913-a5113a4df86a?w=600&q=80" },
    { name: "Avocado", calories: 234, protein: 2.9, carbs: 12.5, fat: 21, image: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80" },
    { name: "Almonds", calories: 164, protein: 6, carbs: 6, fat: 14, image: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&q=80" }
  ];

  // Filter foods based on query
  const filteredFoods = foodDatabase.filter(food => 
    food.name.toLowerCase().includes(query.toLowerCase())
  );

  // Render results
  if (filteredFoods.length === 0) {
    resultsContainer.innerHTML = '<div class="no-results">No foods found. Try a different search term.</div>';
    return;
  }

  let resultsHTML = '';

  filteredFoods.forEach(food => {
    resultsHTML += `
      <div class="food-result">
        ${food.image ? `<div class="food-result-image"><img src="${food.image}" alt="${food.name}"></div>` : ''}
        <div class="food-result-details">
          <div class="food-result-name">${food.name}</div>
          <div class="food-result-macros">
            <span>${food.calories} cal</span> | 
            <span>P: ${food.protein}g</span> | 
            <span>C: ${food.carbs}g</span> | 
            <span>F: ${food.fat}g</span>
          </div>
        </div>
        <button class="add-food-btn" onclick="addSelectedFood(${JSON.stringify(food).replace(/"/g, '&quot;')})">
          <i class="fas fa-plus"></i>
        </button>
      </div>
    `;
  });

  resultsContainer.innerHTML = resultsHTML;
}

// Add selected food to current meal
function addSelectedFood(food) {
  try {
    const mealSelect = document.getElementById('mealSelect');
    const meal = mealSelect ? mealSelect.value : 'breakfast';
    
    // Handle cases where food might be a string representation of an object
    let foodObj = food;
    if (typeof food === 'string') {
      try {
        foodObj = JSON.parse(food);
      } catch (e) {
        console.error("Error parsing food data:", e);
        foodObj = {
          name: food,
          calories: 100,
          protein: 0,
          carbs: 0,
          fat: 0
        };
      }
    }

    addFoodToLog(foodObj, meal);

    // Clear search results
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
      searchResults.innerHTML = '';
    }

    // Show success message
    const foodSection = document.getElementById('food');
    if (foodSection) {
      const successMsg = document.createElement('div');
      successMsg.className = 'success-message';
      successMsg.innerHTML = `
        <i class="fas fa-check-circle"></i>
        Added ${foodObj.name} to ${meal}
      `;

      foodSection.appendChild(successMsg);

      // Remove message after 3 seconds
      setTimeout(() => {
        successMsg.remove();
      }, 3000);
    }
  } catch (error) {
    console.error("Error in addSelectedFood:", error);
  }
}

// Update macro chart
function updateMacroChart(protein, carbs, fat) {
  const ctx = document.getElementById('macroChart');
  if (!ctx) return;

  // Destroy existing chart if it exists
  if (window.macroChart) {
    window.macroChart.destroy();
  }

  // Create new chart
  window.macroChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fat'],
      datasets: [{
        data: [protein, carbs, fat],
        backgroundColor: [
          '#FF6B6B',
          '#4ECDC4',
          '#FFD166'
        ],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 20,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              return `${label}: ${value}g`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

// Event listeners for food log section
document.addEventListener('DOMContentLoaded', function() {
  const addFoodBtn = document.getElementById('addFoodBtn');
  const searchFoodBtn = document.getElementById('searchFoodBtn'); // Added for search functionality

  if (addFoodBtn) {
    addFoodBtn.addEventListener('click', showFoodSearch);
  }
});

// Initialize the app
function initApp() {
  console.log("DOM loaded, applying fixes");
  try {
    updateProfileDisplay();
    console.log("Profile display updated successfully");
  } catch (error) {
    console.error("Error updating profile display:", error);
  }

  // Apply fixes from app_fixes.js
  if (typeof applyAppFixes === 'function') {
    try {
      applyAppFixes();
      console.log("App fixes applied successfully");
    } catch (error) {
      console.error("Error applying app fixes:", error);
    }
  }

  // Initialize fitness connector and other components
  console.log("Initializing fitness connector...");
  try {
    if (typeof initializeGrokAgent === 'function') {
      initializeGrokAgent();
    } else {
      console.warn("Grok agent initialization function not found");
    }
  } catch (error) {
    console.error("Error initializing Grok agent:", error);
  }

  // Initialize premium features showcase
  if (typeof PremiumFeaturesManager !== 'undefined') {
    try {
      // Get user's subscription tier from localStorage or use 'free' as default
      const userSubscription = JSON.parse(localStorage.getItem('userSubscription') || '{"plan":"free"}');
      const userTier = userSubscription.plan || 'free';

      // Add premium features tab to navigation
      if (typeof addPremiumFeaturesNavItem === 'function') {
        addPremiumFeaturesNavItem();
      }

      // Render premium features showcase
      PremiumFeaturesManager.renderFeaturesShowcase('premium-features-container', userTier);
      console.log("Premium features initialized");
    } catch (error) {
      console.error("Error initializing premium features:", error);
    }
  }

  // Generate initial plans
  try {
    console.log("Generating meal plan");
    if (typeof generateMealPlan === 'function') {
      generateMealPlan();
    }
  } catch (error) {
    console.error("Error generating meal plan:", error);
  }

  // Make sure all navigation works
  try {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', function() {
        const section = this.getAttribute('data-section');
        if (section && typeof showSection === 'function') {
          showSection(section);
        }
      });
    });
  } catch (error) {
    console.error("Error setting up navigation:", error);
  }

  // Fix workout display
  setTimeout(() => {
    if (typeof generateActivityPlan === 'function') {
      try {
        const workoutSection = document.getElementById('workout');
        if (workoutSection) {
          const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
          if (workoutPlanDisplay && (!workoutPlanDisplay.innerHTML || workoutPlanDisplay.innerHTML.trim() === '')) {
            generateActivityPlan();
          }
        }
      } catch (error) {
        console.error("Error generating activity plan:", error);
      }
    }
  }, 1000);

  // Run tests in development mode
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (typeof runFunctionTests === 'function') {
      runFunctionTests();
    }
  }

  console.log("Script.js initialization complete");
}

// Call initApp after DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Add premium features nav item
function addPremiumFeaturesNavItem() {
  const navBar = document.querySelector('.side-nav');
  if (!navBar) return;

  // Create premium features nav item
  const premiumFeaturesNav = document.createElement('div');
  premiumFeaturesNav.className = 'nav-item';
  premiumFeaturesNav.setAttribute('data-section', 'premium-features');
  premiumFeaturesNav.innerHTML = `
    <i class="fas fa-star"></i>
    <span>Premium</span>
  `;

  // Add to nav bar
  navBar.appendChild(premiumFeaturesNav);
}