// FitMunch App Core Functions - Fixed Version
// Optional split loads (PWA precache order): /js/fm-storage.js → /js/fm-identity.js → /script.js
// Standalone /script.js still works via inline fallbacks when modules are not preloaded.

(function ensureParseStoredJSON() {
  if (typeof globalThis.parseStoredJSON === 'function') return;
  if (typeof require !== 'undefined') {
    try {
      require('./js/fm-storage.js');
    } catch (_) {
      /* browser or wrong cwd */
    }
  }
  if (typeof globalThis.parseStoredJSON !== 'function') {
    globalThis.parseStoredJSON = function parseStoredJSON(key, fallbackValue) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallbackValue;
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`Invalid JSON in localStorage for key: ${key}`, error);
        return fallbackValue;
      }
    };
  }
})();

const parseStoredJSON = globalThis.parseStoredJSON;

(function ensureIdentityHelpers() {
  if (typeof globalThis.getCurrentUserId === 'function') return;
  if (typeof require !== 'undefined') {
    try {
      require('./js/fm-identity.js');
    } catch (_) {
      /* browser or wrong cwd */
    }
  }
  if (typeof globalThis.getCurrentUserId !== 'function') {
    globalThis.generateUUID = function generateUUID() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };
    globalThis.migrateOldUserId = function migrateOldUserId() {
      if (typeof sessionStorage === 'undefined') return;
      const oldSessionId = sessionStorage.getItem('fitmunch_userId');
      if (oldSessionId) {
        console.log('Removing old sessionStorage user ID');
        sessionStorage.removeItem('fitmunch_userId');
      }
      const userId = localStorage.getItem('userId');
      if (userId && !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        console.log('Migrating old user ID to UUID format');
        localStorage.removeItem('userId');
      }
    };
    globalThis.getCurrentUserId = function getCurrentUserId() {
      let userId = localStorage.getItem('userId');
      if (!userId) {
        userId = globalThis.generateUUID();
        localStorage.setItem('userId', userId);
        console.log('Generated new UUID:', userId);
      }
      return userId;
    };
    globalThis.getCurrentDate = function getCurrentDate() {
      return new Date().toISOString().split('T')[0];
    };
  }
})();

const generateUUID = globalThis.generateUUID;
const migrateOldUserId = globalThis.migrateOldUserId;
const getCurrentUserId = globalThis.getCurrentUserId;
const getCurrentDate = globalThis.getCurrentDate;

// Loading state helper
window.showLoading = function(show = true) {
  let loader = document.getElementById('globalLoader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'globalLoader';
    loader.className = 'loading-spinner';
    loader.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(loader);
  }
  loader.style.display = show ? 'flex' : 'none';
};

// Global variables
window.userProfile = parseStoredJSON('userProfile', {
  name: 'FitMunch User',
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
});

window.dailyLog = parseStoredJSON('dailyLog', {
  meals: {
    breakfast: [],
    lunch: [],
    dinner: [],
    snacks: []
  },
  totalCalories: 0,
  totalSteps: 0,
  water: 0,
  activities: []
});

globalThis.userProfile = window.userProfile;
globalThis.dailyLog = window.dailyLog;

// Fixed Navigation Function
window.showSection = function(sectionId) {
  console.log("Showing section:", sectionId);

  try {
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

      // Update navigation state
      const navItems = document.querySelectorAll('.nav-item');
      navItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-section') === sectionId);
      });

      // Initialize section-specific content
      setTimeout(() => {
        switch(sectionId) {
          case 'meal':
            if (typeof window.generateMealPlan === 'function') window.generateMealPlan(true);
            break;
          case 'workout':
            if (typeof window.generateActivityPlan === 'function') window.generateActivityPlan();
            break;
          case 'shopping':
            if (typeof updateShoppingList === 'function') updateShoppingList();
            break;
          case 'food':
            if (typeof updateFoodLogDisplay === 'function') updateFoodLogDisplay();
            break;
          case 'dashboard':
            if (typeof window.updateProfileDisplay === 'function') window.updateProfileDisplay();
            break;
          case 'fitness':
            if (typeof updateAnalytics === 'function') updateAnalytics();
            break;
        }
      }, 100);

      // Scroll to top
      window.scrollTo(0, 0);
    } else {
      console.warn(`Section element not found: ${sectionId}`);
    }
  } catch (error) {
    console.error("Error in showSection:", error);
  }
};

// Load profile from API
async function loadProfileFromAPI() {
  if (!window.fitMunchAPI) {
    console.warn('fitMunchAPI not yet loaded, using default profile');
    return;
  }
  
  window.showLoading(true);
  try {
    const userId = getCurrentUserId();
    const profile = await window.fitMunchAPI.getProfile(userId);
    
    if (profile) {
      window.userProfile = profile;
      globalThis.userProfile = window.userProfile;
      try {
        localStorage.setItem('userProfile', JSON.stringify(window.userProfile));
      } catch (e) {
        console.warn('Could not persist profile to localStorage', e);
      }
      console.log('Profile loaded from API:', profile);
    } else {
      console.log('No profile found in API, using defaults');
    }
  } catch (error) {
    console.warn('Failed to load profile from API, using defaults:', error);
  } finally {
    window.showLoading(false);
  }
}

