// FitMunch App Fixes
// This file consolidates all fixes needed for the FitMunch app

// Function to apply all fixes to the app
function applyAppFixes() {
  console.log("Applying app fixes...");
  fixNavigationButtons();
  fixWorkoutDisplay();
}

// Fix navigation functionality - uses the dedicated navigation_fix.js when available
function fixNavigationButtons() {
  console.log("Applying navigation button fixes");
  
  // Use the dedicated navigation fix if available
  if (typeof window.fixNavigation === 'function') {
    window.fixNavigation();
    return;
  }
  
  // Fallback fix if navigation_fix.js isn't loaded
  console.log("Fallback navigation fix being applied");
  
  // Fix navigation items
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    // Remove any existing event listeners by cloning
    const newItem = item.cloneNode(true);
    if (item.parentNode) {
      item.parentNode.replaceChild(newItem, item);
    }
    
    // Add new event listener
    newItem.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log('Navigation clicked for section:', section);
        window.showSection(section);
      } else {
        console.error('showSection function not available or section not specified');
      }
    });
  });
  
  // Also fix dashboard cards that act as navigation
  const navCards = document.querySelectorAll('.nav-card, .promo-card');
  navCards.forEach(card => {
    // Remove existing listeners by cloning
    const newCard = card.cloneNode(true);
    if (card.parentNode) {
      card.parentNode.replaceChild(newCard, card);
    }
    
    // Add new listener
    newCard.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section') || this.getAttribute('data-page');
      if (section && typeof window.showSection === 'function') {
        console.log('Card navigation clicked for section:', section);
        window.showSection(section);
      }
    });
  });
  
  console.log("Navigation buttons fixed");
}

// Fix workout display
function fixWorkoutDisplay() {
  console.log("Fixing workout plan display");
  
  // Make sure workout display exists
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (!workoutPlanDisplay) return;
  
  // Regenerate activity plan if needed
  if (typeof window.generateActivityPlan === 'function') {
    window.generateActivityPlan();
  }
  
  // Make sure workout card buttons work
  const workoutButtons = document.querySelectorAll('.workout-details-btn, .workout-complete-btn, .exercise-log-btn');
  workoutButtons.forEach(button => {
    // Remove old listeners by cloning
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    // Add click event listener based on button type
    if (newButton.classList.contains('exercise-log-btn')) {
      newButton.addEventListener('click', function(e) {
        e.stopPropagation();
        const exerciseName = this.getAttribute('data-exercise') || 
                           this.closest('.exercise-row').querySelector('.exercise-name').textContent;
        
        if (exerciseName) {
          console.log("Log button clicked for exercise:", exerciseName);
          if (typeof window.showWorkoutLog === 'function') {
            window.showWorkoutLog(exerciseName);
          } else {
            console.log("Workout log function not available, implementing backup function");
            // Backup implementation if the main function isn't available
            const modal = document.getElementById('workoutLogModal');
            if (modal) {
              const exerciseNameElement = document.getElementById('logExerciseName');
              if (exerciseNameElement) {
                exerciseNameElement.textContent = exerciseName;
              }
              modal.style.display = 'block';
            } else {
              console.error("Workout log modal not found");
            }
          }
        }
      });
    }
  });
  
  console.log("Workout display fixed successfully");
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded, initializing app fixes");
  
  // Apply app fixes immediately after DOM load
  if (typeof applyAppFixes === 'function') {
    setTimeout(applyAppFixes, 100);
  }
  
  // Add event listener for content updates
  window.addEventListener('contentUpdated', function() {
    console.log("Content updated, reapplying fixes");
    if (typeof applyAppFixes === 'function') {
      applyAppFixes();
    }
  });
});

// Make functions available globally
window.applyAppFixes = applyAppFixes;
window.fixNavigationButtons = fixNavigationButtons;
window.fixWorkoutDisplay = fixWorkoutDisplay;

        if (exerciseName) {
          if (typeof window.showWorkoutLog === 'function') {
            window.showWorkoutLog(exerciseName);
          } else {
            console.log("Workout log function not available, implementing backup function");
            // Backup implementation if the main function isn't available
            const modal = document.getElementById('workoutLogModal');
            if (modal) {
              const exerciseNameElement = document.getElementById('logExerciseName');
              if (exerciseNameElement) {
                exerciseNameElement.textContent = exerciseName;
              }
              modal.style.display = 'block';
            } else {
              console.error("Workout log modal not found");
            }
          }
        }
      });
    }
  });
  
  console.log("Workout display fixed successfully");
}

// Ensure the showWorkoutLog function is always available
if (typeof window.showWorkoutLog !== 'function') {
  window.showWorkoutLog = function(exerciseName) {
    console.log("Logging workout for:", exerciseName);
    
    // Get the modal element
    const modal = document.getElementById('workoutLogModal');
    if (!modal) {
      console.error("Workout log modal not found");
      return;
    }
    
    // Set exercise name in modal
    const exerciseNameElement = document.getElementById('logExerciseName');
    if (exerciseNameElement) {
      exerciseNameElement.textContent = exerciseName;
    }
    
    // Show appropriate metrics based on exercise type
    const isCardio = exerciseName.toLowerCase().includes('run') || 
                     exerciseName.toLowerCase().includes('cardio') || 
                     exerciseName.toLowerCase().includes('cycling');
    
    const isYoga = exerciseName.toLowerCase().includes('yoga') || 
                   exerciseName.toLowerCase().includes('stretch') || 
                   exerciseName.toLowerCase().includes('meditation');
    
    // Show/hide appropriate metric sections
    const gymMetrics = document.getElementById('gymMetrics');
    const runMetrics = document.getElementById('runMetrics');
    const yogaMetrics = document.getElementById('yogaMetrics');
    
    if (gymMetrics) gymMetrics.style.display = (!isCardio && !isYoga) ? 'block' : 'none';
    if (runMetrics) runMetrics.style.display = isCardio ? 'block' : 'none';
    if (yogaMetrics) yogaMetrics.style.display = isYoga ? 'block' : 'none';
    
    // Show the modal
    modal.style.display = 'block';
    
    // Track the workout in history
    let workoutLog = JSON.parse(localStorage.getItem('workoutLog') || '{}');
    if (!workoutLog[exerciseName]) {
      workoutLog[exerciseName] = [];
    }
    workoutLog[exerciseName].unshift({
      timestamp: new Date().toISOString(),
      viewed: true
    });
    localStorage.setItem('workoutLog', JSON.stringify(workoutLog));
    
    // Load exercise history if that function exists
    if (typeof window.loadExerciseHistory === 'function') {
      window.loadExerciseHistory(exerciseName);
    }
  };
  
  // Also ensure closeWorkoutLog function is available
  if (typeof window.closeWorkoutLog !== 'function') {
    window.closeWorkoutLog = function() {
      const modal = document.getElementById('workoutLogModal');
      if (modal) {
        modal.style.display = 'none';
      }
    };
  }
  
  // And ensure saveWorkoutLog function is available
  if (typeof window.saveWorkoutLog !== 'function') {
    window.saveWorkoutLog = function() {
      const exerciseName = document.getElementById('logExerciseName')?.textContent;
      if (!exerciseName) return;
      
      // Get form values
      const notes = document.getElementById('workoutNotes')?.value || '';
      const weight = document.getElementById('weight')?.value || '';
      const reps = document.getElementById('reps')?.value || '';
      const sets = document.getElementById('sets')?.value || '';
      const duration = document.getElementById('duration')?.value || document.getElementById('yogaDuration')?.value || '';
      const distance = document.getElementById('distance')?.value || '';
      const pace = document.getElementById('pace')?.value || '';
      const difficulty = document.getElementById('difficulty')?.value || '';
      
      // Create workout data object
      const workoutData = {
        timestamp: new Date().toISOString(),
        notes: notes,
        completed: true
      };
      
      // Add metrics based on which fields have values
      if (weight) workoutData.weight = weight;
      if (reps) workoutData.reps = reps;
      if (sets) workoutData.sets = sets;
      if (duration) workoutData.duration = duration;
      if (distance) workoutData.distance = distance;
      if (pace) workoutData.pace = pace;
      if (difficulty) workoutData.difficulty = difficulty;
      
      // Save to localStorage
      let workoutLog = JSON.parse(localStorage.getItem('workoutLog') || '{}');
      if (!workoutLog[exerciseName]) {
        workoutLog[exerciseName] = [];
      }
      workoutLog[exerciseName].unshift(workoutData);
      localStorage.setItem('workoutLog', JSON.stringify(workoutLog));
      
      // Mark exercise as completed in UI
      const exerciseRows = document.querySelectorAll('.exercise-row');
      exerciseRows.forEach(row => {
        if (row.querySelector('.exercise-name')?.textContent.trim() === exerciseName) {
          row.classList.add('exercise-completed');
          
          // Add completion indicator if it doesn't exist
          if (!row.querySelector('.completion-indicator')) {
            const indicator = document.createElement('div');
            indicator.className = 'completion-indicator';
            indicator.innerHTML = '<i class="fas fa-check-circle"></i>';
            row.querySelector('.exercise-name').appendChild(indicator);
          }
          
          // Update log button text
          const logBtn = row.querySelector('.exercise-log-btn');
          if (logBtn) {
            logBtn.textContent = 'Update';
          }
        }
      });
      
      // Close modal
      window.closeWorkoutLog();
      
      // Show confirmation
      alert(`Great job! You've logged ${exerciseName}`);
    };
  }
}

// Fix app initialization
document.addEventListener('DOMContentLoaded', function() {

  // Fix dashboard cards navigation
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    // Remove any existing event listeners by cloning
    const newCard = card.cloneNode(true);
    if (card.parentNode) {
      card.parentNode.replaceChild(newCard, card);
    }
    
    // Add new event listener
    newCard.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log('Nav card clicked for section:', section);
        window.showSection(section);
      }
    });
  });

  // Fix promo cards navigation
  const promoCards = document.querySelectorAll('.promo-card');
  promoCards.forEach(card => {
    // Remove any existing event listeners by cloning
    const newCard = card.cloneNode(true);
    if (card.parentNode) {
      card.parentNode.replaceChild(newCard, card);
    }
    
    // Add new event listener
    newCard.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log('Promo card clicked for section:', section);
        window.showSection(section);
      }
    });
  });

  // Initialize premium features showcase
  initPremiumFeatures();

  // Initialize subscription UI
  if (typeof initSubscriptionUI === 'function') {
    initSubscriptionUI();
  }

  // Initialize workout analytics
  if (typeof WorkoutAnalytics === 'object' && WorkoutAnalytics.initialize) {
    WorkoutAnalytics.initialize();
  }

  // Setup banner button to open subscription section
  const bannerBtn = document.querySelector('.banner-btn');
  if (bannerBtn) {
    bannerBtn.addEventListener('click', function() {
      showSection('subscription');
    });
  }
  
  // Setup analytics navigation
  const analyticsNav = document.querySelector('[data-section="analytics"]');
  if (analyticsNav) {
    analyticsNav.addEventListener('click', function() {
      window.location.href = 'workout_analytics.html';
    });
  }

  // Fix mobile responsiveness issues
  const isMobile = window.innerWidth < 768;
  if (isMobile) {
    document.body.classList.add('mobile-view');
  }

  // Update user name
  updateUserName();

  // Set current date
  setCurrentDate();

  // Fix chart issue
  fixMacroChart();

  // Enhance aesthetics
  enhanceAppAesthetics();
});

