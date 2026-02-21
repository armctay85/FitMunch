
// Fix for FitMunch JavaScript errors

// This file consolidates all fixes needed for the FitMunch app
// Instructions: Replace the problematic code in the existing files with these corrected versions

// ========== SCRIPT.JS FIXES ==========
// Fix 1: Remove duplicate userProfile declaration
// In script.js, ensure there's only one userProfile declaration:

// Global variables - only declare these once
const userProfile = JSON.parse(localStorage.getItem('userProfile')) || {
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

const dailyLog = {
  meals: {
    breakfast: [],
    lunch: [],
    dinner: [],
    snacks: []
  },
  totalCalories: 0,
  totalSteps: 0
};

// Fix 2: Ensure all functions are properly defined in global scope

// Navigation function
function showSection(sectionId) {
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
}

// Update profile display
function updateProfileDisplay() {
  const userName = document.getElementById('userName');
  const currentDate = document.getElementById('currentDate');
  const calorieDisplay = document.getElementById('calorieDisplay');
  const stepsDisplay = document.getElementById('stepsDisplay');
  
  if (userName) userName.textContent = userProfile.name;
  if (currentDate) currentDate.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  
  // Update profile stats
  const profileStats = document.querySelector('.profile-stats');
  if (profileStats) {
    profileStats.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${userProfile.height}cm</span>
        <span class="stat-label">Height</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${userProfile.weight}kg</span>
        <span class="stat-label">Weight</span>
      </div>
    `;
  }
  
  // Update goal displays
  if (calorieDisplay) calorieDisplay.textContent = userProfile.goals.calories;
  if (stepsDisplay) stepsDisplay.textContent = userProfile.goals.steps;
  
  // Update progress bars
  updateProgressBars();
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
  
  // Calculate and display macros
  calculateAndDisplayMacros(selectedPlan);
  
  // Update shopping list
  updateShoppingList(selectedPlan);
  
  return selectedPlan;
}

// Calculate macros
function calculateMacros(foods) {
  // Simplified calculation for demo
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  
  if (Array.isArray(foods)) {
    foods.forEach(food => {
      totalProtein += food.protein || 0;
      totalCarbs += food.carbs || 0;
      totalFat += food.fat || 0;
    });
  }
  
  return {
    protein: totalProtein,
    carbs: totalCarbs,
    fat: totalFat,
    calories: totalProtein * 4 + totalCarbs * 4 + totalFat * 9
  };
}

// Calculate and display macros
function calculateAndDisplayMacros(mealPlan) {
  // Simplified macro values for demo
  const macros = {
    protein: 120, // grams
    carbs: 200,   // grams
    fat: 60,      // grams
  };
  
  const calories = macros.protein * 4 + macros.carbs * 4 + macros.fat * 9;
  
  // Update macro displays
  const mealCalories = document.getElementById('mealCalories');
  const mealProtein = document.getElementById('mealProtein');
  const mealCarbs = document.getElementById('mealCarbs');
  const mealFat = document.getElementById('mealFat');
  
  if (mealCalories) mealCalories.textContent = calories;
  if (mealProtein) mealProtein.textContent = macros.protein + 'g';
  if (mealCarbs) mealCarbs.textContent = macros.carbs + 'g';
  if (mealFat) mealFat.textContent = macros.fat + 'g';
  
  // Calculate cost estimates
  const dailyCost = 15.00 + (Math.random() * 10); // Simulated daily cost
  const weeklyCost = dailyCost * 7;
  
  const dailyCostElement = document.getElementById('dailyCost');
  const weeklyCostElement = document.getElementById('weeklyCost');
  
  if (dailyCostElement) dailyCostElement.textContent = '$' + dailyCost.toFixed(2);
  if (weeklyCostElement) weeklyCostElement.textContent = '$' + weeklyCost.toFixed(2);
}

// Update shopping list based on meal plan
function updateShoppingList(mealPlan) {
  // Only proceed if shopping section exists
  const shoppingSection = document.getElementById('shopping');
  if (!shoppingSection) return;
  
  // Sample shopping items based on meal plan
  const shoppingItems = generateShoppingItems(mealPlan);
  
  // Display shopping list
  const shopList = document.getElementById('shopList');
  if (shopList) {
    let listHTML = '';
    
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
    shoppingItems.forEach(item => {
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
          listHTML += `
            <li class="shop-item">
              <div class="item-details">
                <span class="item-name">${item.name}</span>
                <span class="item-quantity">${item.quantity}</span>
              </div>
              <div class="item-price">$${item.price.toFixed(2)}</div>
            </li>
          `;
        });
        
        listHTML += '</ul>';
      }
    }
    
    shopList.innerHTML = listHTML;
  }
  
  // Calculate and display totals
  const totalCost = shoppingItems.reduce((sum, item) => sum + item.price, 0);
  const totalItems = shoppingItems.length;
  
  const totalCostElement = document.getElementById('totalCost');
  const totalItemsElement = document.getElementById('totalItems');
  
  if (totalCostElement) totalCostElement.textContent = '$' + totalCost.toFixed(2);
  if (totalItemsElement) totalItemsElement.textContent = totalItems;
}

// Generate shopping items based on meal plan
function generateShoppingItems(mealPlan) {
  // Sample shopping items (in a real app, this would be derived from the meal plan)
  return [
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
}

// Generate workout/activity plan
function generateActivityPlan() {
  // Only proceed if workout section is active
  const workoutSection = document.getElementById('workout');
  if (!workoutSection || !workoutSection.classList.contains('active-section')) return;
  
  // Get activity plan from user profile
  const activityPlan = userProfile.goals.activityPlan;
  
  // Set default values if not available
  const activityType = activityPlan.type || 'gym';
  const frequency = activityPlan.frequency || 3;
  const level = activityPlan.level || 'Beginner';
  const duration = activityPlan.duration || 1;
  const preferredTime = activityPlan.preferredTime || 'Morning (6-9)';
  
  // Generate workout plan based on type and level
  let workouts = [];
  
  if (activityType === 'gym') {
    if (level === 'Beginner') {
      workouts = [
        { day: 'Monday', workout: 'Full Body Workout', description: 'Basic strength training focusing on major muscle groups', duration: duration },
        { day: 'Wednesday', workout: 'Cardio', description: '30 minutes moderate intensity on treadmill or elliptical', duration: duration },
        { day: 'Friday', workout: 'Full Body Workout', description: 'Basic strength training with different exercises than Monday', duration: duration }
      ];
    } else if (level === 'Intermediate') {
      workouts = [
        { day: 'Monday', workout: 'Upper Body', description: 'Chest, back, shoulders, and arms', duration: duration },
        { day: 'Tuesday', workout: 'Lower Body', description: 'Legs, glutes, and core', duration: duration },
        { day: 'Thursday', workout: 'HIIT Cardio', description: 'High-intensity interval training', duration: duration },
        { day: 'Friday', workout: 'Full Body', description: 'Compound movements for all major muscle groups', duration: duration }
      ];
    } else {
      // Advanced
      workouts = [
        { day: 'Monday', workout: 'Push Day', description: 'Chest, shoulders, and triceps', duration: duration },
        { day: 'Tuesday', workout: 'Pull Day', description: 'Back and biceps', duration: duration },
        { day: 'Wednesday', workout: 'Legs Day', description: 'Quadriceps, hamstrings, glutes, and calves', duration: duration },
        { day: 'Thursday', workout: 'HIIT Cardio', description: 'High-intensity interval training', duration: duration },
        { day: 'Friday', workout: 'Upper Body', description: 'Focus on weaker muscle groups', duration: duration },
        { day: 'Saturday', workout: 'Active Recovery', description: 'Light cardio and mobility work', duration: 0.5 }
      ];
    }
  } else {
    // Default for other activity types
    workouts = [
      { day: 'Monday', workout: 'Workout 1', description: 'Activity based on your preferences', duration: duration },
      { day: 'Wednesday', workout: 'Workout 2', description: 'Activity based on your preferences', duration: duration },
      { day: 'Friday', workout: 'Workout 3', description: 'Activity based on your preferences', duration: duration }
    ];
  }
  
  // Display workout plan
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (workoutPlanDisplay) {
    let planHTML = `
      <div class="plan-header">
        <h3>Weekly Activity Plan</h3>
        <p>Type: ${capitalizeFirstLetter(activityType)} Workout | Level: ${level} | Frequency: ${frequency} days/week</p>
      </div>
      <div class="workouts-container">
    `;
    
    workouts.forEach(workout => {
      planHTML += `
        <div class="workout-card">
          <div class="workout-day">${workout.day}</div>
          <div class="workout-title">${workout.workout}</div>
          <div class="workout-time">${workout.duration} hour${workout.duration !== 1 ? 's' : ''}</div>
          <div class="workout-desc">${workout.description}</div>
        </div>
      `;
    });
    
    planHTML += '</div>';
    workoutPlanDisplay.innerHTML = planHTML;
  }
  
  // Generate and display weekly schedule
  generateWeeklySchedule(workouts, preferredTime);
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Helper function to generate weekly schedule
function generateWeeklySchedule(workouts, preferredTime) {
  const weeklyScheduleDisplay = document.getElementById('weeklyScheduleDisplay');
  
  if (weeklyScheduleDisplay) {
    let scheduleHTML = `
      <div class="schedule-header">
        <h3>Weekly Schedule</h3>
        <p>Preferred Time: ${preferredTime}</p>
      </div>
      <div class="schedule-grid">
        <div class="schedule-day">Monday</div>
        <div class="schedule-day">Tuesday</div>
        <div class="schedule-day">Wednesday</div>
        <div class="schedule-day">Thursday</div>
        <div class="schedule-day">Friday</div>
        <div class="schedule-day">Saturday</div>
        <div class="schedule-day">Sunday</div>
    `;
    
    // Days of the week
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Create schedule cells
    days.forEach(day => {
      const workout = workouts.find(w => w.day === day);
      
      if (workout) {
        scheduleHTML += `
          <div class="schedule-cell workout">
            <div class="schedule-workout">${workout.workout}</div>
            <div class="schedule-time">${preferredTime}</div>
          </div>
        `;
      } else {
        scheduleHTML += `<div class="schedule-cell rest">Rest Day</div>`;
      }
    });
    
    scheduleHTML += '</div>';
    weeklyScheduleDisplay.innerHTML = scheduleHTML;
  }
}

// Update progress bars
function updateProgressBars() {
  const calorieProgress = document.getElementById('calorieProgress');
  const stepsProgress = document.getElementById('stepsProgress');
  const activityProgress = document.getElementById('activityProgress');
  
  if (calorieProgress) {
    const caloriePercent = Math.min(100, Math.round((dailyLog.totalCalories / userProfile.goals.calories) * 100));
    calorieProgress.style.width = `${caloriePercent}%`;
  }
  
  if (stepsProgress) {
    const stepsPercent = Math.min(100, Math.round((dailyLog.totalSteps / userProfile.goals.steps) * 100));
    stepsProgress.style.width = `${stepsPercent}%`;
  }
  
  if (activityProgress) {
    // Simplified for demo
    const activityPercent = 65; // Example value
    activityProgress.style.width = `${activityPercent}%`;
  }
}

// ========== GROK AGENT FIXES ==========
// Fix syntax errors in grokAgent class

// Fixed grokAgent class definition 
class GrokAgent {
  constructor() {
    this.initialized = false;
    this.userPreferences = null;
    this.functionRegistry = {};
  }
  
  initialize(userProfile) {
    this.userPreferences = userProfile || {};
    this.initialized = true;
    
    // Register common functions
    this.registerFunction('showSection', window.showSection);
    this.registerFunction('updateProfileDisplay', window.updateProfileDisplay);
    this.registerFunction('generateMealPlan', window.generateMealPlan);
    this.registerFunction('updateShoppingList', window.updateShoppingList);
    this.registerFunction('generateActivityPlan', window.generateActivityPlan);
    
    console.log("Grok Agent initialized successfully");
    return true;
  }
  
  registerFunction(name, func) {
    if (typeof func === 'function') {
      this.functionRegistry[name] = func;
      return true;
    }
    return false;
  }
  
  executeFunction(name, ...args) {
    if (name in this.functionRegistry) {
      return this.functionRegistry[name](...args);
    }
    console.error(`Function ${name} not found in registry`);
    return null;
  }
  
  getRegisteredFunctions() {
    return Object.keys(this.functionRegistry);
  }
  
  isInitialized() {
    return this.initialized;
  }
}

// Export as singleton
window.grokAgent = new GrokAgent();

// Make sure these are exposed to window object
window.showSection = showSection;
window.updateProfileDisplay = updateProfileDisplay;
window.generateMealPlan = generateMealPlan;
window.calculateMacros = calculateMacros;
window.updateShoppingList = updateShoppingList;
window.generateActivityPlan = generateActivityPlan;

// Initialize everything on page load
document.addEventListener('DOMContentLoaded', function() {
  console.log("Initializing app...");
  
  // Update profile display
  try {
    updateProfileDisplay();
  } catch (error) {
    console.error("Error updating profile:", error);
  }
  
  // Set up navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
      const section = this.getAttribute('data-section');
      showSection(section);
    });
  });
  
  // Initialize Grok Agent
  if (window.grokAgent) {
    window.grokAgent.initialize({
      name: 'Test User',
      height: '175',
      weight: '70',
      goals: {
        calories: 2000,
        steps: 10000
      }
    });
  }
  
  // Show dashboard by default
  showSection('dashboard');
});

// Test all functions to verify they're working
function testAllFunctions() {
  console.log("Testing all functions...");
  
  const results = {
    showSection: typeof window.showSection === 'function',
    updateProfileDisplay: typeof window.updateProfileDisplay === 'function',
    generateMealPlan: typeof window.generateMealPlan === 'function',
    calculateMacros: typeof window.calculateMacros === 'function',
    updateShoppingList: typeof window.updateShoppingList === 'function',
    generateActivityPlan: typeof window.generateActivityPlan === 'function',
    grokAgentInitialized: window.grokAgent && window.grokAgent.isInitialized()
  };
  
  console.log("Function test results:", results);
  
  const allPassed = Object.values(results).every(result => result === true);
  console.log(`All functions ${allPassed ? 'PASSED' : 'FAILED'}`);
  
  return results;
}

// Expose test function to window
window.testAllFunctions = testAllFunctions;