function applyProfileDisplayUI() {
  const userName = document.getElementById('userName');
  const currentDate = document.getElementById('currentDate');

  if (userName) userName.textContent = window.userProfile.name || 'FitMunch User';
  if (currentDate) {
    const today = new Date();
    currentDate.textContent = today.toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  const wellnessScore = calculateWellnessScore();
  const scoreElement = document.querySelector('.score');
  if (scoreElement) {
    scoreElement.textContent = wellnessScore;
  }

  const calorieDisplay = document.getElementById('calorieDisplay');
  const stepsDisplay = document.getElementById('stepsDisplay');

  if (calorieDisplay) calorieDisplay.textContent = window.userProfile.goals?.calories || 2000;
  if (stepsDisplay) stepsDisplay.textContent = window.userProfile.goals?.steps || 10000;

  updateProgressBars();
}

// Enhanced Profile Display (sync DOM update; optional API refresh in background)
window.updateProfileDisplay = function() {
  console.log("Updating profile display");

  try {
    applyProfileDisplayUI();
    if (window.fitMunchAPI && typeof loadProfileFromAPI === 'function') {
      loadProfileFromAPI()
        .then(() => applyProfileDisplayUI())
        .catch(() => {});
    }
  } catch (error) {
    console.error("Error updating profile display:", error);
  }
};

// Calculate wellness score
function calculateWellnessScore() {
  const profile = window.userProfile;
  const dailyLog = window.dailyLog;

  let score = 50; // Base score

  // Nutrition scoring (30 points max)
  if (dailyLog.totalCalories > 0) {
    const calorieGoal = profile.goals?.calories || 2000;
    const calorieRatio = dailyLog.totalCalories / calorieGoal;
    if (calorieRatio >= 0.8 && calorieRatio <= 1.1) {
      score += 30;
    } else if (calorieRatio >= 0.6 && calorieRatio <= 1.3) {
      score += 20;
    } else {
      score += 10;
    }
  }

  // Activity scoring (25 points max)
  const stepsGoal = profile.goals?.steps || 10000;
  const stepsRatio = dailyLog.totalSteps / stepsGoal;
  if (stepsRatio >= 1.0) {
    score += 25;
  } else if (stepsRatio >= 0.7) {
    score += 15;
  } else if (stepsRatio >= 0.4) {
    score += 8;
  }

  return Math.min(Math.max(score, 0), 100);
}

// Update progress bars
function updateProgressBars() {
  const calorieProgress = document.getElementById('calorieProgress');
  const stepsProgress = document.getElementById('stepsProgress');
  const activityProgress = document.getElementById('activityProgress');

  if (calorieProgress) {
    const calorieGoal = window.userProfile.goals?.calories || 2000;
    const current = window.dailyLog.totalCalories || 0;
    calorieProgress.textContent = `${current}/${calorieGoal}`;
  }

  if (stepsProgress) {
    const stepsGoal = window.userProfile.goals?.steps || 10000;
    const current = window.dailyLog.totalSteps || 0;
    stepsProgress.textContent = `${current}/${stepsGoal}`;
  }

  if (activityProgress) {
    const activityType = window.userProfile.goals?.activityPlan?.type || 'General';
    activityProgress.textContent = activityType.charAt(0).toUpperCase() + activityType.slice(1);
  }
}

// Enhanced Meal Plan Generation
// `force` is accepted for compatibility with callers; generation runs whenever #meal exists.
window.generateMealPlan = function(_force) {
  const mealSection = document.getElementById('meal');
  if (!mealSection) return;
  const mealDisplay = document.getElementById('mealDisplay');
  if (mealDisplay) {
    mealDisplay.innerHTML = '<p>No meal plan yet. Build the week in FitMunch. Prices vary by store and week.</p>';
  }
  ['mealCalories', 'mealProtein', 'mealCarbs', 'mealFat', 'dailyCost', 'weeklyCost'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
};

// Enhanced Food Search
window.showFoodSearch = function() {
  console.log("Showing enhanced food search");

  const searchResults = document.getElementById('searchResults');
  if (!searchResults) return;

  searchResults.innerHTML = `
    <div class="food-search-container">
      <div class="search-header">
        <h3>Add Food to Log</h3>
        <select id="mealTypeSelector" class="meal-selector">
          <option value="breakfast">Breakfast</option>
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
          <option value="snacks">Snacks</option>
        </select>
      </div>

      <div class="search-input-group">
        <input type="text" id="foodSearchInput" placeholder="Search for foods..." autocomplete="off">
        <button id="searchFoodBtn" class="search-btn">
          <i class="fas fa-search"></i>
        </button>
      </div>

      <div class="quick-add-section">
        <h4>Quick Add</h4>
        <div class="quick-add-buttons">
          <button onclick="quickAddFood('Water', 0, 0, 0, 0)" class="quick-add-btn">Water</button>
          <button onclick="quickAddFood('Apple', 95, 0.5, 25, 0.3)" class="quick-add-btn">Apple</button>
          <button onclick="quickAddFood('Banana', 105, 1.3, 27, 0.3)" class="quick-add-btn">Banana</button>
          <button onclick="quickAddFood('Chicken Breast (100g)', 165, 31, 0, 3.6)" class="quick-add-btn">Chicken</button>
        </div>
      </div>

      <div id="foodSearchResults" class="food-search-results"></div>
    </div>
  `;

  // Add event listeners
  const searchInput = document.getElementById('foodSearchInput');
  const searchBtn = document.getElementById('searchFoodBtn');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => searchFood(searchInput.value));
  }

  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        searchFood(searchInput.value);
      }
    });
    searchInput.focus();
  }
};

// Quick add food function
window.quickAddFood = function(name, calories, protein, carbs, fat) {
  const mealType = document.getElementById('mealTypeSelector')?.value || 'breakfast';
  const food = { name, calories, protein, carbs, fat };
  addFoodToLog(food, mealType);
  showNotification(`Added ${name} to ${mealType}!`, 'success');
};