// Fix section display function
function showSection(sectionId) {
  // Track section view in analytics
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.trackPageView(sectionId);
  }

  // Update SEO metadata
  if (typeof SEOOptimizationService !== 'undefined') {
    SEOOptimizationService.updateMetadata(sectionId);
  }

  // Hide all sections
  const sections = document.querySelectorAll('.section, #dashboard');
  sections.forEach(section => {
    section.classList.remove('active-section');
  });

  // Show selected section
  const selectedSection = document.getElementById(sectionId);
  if (selectedSection) {
    selectedSection.classList.add('active-section');
  }

  // Update active navigation item
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-section') === sectionId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Scroll to top
  window.scrollTo(0, 0);
}

// Fix user name display
function updateUserName() {
  const userName = localStorage.getItem('userName') || 'User';
  const userNameElements = document.querySelectorAll('#userName');
  userNameElements.forEach(el => {
    el.textContent = userName;
  });
}

// Fix date display
function setCurrentDate() {
  const currentDateElement = document.getElementById('currentDate');
  if (currentDateElement) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = new Date().toLocaleDateString('en-US', options);
    currentDateElement.textContent = formattedDate;
  }
}

// Fix chart display
function fixMacroChart() {
  const chartCanvas = document.getElementById('macroChart');
  if (chartCanvas && typeof Chart !== 'undefined') {
    // Destroy existing chart if it exists
    const existingChart = Chart.getChart(chartCanvas);
    if (existingChart) {
      existingChart.destroy();
    }

    // Create new chart
    new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{
          data: [30, 50, 20],
          backgroundColor: ['#4361ee', '#3a0ca3', '#f72585'],
          borderWidth: 0
        }]
      },
      options: {
        cutout: '70%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 20,
              font: {
                size: 12,
                family: 'Montserrat'
              }
            }
          }
        }
      }
    });
  }
}

// Initialize premium features
function initPremiumFeatures() {
  if (typeof PremiumFeaturesManager !== 'undefined' && document.getElementById('premium-features-container')) {
    try {
      // Set user subscription tier from subscription manager or default to 'free'
      let userTier = 'free';
      if (typeof subscriptionManager !== 'undefined' && subscriptionManager.currentPlan) {
        userTier = subscriptionManager.currentPlan;
      }

      // Render premium features showcase
      PremiumFeaturesManager.renderFeaturesShowcase('premium-features-container', userTier);
      console.log("Premium features initialized");
    } catch (error) {
      console.error("Error initializing premium features:", error);
    }
  }
}

// Enhance app aesthetics
function enhanceAppAesthetics() {
  // Update color scheme for better visual consistency
  const root = document.documentElement;

  // Set modern color palette
  root.style.setProperty('--primary-color', '#4361ee');
  root.style.setProperty('--primary-dark', '#3a49ca');
  root.style.setProperty('--accent-color', '#f72585');
  root.style.setProperty('--accent-dark', '#d61a6f');
  root.style.setProperty('--text-color', '#2b2d42');
  root.style.setProperty('--secondary-color', '#3a0ca3');
  root.style.setProperty('--background-color', '#f8f9fa');
  root.style.setProperty('--card-gradient', 'linear-gradient(135deg, #4361ee, #3a0ca3)');
  root.style.setProperty('--sidebar-width', '250px');

  // Add subtle animation to cards
  const cards = document.querySelectorAll('.stat-card, .promo-card, .nav-card, .meal-time, .workout-card');
  cards.forEach(card => {
    card.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
  });

  // Enhance premium feature visual indicators
  const premiumElements = document.querySelectorAll('.premium-feature, .upgrade-prompt');
  premiumElements.forEach(element => {
    element.style.boxShadow = '0 5px 15px rgba(247, 37, 133, 0.15)';
    element.style.border = '1px solid rgba(247, 37, 133, 0.2)';
  });

  // Improve button styles
  const buttons = document.querySelectorAll('.primary-btn, .banner-btn, .subscribe-btn');
  buttons.forEach(button => {
    button.style.boxShadow = '0 4px 10px rgba(67, 97, 238, 0.3)';
    button.style.fontWeight = '600';
  });

  // Add premium badge to locked features
  const lockedFeatures = document.querySelectorAll('.locked-badge');
  lockedFeatures.forEach(badge => {
    badge.style.background = 'linear-gradient(135deg, #f72585, #b5179e)';
    badge.style.color = 'white';
    badge.style.padding = '5px 10px';
    badge.style.borderRadius = '20px';
    badge.style.fontWeight = 'bold';
    badge.style.fontSize = '12px';
    badge.style.boxShadow = '0 2px 5px rgba(247, 37, 133, 0.3)';
  });
}

// Fix profile modal
function editProfile() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.style.display = 'block';
  }
}

function closeModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Fix goals saving
function saveGoals() {
  // Get form values
  const height = document.getElementById('userHeight').value;
  const weight = document.getElementById('userWeight').value;
  const goals = document.getElementById('userGoals').value;
  const calories = document.getElementById('calories').value;
  const steps = document.getElementById('steps').value;
  const activityType = document.getElementById('activityType').value;
  const frequency = document.getElementById('frequency').value;
  const activityLevel = document.getElementById('activityLevel').value;
  const duration = document.getElementById('duration').value;
  const preferredTime = document.getElementById('preferredTime').value;

  // Save to localStorage
  if (height) localStorage.setItem('userHeight', height);
  if (weight) localStorage.setItem('userWeight', weight);
  if (goals) localStorage.setItem('userGoals', goals);
  if (calories) localStorage.setItem('calorieTarget', calories);
  if (steps) localStorage.setItem('stepsTarget', steps);
  if (activityType) localStorage.setItem('activityType', activityType);
  if (frequency) localStorage.setItem('frequency', frequency);
  if (activityLevel) localStorage.setItem('activityLevel', activityLevel);
  if (duration) localStorage.setItem('duration', duration);
  if (preferredTime) localStorage.setItem('preferredTime', preferredTime);

  // Update display
  updateUserName();
  const userHeightDisplay = document.getElementById('userHeight');
  if (userHeightDisplay) userHeightDisplay.textContent = height || '--';

  const userWeightDisplay = document.getElementById('userWeight');
  if (userWeightDisplay) userWeightDisplay.textContent = weight || '--';

  // Track in analytics
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.trackEvent('goals_updated', {
      height,
      weight,
      goals,
      calories,
      steps,
      activityType,
      frequency,
      activityLevel,
      duration,
      preferredTime
    });
  }

  // Close modal
  closeModal();

  // Show success notification
  showNotification('Profile and goals updated successfully');
}

// Notification system
function showNotification(message, type = 'success') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  // Show notification
  setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Fix workout log functions
function openWorkoutLog(exerciseName, exerciseDetails) {
  const modal = document.getElementById('workoutLogModal');
  const exerciseNameElement = document.getElementById('logExerciseName');

  if (modal && exerciseNameElement) {
    exerciseNameElement.textContent = exerciseName;
    modal.style.display = 'block';

    // Show appropriate metrics based on exercise type
    const isCardio = exerciseName.toLowerCase().includes('run') || 
                     exerciseName.toLowerCase().includes('cardio') || 
                     exerciseName.toLowerCase().includes('cycling');

    const isYoga = exerciseName.toLowerCase().includes('yoga') || 
                   exerciseName.toLowerCase().includes('stretch') || 
                   exerciseName.toLowerCase().includes('meditation');

    document.getElementById('gymMetrics').style.display = (!isCardio && !isYoga) ? 'block' : 'none';
    document.getElementById('runMetrics').style.display = isCardio ? 'block' : 'none';
    document.getElementById('yogaMetrics').style.display = isYoga ? 'block' : 'none';

    // Populate with previous data if available
    if (exerciseDetails) {
      if (document.getElementById('weight')) document.getElementById('weight').value = exerciseDetails.weight || '';
      if (document.getElementById('reps')) document.getElementById('reps').value = exerciseDetails.reps || '';
      if (document.getElementById('sets')) document.getElementById('sets').value = exerciseDetails.sets || '';
      if (document.getElementById('duration')) document.getElementById('duration').value = exerciseDetails.duration || '';
      if (document.getElementById('distance')) document.getElementById('distance').value = exerciseDetails.distance || '';
      if (document.getElementById('pace')) document.getElementById('pace').value = exerciseDetails.pace || '';
      if (document.getElementById('difficulty')) document.getElementById('difficulty').value = exerciseDetails.difficulty || '';
    }

    // Load exercise history if available
    loadExerciseHistory(exerciseName);
  }
}

