
// FitMunch Exercise Tracker
// Tracks individual exercises within workouts

const ExerciseTracker = {
  // Initialize tracker
  initialize: function() {
    console.log("Exercise tracker initialized");
    this.loadExerciseData();
  },
  
  // Load exercise data from storage
  loadExerciseData: function() {
    const storedData = localStorage.getItem('exerciseData');
    if (storedData) {
      try {
        this.exerciseData = JSON.parse(storedData);
      } catch (e) {
        console.error('Error loading exercise data:', e);
        this.exerciseData = {};
      }
    } else {
      this.exerciseData = {};
    }
  },
  
  // Save exercise data to storage
  saveExerciseData: function() {
    localStorage.setItem('exerciseData', JSON.stringify(this.exerciseData));
  },
  
  // Log an exercise completion
  logExercise: function(exercise) {
    if (!exercise.name) return false;
    
    // Initialize exercise data if needed
    if (!this.exerciseData) this.loadExerciseData();
    if (!this.exerciseData[exercise.name]) {
      this.exerciseData[exercise.name] = [];
    }
    
    // Add timestamp if not provided
    if (!exercise.timestamp) {
      exercise.timestamp = new Date().toISOString();
    }
    
    // Add to exercise history
    this.exerciseData[exercise.name].push(exercise);
    
    // Save updated data
    this.saveExerciseData();
    
    // Track in analytics if available
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackFeatureUse('exercise_logged', {
        exercise: exercise.name,
        weight: exercise.weight,
        reps: exercise.reps,
        sets: exercise.sets
      });
    }
    
    return true;
  },
  
  // Get exercise history for a specific exercise
  getExerciseHistory: function(exerciseName) {
    if (!this.exerciseData) this.loadExerciseData();
    return this.exerciseData[exerciseName] || [];
  },
  
  // Get all exercise data
  getAllExerciseData: function() {
    if (!this.exerciseData) this.loadExerciseData();
    return this.exerciseData;
  },
  
  // Get recent exercise logs
  getRecentExercises: function(limit = 10) {
    if (!this.exerciseData) this.loadExerciseData();
    
    let allExercises = [];
    
    // Flatten all exercise data with name
    Object.keys(this.exerciseData).forEach(name => {
      const exercises = this.exerciseData[name].map(e => ({
        ...e,
        name: name
      }));
      allExercises = [...allExercises, ...exercises];
    });
    
    // Sort by timestamp (newest first)
    allExercises.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Return limited number
    return allExercises.slice(0, limit);
  }
};

// Initialize if the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  if (typeof ExerciseTracker === 'object' && ExerciseTracker.initialize) {
    ExerciseTracker.initialize();
  }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExerciseTracker;
} else {
  // Make available globally in browser
  window.ExerciseTracker = ExerciseTracker;
}