// Food search function
function searchFood(query) {
  if (!query || query.length < 2) return;

  const resultsContainer = document.getElementById('foodSearchResults');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '<div class="loading-indicator">Searching foods...</div>';

  // Simple food database
  const foodDatabase = [
    { name: "Chicken Breast", calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    { name: "Salmon", calories: 208, protein: 22, carbs: 0, fat: 13 },
    { name: "Eggs", calories: 155, protein: 13, carbs: 1, fat: 11 },
    { name: "Greek Yogurt", calories: 100, protein: 17, carbs: 6, fat: 0 },
    { name: "Brown Rice", calories: 216, protein: 5, carbs: 45, fat: 1.8 },
    { name: "Quinoa", calories: 222, protein: 8, carbs: 39, fat: 4 },
    { name: "Sweet Potato", calories: 112, protein: 2, carbs: 26, fat: 0.1 },
    { name: "Broccoli", calories: 55, protein: 3.7, carbs: 11, fat: 0.6 },
    { name: "Avocado", calories: 234, protein: 2.9, carbs: 12, fat: 21 },
    { name: "Almonds", calories: 164, protein: 6, carbs: 6, fat: 14 }
  ];

  const filteredFoods = foodDatabase.filter(food =>
    food.name.toLowerCase().includes(query.toLowerCase())
  );

  if (filteredFoods.length === 0) {
    resultsContainer.innerHTML = `<div class="no-results">No foods found for "${query}"</div>`;
    return;
  }

  let resultsHTML = '';
  filteredFoods.forEach(food => {
    resultsHTML += `
      <div class="food-result">
        <div class="food-info">
          <h5>${food.name}</h5>
          <div class="food-nutrition">
            <span class="calories">${food.calories} cal</span>
            <span class="macros">P: ${food.protein}g | C: ${food.carbs}g | F: ${food.fat}g</span>
          </div>
        </div>
        <button class="add-food-btn" onclick="addFoodFromSearch('${food.name}', ${food.calories}, ${food.protein}, ${food.carbs}, ${food.fat})">
          <i class="fas fa-plus"></i>
        </button>
      </div>
    `;
  });

  resultsContainer.innerHTML = resultsHTML;
}

// Add food from search
window.addFoodFromSearch = function(name, calories, protein, carbs, fat) {
  const mealType = document.getElementById('mealTypeSelector')?.value || 'breakfast';
  const food = { name, calories, protein, carbs, fat };
  addFoodToLog(food, mealType);
  showNotification(`Added ${name} to ${mealType}!`, 'success');
};

// Add food to log
async function addFoodToLog(food, mealType) {
  if (!window.dailyLog.meals[mealType]) {
    window.dailyLog.meals[mealType] = [];
  }

  window.dailyLog.meals[mealType].push(food);
  window.dailyLog.totalCalories += food.calories || 0;

  try {
    showLoading(true);
    const userId = getCurrentUserId();
    const date = getCurrentDate();
    const macros = {
      protein: food.protein || 0,
      carbs: food.carbs || 0,
      fat: food.fat || 0
    };

    await fitMunchAPI.logMeal(userId, date, mealType, [food], food.calories || 0, macros);
    console.log('Meal logged to API successfully');
    
    await updateFoodLogDisplay();
    updateProfileDisplay();
  } catch (error) {
    console.error('Failed to log meal:', error);
    showNotification('Failed to save meal. Please try again.', 'error');
  } finally {
    showLoading(false);
  }
}

// Update food log display
window.updateFoodLogDisplay = async function() {
  console.log("Updating food log display");

  try {
    showLoading(true);
    const userId = getCurrentUserId();
    const date = getCurrentDate();
    
    // Load daily meals from API
    const dailyData = await fitMunchAPI.getDailyMeals(userId, date);
    console.log('Daily meals loaded from API:', dailyData);
    
    // Update local daily log
    window.dailyLog = dailyData || {
      meals: { breakfast: [], lunch: [], dinner: [], snacks: [] },
      totalCalories: 0
    };

    const meals = ['breakfast', 'lunch', 'dinner', 'snacks'];

    meals.forEach(meal => {
      const logElement = document.getElementById(`${meal}Log`);
      if (!logElement) return;

      const foods = window.dailyLog.meals[meal] || [];

      if (foods.length === 0) {
        logElement.innerHTML = `
          <li class="empty-meal">
            <div class="empty-message">No foods logged yet</div>
            <button onclick="showFoodSearch()" class="add-first-food">
              <i class="fas fa-plus"></i> Add Food
            </button>
          </li>
        `;
        return;
      }

      let logHTML = '';
      foods.forEach((food, index) => {
        logHTML += `
          <li class="food-entry">
            <div class="food-main-info">
              <span class="food-name">${food.name || 'Unknown Food'}</span>
              <span class="food-calories">${food.calories || 0} cal</span>
            </div>
            <div class="food-macros">
              <span class="macro protein">P: ${(food.protein || 0).toFixed(1)}g</span>
              <span class="macro carbs">C: ${(food.carbs || 0).toFixed(1)}g</span>
              <span class="macro fat">F: ${(food.fat || 0).toFixed(1)}g</span>
            </div>
            <button class="remove-food" onclick="removeFoodFromLog('${meal}', ${index})">
              <i class="fas fa-trash"></i>
            </button>
          </li>
        `;
      });

      logElement.innerHTML = logHTML;
    });

    // Update total macros
    updateMacroTotals();
  } catch (error) {
    console.error('Failed to load food log:', error);
    showNotification('Failed to load meal data', 'error');
  } finally {
    showLoading(false);
  }
};

// Remove food from log
window.removeFoodFromLog = async function(mealType, index) {
  const food = window.dailyLog.meals[mealType][index];
  if (!food) return;

  window.dailyLog.totalCalories -= food.calories || 0;
  window.dailyLog.meals[mealType].splice(index, 1);

  showNotification(`Removed ${food.name} from ${mealType}`, 'info');
  
  // Reload the food log to refresh display
  await updateFoodLogDisplay();
  updateProfileDisplay();
};

// Regenerate workout plan
window.regenerateWorkout = function() {
  console.log("Regenerating workout plan");
  generateActivityPlan();
  showNotification('New workout plan generated!', 'success');
};

// Generate activity plan based on user preferences
window.generateActivityPlan = function() {
  console.log("Generating comprehensive activity plan");

  const workoutSection = document.getElementById('workout');
  if (!workoutSection?.classList.contains('active-section')) return;

  const activityPlan = window.userProfile.goals?.activityPlan || {
    type: 'gym',
    frequency: 3,
    level: 'Beginner',
    duration: 1,
    preferredTime: 'Morning (6-9)'
  };

  console.log("Activity plan:", activityPlan);

  const workouts = [
    {
      day: 'Monday',
      workout: 'Upper Body Strength',
      duration: activityPlan.duration,
      exercises: [
        { name: 'Push-ups', sets: 3, reps: '8-12', rest: '60s' },
        { name: 'Dumbbell Rows', sets: 3, reps: '10-12', rest: '60s' },
        { name: 'Shoulder Press', sets: 3, reps: '10-12', rest: '60s' },
        { name: 'Bicep Curls', sets: 2, reps: '12-15', rest: '45s' }
      ]
    },
    {
      day: 'Wednesday',
      workout: 'Lower Body & Core',
      duration: activityPlan.duration,
      exercises: [
        { name: 'Squats', sets: 3, reps: '12-15', rest: '60s' },
        { name: 'Lunges', sets: 3, reps: '10 each leg', rest: '60s' },
        { name: 'Plank', sets: 3, time: '30-45s', rest: '30s' },
        { name: 'Glute Bridges', sets: 3, reps: '15-20', rest: '45s' }
      ]
    },
    {
      day: 'Friday',
      workout: 'Full Body Circuit',
      duration: activityPlan.duration,
      exercises: [
        { name: 'Burpees', sets: 3, reps: '8-10', rest: '60s' },
        { name: 'Mountain Climbers', sets: 3, time: '30s', rest: '45s' },
        { name: 'Jump Squats', sets: 3, reps: '12-15', rest: '45s' },
        { name: 'Push-up to T', sets: 3, reps: '8-10', rest: '60s' }
      ]
    }
  ];

  displayWorkoutPlan(workouts, activityPlan);
  console.log("Activity plan generated successfully");
};

function displayWorkoutPlan(workouts, activityPlan) {
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (!workoutPlanDisplay) return;

  let planHTML = `
    <div class="workout-plan-header">
      <h3>${activityPlan.level} ${activityPlan.type.charAt(0).toUpperCase() + activityPlan.type.slice(1)} Program</h3>
      <div class="plan-overview">
        <div class="plan-stat">
          <span class="stat-label">Weekly Frequency</span>
          <span class="stat-value">${workouts.length} days</span>
        </div>
        <div class="plan-stat">
          <span class="stat-label">Session Duration</span>
          <span class="stat-value">${activityPlan.duration} hour${activityPlan.duration > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  `;

  planHTML += '<div class="workout-cards-container">';

  workouts.forEach((workout, index) => {
    planHTML += `
      <div class="workout-card" data-workout-index="${index}">
        <div class="workout-card-header">
          <div class="workout-day">${workout.day}</div>
          <div class="workout-completion">
            <label class="checkbox-wrapper">
              <input type="checkbox" class="workout-checkbox" data-day="${workout.day}">
              <span class="checkmark"></span>
              <span class="checkbox-label">Complete</span>
            </label>
          </div>
        </div>

        <div class="workout-title">${workout.workout}</div>
        <div class="workout-duration">Duration: ${workout.duration} hour${workout.duration !== 1 ? 's' : ''}</div>

        <div class="exercises-preview">
          ${workout.exercises.slice(0, 3).map(ex => `
            <div class="exercise-preview">${ex.name}</div>
          `).join('')}
        </div>

        <div class="workout-actions">
          <button onclick="showWorkoutDetails(${index})" class="details-btn">
            <i class="fas fa-eye"></i> View Details
          </button>
          <button onclick="openWorkoutLogModal('${workout.exercises[0].name}');" class="log-btn">
            <i class="fas fa-save"></i> Log Workout
          </button>
        </div>
      </div>
    `;
  });

  planHTML += '</div>';
  workoutPlanDisplay.innerHTML = planHTML;

  setupWorkoutInteractions();
}

// Check prices for shopping items
function checkPrices() {
  checkProductPrice();
}

// Update shopping list with live pricing and better UI
async function updateShoppingList() {
  const shopList = document.getElementById("shopList");
  const shoppingSection = document.getElementById("shopping");
  let shopLoadingIndicator;

  if (!shopList || !shoppingSection) {
    console.warn("Shopping list elements not found");
    return;
  }

  try {
    // Ensure shopping stats elements exist
    ensureShoppingStatsElements();

    // Show loading indicator
    shopLoadingIndicator = shoppingSection.querySelector('.loading-indicator');
    if (!shopLoadingIndicator) {
      shopLoadingIndicator = document.createElement('div');
      shopLoadingIndicator.className = 'loading-indicator';
      shopLoadingIndicator.innerHTML = '<span>Loading the list...</span>';
      shoppingSection.appendChild(shopLoadingIndicator);
    }
    shopLoadingIndicator.style.display = 'flex';

    // Create a complete shopping section if it doesn't have the right content
    if (!shoppingSection.querySelector('.shopping-list-container')) {
      shoppingSection.innerHTML = `
        <div class="shopping-list-container">
          <div class="shopping-list-header">
            <h3>Your Shopping List</h3>
            <button class="add-item-btn" onclick="addItemToShoppingList()">
              <i class="fas fa-plus"></i> Add Item
            </button>
          </div>
          <div id="shopList" class="shop-list-content"></div>
        </div>
      `;
      // Re-select the shopList element after updating innerHTML
      const updatedShopList = document.getElementById("shopList");
      if (!updatedShopList) {
        console.error("Failed to re-select shopList element.");
        return;
      }
    }

    // Sample shopping items organized by category
    const shoppingItems = [
      { name: "Chicken Breast", quantity: "1kg", category: "Proteins", brand: "Premium Choice", weeklyAmount: "1kg" },
      { name: "Salmon Fillets", quantity: "500g", category: "Proteins", brand: "Ocean Fresh", weeklyAmount: "500g" },
      { name: "Eggs", quantity: "1 dozen", category: "Dairy & Eggs", brand: "Farm Fresh", weeklyAmount: "1 dozen" },
      { name: "Greek Yogurt", quantity: "750g", category: "Dairy & Eggs", brand: "Healthy Bites", weeklyAmount: "1 tub" },
      { name: "Brown Rice", quantity: "1kg", category: "Grains & Pasta", brand: "Nature's Grain", weeklyAmount: "1kg" },
      { name: "Quinoa", quantity: "500g", category: "Grains & Pasta", brand: "Pure Quinoa", weeklyAmount: "500g" },
      { name: "Sweet Potatoes", quantity: "1kg", category: "Fruits & Vegetables", brand: "Farm Fresh", weeklyAmount: "1kg" },
      { name: "Broccoli", quantity: "500g", category: "Fruits & Vegetables", brand: "Green Fields", weeklyAmount: "1 head" },
      { name: "Spinach", quantity: "200g", category: "Fruits & Vegetables", brand: "Leafy Greens Co.", weeklyAmount: "1 bag" },
      { name: "Bananas", quantity: "1kg", category: "Fruits & Vegetables", brand: "Tropical Fruit Farms", weeklyAmount: "1kg" },
      { name: "Apples", quantity: "1kg", category: "Fruits & Vegetables", brand: "Orchard Delights", weeklyAmount: "1kg" },
      { name: "Almonds", quantity: "250g", category: "Nuts & Seeds", brand: "Nutty Delights", weeklyAmount: "250g" },
      { name: "Olive Oil", quantity: "500ml", category: "Pantry", brand: "Italian Harvest", weeklyAmount: "500ml" }
    ];

    const itemsWithPrices = shoppingItems;

    // Group items by category
    const groupedItems = itemsWithPrices.reduce((groups, item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
      return groups;
    }, {});

    // Display items by category
    let listHTML = '<div class="shopping-categories">';

    Object.entries(groupedItems).forEach(([category, items]) => {
      listHTML += `
        <div class="shopping-category">
          <h4 class="category-header">
            <i class="fas fa-${getCategoryIcon(category)}"></i>
            ${category}
            <span class="item-count">${items.length} items</span>
          </h4>
          <div class="category-items">
      `;

      items.forEach(item => {
        listHTML += `<li class="shopping-item">
          <div class="item-details">
            <input type="checkbox" id="item-${item.name.replace(/\s+/g, '-')}" />
            <label for="item-${item.name.replace(/\s+/g, '-')}">
              <span class="item-name">${item.name}</span>
              ${item.brand ? `<span class="item-brand">${item.brand}</span>` : ''}
            </label>
          </div>
          <span class="item-quantity">${item.weeklyAmount || 'as needed'}</span>
        </li>`;
      });

      listHTML += `
          </div>
        </div>
      `;
    });

    listHTML += '</div>';

    shopList.innerHTML = listHTML;

    const totalItems = itemsWithPrices.length;
    const totalItemsEl = document.getElementById('totalItems');

    if (totalItemsEl) {
      totalItemsEl.textContent = totalItems;
    } else {
      console.log("Total items element not found");
    }

    // Add event listeners for price checking
    const priceCheckBtn = document.getElementById('priceCheckBtn');
    if (priceCheckBtn) {
      priceCheckBtn.removeEventListener('click', checkProductPrice); // Remove existing listener
      priceCheckBtn.addEventListener('click', checkProductPrice);
    }

    const priceCheckInput = document.getElementById('priceCheckInput');
    if (priceCheckInput) {
      priceCheckInput.removeEventListener('keypress', handlePriceCheckEnter); // Remove existing listener
      priceCheckInput.addEventListener('keypress', handlePriceCheckEnter);
    }

    // Add event listeners for checkboxes
    shopList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const item = this.closest('.shopping-item');
        item.classList.toggle('completed', this.checked);
      });
    });

    // Hide loading indicator
    if (shopLoadingIndicator) shopLoadingIndicator.style.display = 'none';

  } catch (error) {
    console.error("Error updating shopping list:", error);
    const shopListElement = document.getElementById('shopList');
    if (shopListElement) {
      shopListElement.innerHTML = '<div class="error-message">Failed to load shopping list. Please try again later.</div>';
    }
    if (shopLoadingIndicator) shopLoadingIndicator.style.display = 'none';
  }
}