function closeWorkoutLog() {
  const modal = document.getElementById('workoutLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function loadExerciseHistory(exerciseName) {
  const historyContainer = document.getElementById('exercise-history');
  if (!historyContainer) return;

  // Clear history container
  historyContainer.innerHTML = '<h4>Previous Logs</h4>';

  // Get exercise history if ExerciseTracker is available
  if (typeof ExerciseTracker !== 'undefined') {
    const history = ExerciseTracker.getExerciseHistory(exerciseName);
    
    if (history && history.length > 0) {
      // Sort by timestamp (newest first)
      history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Display last 3 entries
      const lastEntries = history.slice(0, 3);
      
      lastEntries.forEach(entry => {
        const entryDate = new Date(entry.timestamp).toLocaleDateString();
        
        let metricsHTML = '';
        if (entry.weight) metricsHTML += `<span>Weight: ${entry.weight}kg</span>`;
        if (entry.reps) metricsHTML += `<span>Reps: ${entry.reps}</span>`;
        if (entry.sets) metricsHTML += `<span>Sets: ${entry.sets}</span>`;
        if (entry.duration) metricsHTML += `<span>Duration: ${entry.duration} min</span>`;
        if (entry.distance) metricsHTML += `<span>Distance: ${entry.distance} km</span>`;
        
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
          <div class="history-date">${entryDate}</div>
          <div class="history-metrics">${metricsHTML}</div>
          ${entry.notes ? `<div class="history-notes">${entry.notes}</div>` : ''}
        `;
        
        historyContainer.appendChild(historyItem);
      });
    } else {
      historyContainer.innerHTML += '<div class="no-history">No previous logs found</div>';
    }
  } else {
    historyContainer.innerHTML += '<div class="no-history">Exercise history tracker not available</div>';
  }
}

function saveWorkoutLog() {
  const exerciseName = document.getElementById('logExerciseName').textContent;
  const notes = document.getElementById('workoutNotes').value;
  
  // Collect metrics based on visible sections
  const exerciseData = {
    name: exerciseName,
    notes: notes,
    timestamp: new Date().toISOString(),
    completed: true
  };
  
  // Get values from visible metrics sections
  if (document.getElementById('gymMetrics').style.display !== 'none') {
    exerciseData.weight = document.getElementById('weight').value;
    exerciseData.reps = document.getElementById('reps').value;
    exerciseData.sets = document.getElementById('sets').value;
  }
  
  if (document.getElementById('runMetrics').style.display !== 'none') {
    exerciseData.duration = document.getElementById('duration').value;
    exerciseData.distance = document.getElementById('distance').value;
    exerciseData.pace = document.getElementById('pace').value;
  }
  
  if (document.getElementById('yogaMetrics').style.display !== 'none') {
    exerciseData.duration = document.getElementById('yogaDuration').value;
    exerciseData.difficulty = document.getElementById('difficulty').value;
  }

  // Log exercise in ExerciseTracker if available
  if (typeof ExerciseTracker !== 'undefined') {
    ExerciseTracker.logExercise(exerciseData);
  }
  
  // Track workout completion in analytics
  if (typeof AnalyticsService !== 'undefined') {
    AnalyticsService.trackEvent('workout_logged', {
      exercise: exerciseName,
      weight: exerciseData.weight,
      reps: exerciseData.reps,
      sets: exerciseData.sets,
      notes: notes
    });
  }

  // Update the UI to mark exercise as completed
  const exerciseElements = document.querySelectorAll('.exercise-row');
  exerciseElements.forEach(el => {
    if (el.querySelector('.exercise-name')?.textContent === exerciseName) {
      el.classList.add('exercise-completed');
      
      // Add completion indicator if it doesn't exist
      if (!el.querySelector('.completion-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'completion-indicator';
        indicator.innerHTML = '<i class="fas fa-check-circle"></i>';
        el.appendChild(indicator);
      }
    }
  });

  closeWorkoutLog();
  showNotification(`Great job! You've logged ${exerciseName}`);
}

// Fix for food logging
function showFoodSearch() {
  const searchResults = document.getElementById('searchResults');
  if (searchResults) {
    searchResults.innerHTML = '<div class="loading-indicator">Searching for foods...</div>';

    // Simulate search results
    setTimeout(() => {
      searchResults.innerHTML = `
        <div class="food-result">
          <div class="food-result-image">
            <img src="https://images.unsplash.com/photo-1529694157872-4e0c0f3b238b?w=150&q=80" alt="Chicken Breast">
          </div>
          <div class="food-result-details">
            <h3 class="food-result-name">Grilled Chicken Breast</h3>
            <div class="food-result-macros">165 calories | 31g protein | 0g carbs | 3.6g fat</div>
          </div>
          <button class="add-food-btn" onclick="addFood('Grilled Chicken Breast', 165, 31, 0, 3.6)">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="food-result">
          <div class="food-result-image">
            <img src="https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=150&q=80" alt="Sweet Potato">
          </div>
          <div class="food-result-details">
            <h3 class="food-result-name">Baked Sweet Potato</h3>
            <div class="food-result-macros">103 calories | 2g protein | 24g carbs | 0g fat</div>
          </div>
          <button class="add-food-btn" onclick="addFood('Baked Sweet Potato', 103, 2, 24, 0)">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="food-result premium-item">
          <div class="food-result-image">
            <img src="https://images.unsplash.com/photo-1546793665-c74683f339c1?w=150&q=80" alt="Quinoa Salad">
          </div>
          <div class="food-result-details">
            <h3 class="food-result-name">Quinoa Vegetable Salad</h3>
            <div class="food-result-macros">220 calories | 8g protein | 40g carbs | 4g fat</div>
            <span class="premium-badge"><i class="fas fa-crown"></i> Premium Recipe</span>
          </div>
          <button class="add-food-btn" onclick="addFoodPremium('Quinoa Vegetable Salad')">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      `;
    }, 1000);
  }
}

function addFood(name, calories, protein, carbs, fat) {
  const meal = document.getElementById('mealSelect').value;
  const mealLog = document.getElementById(`${meal}Log`);

  if (mealLog) {
    const foodEntry = document.createElement('li');
    foodEntry.innerHTML = `
      <div class="food-entry-details">
        <div class="food-name">${name}</div>
        <div class="food-calories">${calories} calories</div>
        <div class="food-macros">
          <span>P: ${protein}g</span>
          <span>C: ${carbs}g</span>
          <span>F: ${fat}g</span>
        </div>
      </div>
      <button class="remove-food" onclick="this.parentNode.remove()"><i class="fas fa-times"></i></button>
    `;
    mealLog.appendChild(foodEntry);

    // Clear search results
    document.getElementById('searchResults').innerHTML = '';

    // Show success notification
    showNotification(`Added ${name} to ${meal}`);

    // Update macros
    updateMacroTotals();
  }
}

function addFoodPremium(name) {
  // Check if user has premium access
  if (typeof checkFeatureAccess === 'function' && checkFeatureAccess('premiumRecipes')) {
    addFood(name, 220, 8, 40, 4);
  } else {
    showSection('subscription');
  }
}

function updateMacroTotals() {
  // This would calculate totals from all meals
  // For now just update with some values
  document.getElementById('totalCals').textContent = '1250';
  document.getElementById('totalProtein').textContent = '95';
  document.getElementById('totalCarbs').textContent = '120';
  document.getElementById('totalFat').textContent = '45';

  // Update chart
  fixMacroChart();
}

// Fix scanning function
function scanBarcode() {
  // In a real implementation, this would access the camera
  // For demo, just show a modal or notification
  showNotification('Premium Feature: Barcode scanning requires subscription', 'warning');

  // Redirect to subscription page after a delay
  setTimeout(() => {
    showSection('subscription');
  }, 2000);
}

// Fix meal plan generation
function generateMealPlan() {
  const goalType = document.getElementById('goalType').value;
  const mealDisplay = document.getElementById('mealDisplay');

  if (mealDisplay) {
    mealDisplay.innerHTML = '<div class="loading-indicator">Generating your personalized meal plan...</div>';

    // Simulate API call delay
    setTimeout(() => {
      // Check if premium feature should be shown
      const hasPremiumAccess = typeof checkFeatureAccess === 'function' && 
                              checkFeatureAccess('mealPlanner');

      if (hasPremiumAccess) {
        // Show full meal plan for premium users
        mealDisplay.innerHTML = `
          <h3>Your ${goalType} Meal Plan</h3>
          <p>Personalized nutrition plan based on your profile and preferences.</p>

          <div class="meal-plan-details">
            <div class="meal-time">
              <h4>Breakfast</h4>
              <ul>
                <li>Greek yogurt with berries and honey</li>
                <li>Whole grain toast with avocado</li>
                <li>Coffee or green tea</li>
              </ul>
              <div class="meal-macros">P: 25g | C: 45g | F: 15g</div>
            </div>

            <div class="meal-time">
              <h4>Lunch</h4>
              <ul>
                <li>Grilled chicken salad with mixed greens</li>
                <li>Quinoa with roasted vegetables</li>
                <li>Olive oil and lemon dressing</li>
              </ul>
              <div class="meal-macros">P: 35g | C: 30g | F: 12g</div>
            </div>

            <div class="meal-time">
              <h4>Dinner</h4>
              <ul>
                <li>Baked salmon with herbs</li>
                <li>Sweet potato mash</li>
                <li>Steamed broccoli and carrots</li>
              </ul>
              <div class="meal-macros">P: 32g | C: 35g | F: 18g</div>
            </div>

            <div class="meal-time">
              <h4>Snacks</h4>
              <ul>
                <li>Apple with almond butter</li>
                <li>Protein smoothie</li>
                <li>Mixed nuts (handful)</li>
              </ul>
              <div class="meal-macros">P: 18g | C: 25g | F: 15g</div>
            </div>
          </div>
        `;

        // Update nutritional info
        document.getElementById('mealCalories').textContent = '2,100';
        document.getElementById('mealProtein').textContent = '110g';
        document.getElementById('mealCarbs').textContent = '135g';
        document.getElementById('mealFat').textContent = '60g';

        // Update cost analysis
        document.getElementById('dailyCost').textContent = '$16.45';
        document.getElementById('weeklyCost').textContent = '$115.15';
      } else {
        // Show limited meal plan for free users with upgrade prompt
        mealDisplay.innerHTML = `
          <h3>Your ${goalType} Meal Plan Preview</h3>
          <p>Here's a sample of what your nutrition plan could look like.</p>

          <div class="meal-plan-details">
            <div class="meal-time">
              <h4>Breakfast</h4>
              <ul>
                <li>Greek yogurt with berries and honey</li>
                <li>Whole grain toast with avocado</li>
              </ul>
              <div class="meal-macros">P: 25g | C: 45g | F: 15g</div>
            </div>

            <div class="meal-time blurred-content">
              <h4>Lunch</h4>
              <div class="premium-overlay">
                <i class="fas fa-lock"></i>
                <h3>Premium Feature</h3>
                <p>Unlock full meal plans with Premium</p>
                <button class="primary-btn" onclick="showSection('subscription')">Upgrade Now</button>
              </div>
            </div>
          </div>

          <div class="upgrade-prompt">
            <h3><i class="fas fa-crown"></i> Unlock Full Meal Plans</h3>
            <p>Get access to complete, personalized meal plans with exact portions, grocery lists, and meal prep instructions.</p>
            <button class="primary-btn" onclick="showSection('subscription')">Upgrade to Premium</button>
          </div>
        `;

        // Update limited nutritional info
        document.getElementById('mealCalories').textContent = 'Upgrade for details';
        document.getElementById('mealProtein').textContent = 'Upgrade for details';
        document.getElementById('mealCarbs').textContent = 'Upgrade for details';
        document.getElementById('mealFat').textContent = 'Upgrade for details';
      }
    }, 1500);
  }
}

// Add CSS for premium feature overlays
const style = document.createElement('style');
style.textContent = `
  .blurred-content {
    position: relative;
    filter: blur(5px);
    pointer-events: none;
  }

  .premium-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(67, 97, 238, 0.85);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    padding: 20px;
    text-align: center;
    border-radius: 8px;
    z-index: 10;
    pointer-events: all;
  }

  .premium-overlay i {
    font-size: 32px;
    margin-bottom: 10px;
    color: gold;
  }

  .premium-overlay h3 {
    margin: 0 0 10px 0;
    font-size: 18px;
  }

  .premium-overlay p {
    margin: 0 0 15px 0;
    font-size: 14px;
    opacity: 0.9;
  }

  .premium-badge {
    display: inline-block;
    background: linear-gradient(135deg, #f72585, #b5179e);
    color: white;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 12px;
    margin-top: 5px;
  }

  .premium-badge i {
    color: gold;
    margin-right: 3px;
  }

  .premium-item {
    position: relative;
    border-left: 3px solid #f72585;
  }

  .upgrade-prompt {
    background: linear-gradient(135deg, rgba(67, 97, 238, 0.1), rgba(247, 37, 133, 0.1));
    border-radius: 12px;
    padding: 25px;
    text-align: center;
    margin-top: 30px;
    box-shadow: 0 5px 15px rgba(67, 97, 238, 0.15);
  }

  .upgrade-prompt h3 {
    color: #4361ee;
    margin-top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .upgrade-prompt h3 i {
    color: gold;
  }

  .upgrade-prompt p {
    margin-bottom: 20px;
    color: #555;
  }

  .notification {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 15px 25px;
    background: #4361ee;
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    transform: translateY(100px);
    opacity: 0;
    transition: transform 0.3s ease, opacity 0.3s ease;
  }

  .notification.show {
    transform: translateY(0);
    opacity: 1;
  }

  .notification.success {
    background: #4361ee;
  }

  .notification.error {
    background: #e63946;
  }

  .notification.warning {
    background: #fb8500;
  }
`;

document.head.appendChild(style);


// Define missing functions to avoid errors
// Implement workoutLog functionality to track workout weights
function logWorkout(exercise, weight, reps, sets, notes, duration, distance, pace, difficulty) {
  // Make sure workout log exists in localStorage
  const workoutLog = JSON.parse(localStorage.getItem('workoutLog') || '{}');
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  if (!workoutLog[today]) {
    workoutLog[today] = [];
  }

  // Add the workout with all possible metrics
  workoutLog[today].push({
    exercise,
    weight: weight || '',
    reps: reps || '',
    sets: sets || '',
    duration: duration || '',
    distance: distance || '',
    pace: pace || '',
    difficulty: difficulty || '',
    notes,
    completed: true,
    timestamp: new Date().toISOString()
  });

  // Save back to localStorage
  localStorage.setItem('workoutLog', JSON.stringify(workoutLog));

  console.log("Workout logged successfully:", exercise, weight);

  // If ProgressTracker exists, log the workout there too
  if (window.ProgressTracker && typeof window.ProgressTracker.logWorkout === 'function') {
    window.ProgressTracker.logWorkout({
      type: exercise,
      weight: weight,
      reps: reps,
      sets: sets,
      duration: duration
    });
  }

  return true;
}

// Handle workout log form submission
function saveWorkoutLog() {
  const exerciseName = document.getElementById('logExerciseName')?.textContent;
  const weight = document.getElementById('weight')?.value;
  const reps = document.getElementById('reps')?.value;
  const sets = document.getElementById('sets')?.value;
  const notes = document.getElementById('workoutNotes')?.value;

  // Get additional metrics based on workout type
  const duration = document.getElementById('duration')?.value || document.getElementById('yogaDuration')?.value;
  const distance = document.getElementById('distance')?.value;
  const pace = document.getElementById('pace')?.value;
  const difficulty = document.getElementById('difficulty')?.value;

  if (exerciseName) {
    // Log with all possible metrics
    logWorkout(exerciseName, weight, reps, sets, notes, duration, distance, pace, difficulty);

    // Close modal if function exists
    if (typeof closeWorkoutLog === 'function') {
      closeWorkoutLog();
    } else {
      // Fallback if closeWorkoutLog doesn't exist
      const modal = document.getElementById('workoutLogModal');
      if (modal) modal.style.display = 'none';
    }

    // Show success notification
    showNotification('Workout logged successfully!');

    // Update workout card to show it's completed
    const workoutCard = document.querySelector(`.workout-card:has(button[data-day="${exerciseName}"])`);
    if (workoutCard) {
      workoutCard.classList.add('workout-completed');
    }
  }
}

// Show workout log modal
function showWorkoutLog(exercise) {
  const modal = document.getElementById('workoutLogModal');
  if (modal) {
    document.getElementById('logExerciseName').textContent = exercise;
    modal.style.display = 'block';
  }
}

// Close workout log modal
function closeWorkoutLog() {
  const modal = document.getElementById('workoutLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Show notification
function showNotification(message, type = 'success') {
  // Create notification element if it doesn't exist
  let notification = document.getElementById('notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'notification';
    document.body.appendChild(notification);
  }

  // Set notification style based on type
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.display = 'block';

  // Hide notification after 3 seconds
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

// Initialize food log
function initFoodLog() {
  console.log("Initializing food log");
  // Populate food log from localStorage if available
  try {
    const storedFoodLog = localStorage.getItem('dailyLog');
    if (storedFoodLog && typeof updateFoodLogDisplay === 'function') {
      updateFoodLogDisplay();
    }
  } catch (error) {
    console.error("Error initializing food log:", error);
  }
}

// Initialize charts
function initCharts() {
  console.log("Initializing charts");
  try {
    if (typeof Chart !== 'undefined') {
      const macroChart = document.getElementById('macroChart');
      if (macroChart && typeof updateMacroChart === 'function') {
        // Initialize with default values
        updateMacroChart(0, 0, 0);
      }
    }
  } catch (error) {
    console.error("Error initializing charts:", error);
  }
}

// Add mobile support
function addMobileSupport() {
  console.log("Adding mobile support");
  try {
    // Check if user is on a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      document.body.classList.add('mobile-view');
      // Adjust sidebar for mobile
      document.documentElement.style.setProperty('--sidebar-width', '0px');
    }
  } catch (error) {
    console.error("Error adding mobile support:", error);
  }
}

// Initialize food search if it's not working
function initFoodSearch() {
  // Add event listener to "Add Food" button
  const addFoodBtn = document.querySelector('button.primary-btn:not([id])');
  if (addFoodBtn && addFoodBtn.textContent.includes('Add Food')) {
    addFoodBtn.addEventListener('click', showFoodSearch);
  }
}

// Initialize weight logging
function initWeightLogging() {
  // Add event listeners to workout log buttons
  document.querySelectorAll('.workout-details-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const exerciseName = this.closest('.workout-card')?.querySelector('.workout-title')?.textContent || 'Exercise';
      showWorkoutLog(exerciseName);
    });
  });
}

function applyAppFixesEnhanced() {
  console.log("Applying enhanced mobile support...");

  if (typeof addMobileSupport === 'function') {
    addMobileSupport();
  }

  if (typeof initFoodSearch === 'function') {
    initFoodSearch();
  }

  if (typeof initWeightLogging === 'function') {
    initWeightLogging();
  }

  // Make all buttons work by adding a delegated click handler
  document.addEventListener('click', function(e) {
    // For navigation items
    if (e.target.closest('.nav-item') && !e.target.closest('a.nav-item')) {
      const navItem = e.target.closest('.nav-item');
      const section = navItem.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log("Navigation delegated click for section:", section);
        window.showSection(section);
      }
    }

    // For nav cards
    if (e.target.closest('.nav-card')) {
      const navCard = e.target.closest('.nav-card');
      const section = navCard.getAttribute('data-page') || navCard.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log("Nav card delegated click for section:", section);
        window.showSection(section);
      }
    }

    // For promo cards
    if (e.target.closest('.promo-card')) {
      const promoCard = e.target.closest('.promo-card');
      const section = promoCard.getAttribute('data-page') || promoCard.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log("Promo card delegated click for section:", section);
        window.showSection(section);
      }
    }

    // For workout completion checkboxes
    if (e.target.matches('.workout-completed-checkbox')) {
      if (typeof fixWorkoutCheckboxes === 'function') {
        fixWorkoutCheckboxes();
      }
    }

    // For exercise log buttons
    if (e.target.closest('.log-exercise-btn')) {
      const exerciseName = e.target.closest('.workout-card')?.querySelector('.workout-title')?.textContent || 'Exercise';
      if (typeof showWorkoutLog === 'function') {
        showWorkoutLog(exerciseName);
      }
    }
  });
}

// Call enhanced fixes when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Apply enhanced fixes immediately
  applyAppFixesEnhanced();
  
  // Also apply standard fixes
  if (typeof applyAppFixes === 'function') {
    applyAppFixes();
  }
  
  // Force fix navigation explicitly
  fixNavigation();
  
  console.log("All navigation fixes applied on DOM load");
});

// Also apply fix immediately in case DOMContentLoaded already fired
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(function() {
    applyAppFixesEnhanced();
    
    if (typeof applyAppFixes === 'function') {
      applyAppFixes();
    }
    
    fixNavigation();
    
    console.log("Navigation fixes applied immediately");
  }, 0);
}
function initFoodLog() {
  console.log("Initializing food log");
  // Populate food log from localStorage if available
  try {
    const storedFoodLog = localStorage.getItem('dailyLog');
    if (storedFoodLog && typeof updateFoodLogDisplay === 'function') {
      updateFoodLogDisplay();
    }
  } catch (error) {
    console.error("Error initializing food log:", error);
  }
}

function initCharts() {
  console.log("Initializing charts");
  try {
    if (typeof Chart !== 'undefined') {
      const macroChart = document.getElementById('macroChart');
      if (macroChart && typeof updateMacroChart === 'function') {
        // Initialize with default values
        updateMacroChart(0, 0, 0);
      }
    }
  } catch (error) {
    console.error("Error initializing charts:", error);
  }
}

function addMobileSupport() {
  console.log("Adding mobile support");
  try {
    // Check if user is on a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      document.body.classList.add('mobile-view');
      // Adjust sidebar for mobile
      document.documentElement.style.setProperty('--sidebar-width', '0px');
    }
  } catch (error) {
    console.error("Error adding mobile support:", error);
  }
}

// Export the function
window.applyAppFixes = applyAppFixes;

// Run fixes immediately when script is loaded
document.addEventListener('DOMContentLoaded', function() {
  applyAppFixes();
  
  // Double-check that navigation works after all scripts have loaded
  setTimeout(function() {
    if (typeof window.fixNavigation === 'function') {
      window.fixNavigation();
    }
    
    // Ensure showSection exists no matter what
    if (typeof window.showSection !== 'function') {
      console.warn("showSection still missing after all scripts loaded, adding emergency implementation");
      window.showSection = function(sectionId) {
        console.log("Emergency showSection called for:", sectionId);
        
        // Hide all sections
        document.querySelectorAll('section, #dashboard').forEach(section => {
          section.style.display = 'none';
        });
        
        // Show requested section
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
          targetSection.style.display = 'block';
        }
      };
    }
    
    // Test the nav buttons directly
    console.log("Setting up one-time direct click handlers for navigation safety");
    document.querySelectorAll('.nav-item').forEach(function(navItem) {
      navItem.onclick = function(e) {
        const section = this.getAttribute('data-section');
        if (section) {
          console.log("Direct navigation handler for:", section);
          e.preventDefault();
          
          if (typeof window.showSection === 'function') {
            window.showSection(section);
          } else {
            // Last resort fallback if showSection is still undefined
            document.querySelectorAll('section, #dashboard').forEach(s => {
              s.style.display = 'none';
            });
            
            const targetSection = document.getElementById(section);
            if (targetSection) {
              targetSection.style.display = 'block';
            }
          }
        }
      };
    });
  }, 500);
});


// Load subscription modules
if (typeof module !== 'undefined' && module.exports) {
  try {
    // Import handling is already managed elsewhere
    // We'll skip re-declaring these functions to avoid conflicts
    console.log("Module exports detected");
    console.log("Module exports detected");
  } catch (error) {
    console.error("Error loading subscription modules:", error);
  }
}

// Ensure global variables exist
if (!window.userProfile) {
  window.userProfile = JSON.parse(localStorage.getItem('userProfile')) || {
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
}

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

// Track workout history (create if doesn't exist)
if (!window.workoutHistory) {
  const savedHistory = localStorage.getItem('workoutHistory');
  window.workoutHistory = savedHistory ? JSON.parse(savedHistory) : {};
}

// Core navigation function
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
  } else {
    console.warn(`Section with ID '${sectionId}' not found`);
  }

  // Update active nav item
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-section') === sectionId) {
      item.classList.add('active');
    }
  });

  // Initialize section content if needed
  if (sectionId === 'meal') {
    window.generateMealPlan();
  } else if (sectionId === 'workout') {
    window.generateActivityPlan();
  } else if (sectionId === 'shopping') {
    window.updateShoppingList();
  }
};