// Helper function to get category icons
function getCategoryIcon(category) {
  const icons = {
    'Proteins': '🥩',
    'Fruits & Vegetables': '🥬',
    'Grains & Pasta': '🌾',
    'Dairy & Eggs': '🥛',
    'Nuts & Seeds': '🥜',
    'Other': '🛒'
  };
  return icons[category] || '🛒';
}

// Ensure shopping stats elements exist
function ensureShoppingStatsElements() {
  const shoppingSection = document.getElementById('shopping');
  if (!shoppingSection) return;

  // Add shopping stats container if missing
  let statsContainer = shoppingSection.querySelector('.shopping-stats');
  if (!statsContainer) {
    statsContainer = document.createElement('div');
    statsContainer.className = 'shopping-stats';
    statsContainer.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Total Items:</span>
        <span id="totalItems" class="stat-value">0</span>
      </div>
    `;

    // Insert at the beginning of shopping section
    const firstChild = shoppingSection.firstElementChild;
    if (firstChild) {
      shoppingSection.insertBefore(statsContainer, firstChild);
    } else {
      shoppingSection.appendChild(statsContainer);
    }
  }

}

// Check live product prices
async function checkProductPrice() {
  const input = document.getElementById('priceCheckInput');
  const resultsContainer = document.getElementById('priceCheckResults');

  if (!input || !resultsContainer) {
    console.warn('Price check elements not found');
    return;
  }

  const productName = input.value.trim();
  if (!productName) {
    resultsContainer.innerHTML = '<div class="error">Please enter a product name</div>';
    return;
  }

  resultsContainer.textContent = 'Prices vary by store and week.';
}

// Handle Enter key press for price check input
function handlePriceCheckEnter(e) {
  if (e.key === 'Enter') {
    checkProductPrice();
  }
}

// Profile Management
window.editProfile = function() {
  console.log("Opening enhanced profile editor");

  const modal = document.getElementById('profileModal');
  if (!modal) {
    createProfileModal();
    return;
  }

  populateProfileForm();
  modal.style.display = 'block';
};

function createProfileModal() {
  const modalHTML = `
    <div id="profileModal" class="modal profile-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Edit Your Profile</h2>
          <button class="close-modal" onclick="closeModal('profileModal')">&times;</button>
        </div>

        <form class="profile-form" onsubmit="saveProfile(event)">
          <div class="form-section">
            <h3>Personal Information</h3>
            <div class="form-group">
              <label for="userName">Name</label>
              <input type="text" id="userName" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="userHeight">Height (cm)</label>
                <input type="number" id="userHeight" min="100" max="250">
              </div>
              <div class="form-group">
                <label for="userWeight">Weight (kg)</label>
                <input type="number" id="userWeight" min="30" max="300" step="0.1">
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3>Daily Goals</h3>
            <div class="form-row">
              <div class="form-group">
                <label for="calories">Daily Calories</label>
                <input type="number" id="calories" min="800" max="5000">
              </div>
              <div class="form-group">
                <label for="steps">Daily Steps</label>
                <input type="number" id="steps" min="1000" max="50000">
              </div>
            </div>
          </div>

          <div class="form-actions">
            <button type="button" onclick="closeModal('profileModal')" class="secondary-btn">Cancel</button>
            <button type="submit" class="primary-btn">Save Profile</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  populateProfileForm();
  document.getElementById('profileModal').style.display = 'block';
}

function populateProfileForm() {
  const profile = window.userProfile;

  const fields = {
    userName: profile.name,
    userHeight: profile.height,
    userWeight: profile.weight,
    calories: profile.goals?.calories,
    steps: profile.goals?.steps
  };

  Object.entries(fields).forEach(([fieldId, value]) => {
    const element = document.getElementById(fieldId);
    if (element && value !== undefined) {
      element.value = value;
    }
  });
}

window.saveProfile = async function(event) {
  if (event) event.preventDefault();

  const formData = {
    name: document.getElementById('userName')?.value,
    height: document.getElementById('userHeight')?.value,
    weight: document.getElementById('userWeight')?.value,
    goals: {
      calories: parseInt(document.getElementById('calories')?.value) || 2000,
      steps: parseInt(document.getElementById('steps')?.value) || 10000,
      activityPlan: window.userProfile.goals?.activityPlan || {}
    }
  };

  window.userProfile = { ...window.userProfile, ...formData };
  globalThis.userProfile = window.userProfile;
  localStorage.setItem('userProfile', JSON.stringify(window.userProfile));

  if (typeof window !== 'undefined' && window.fitMunchAPI && typeof window.fitMunchAPI.saveProfile === 'function') {
    try {
      window.showLoading(true);
      const userId = getCurrentUserId();
      await window.fitMunchAPI.saveProfile(userId, window.userProfile);
      console.log('Profile saved to API successfully');
    } catch (error) {
      console.error('Failed to save profile:', error);
      window.showNotification('Failed to save profile. Please try again.', 'error');
      window.showLoading(false);
      return;
    } finally {
      window.showLoading(false);
    }
  }

  window.updateProfileDisplay();
  window.closeModal('profileModal');
  window.showNotification('Profile updated successfully!', 'success');
};

window.saveGoals = function(event) {
  window.saveProfile(event);
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
};

// Edit workout plan functionality
window.editWorkoutPlan = function() {
  console.log("Opening workout plan editor");

  const workoutSection = document.getElementById('workout');
  if (workoutSection) {
    // Check if editor already exists to avoid duplicates
    if (workoutSection.querySelector('.workout-editor')) {
      return;
    }

    const editor = document.createElement('div');
    editor.className = 'workout-editor';
    editor.innerHTML = `
      <div class="editor-header">
        <h3><i class="fas fa-edit"></i> Customize Your Workout Plan</h3>
        <button onclick="this.closest('.workout-editor').remove()" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="editor-content">
        <div class="form-group">
          <label for="workoutType">Workout Type:</label>
          <select id="workoutType">
            <option value="strength" ${window.userProfile.goals?.activityPlan?.type === 'strength' ? 'selected' : ''}>Strength Training</option>
            <option value="cardio" ${window.userProfile.goals?.activityPlan?.type === 'cardio' ? 'selected' : ''}>Cardio Focus</option>
            <option value="mixed" ${window.userProfile.goals?.activityPlan?.type === 'mixed' ? 'selected' : ''}>Mixed Training</option>
            <option value="yoga" ${window.userProfile.goals?.activityPlan?.type === 'yoga' ? 'selected' : ''}>Yoga & Flexibility</option>
          </select>
        </div>
        <div class="form-group">
          <label for="workoutFrequency">Weekly Frequency:</label>
          <select id="workoutFrequency">
            <option value="2" ${window.userProfile.goals?.activityPlan?.frequency === 2 ? 'selected' : ''}>2 days per week</option>
            <option value="3" ${window.userProfile.goals?.activityPlan?.frequency === 3 ? 'selected' : ''}>3 days per week</option>
            <option value="4" ${window.userProfile.goals?.activityPlan?.frequency === 4 ? 'selected' : ''}>4 days per week</option>
            <option value="5" ${window.userProfile.goals?.activityPlan?.frequency === 5 ? 'selected' : ''}>5 days per week</option>
          </select>
        </div>
        <div class="form-group">
          <label for="workoutLevel">Fitness Level:</label>
          <select id="workoutLevel">
            <option value="beginner" ${window.userProfile.goals?.activityPlan?.level === 'Beginner' ? 'selected' : ''}>Beginner</option>
            <option value="intermediate" ${window.userProfile.goals?.activityPlan?.level === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
            <option value="advanced" ${window.userProfile.goals?.activityPlan?.level === 'Advanced' ? 'selected' : ''}>Advanced</option>
          </select>
        </div>
        <div class="form-group">
          <label for="workoutDuration">Session Duration:</label>
          <select id="workoutDuration">
            <option value="30" ${window.userProfile.goals?.activityPlan?.duration * 60 === 30 ? 'selected' : ''}>30 minutes</option>
            <option value="45" ${window.userProfile.goals?.activityPlan?.duration * 60 === 45 ? 'selected' : ''}>45 minutes</option>
            <option value="60" ${window.userProfile.goals?.activityPlan?.duration * 60 === 60 ? 'selected' : ''}>1 hour</option>
            <option value="90" ${window.userProfile.goals?.activityPlan?.duration * 60 === 90 ? 'selected' : ''}>1.5 hours</option>
          </select>
        </div>
        <div class="editor-actions">
          <button onclick="applyWorkoutChanges()" class="primary-btn">
            <i class="fas fa-save"></i> Apply Changes
          </button>
          <button onclick="this.closest('.workout-editor').remove()" class="secondary-btn">
            Cancel
          </button>
        </div>
      </div>
    `;

    workoutSection.insertBefore(editor, workoutSection.firstChild.nextSibling);
  }
};

// Apply workout plan changes
window.applyWorkoutChanges = function() {
  const workoutType = document.getElementById('workoutType')?.value || 'mixed';
  const frequency = document.getElementById('workoutFrequency')?.value || '3';
  const level = document.getElementById('workoutLevel')?.value || 'Beginner';
  const duration = parseInt(document.getElementById('workoutDuration')?.value) / 60 || 1;

  // Update user profile with new workout preferences
  if (window.userProfile && window.userProfile.goals) {
    window.userProfile.goals.activityPlan = {
      type: workoutType,
      frequency: parseInt(frequency),
      level: level.charAt(0).toUpperCase() + level.slice(1),
      duration: duration
    };

    localStorage.setItem('userProfile', JSON.stringify(window.userProfile));
  }

  // Remove editor
  const editor = document.querySelector('.workout-editor');
  if (editor) editor.remove();

  // Regenerate workout plan with new settings
  if (typeof window.generateActivityPlan === 'function') {
    window.generateActivityPlan();
  }

  showNotification('Workout plan updated successfully!', 'success');
};

// Scan barcode functionality
window.scanBarcode = function() {
  console.log("Opening barcode scanner");

  // Create barcode scanner modal
  const modal = document.createElement('div');
  modal.className = 'modal barcode-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Barcode Scanner</h3>
        <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="barcode-scanner">
          <div class="scanner-area">
            <div class="scanner-frame">
              <div class="scanner-line"></div>
            </div>
            <p>Position barcode within the frame</p>
          </div>
          <div class="scanner-controls">
            <input type="text" id="manualBarcode" placeholder="Or enter barcode manually..." class="barcode-input">
            <button onclick="processBarcode()" class="primary-btn">
              <i class="fas fa-search"></i> Lookup Product
            </button>
          </div>
          <div id="barcodeResults" class="barcode-results"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.style.display = 'block';

  // Focus on manual input
  setTimeout(() => {
    const input = document.getElementById('manualBarcode');
    if (input) input.focus();
  }, 100);
};

// Process barcode lookup
window.processBarcode = function() {
  const barcode = document.getElementById('manualBarcode')?.value.trim();
  const resultsDiv = document.getElementById('barcodeResults');

  if (!barcode) {
    if (resultsDiv) resultsDiv.innerHTML = '<div class="error">Please enter a barcode</div>';
    return;
  }

  if (resultsDiv) resultsDiv.innerHTML = '<div class="loading">Looking up product...</div>';

  // Simulate barcode lookup
  setTimeout(() => {
    const products = getBarcodeProduct(barcode);

    if (products.length === 0) {
      if (resultsDiv) resultsDiv.innerHTML = '<div class="error">Product not found in database</div>';
      return;
    }

    let resultsHTML = '<div class="barcode-products">';
    products.forEach(product => {
      resultsHTML += `
        <div class="barcode-product">
          <div class="product-info">
            <h4>${product.name}</h4>
            <div class="product-nutrition">
              <span class="calories">${product.calories} cal</span>
              <span class="macros">P: ${product.protein}g | C: ${product.carbs}g | F: ${product.fat}g</span>
            </div>
          </div>
          <button onclick="addScannedProduct('${product.name}', ${product.calories}, ${product.protein}, ${product.carbs}, ${product.fat})" class="add-btn">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      `;
    });
    resultsHTML += '</div>';

    if (resultsDiv) resultsDiv.innerHTML = resultsHTML;
  }, 1500);
};

// Get product by barcode
function getBarcodeProduct(barcode) {
  const barcodeDatabase = {
    '1234567890123': [{ name: 'Greek Yogurt Plain', calories: 100, protein: 17, carbs: 6, fat: 0 }],
    '2345678901234': [{ name: 'Whole Wheat Bread', calories: 80, protein: 4, carbs: 15, fat: 1 }],
    '3456789012345': [{ name: 'Chicken Breast', calories: 165, protein: 31, carbs: 0, fat: 3.6 }],
    '4567890123456': [{ name: 'Bananas', calories: 105, protein: 1.3, carbs: 27, fat: 0.3 }],
    '5678901234567': [{ name: 'Almonds (28g)', calories: 164, protein: 6, carbs: 6, fat: 14 }]
  };

  return barcodeDatabase[barcode] || [];
}

// Add scanned product
window.addScannedProduct = function(name, calories, protein, carbs, fat) {
  const food = { name, calories, protein, carbs, fat };
  addFoodToLog(food, 'breakfast'); // Default to breakfast

  // Close modal
  const modal = document.querySelector('.barcode-modal');
  if (modal) modal.remove();

  showNotification(`Added ${name} to breakfast!`, 'success');
};

// Add workout log modal functionality
function openWorkoutLogModal(exerciseName) {
  const modal = document.getElementById('workoutLogModal');
  const exerciseInput = document.getElementById('exerciseName');

  if (modal && exerciseInput) {
    exerciseInput.value = exerciseName;
    modal.style.display = 'block';
  }
}

// Handle workout log form submission
function handleWorkoutLogSubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const logEntry = {
    exercise: formData.get('exerciseName'),
    sets: formData.get('setsCompleted'),
    reps: formData.get('repsCompleted'),
    weight: formData.get('weightUsed'),
    date: new Date().toISOString()
  };

  // Save workout log
  const workoutLogs = JSON.parse(localStorage.getItem('workoutLogs')) || [];
  workoutLogs.push(logEntry);
  localStorage.setItem('workoutLogs', JSON.stringify(workoutLogs));

  closeModal('workoutLogModal');

  if (window.grokNotifications) {
    window.grokNotifications.success("Workout logged successfully!", "Progress Tracked");
  }
}

// Detect mobile device and apply class
function detectMobileDevice() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

  if (isMobile) {
    document.body.classList.add('mobile-device');
    console.log("Mobile device detected, class applied");
    return true;
  } else {
    document.body.classList.remove('mobile-device');
    console.log("Desktop device detected");
    return false;
  }

  // Also check on window resize
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      document.body.classList.add('mobile-device');
    } else {
      document.body.classList.remove('mobile-device');
    }
  });
}


// Utility Functions
function updateMacroTotals() {
  const macros = calculateTotalMacros();
  const totalCalories = window.dailyLog.totalCalories || 0;

  const elements = {
    totalProtein: macros.protein,
    totalCarbs: macros.carbs,
    totalFat: macros.fat,
    totalCals: totalCalories
  };

  Object.entries(elements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

function calculateTotalMacros() {
  let protein = 0, carbs = 0, fat = 0;

  Object.values(window.dailyLog.meals).forEach(foods => {
    foods.forEach(food => {
      protein += food.protein || 0;
      carbs += food.carbs || 0;
      fat += food.fat || 0;
    });
  });

  return {
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10
  };
}

async function logCompletedWorkout(workoutName, duration = 45) {
  try {
    const userId = getCurrentUserId();
    const date = new Date().toISOString();
    const caloriesBurned = Math.round(duration * 7.5); // Estimate calories burned
    
    await fitMunchAPI.logWorkout(
      userId,
      date,
      workoutName,
      duration,
      caloriesBurned,
      []
    );
    
    console.log('Workout logged to API successfully');
    showNotification(`Workout logged! ${duration} min, ~${caloriesBurned} cal burned`, 'success');
  } catch (error) {
    console.error('Failed to log workout:', error);
    showNotification('Failed to save workout', 'error');
  }
}

function setupWorkoutInteractions() {
  document.querySelectorAll('.workout-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async function() {
      const card = this.closest('.workout-card');
      card.classList.toggle('completed', this.checked);
      
      if (this.checked) {
        const workoutName = card.querySelector('.workout-name')?.textContent || 'Workout';
        const duration = window.userProfile.goals?.activityPlan?.duration || 1;
        const durationMinutes = duration * 60;
        
        await logCompletedWorkout(workoutName, durationMinutes);
      }
    });
  });
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Show workout details 
window.showWorkoutDetails = function(index) {
  const workouts = [
    {
      day: 'Monday',
      workout: 'Upper Body Strength',
      exercises: [
        { name: 'Push-ups', sets: 3, reps: '8-12', rest: '60s', instructions: 'Keep your body straight, lower chest to floor' },
        { name: 'Dumbbell Rows', sets: 3, reps: '10-12', rest: '60s', instructions: 'Pull weight to hip, squeeze shoulder blades' },
        { name: 'Shoulder Press', sets: 3, reps: '10-12', rest: '60s', instructions: 'Press weight overhead, control the movement' },
        { name: 'Bicep Curls', sets: 2, reps: '12-15', rest: '45s', instructions: 'Curl weight to shoulder, squeeze bicep at top' }
      ]
    },
    {
      day: 'Wednesday',
      workout: 'Lower Body & Core',
      exercises: [
        { name: 'Squats', sets: 3, reps: '12-15', rest: '60s', instructions: 'Lower hips back and down, keep knees aligned' },
        { name: 'Lunges', sets: 3, reps: '10 each leg', rest: '60s', instructions: 'Step forward, lower back knee to ground' },
        { name: 'Plank', sets: 3, time: '30-45s', rest: '30s', instructions: 'Hold straight line from head to heels' },
        { name: 'Glute Bridges', sets: 3, reps: '15-20', rest: '45s', instructions: 'Lift hips up, squeeze glutes at top' }
      ]
    },
    {
      day: 'Friday',
      workout: 'Full Body Circuit',
      exercises: [
        { name: 'Burpees', sets: 3, reps: '8-10', rest: '60s', instructions: 'Drop down, jump back, push-up, jump up' },
        { name: 'Mountain Climbers', sets: 3, time: '30s', rest: '45s', instructions: 'Alternate bringing knees to chest rapidly' },
        { name: 'Jump Squats', sets: 3, reps: '12-15', rest: '45s', instructions: 'Squat down, then jump up explosively' },
        { name: 'Push-up to T', sets: 3, reps: '8-10', rest: '60s', instructions: 'Push-up, then rotate to side arm extension' }
      ]
    }
  ];

  const workout = workouts[index];
  if (!workout) {
    showNotification('Workout not found', 'error');
    return;
  }

  const modal = document.getElementById('workoutDetailsModal');
  if (modal) {
    const modalBody = modal.querySelector('.modal-body');
    modalBody.innerHTML = `
      <div class="workout-details">
        <h3>${workout.day} - ${workout.workout}</h3>
        <div class="exercises-detailed">
          ${workout.exercises.map(exercise => `
            <div class="exercise-detail">
              <h4>${exercise.name}</h4>
              <div class="exercise-specs">
                ${exercise.sets ? `<span class="spec">Sets: ${exercise.sets}</span>` : ''}
                ${exercise.reps ? `<span class="spec">Reps: ${exercise.reps}</span>` : ''}
                ${exercise.time ? `<span class="spec">Time: ${exercise.time}</span>` : ''}
                ${exercise.rest ? `<span class="spec">Rest: ${exercise.rest}</span>` : ''}
              </div>
              <p class="exercise-instructions">${exercise.instructions}</p>
              <button onclick="openWorkoutLogModal('${exercise.name}')" class="btn-start-exercise">
                <i class="fas fa-play"></i> Log This Exercise
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    modal.style.display = 'block';
  }
};