// Profile display function
window.updateProfileDisplay = function() {
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
    profileStats.innerHTML = `Height: <span id="userHeightDisplay">${userProfile.height || '175'}cm</span> | Weight: <span id="userWeightDisplay">${userProfile.weight || '70'}kg</span>`;
  }

  // Update height and weight display in the header section
  const heightDisplay = document.querySelector('.profile-header .profile-info Height');
  const weightDisplay = document.querySelector('.profile-header .profile-info Weight');

  // Fix the placeholders in the profile header
  const headerHeight = document.querySelector('span[id="userHeight"]');
  const headerWeight = document.querySelector('span[id="userWeight"]');

  if (headerHeight) headerHeight.textContent = userProfile.height || '175';
  if (headerWeight) headerWeight.textContent = userProfile.weight || '70';

  // Update wellness score color based on score value
  const scoreCircle = document.querySelector('.score-circle');
  const scoreElement = document.querySelector('.score-circle .score');
  if (scoreCircle && scoreElement) {
    const score = parseInt(scoreElement.textContent) || 0;
    const scorePercentage = score + '%';

    // Calculate color based on score (red -> yellow -> green)
    let scoreColor;
    if (score < 50) {
      // Red (0-49)
      scoreColor = `rgb(230, ${score * 2 + 57}, 57)`;
    } else if (score < 75) {
      // Yellow to Green-Yellow (50-74)
      const greenIntensity = 50 + ((score - 50) * 3);
      scoreColor = `rgb(${255 - ((score - 50) * 5)}, ${200 + greenIntensity}, 60)`;
    } else {
      // Green (75-100)
      scoreColor = `rgb(${100 - (score - 75)}, ${200 + (score - 75)}, 100)`;
    }

    scoreCircle.style.setProperty('--score-color', scoreColor);
    scoreCircle.style.setProperty('--score-percentage', scorePercentage);
  }

  // Update goal displays
  if (calorieDisplay) calorieDisplay.textContent = userProfile.goals?.calories || 2000;
  if (stepsDisplay) stepsDisplay.textContent = userProfile.goals?.steps || 10000;
  if (macroDisplay) macroDisplay.textContent = 'P: 0g | C: 0g | F: 0g';

  // Update progress bars
  const calorieProgress = document.getElementById('calorieProgress');
  const stepsProgress = document.getElementById('stepsProgress');
  const activityProgress = document.getElementById('activityProgress');

  if (calorieProgress) {
    calorieProgress.textContent = `${dailyLog?.totalCalories || 0}/${userProfile.goals?.calories || 2000}`;
  }

  if (stepsProgress) {
    stepsProgress.textContent = `${dailyLog?.totalSteps || 0}/${userProfile.goals?.steps || 10000}`;
  }

  if (activityProgress) {
    activityProgress.textContent = userProfile.goals?.activityPlan?.type || '--';
  }
};

// Generate meal plan
window.generateMealPlan = function() {
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
};

// Calculate macros
window.calculateMacros = function(foods) {
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
};

// Update shopping list based on meal plan
function updateShoppingList(plan) {
  console.log("Updating shopping list");
  // Only proceed if shopping section exists
  const shoppingSection = document.getElementById('shopping');
  if (!shoppingSection) return;

  // Show loading state
  const shopList = document.getElementById('shopList');
  if (shopList) {
    shopList.innerHTML = '<div class="loading-indicator"><span>Loading shopping list items</span></div>';
  }

  // Update total cost and items count displays
  const totalCostElement = document.getElementById('totalCost');
  const totalItemsElement = document.getElementById('totalItems');

  // Sample shopping items (in a real app, this would be derived from the meal plan)
  const shoppingItems = [
    { name: "Chicken Breast", quantity: "1 kg", price: 12.50, category: "Proteins", nutrition: { protein: 31, carbs: 0, fat: 3.6 } },
    { name: "Eggs (Free Range)", quantity: "12 count", price: 6.50, category: "Dairy & Eggs", nutrition: { protein: 13, carbs: 0.7, fat: 11 } },
    { name: "Greek Yogurt", quantity: "750 g", price: 5.50, category: "Dairy & Eggs", nutrition: { protein: 10, carbs: 3.6, fat: 0.4 } },
    { name: "Atlantic Salmon", quantity: "500 g", price: 15.00, category: "Proteins", nutrition: { protein: 25, carbs: 0, fat: 13 } },
    { name: "Brown Rice", quantity: "1 kg", price: 4.50, category: "Grains & Pasta", nutrition: { protein: 2.6, carbs: 23, fat: 0.9 } },
    { name: "Sweet Potato", quantity: "1 kg", price: 4.00, category: "Fruits & Vegetables", nutrition: { protein: 1.6, carbs: 20, fat: 0.1 } },
    { name: "Broccoli", quantity: "500 g", price: 3.50, category: "Fruits & Vegetables", nutrition: { protein: 2.8, carbs: 7, fat: 0.4 } },
    { name: "Spinach (Organic)", quantity: "250 g", price: 3.00, category: "Fruits & Vegetables", nutrition: { protein: 2.9, carbs: 3.6, fat: 0.4 } },
    { name: "Bananas", quantity: "1 kg", price: 4.90, category: "Fruits & Vegetables", nutrition: { protein: 1.1, carbs: 23, fat: 0.3 } },
    { name: "Mixed Berries", quantity: "250 g", price: 6.00, category: "Fruits & Vegetables", nutrition: { protein: 0.7, carbs: 14, fat: 0.3 } },
    { name: "Almonds (Raw)", quantity: "250 g", price: 6.50, category: "Nuts & Seeds", nutrition: { protein: 21, carbs: 22, fat: 49 } },
    { name: "Rolled Oats", quantity: "750 g", price: 5.00, category: "Grains & Pasta", nutrition: { protein: 13, carbs: 68, fat: 7 } },
    { name: "Whole Grain Bread", quantity: "1 loaf", price: 4.20, category: "Grains & Pasta", nutrition: { protein: 12, carbs: 41, fat: 3 } },
    { name: "Extra Virgin Olive Oil", quantity: "500 ml", price: 8.00, category: "Other", nutrition: { protein: 0, carbs: 0, fat: 100 } },
    { name: "Whey Protein Powder", quantity: "500 g", price: 29.99, category: "Other", nutrition: { protein: 80, carbs: 7, fat: 3 } }
  ];

  // Calculate totals
  let totalCost = 0;
  let totalItems = shoppingItems.length;
  let totalNutrition = { protein: 0, carbs: 0, fat: 0 };

  shoppingItems.forEach(item => {
    totalCost += item.price;
    // Add nutrition totals
    if (item.nutrition) {
      totalNutrition.protein += item.nutrition.protein;
      totalNutrition.carbs += item.nutrition.carbs;
      totalNutrition.fat += item.nutrition.fat;
    }
  });

  // Update totals display
  if (totalCostElement) totalCostElement.textContent = `$${totalCost.toFixed(2)}`;
  if (totalItemsElement) totalItemsElement.textContent = totalItems;

  // Update nutrition totals
  const proteinElement = document.getElementById('totalProteinWeek');
  const carbsElement = document.getElementById('totalCarbsWeek');
  const fatElement = document.getElementById('totalFatWeek');
  const caloriesElement = document.getElementById('totalCaloriesWeek');

  if (proteinElement) proteinElement.textContent = `${Math.round(totalNutrition.protein)}g`;
  if (carbsElement) carbsElement.textContent = `${Math.round(totalNutrition.carbs)}g`;
  if (fatElement) fatElement.textContent = `${Math.round(totalNutrition.fat)}g`;

  // Calculate calories (4 cal per g protein, 4 cal per g carbs, 9 cal per g fat)
  const calories = totalNutrition.protein * 4 + totalNutrition.carbs * 4 + totalNutrition.fat * 9;
  if (caloriesElement) caloriesElement.textContent = Math.round(calories);

  // Display shopping list
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
        listHTML += `<h3 class="shop-category">${category}</h3>`;

        items.forEach(item => {
          const nutritionInfo = item.nutrition ?
            `<div class="item-macros">P: ${item.nutrition.protein}g | C: ${item.nutrition.carbs}g | F: ${item.nutrition.fat}g</div>` : '';

          listHTML += `
            <li class="shop-item">
              <div class="item-details">
                <span class="item-name">${item.name}</span>
                ${nutritionInfo}
              </div>
              <div class="item-quantity">${item.quantity}</div>
              <div class="item-cost">$${item.price.toFixed(2)}</div>
            </li>
          `;
        });
      }
    }

    shopList.innerHTML = listHTML;

    // Add event listeners for item selection
    const shopItems = shopList.querySelectorAll('.shop-item');
    shopItems.forEach(item => {
      item.addEventListener('click', function() {
        this.classList.toggle('selected');
        if (this.classList.contains('selected')) {
          this.style.backgroundColor = '#e8f5e9';
        } else {
          this.style.backgroundColor = '';
        }
      });
    });
  }
}