// Start workout timer
window.startWorkout = function(index) {
  const workouts = [
    { day: 'Monday', workout: 'Upper Body Strength', duration: 45 },
    { day: 'Wednesday', workout: 'Lower Body & Core', duration: 50 },
    { day: 'Friday', workout: 'Full Body Circuit', duration: 40 }
  ];

  const workout = workouts[index];
  if (!workout) return;

  // Create workout timer modal
  const modal = document.createElement('div');
  modal.className = 'modal workout-timer-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Workout Timer - ${workout.workout}</h3>
        <button class="close-modal" onclick="stopWorkoutTimer()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="workout-timer">
          <div class="timer-display">
            <div class="time-elapsed" id="timeElapsed">00:00</div>
            <div class="workout-progress">
              <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
              </div>
              <div class="time-remaining">${workout.duration} min workout</div>
            </div>
          </div>
          <div class="timer-controls">
            <button id="startPauseBtn" onclick="toggleWorkoutTimer()" class="primary-btn">
              <i class="fas fa-play"></i> Start Workout
            </button>
            <button onclick="stopWorkoutTimer()" class="secondary-btn">
              <i class="fas fa-stop"></i> End Workout
            </button>
          </div>
          <div class="workout-stats">
            <div class="stat">
              <span class="label">Estimated Calories</span>
              <span class="value" id="caloriesBurned">0</span>
            </div>
            <div class="stat">
              <span class="label">Exercises Completed</span>
              <span class="value" id="exercisesCompleted">0/4</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.style.display = 'block';

  // Initialize timer
  window.workoutTimer = {
    startTime: null,
    elapsed: 0,
    isRunning: false,
    interval: null,
    totalDuration: workout.duration * 60 // Convert to seconds
  };
};

// Toggle workout timer
window.toggleWorkoutTimer = function() {
  const timer = window.workoutTimer;
  const startPauseBtn = document.getElementById('startPauseBtn');

  if (!timer.isRunning) {
    // Start timer
    timer.startTime = Date.now() - timer.elapsed;
    timer.isRunning = true;
    timer.interval = setInterval(updateWorkoutTimer, 1000);

    if (startPauseBtn) {
      startPauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
    }
  } else {
    // Pause timer
    timer.isRunning = false;
    clearInterval(timer.interval);

    if (startPauseBtn) {
      startPauseBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
    }
  }
};

// Update workout timer display
function updateWorkoutTimer() {
  const timer = window.workoutTimer;
  timer.elapsed = Date.now() - timer.startTime;

  const seconds = Math.floor(timer.elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const displaySeconds = seconds % 60;

  const timeDisplay = document.getElementById('timeElapsed');
  if (timeDisplay) {
    timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
  }

  // Update progress bar
  const progressFill = document.getElementById('progressFill');
  if (progressFill) {
    const progress = Math.min((seconds / timer.totalDuration) * 100, 100);
    progressFill.style.width = `${progress}%`;
  }

  // Update calories burned (rough estimate)
  const caloriesBurned = document.getElementById('caloriesBurned');
  if (caloriesBurned) {
    const calories = Math.floor((seconds / 60) * 8); // ~8 calories per minute
    caloriesBurned.textContent = calories;
  }
}

// Stop workout timer
window.stopWorkoutTimer = function() {
  const timer = window.workoutTimer;
  if (timer && timer.interval) {
    clearInterval(timer.interval);
  }

  const modal = document.querySelector('.workout-timer-modal');
  if (modal) modal.remove();

  if (timer && timer.elapsed > 30000) { // If workout was longer than 30 seconds
    const minutes = Math.floor(timer.elapsed / 60000);
    const calories = Math.floor(minutes * 8);

    // Save workout to log
    const workoutEntry = {
      date: new Date().toISOString(),
      duration: minutes,
      calories: calories,
      type: 'General Workout'
    };

    let workoutHistory = JSON.parse(localStorage.getItem('workoutHistory')) || [];
    workoutHistory.push(workoutEntry);
    localStorage.setItem('workoutHistory', JSON.stringify(workoutHistory));

    showNotification(`Workout completed! ${minutes} minutes, ~${calories} calories burned`, 'success');
  }
};

// UI Enhancement Functions
function initializeUIEnhancements() {
  // Add floating action button
  addFloatingActionButton();

  // Enhance stat cards
  enhanceStatCards();

  // Add progress rings
  addProgressRings();

  // Initialize animations
  initializeAnimations();

  // Add interactive elements
  addInteractiveElements();
}

function addFloatingActionButton() {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fas fa-plus"></i>';
  fab.title = 'Quick Add';
  fab.addEventListener('click', () => {
    showSection('food');
    setTimeout(() => showFoodSearch(), 300);
  });
  document.body.appendChild(fab);
}

function enhanceStatCards() {
  const statCards = document.querySelectorAll('.stat-card');
  statCards.forEach((card, index) => {
    card.classList.add('interactive-card', 'animate-fade-scale');
    card.style.animationDelay = `${index * 0.1}s`;

    // Add enhanced icon container
    const icon = card.querySelector('i');
    if (icon) {
      icon.parentElement.classList.add('stat-icon-enhanced');
    }
  });
}

function addProgressRings() {
  const wellnessScore = document.querySelector('.score-circle');
  if (wellnessScore) {
    const score = parseInt(wellnessScore.querySelector('.score')?.textContent) || 85;
    const progressDegree = (score / 100) * 360;

    wellnessScore.style.setProperty('--progress', `${progressDegree}deg`);
    wellnessScore.classList.add('progress-ring-circle');

    const content = wellnessScore.querySelector('.score');
    if (content) {
      content.parentElement.classList.add('progress-ring-content');
      content.classList.add('progress-ring-value');
    }
  }
}

function initializeAnimations() {
  // Add intersection observer for scroll animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-slide-up');
      }
    });
  }, { threshold: 0.1 });

  // Observe all sections
  document.querySelectorAll('.section').forEach(section => {
    observer.observe(section);
  });
}

function addInteractiveElements() {
  // Add hover effects to navigation cards
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    card.classList.add('interactive-card');
  });

  // Add gradient effects to primary buttons
  const primaryBtns = document.querySelectorAll('.primary-btn');
  primaryBtns.forEach(btn => {
    btn.classList.add('btn-gradient');
  });
}