// Generate workout plan
window.generateActivityPlan = function() {
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

  // Generate basic workout plans
  let workouts = [
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
      exercises: [
        { name: 'Warm-up Jog', time: '5 min', notes: 'Easy pace to elevate heart rate' },
        { name: 'Interval Running', sets: 5, work: '30s', rest: '30s', notes: 'Higher intensity effort' },
        { name: 'Stationary Bike', time: '15 min', notes: 'Moderate resistance' },
        { name: 'Jump Rope', time: '5 min', notes: 'Focus on consistency' },
        { name: 'Cool-down Walk', time: '5 min', notes: 'Gradually reduce heart rate' }
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

  // Load completed exercises from ExerciseTracker
  let completedExercises = {};
  if (typeof ExerciseTracker !== 'undefined') {
    const exerciseData = ExerciseTracker.getAllExerciseData();
    Object.keys(exerciseData).forEach(name => {
      if (exerciseData[name].length > 0) {
        completedExercises[name] = exerciseData[name];
      }
    });
  }

  // Display workout plan
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (workoutPlanDisplay) {
    let planHTML = `
      <div class="plan-header">
        <h3>${activityPlan.level} ${activityPlan.type.charAt(0).toUpperCase() + activityPlan.type.slice(1)} Program</h3>
        <p>Weekly Frequency: ${workouts.length} days | Duration: ${activityPlan.duration} hour${activityPlan.duration > 1 ? 's' : ''}/session | Preferred Time: ${activityPlan.preferredTime}</p>
      </div>
      <div class="workouts-container">
    `;

    workouts.forEach(workout => {
      // Calculate how many exercises are completed in this workout
      let completedCount = 0;
      if (workout.exercises) {
        workout.exercises.forEach(exercise => {
          if (completedExercises[exercise.name]) {
            completedCount++;
          }
        });
      }

      // Calculate completion percentage
      const totalExercises = workout.exercises ? workout.exercises.length : 0;
      const completionPercentage = totalExercises > 0 ? Math.round((completedCount / totalExercises) * 100) : 0;
      
      // Determine if workout is fully completed
      const isWorkoutCompleted = totalExercises > 0 && completedCount === totalExercises;

      planHTML += `
        <div class="workout-card ${isWorkoutCompleted ? 'workout-completed' : ''}">
          <div class="workout-day">${workout.day}</div>
          <div class="workout-title">${workout.workout}</div>
          <div class="workout-meta">
            <span class="workout-time"><i class="fas fa-clock"></i> ${workout.duration} hr${workout.duration !== 1 ? 's' : ''}</span>
            <span class="workout-intensity"><i class="fas fa-fire"></i> ${workout.intensity || 'Moderate'}</span>
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
                <div class="exercise-log">Log</div>
              </div>
              ${workout.exercises.map(exercise => {
                const isCompleted = !!completedExercises[exercise.name];
                const lastLog = isCompleted ? completedExercises[exercise.name][0] : null;
                
                return `
                <div class="exercise-row ${isCompleted ? 'exercise-completed' : ''}">
                  <div class="exercise-name">
                    ${exercise.name}
                    ${isCompleted ? '<div class="completion-indicator"><i class="fas fa-check-circle"></i></div>' : ''}
                  </div>
                  <div class="exercise-sets">${exercise.sets || '-'}</div>
                  <div class="exercise-reps">${exercise.reps || exercise.time || '-'}</div>
                  <div class="exercise-rest">${exercise.rest || '-'}</div>
                  <div class="exercise-log">
                    <button class="exercise-log-btn" data-exercise="${exercise.name}" onclick="openWorkoutLog('${exercise.name}')">
                      ${isCompleted ? 'Update' : 'Log'}
                    </button>
                  </div>
                </div>
                ${exercise.notes ? `<div class="exercise-notes"><i class="fas fa-info-circle"></i> ${exercise.notes}</div>` : ''}
                `;
              }).join('')}
            </div>
          </div>
          ` : ''}
          
          ${workout.exercises && workout.exercises.length > 0 ? `
          <div class="workout-completion-summary">
            <div class="completion-progress">
              <div>Progress: ${completedCount}/${totalExercises} exercises completed (${completionPercentage}%)</div>
            </div>
          </div>
          ` : ''}
          
          <button class="workout-complete-btn ${isWorkoutCompleted ? 'completed' : ''}" ${isWorkoutCompleted ? 'disabled' : ''}>
            ${isWorkoutCompleted ? 'Workout Completed' : 'Mark All as Complete'}
          </button>
        </div>
      `;
    });

    planHTML += '</div>';
    workoutPlanDisplay.innerHTML = planHTML;

    // Add event listeners to complete buttons
    const completeButtons = workoutPlanDisplay.querySelectorAll('.workout-complete-btn:not([disabled])');
    completeButtons.forEach(button => {
      button.addEventListener('click', function() {
        const workoutCard = this.closest('.workout-card');
        const workoutDay = workoutCard.querySelector('.workout-day').textContent;
        const workoutName = workoutCard.querySelector('.workout-title').textContent;
        
        // Find all uncompleted exercises in this workout
        const uncompletedExercises = workoutCard.querySelectorAll('.exercise-row:not(.exercise-completed)');
        
        if (uncompletedExercises.length > 0) {
          // Ask for confirmation to log all exercises
          if (confirm(`Log all ${uncompletedExercises.length} remaining exercises in this workout?`)) {
            // Log each exercise with basic info
            uncompletedExercises.forEach(exercise => {
              const exerciseName = exercise.querySelector('.exercise-name').textContent.trim();
              const exerciseData = {
                name: exerciseName,
                completed: true,
                timestamp: new Date().toISOString(),
                notes: `Quick logged as part of ${workoutName}`
              };
              
              if (typeof ExerciseTracker !== 'undefined') {
                ExerciseTracker.logExercise(exerciseData);
              }
              
              // Add completion styling
              exercise.classList.add('exercise-completed');
              if (!exercise.querySelector('.completion-indicator')) {
                const indicator = document.createElement('div');
                indicator.className = 'completion-indicator';
                indicator.innerHTML = '<i class="fas fa-check-circle"></i>';
                exercise.querySelector('.exercise-name').appendChild(indicator);
              }
              
              // Update log button text
              const logBtn = exercise.querySelector('.exercise-log-btn');
              if (logBtn) {
                logBtn.textContent = 'Update';
              }
            });
            
            // Update workout card
            workoutCard.classList.add('workout-completed');
            this.classList.add('completed');
            this.disabled = true;
            this.textContent = 'Workout Completed';
            
            // Update completion summary
            const completionSummary = workoutCard.querySelector('.workout-completion-summary');
            if (completionSummary) {
              completionSummary.innerHTML = `
                <div class="completion-progress">
                  <div>Progress: ${workout.exercises.length}/${workout.exercises.length} exercises completed (100%)</div>
                </div>
              `;
            }
            
            // Log workout in workout history
            window.workoutHistory[workoutDay] = {
              workout: workoutName,
              completed: true,
              date: new Date().toLocaleDateString()
            };
            
            localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));
            showNotification(`Workout "${workoutName}" on ${workoutDay} completed successfully!`);
          }
        }
      });
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
              <div class="workout-intensity-indicator" data-intensity="moderate">
                Moderate
              </div>
            </div>
          ` : '<div class="day-rest">Rest & Recovery</div>'}
          ${window.workoutHistory[day] && window.workoutHistory[day].completed ? '<span class="completed">Completed</span>' : ''}
        </div>
      `;
    });

    scheduleHTML += '</div>';
    weeklyScheduleDisplay.innerHTML = scheduleHTML;
  }
};

// Enhanced mobile support function
function enhanceMobileSupport() {
  console.log("Applying enhanced mobile support...");

  // Check if we're on a mobile device
  const isMobile = window.innerWidth <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
    // Add mobile-specific class to body
    document.body.classList.add('mobile-view');

    // Fix navigation item active states
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('touchend', (e) => {
        // Prevent default to avoid double-firing
        e.preventDefault();

        // Get section to show
        const section = item.getAttribute('data-section');
        if (section) {
          // Remove active class from all items
          navItems.forEach(navItem => navItem.classList.remove('active'));

          // Add active class to clicked item
          item.classList.add('active');

          // Show section
          showSection(section);
        }
      }, { passive: false });
    });

    // Optimize modals
    const modals = document.querySelectorAll('.modal, .workout-log-modal');
    modals.forEach(modal => {
      modal.addEventListener('touchmove', (e) => {
        e.stopPropagation();
      }, { passive: true });
    });

    // Make lists and tables scrollable
    const scrollables = document.querySelectorAll('.exercise-table, .meal-plan-details, .shopping-list-container');
    scrollables.forEach(element => {
      element.style.webkitOverflowScrolling = 'touch';
    });

    // Add tap state visual feedback
    const tappableElements = document.querySelectorAll('button, .nav-item, .shop-item, .food-entry');
    tappableElements.forEach(element => {
      element.addEventListener('touchstart', () => {
        element.classList.add('touch-active');
      }, { passive: true });

      element.addEventListener('touchend', () => {
        setTimeout(() => {
          element.classList.remove('touch-active');
        }, 150);
      }, { passive: true });
    });

    // Apply iOS specific fixes
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      // Fix iOS rendering issues with position fixed

      document.body.style.webkitTouchCallout = 'none';

      // Fix input zoom on iOS
      const metaViewport = document.querySelector('meta[name="viewport"]');
      if (metaViewport) {
        metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0');
      }
    }

    console.log("Mobile optimizations applied");
  }
}

// Main app fixes function that will be called from other scripts
function applyAppFixes() {
  console.log("Applying app fixes...");

  // Apply all fixes directly to ensure they're running
  fixNavigation();
  enhanceMobileSupport();
  initFoodLog();
  fixWorkoutDisplay();

  // Fix navigation buttons explicitly
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    // Clean up any existing event listeners
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    
    // Add new event listener
    newItem.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log("Navigation clicked for section:", section);
        window.showSection(section);
      }
    });
  });

  console.log("App fixes applied successfully");
}

// Call all fixes when document is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded, applying all fixes");
  
  // Apply all fixes
  applyAppFixes();
  
  // Re-apply on orientation change
  window.addEventListener('orientationchange', function() {
    setTimeout(applyAppFixes, 300);
  });

  // Also re-apply when resizing
  window.addEventListener('resize', function() {
    setTimeout(applyAppFixes, 300);
  });

  // Add global navigation event delegation as a backup
  document.body.addEventListener('click', function(e) {
    const navItem = e.target.closest('.nav-item');
    if (navItem) {
      e.preventDefault();
      const section = navItem.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        console.log("Navigation delegated click for section:", section);
        window.showSection(section);
      }
    }
  });
  
  // Make sure showSection is properly defined in window scope
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
        
        // Update active nav item
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
          item.classList.remove('active');
          if (item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
          }
        });
      }
    };
  }
});

// Workout Plan Regeneration
window.regenerateWorkoutPlan = function() {
  console.log("Regenerating workout plan...");
  
  // Check if the original function exists and use it
  if (typeof window.generateActivityPlan === 'function') {
    try {
      window.generateActivityPlan();
      if (typeof showNotification === 'function') {
        showNotification('Workout plan regenerated successfully!', 'success');
      } else {
        alert('Workout plan regenerated successfully!');
      }
    } catch (error) {
      console.error("Error regenerating workout plan:", error);
      if (typeof showNotification === 'function') {
        showNotification('Sorry, could not regenerate workout plan. Please try again.', 'error');
      } else {
        alert('Sorry, could not regenerate workout plan. Please try again.');
      }
    }
  } else {
    console.error("generateActivityPlan function not available");
    // Try to use the one from script.js directly
    if (typeof generateActivityPlan === 'function') {
      try {
        generateActivityPlan();
        if (typeof showNotification === 'function') {
          showNotification('Workout plan regenerated successfully!', 'success');
        } else {
          alert('Workout plan regenerated successfully!');
        }
      } catch (error) {
        console.error("Error using direct generateActivityPlan function:", error);
        if (typeof showNotification === 'function') {
          showNotification('Sorry, could not regenerate workout plan. Please try again.', 'error');
        } else {
          alert('Sorry, could not regenerate workout plan. Please try again.');
        }
      }
    } else {
      console.error("No generateActivityPlan function found");
      if (typeof showNotification === 'function') {
        showNotification('Sorry, could not regenerate workout plan. Please try again.', 'error');
      } else {
        alert('Sorry, could not regenerate workout plan. Please try again.');
      }
    }
  }
};

// Profile functions
window.editProfile = function() {
  console.log("Opening profile editor");

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
};

window.closeModal = function() {
  console.log("Closing profile editor");

  const profileModal = document.getElementById('profileModal');
  if (profileModal) {
    profileModal.style.display = 'none';
  }
};

window.saveGoals = function() {
  console.log("Saving profile and goals");

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
  window.updateProfileDisplay();

  // Close modal
  window.closeModal();

  // If on workout section, regenerate activity plan
  if (document.getElementById('workout')?.classList.contains('active-section')) {
    window.generateActivityPlan();
  }
};

window.editWorkoutPlan = function() {
  window.editProfile();
};

window.regenerateWorkoutPlan = function() {
  window.generateActivityPlan();
};

// SupermarketAPI class definition
class SupermarketAPI {
  constructor() {
    this.stores = ['Woolworths', 'Coles', 'Aldi'];
    this.mockPrices = {
      "Chicken Breast": { woolworths: 12.50, coles: 11.90, aldi: 10.99 },
      "Greek Yogurt": { woolworths: 5.50, coles: 5.80, aldi: 4.99 },
      "Salmon": { woolworths: 32.00, coles: 30.50, aldi: 29.99 },
      "Sweet Potato": { woolworths: 4.50, coles: 4.20, aldi: 3.99 },
      "Broccoli": { woolworths: 8.90, coles: 9.20, aldi: 7.99 },
      "Quinoa": { woolworths: 7.50, coles: 8.00, aldi: 6.99 },
      "Brown Rice": { woolworths: 5.40, coles: 5.20, aldi: 4.49 },
      "Oats": { woolworths: 5.00, coles: 4.80, aldi: 4.29 },
      "Eggs": { woolworths: 7.20, coles: 6.90, aldi: 6.49 },
      "Banana": { woolworths: 4.90, coles: 4.50, aldi: 3.99 }
    };
  }

  getProductPrice(productName) {
    // Find exact or approximate match
    const productKey = Object.keys(this.mockPrices).find(key =>
      key.toLowerCase().includes(productName.toLowerCase()) ||
      productName.toLowerCase().includes(key.toLowerCase())
    );

    if (productKey) {
      const storeIndex = Math.floor(Math.random() * this.stores.length);
      const store = this.stores[storeIndex];
      const storeKey = store.toLowerCase();
      const price = this.mockPrices[productKey][storeKey] ||
        (Math.floor(Math.random() * 1000) / 100 + 3).toFixed(2);

      return {
        product: productName,
        store: store,
        price: parseFloat(price),
        unit: 'per item'
      };
    } else {
      // Random price for unknown products
      const storeIndex = Math.floor(Math.random() * this.stores.length);
      const price = (Math.floor(Math.random() * 1000) / 100 + 3).toFixed(2);

      return {
        product: productName,
        store: this.stores[storeIndex],
        price: parseFloat(price),
        unit: 'per item'
      };
    }
  }

  comparePrices(productName) {
    const productKey = Object.keys(this.mockPrices).find(key =>
      key.toLowerCase().includes(productName.toLowerCase()) ||
      productName.toLowerCase().includes(key.toLowerCase())
    );

    if (productKey) {
      const wPrice = this.mockPrices[productKey].woolworths;
      const cPrice = this.mockPrices[productKey].coles;
      const cheapest = wPrice <= cPrice ? 'Woolworths' : 'Coles';

      return {
        product: productKey,
        woolworths: {
          price: wPrice.toFixed(2),
          unit: 'per pack'
        },
        coles: {
          price: cPrice.toFixed(2),
          unit: 'per pack'
        },
        cheapest: cheapest,
        savings: Math.abs(wPrice - cPrice).toFixed(2)
      };
    } else {
      // Generate random prices for unknown products
      const wPrice = (Math.floor(Math.random() * 1000) / 100 + 3).toFixed(2);
      const cPrice = (Math.floor(Math.random() * 1000) / 100 + 3).toFixed(2);
      const cheapest = parseFloat(wPrice) <= parseFloat(cPrice) ? 'Woolworths' : 'Coles';

      return {
        product: productName,
        woolworths: {
          price: wPrice,
          unit: 'per pack'
        },
        coles: {
          price: cPrice,
          unit: 'per pack'
        },
        cheapest: cheapest,
        savings: Math.abs(parseFloat(wPrice) - parseFloat(cPrice)).toFixed(2)
      };
    }
  }

  // Enhanced method for use in shopping list display
  async getPricedShoppingList(items) {
    if (!Array.isArray(items)) return [];

    const pricedItems = await Promise.all(items.map(async (item) => {
      try {
        const priceInfo = await this.compareProductPrices(item.name);
        return {
          ...item,
          priceInfo: priceInfo,
          bestPrice: `$${priceInfo.cheapest === 'Woolworths' ?
            priceInfo.woolworths.price : priceInfo.coles.price}`,
          bestStore: priceInfo.cheapest,
          savings: priceInfo.savings
        };
      } catch (error) {
        console.error(`Error getting price for ${item.name}:`, error);
        return item;
      }
    }));

    return pricedItems;
  }
}

// Initialize SupermarketAPI
window.supermarketAPI = new SupermarketAPI();

// GrokAgent class definition
class GrokAgent {
  constructor() {
    this.initialized = false;
    this.features = {
      meal_planning: true,
      workout_planning: true,
      shopping_list: true
    };

    console.log("Initializing Grok Agent...");
    this.init();
  }

  init() {
    if (this.initialized) return;

    // Initialize features
    if (this.features.meal_planning) {
      console.log("Meal planning feature initialized");
    }

    if (this.features.workout_planning) {
      console.log("Workout planning feature initialized");
    }

    if (this.features.shopping_list) {
      console.log("Shopping list feature initialized");
    }

    this.initialized = true;
    console.log("Grok Agent initialized successfully");
  }

  isInitialized() {
    return this.initialized;
  }

  processQuery(query) {
    return {
      type: "text",
      content: `I've processed your query: "${query}". How can I help you further?`
    };
  }

  generateMealPlan(preferences) {
    return {
      plan: {
        breakfast: ["Oatmeal with berries", "Greek yogurt with honey"],
        lunch: ["Chicken salad", "Quinoa bowl"],
        dinner: ["Salmon with vegetables", "Steak with sweet potato"],
        snacks: ["Apple with almond butter", "Protein shake"]
      },
      macros: {
        calories: 2200,
        protein: 150,
        carbs: 220,
        fat: 70
      }
    };
  }

  generateWorkoutPlan(preferences) {
    return {
      plan: {
        monday: { type: "Upper Body", exercises: ["Bench Press", "Rows", "Shoulder Press"] },
        wednesday: { type: "Lower Body", exercises: ["Squats", "Lunges", "Leg Press"] },
        friday: { type: "Full Body", exercises: ["Deadlifts", "Pull-ups", "Push-ups"] }
      },
      level: preferences?.level || "Beginner",
      duration: preferences?.duration || 45
    };
  }
}

// Initialize GrokAgent
window.grokAgent = new GrokAgent();

// Set up initial state when document is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, applying fixes');

  // Set sidebar width CSS variable
  document.documentElement.style.setProperty('--sidebar-width', '200px');

  // Fix navigation buttons
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');
      if (section) {
        console.log('Navigation clicked for section:', section);
        window.showSection(section);
      }
    });
  });

  // Fix dashboard navigation cards
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    card.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (section) {
        console.log('Nav card clicked for section:', section);
        window.showSection(section);
      }
    });
  });

  // Fix promo cards
  const promoCards = document.querySelectorAll('.promo-card');
  promoCards.forEach(card => {
    card.addEventListener('click', function(e) {
      e.preventDefault();
      const section = this.getAttribute('data-page');
      if (section) {
        console.log('Promo card clicked for section:', section);
        window.showSection(section);
      }
    });
  });

  // Update profile display
  window.updateProfileDisplay();

  // Set up meal plan generator
  const goalType = document.getElementById('goalType');
  if (goalType) {
    goalType.addEventListener('change', window.generateMealPlan);
  }

  // Set up Grok toggle
  const toggleGrok = document.getElementById('toggleGrok');
  const closeGrok = document.getElementById('closeGrok');
  const grokPanel = document.getElementById('grokPanel');

  if (toggleGrok && grokPanel) {
    toggleGrok.addEventListener('click', function() {
      grokPanel.classList.add('open');
      grokPanel.style.transform = 'translateY(0)';
      grokPanel.style.opacity = '1';
      grokPanel.style.pointerEvents = 'all';
    });
  }

  if (closeGrok && grokPanel) {
    closeGrok.addEventListener('click', function() {
      grokPanel.classList.remove('open');
      grokPanel.style.transform = 'translateY(20px)';
      grokPanel.style.opacity = '0';
      grokPanel.style.pointerEvents = 'none';
    });
  }  // Set up profile editing
  const editProfileBtn = document.querySelector('.edit-profile-btn');
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', window.editProfile);
  }

  // Show dashboard by default
  window.showSection('dashboard');

  console.log('App fixes applied successfully');
});