// Initialize the app
function initializeApp() {
  console.log("🚀 FitMunch App Initializing...");
  const startTime = performance.now();

  // Migrate old user IDs to UUID format (must be first)
  migrateOldUserId();

  // Hide fallback and show main app
  try {
    const fallback = document.getElementById('emergencyFallback');
    const mainApp = document.getElementById('mainApp');

    if (fallback) {
      fallback.style.display = 'none';
      console.log("✅ Fallback hidden");
    }
    if (mainApp) {
      mainApp.style.display = 'block';
      console.log("✅ Main app shown");
    }

    console.log("✅ App containers switched successfully");
  } catch (error) {
    console.error("❌ Error switching containers:", error);
  }

  // Apply UI enhancements
  initializeUIEnhancements();

  // Setup navigation
  setupNavigation();

  // Initialize profile display
  updateProfileDisplay();

  // Initialize features
  initializeFeatures();

  // Detect mobile device
  detectMobileDevice();

  // Initialize analytics if on fitness section
  setTimeout(() => {
    if (document.getElementById('fitness')?.classList.contains('active-section')) {
      updateAnalytics();
    }
  }, 500);

  // Initialize workout log form
  const workoutLogForm = document.getElementById('workoutLogForm');
  if (workoutLogForm) {
    workoutLogForm.addEventListener('submit', handleWorkoutLogSubmit);
  }

  // Ensure dashboard is visible after initialization
  setTimeout(() => {
    if (typeof window.showSection === 'function') {
      window.showSection('dashboard');
      console.log("✅ Dashboard section activated");
    }
  }, 100);

  console.log(`⚡ FitMunch App Ready! (${(performance.now() - startTime).toFixed(1)}ms)`);

}

// Call initApp after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log("🔄 DOM Content Loaded - Starting FitMunch");
  try {
    // Small delay to ensure all elements are rendered
    setTimeout(() => {
      initializeApp();
    }, 50);
  } catch (error) {
    console.error("❌ Error in initializeApp:", error);
    // Show fallback if there's an error
    const fallback = document.getElementById('emergencyFallback');
    const mainApp = document.getElementById('mainApp');
    if (fallback) fallback.style.display = 'block';
    if (mainApp) mainApp.style.display = 'none';
  }
});

// Also run if DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  console.log("🔄 DOM already loaded - Starting FitMunch immediately");
  setTimeout(() => {
    try {
      initializeApp();
    } catch (error) {
      console.error("❌ Error in immediate initializeApp:", error);
    }
  }, 10);
}


function showEmergencyFallback() {
  const fallback = document.getElementById('emergencyFallback');
  const mainApp = document.getElementById('mainApp');

  if (fallback) fallback.style.display = 'block';
  if (mainApp) mainApp.style.display = 'none';
}

function initializeFeatures() {
  // Initialize enhanced features
  if (typeof enhancedFeatures !== 'undefined') {
    const container = document.getElementById('enhanced-features-container');
    if (container) {
      container.appendChild(enhancedFeatures.createFeatureShowcase());
    }
  }

  // Initialize theme
  if (typeof ThemeManager !== 'undefined') {
    ThemeManager.init();
  }

  // Initialize analytics
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.initialize();
  }
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');
      if (section) showSection(section);
    });
  });

  // Setup navigation cards
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    card.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (section) showSection(section);
    });
  });
}

// Update analytics function
window.updateAnalytics = function() {
  console.log("Updating analytics data");

  const timeframe = document.getElementById('analyticsTimeframe')?.value || 'week';

  // Update progress chart
  updateProgressChart(timeframe);

  // Update nutrition chart
  updateNutritionChart();

  // Update stats
  const stats = calculateAnalyticsStats(timeframe);

  const avgCaloriesEl = document.getElementById('avgCalories');
  const totalWorkoutsEl = document.getElementById('totalWorkouts');
  const currentStreakEl = document.getElementById('currentStreak');

  if (avgCaloriesEl) avgCaloriesEl.textContent = stats.avgCalories;
  if (totalWorkoutsEl) totalWorkoutsEl.textContent = stats.totalWorkouts;
  if (currentStreakEl) currentStreakEl.textContent = stats.currentStreak;

  showNotification('Analytics updated successfully!', 'success');
};

// Calculate analytics stats
function calculateAnalyticsStats(timeframe) {
  // In a real app, this would calculate from actual user data
  const stats = {
    week: { avgCalories: '1,847', totalWorkouts: '4', currentStreak: '7 days' },
    month: { avgCalories: '1,923', totalWorkouts: '16', currentStreak: '12 days' },
    quarter: { avgCalories: '1,891', totalWorkouts: '48', currentStreak: '18 days' }
  };

  return stats[timeframe] || stats.week;
}

// Update progress chart
function updateProgressChart(timeframe) {
  const canvas = document.getElementById('progressChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Sample data based on timeframe
  const data = {
    week: [1800, 1900, 1750, 2100, 1850, 1950, 1890],
    month: Array.from({length: 30}, () => Math.floor(Math.random() * 500) + 1600),
    quarter: Array.from({length: 90}, () => Math.floor(Math.random() * 600) + 1500)
  };

  const chartData = data[timeframe] || data.week;
  const maxValue = Math.max(...chartData);
  const minValue = Math.min(...chartData);
  const range = maxValue - minValue || 1;

  // Draw chart
  ctx.strokeStyle = '#004225';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const stepX = canvas.width / (chartData.length - 1);

  chartData.forEach((value, index) => {
    const x = index * stepX;
    const y = canvas.height - ((value - minValue) / range) * (canvas.height - 40) - 20;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  // Add points
  ctx.fillStyle = '#00b8a6';
  chartData.forEach((value, index) => {
    const x = index * stepX;
    const y = canvas.height - ((value - minValue) / range) * (canvas.height - 40) - 20;

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fill();
  });
}

// Update nutrition chart
function updateNutritionChart() {
  const canvas = document.getElementById('nutritionChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 20;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const data = [
    { label: 'Protein', value: 25, color: '#004225' },
    { label: 'Carbs', value: 45, color: '#00b8a6' },
    { label: 'Fat', value: 30, color: '#ffd700' }
  ];

  let currentAngle = -Math.PI / 2;

  data.forEach(segment => {
    const sliceAngle = (segment.value / 100) * 2 * Math.PI;

    ctx.fillStyle = segment.color;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    ctx.fill();

    currentAngle += sliceAngle;
  });
}

// Add missing functions
window.upgradeToPremium = function() {
  showNotification('Premium upgrade feature activated!', 'success');
  // Could integrate with payment system here
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Upgrade to Premium</h3>
        <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p>Premium features include:</p>
        <ul>
          <li>Advanced analytics</li>
          <li>Custom meal plans</li>
          <li>AI-powered recommendations</li>
          <li>Priority support</li>
        </ul>
        <div style="margin-top: 2rem;">
          <button class="primary-btn" onclick="this.closest('.modal').remove(); showNotification('Premium activated!', 'success');">
            Activate Premium
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.style.display = 'block';
};

// Fix theme toggle functionality
window.toggleTheme = function() {
  const body = document.body;
  const isDark = body.classList.contains('dark-theme');

  if (isDark) {
    body.classList.remove('dark-theme');
    localStorage.setItem('theme', 'light');
    window.showNotification('Switched to light theme', 'info');
  } else {
    body.classList.add('dark-theme');
    localStorage.setItem('theme', 'dark');
    window.showNotification('Switched to dark theme', 'info');
  }
};

// Add missing addItemToShoppingList function
window.addItemToShoppingList = function() {
  const itemName = prompt('Enter item name:');
  if (itemName) {
    const shoppingList = parseStoredJSON('shoppingList', []);
    shoppingList.push({
      name: itemName,
      quantity: '1',
      category: 'Other'
    });
    localStorage.setItem('shoppingList', JSON.stringify(shoppingList));
    updateShoppingList();
    window.showNotification(`Added ${itemName} to shopping list!`, 'success');
  }
};

console.log("🎯 FitMunch Enhanced Script Loaded - All Functions Available");

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    showSection: window.showSection,
    updateProfileDisplay: window.updateProfileDisplay,
    saveGoals: window.saveGoals,
    generateMealPlan: window.generateMealPlan,
    updateShoppingList,
    generateActivityPlan: window.generateActivityPlan,
  };
}