function addMobileSupport() {
  // Apply mobile-specific styles
  const styleMobile = document.createElement('style');
  styleMobile.textContent = `
    @media (max-width: 768px) {
      .nav-item {
        font-size: 14px;
        touch-action: manipulation;
      }
      .promo-card {
        width: 100%;
      }
      /* Fix overflow issues */
      body {
        overflow-x: hidden;
        width: 100%;
      }
      /* Make buttons more tappable */
      button, .nav-item, .workout-card, .shop-item, .meal-category {
        min-height: 44px;
        touch-action: manipulation;
      }
      /* Improve spacing for touch targets */
      .workout-day, .meal-log, .food-entry {
        margin-bottom: 12px;
      }
      /* Make workout plan more visible on mobile */
      .workout-card {
        margin-bottom: 15px;
      }
      /* Fix modal scrolling */
      .modal-content {
        max-height: 80vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
    }
  `;
  document.head.appendChild(styleMobile);

  // Improve touch handling for interactive elements
  const touchTargets = document.querySelectorAll('button, .nav-item, .shop-item, .workout-card');
  touchTargets.forEach(element => {
    element.style.touchAction = 'manipulation';
  });

  // Fix any overflow issues
  document.body.style.overflowX = 'hidden';
  document.body.style.width = '100%';

  // Ensure proper rendering on iOS
  const sections = document.querySelectorAll('section, #dashboard');
  sections.forEach(section => {
    section.style.webkitOverflowScrolling = 'touch';
  });

  // Add touchstart listeners for improved responsiveness
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('touchstart', function() {
      // This empty handler improves touch response
    }, {passive: true});
  });
}

// Add food search initialization
function initFoodSearch() {
  console.log("Initializing food search functionality");

  // Set up search button event listener if it exists
  const searchBtn = document.getElementById('searchFoodBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', function() {
      const searchInput = document.getElementById('foodSearchInput');
      if (searchInput && typeof searchFood === 'function') {
        searchFood(searchInput.value);
      }
    });
  }

  // Make sure the food search input triggers search on Enter key
  const searchInput = document.getElementById('foodSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && typeof searchFood === 'function') {
        searchFood(this.value);
      }
    });
  }
}

// Initialize weight logging functionality
function initWeightLogging() {
  console.log("Initializing weight logging functionality");

  // Add event listeners for weight logging form if it exists
  const weightForm = document.getElementById('weightLogForm');
  if (weightForm) {
    weightForm.addEventListener('submit', function(e) {
      e.preventDefault();

      const weightInput = document.getElementById('weightInput');
      if (weightInput && weightInput.value) {
        // Save weight entry to localStorage
        const weightEntries = JSON.parse(localStorage.getItem('weightEntries') || '[]');
        weightEntries.push({
          weight: parseFloat(weightInput.value),
          date: new Date().toISOString()
        });
        localStorage.setItem('weightEntries', JSON.stringify(weightEntries));

        // Clear input and update display
        weightInput.value = '';
        if (typeof updateWeightDisplay === 'function') {
          updateWeightDisplay();
        }
      }
    });
  }
}

// Fix workout checkboxes
function fixWorkoutCheckboxes() {
  console.log("Fixing workout checkboxes");

  const checkboxes = document.querySelectorAll('.workout-completed-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const day = this.dataset.day;
      const card = this.closest('.workout-card');

      if (this.checked) {
        card.classList.add('workout-completed');

        // Save to workout history
        if (window.workoutHistory) {
          window.workoutHistory[day] = window.workoutHistory[day] || {};
          window.workoutHistory[day].completed = true;
          window.workoutHistory[day].date = new Date().toLocaleDateString();

          // Save to localStorage
          localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));
        }
      } else {
        card.classList.remove('workout-completed');

        // Update workout history
        if (window.workoutHistory && window.workoutHistory[day]) {
          window.workoutHistory[day].completed = false;

          // Save to localStorage
          localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));
        }
      }
    });
  });
}

// Show workout log modal
// Make showWorkoutLog available globally
window.showWorkoutLog = function(exerciseName, exerciseDetails) {
  console.log("Showing workout log for:", exerciseName);

  const modal = document.getElementById('workoutLogModal');
  if (!modal) return;

  // Set exercise name in modal
  const nameElement = document.getElementById('logExerciseName');
  if (nameElement) {
    nameElement.textContent = exerciseName;
  }

  // Show the appropriate metrics based on exercise type
  const isCardio = exerciseName.toLowerCase().includes('run') ||
                  exerciseName.toLowerCase().includes('jog') ||
                  exerciseName.toLowerCase().includes('sprint') ||
                  exerciseName.toLowerCase().includes('cycle') ||
                  exerciseName.toLowerCase().includes('cardio');

  const isYoga = exerciseName.toLowerCase().includes('yoga') ||
                exerciseName.toLowerCase().includes('stretch') ||
                exerciseName.toLowerCase().includes('meditation');

  // Show/hide appropriate metric sections
  const gymMetrics = document.getElementById('gymMetrics');
  const runMetrics = document.getElementById('runMetrics');
  const yogaMetrics = document.getElementById('yogaMetrics');

  if (gymMetrics) gymMetrics.style.display = (!isCardio && !isYoga) ? 'block' : 'none';
  if (runMetrics) runMetrics.style.display = isCardio ? 'block' : 'none';
  if (yogaMetrics) yogaMetrics.style.display = isYoga ? 'block' : 'none';

  // Show the modal
  modal.style.display = 'block';
  
  // Load exercise history if available
  if (typeof loadExerciseHistory === 'function') {
    loadExerciseHistory(exerciseName);
  }
};

  // Pre-fill with provided exercise details if available
  if (exerciseDetails) {
    // Implementation for pre-filling exercise details
    // This would populate the form with previous workout data
  }

  // Load previous history for this exercise
  loadExerciseHistory(exerciseName);
}

// Load exercise history for the workout log
function loadExerciseHistory(exerciseName) {
  console.log("Loading exercise history for:", exerciseName);

  const historyContainer = document.getElementById('historyEntries');
  if (!historyContainer) return;

  // Get exercise history from localStorage
  const exerciseHistory = JSON.parse(localStorage.getItem('exerciseHistory') || '{}');
  const entries = exerciseHistory[exerciseName] || [];

  if (entries.length === 0) {
    historyContainer.innerHTML = '<div class="no-history">No previous logs for this exercise</div>';
    return;
  }

  // Sort entries by date (newest first)
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Display history entries
  let historyHTML = '';
  entries.slice(0, 3).forEach(entry => {
    historyHTML += `
      <div class="history-entry">
        <div class="history-date">${new Date(entry.date).toLocaleDateString()}</div>
        <div class="history-details">
          ${entry.weight ? `<span class="detail-item">Weight: ${entry.weight}kg</span>` : ''}
          ${entry.reps ? `<span class="detail-item">Reps: ${entry.reps}</span>` : ''}
          ${entry.sets ? `<span class="detail-item">Sets: ${entry.sets}</span>` : ''}
          ${entry.distance ? `<span class="detail-item">Distance: ${entry.distance}km</span>` : ''}
          ${entry.duration ? `<span class="detail-item">Duration: ${entry.duration}min</span>` : ''}
          ${entry.pace ? `<span class="detail-item">Pace: ${entry.pace}</span>` : ''}
          ${entry.difficulty ? `<span class="detail-item">Difficulty: ${entry.difficulty}/10</span>` : ''}
        </div>
        ${entry.notes ? `<div class="history-notes">${entry.notes}</div>` : ''}
      </div>
    `;
  });

  historyContainer.innerHTML = historyHTML;
}

// Close workout log modal
function closeWorkoutLog() {
  const modal = document.getElementById('workoutLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Save workout log
function saveWorkoutLog() {
  const exerciseName = document.getElementById('logExerciseName')?.textContent;
  if (!exerciseName) return;

  // Get form values based on visible metric section
  const entry = {
    date: new Date().toISOString(),
    notes: document.getElementById('workoutNotes')?.value || ''
  };

  // Gym metrics
  if (document.getElementById('gymMetrics')?.style.display !== 'none') {
    entry.weight = document.getElementById('weight')?.value || '';
    entry.reps = document.getElementById('reps')?.value || '';
    entry.sets = document.getElementById('sets')?.value || '';
  }

  // Running metrics
  if (document.getElementById('runMetrics')?.style.display !== 'none') {
    entry.distance = document.getElementById('distance')?.value || '';
    entry.duration = document.getElementById('duration')?.value || '';
    entry.pace = document.getElementById('pace')?.value || '';
  }

  // Yoga metrics
  if (document.getElementById('yogaMetrics')?.style.display !== 'none') {
    entry.duration = document.getElementById('yogaDuration')?.value || '';
    entry.difficulty = document.getElementById('difficulty')?.value || '';
  }

  // Save to localStorage
  const exerciseHistory = JSON.parse(localStorage.getItem('exerciseHistory') || '{}');
  exerciseHistory[exerciseName] = exerciseHistory[exerciseName] || [];
  exerciseHistory[exerciseName].push(entry);
  localStorage.setItem('exerciseHistory', JSON.stringify(exerciseHistory));

  // Reload history and show success message
  loadExerciseHistory(exerciseName);

  // Show success notification
  alert('Workout logged successfully!');

  // Close modal
  closeWorkoutLog();
}

// Add loadExerciseHistory function
window.loadExerciseHistory = function(exerciseName) {
  console.log("Loading exercise history for:", exerciseName);
  const historyContainer = document.getElementById('historyEntries');
  if (!historyContainer) return;
  
  // Get workout history from localStorage
  const workoutHistory = JSON.parse(localStorage.getItem('exerciseHistory') || '{}');
  const exerciseHistory = workoutHistory[exerciseName] || [];
  
  if (exerciseHistory.length === 0) {
    historyContainer.innerHTML = '<p class="no-history">No previous logs for this exercise</p>';
    return;
  }
  
  // Sort by date (newest first)
  exerciseHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Display history
  let historyHTML = '';
  exerciseHistory.forEach(entry => {
    const date = new Date(entry.timestamp).toLocaleDateString();
    historyHTML += `
      <div class="history-entry">
        <div class="history-date">${date}</div>
        <div class="history-details">
          ${entry.weight ? `<span>Weight: ${entry.weight}kg</span>` : ''}
          ${entry.reps ? `<span>Reps: ${entry.reps}</span>` : ''}
          ${entry.sets ? `<span>Sets: ${entry.sets}</span>` : ''}
          ${entry.duration ? `<span>Duration: ${entry.duration}min</span>` : ''}
          ${entry.distance ? `<span>Distance: ${entry.distance}km</span>` : ''}
        </div>
        ${entry.notes ? `<div class="history-notes">${entry.notes}</div>` : ''}
      </div>
    `;
  });
  
  historyContainer.innerHTML = historyHTML;
};

// Make functions available globally
window.closeWorkoutLog = closeWorkoutLog;
window.saveWorkoutLog = saveWorkoutLog;
window.applyAppFixes = applyAppFixes;
window.fixNavigation = fixNavigation;
window.initFoodLog = initFoodLog;
window.fixWorkoutPlanDisplay = fixWorkoutPlanDisplay;

function fixNavigation() {
  console.log("Fixing navigation functionality");
  
  // Fix for navigation on all devices
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    // Remove old listeners by cloning
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    
    // Add click event listener
    newItem.addEventListener('click', function(e) {
      e.preventDefault();
      const sectionId = this.getAttribute('data-section');
      if (sectionId && typeof window.showSection === 'function') {
        console.log("Navigation clicked for section:", sectionId);
        window.showSection(sectionId);
      }
    });
  });

  // Fix nav cards
  const navCards = document.querySelectorAll('.nav-card');
  navCards.forEach(card => {
    // Remove old listeners by cloning
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    
    // Add click event listener
    newCard.addEventListener('click', function(e) {
      e.preventDefault();
      const sectionId = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (sectionId && typeof window.showSection === 'function') {
        console.log("Nav card clicked for section:", sectionId);
        window.showSection(sectionId);
      }
    });
  });
  
  // Fix promo cards
  const promoCards = document.querySelectorAll('.promo-card');
  promoCards.forEach(card => {
    // Remove old listeners by cloning
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    
    // Add click event listener
    newCard.addEventListener('click', function(e) {
      e.preventDefault();
      const sectionId = this.getAttribute('data-page') || this.getAttribute('data-section');
      if (sectionId && typeof window.showSection === 'function') {
        console.log("Promo card clicked for section:", sectionId);
        window.showSection(sectionId);
      }
    });
  });
  
  console.log("Navigation fixed successfully");
}

function fixWorkoutDisplay() {
  console.log("Fixing workout plan display");
  
  // Make sure workout display exists
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (!workoutPlanDisplay) return;
  
  // Regenerate activity plan if needed
  if (typeof window.generateActivityPlan === 'function') {
    window.generateActivityPlan();
  }
  
  // Make sure workout card buttons work
  const workoutButtons = document.querySelectorAll('.workout-details-btn, .workout-complete-btn, .exercise-log-btn');
  workoutButtons.forEach(button => {
    // Remove old listeners by cloning
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    // Add click event listener based on button type
    if (newButton.classList.contains('exercise-log-btn')) {
      newButton.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event bubbling
        const exerciseName = this.getAttribute('data-exercise') || 
                            this.closest('.exercise-row')?.querySelector('.exercise-name')?.textContent.trim();
        
        if (exerciseName) {
          console.log("Log button clicked for exercise:", exerciseName);
          if (typeof window.showWorkoutLog === 'function') {
            window.showWorkoutLog(exerciseName);
          } else {
            // Fallback implementation
            const modal = document.getElementById('workoutLogModal');
            if (modal) {
              const nameElement = document.getElementById('logExerciseName');
              if (nameElement) {
                nameElement.textContent = exerciseName;
              }
              modal.style.display = 'block';
            }
          }
        }
      });
    }
  });
  
  console.log("Workout display fixed successfully");
}

function initFoodLog() {
  console.log("Initializing food log");
  // Populate food log from localStorage if available
  try {
    const storedFoodLog = localStorage.getItem('dailyLog');
    if (storedFoodLog && typeof updateFoodLogDisplay === 'function') {
      updateFoodLogDisplay();
    }
  } catch (error) {
    console.error("Error initializing food log:", error);
  }
}

function initCharts() {
  console.log("Initializing charts");
  try {
    if (typeof Chart !== 'undefined') {
      const macroChart = document.getElementById('macroChart');
      if (macroChart && typeof updateMacroChart === 'function') {
        // Initialize with default values
        updateMacroChart(0, 0, 0);
      }
    }
  } catch (error) {
    console.error("Error initializing charts:", error);
  }
}

function addMobileSupport() {
  console.log("Adding mobile support");
  try {
    // Check if user is on a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      document.body.classList.add('mobile-view');
      // Adjust sidebar for mobile
      document.documentElement.style.setProperty('--sidebar-width', '0px');
    }
  } catch (error) {
    console.error("Error adding mobile support:", error);
  }
}

// Export the function
window.applyAppFixes = applyAppFixes;