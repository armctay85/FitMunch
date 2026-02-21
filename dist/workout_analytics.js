
// FitMunch Workout Analytics Dashboard
// Provides visual analytics for tracking workout progress over time

const WorkoutAnalytics = {
  // Store for workout data
  workoutData: [],
  
  // Chart instances 
  charts: {},
  
  // Initialize workout analytics
  initialize: function() {
    console.log('Workout analytics initialized');
    this.loadWorkoutData();
    
    // Initialize UI if it exists
    if (document.getElementById('workout-analytics-container')) {
      this.renderDashboard();
    }
  },
  
  // Load workout data from storage
  loadWorkoutData: function() {
    const storedData = localStorage.getItem('workoutHistory');
    if (storedData) {
      try {
        this.workoutData = JSON.parse(storedData);
      } catch (e) {
        console.error('Error loading workout data:', e);
        this.workoutData = [];
      }
    }
    
    // If no data exists, generate sample data for demo
    if (!this.workoutData.length) {
      this.generateSampleData();
    }
  },
  
  // Save workout data to storage
  saveWorkoutData: function() {
    localStorage.setItem('workoutHistory', JSON.stringify(this.workoutData));
  },
  
  // Add a new workout entry
  addWorkout: function(workout) {
    // Ensure workout has required fields
    if (!workout.date) workout.date = new Date().toISOString();
    if (!workout.duration) workout.duration = 0;
    
    this.workoutData.push(workout);
    this.saveWorkoutData();
    
    // Refresh charts if dashboard is visible
    if (document.getElementById('workout-analytics-container')) {
      this.refreshCharts();
    }
  },
  
  // Generate sample data for demonstration
  generateSampleData: function() {
    const today = new Date();
    const workoutTypes = ['Strength', 'Cardio', 'Flexibility', 'HIIT', 'Endurance'];
    const muscleGroups = ['Chest', 'Back', 'Arms', 'Legs', 'Core', 'Full Body'];
    
    // Generate 30 days of sample data
    for (let i = 30; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      // Skip some days to simulate rest days
      if (i % 3 === 0) continue;
      
      this.workoutData.push({
        id: `workout-${date.getTime()}`,
        date: date.toISOString(),
        type: workoutTypes[Math.floor(Math.random() * workoutTypes.length)],
        muscleGroup: muscleGroups[Math.floor(Math.random() * muscleGroups.length)],
        duration: Math.floor(Math.random() * 60) + 20, // 20-80 minutes
        intensity: Math.floor(Math.random() * 5) + 1, // 1-5 rating
        calories: Math.floor(Math.random() * 400) + 100, // 100-500 calories
        exercises: Math.floor(Math.random() * 8) + 3, // 3-10 exercises
        completed: true
      });
    }
    
    this.saveWorkoutData();
  },
  
  // Render the analytics dashboard
  renderDashboard: function() {
    const container = document.getElementById('workout-analytics-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="analytics-header">
        <h2>Workout Analytics</h2>
        <p>Track your fitness journey with detailed analytics</p>
      </div>
      
      <div class="stats-summary">
        <div class="stat-card">
          <div class="stat-value">${this.getWorkoutCount(30)}</div>
          <div class="stat-label">Workouts<br>Last 30 Days</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.getAverageDuration(30)} min</div>
          <div class="stat-label">Average<br>Duration</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.getTotalCalories(30)}</div>
          <div class="stat-label">Calories<br>Burned</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.getConsistencyScore(30)}%</div>
          <div class="stat-label">Consistency<br>Score</div>
        </div>
      </div>
      
      <div class="chart-container">
        <div class="chart-card">
          <h3>Workout Frequency</h3>
          <canvas id="frequency-chart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Workout Duration</h3>
          <canvas id="duration-chart"></canvas>
        </div>
      </div>
      
      <div class="chart-container">
        <div class="chart-card">
          <h3>Workout Type Distribution</h3>
          <canvas id="types-chart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Muscle Group Focus</h3>
          <canvas id="muscle-groups-chart"></canvas>
        </div>
      </div>
      
      <div class="insights-container">
        <h3>Workout Insights</h3>
        <div class="insights-list">
          ${this.generateInsights().map(insight => `
            <div class="insight-card">
              <div class="insight-icon">
                <i class="fas ${insight.icon}"></i>
              </div>
              <div class="insight-content">
                <h4>${insight.title}</h4>
                <p>${insight.description}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    // Initialize charts after rendering HTML
    this.initializeCharts();
  },
  
  // Initialize charts with workout data
  initializeCharts: function() {
    // Only proceed if Chart.js is available
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not available');
      return;
    }
    
    // Create frequency chart
    this.createFrequencyChart();
    
    // Create duration chart
    this.createDurationChart();
    
    // Create type distribution chart
    this.createTypesChart();
    
    // Create muscle groups chart
    this.createMuscleGroupsChart();
  },
  
  // Create chart for workout frequency
  createFrequencyChart: function() {
    const ctx = document.getElementById('frequency-chart');
    if (!ctx) return;
    
    const last30Days = this.getDateLabels(30);
    const workoutCounts = this.getWorkoutCountsByDate(30);
    
    this.charts.frequency = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: last30Days,
        datasets: [{
          label: 'Workouts',
          data: workoutCounts,
          backgroundColor: 'rgba(67, 97, 238, 0.7)',
          borderColor: 'rgba(67, 97, 238, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1
            }
          }
        }
      }
    });
  },
  
  // Create chart for workout duration
  createDurationChart: function() {
    const ctx = document.getElementById('duration-chart');
    if (!ctx) return;
    
    const last30Days = this.getDateLabels(30);
    const durations = this.getDurationsByDate(30);
    
    this.charts.duration = new Chart(ctx, {
      type: 'line',
      data: {
        labels: last30Days,
        datasets: [{
          label: 'Duration (minutes)',
          data: durations,
          backgroundColor: 'rgba(247, 37, 133, 0.2)',
          borderColor: 'rgba(247, 37, 133, 1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  },
  
  // Create chart for workout type distribution
  createTypesChart: function() {
    const ctx = document.getElementById('types-chart');
    if (!ctx) return;
    
    const typeData = this.getWorkoutTypeDistribution();
    
    this.charts.types = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: Object.keys(typeData),
        datasets: [{
          data: Object.values(typeData),
          backgroundColor: [
            'rgba(67, 97, 238, 0.7)',
            'rgba(247, 37, 133, 0.7)',
            'rgba(58, 12, 163, 0.7)',
            'rgba(76, 201, 240, 0.7)',
            'rgba(114, 9, 183, 0.7)'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right'
          }
        }
      }
    });
  },
  
  // Create chart for muscle group focus
  createMuscleGroupsChart: function() {
    const ctx = document.getElementById('muscle-groups-chart');
    if (!ctx) return;
    
    const muscleData = this.getMuscleGroupDistribution();
    
    this.charts.muscleGroups = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: Object.keys(muscleData),
        datasets: [{
          label: 'Focus Level',
          data: Object.values(muscleData),
          backgroundColor: 'rgba(58, 12, 163, 0.2)',
          borderColor: 'rgba(58, 12, 163, 1)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(58, 12, 163, 1)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: {
              display: true
            },
            suggestedMin: 0
          }
        }
      }
    });
  },
  
  // Refresh all charts with latest data
  refreshCharts: function() {
    if (this.charts.frequency) {
      const workoutCounts = this.getWorkoutCountsByDate(30);
      this.charts.frequency.data.datasets[0].data = workoutCounts;
      this.charts.frequency.update();
    }
    
    if (this.charts.duration) {
      const durations = this.getDurationsByDate(30);
      this.charts.duration.data.datasets[0].data = durations;
      this.charts.duration.update();
    }
    
    if (this.charts.types) {
      const typeData = this.getWorkoutTypeDistribution();
      this.charts.types.data.labels = Object.keys(typeData);
      this.charts.types.data.datasets[0].data = Object.values(typeData);
      this.charts.types.update();
    }
    
    if (this.charts.muscleGroups) {
      const muscleData = this.getMuscleGroupDistribution();
      this.charts.muscleGroups.data.labels = Object.keys(muscleData);
      this.charts.muscleGroups.data.datasets[0].data = Object.values(muscleData);
      this.charts.muscleGroups.update();
    }
    
    // Update summary statistics
    const statValues = document.querySelectorAll('.stat-value');
    if (statValues.length === 4) {
      statValues[0].textContent = this.getWorkoutCount(30);
      statValues[1].textContent = `${this.getAverageDuration(30)} min`;
      statValues[2].textContent = this.getTotalCalories(30);
      statValues[3].textContent = `${this.getConsistencyScore(30)}%`;
    }
    
    // Update insights
    const insightsList = document.querySelector('.insights-list');
    if (insightsList) {
      insightsList.innerHTML = this.generateInsights().map(insight => `
        <div class="insight-card">
          <div class="insight-icon">
            <i class="fas ${insight.icon}"></i>
          </div>
          <div class="insight-content">
            <h4>${insight.title}</h4>
            <p>${insight.description}</p>
          </div>
        </div>
      `).join('');
    }
  },
  
  // Get date labels for the past N days
  getDateLabels: function(days) {
    const result = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      // Format as short month/day
      const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
      result.push(monthDay);
    }
    
    return result;
  },
  
  // Get workout counts by date for the past N days
  getWorkoutCountsByDate: function(days) {
    const counts = Array(days).fill(0);
    const today = new Date();
    
    this.workoutData.forEach(workout => {
      const workoutDate = new Date(workout.date);
      const diffTime = today - workoutDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < days) {
        counts[days - 1 - diffDays]++;
      }
    });
    
    return counts;
  },
  
  // Get workout durations by date for the past N days
  getDurationsByDate: function(days) {
    const durations = Array(days).fill(0);
    const today = new Date();
    
    this.workoutData.forEach(workout => {
      const workoutDate = new Date(workout.date);
      const diffTime = today - workoutDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < days) {
        durations[days - 1 - diffDays] = workout.duration;
      }
    });
    
    return durations;
  },
  
  // Get distribution of workout types
  getWorkoutTypeDistribution: function() {
    const types = {};
    
    this.workoutData.forEach(workout => {
      if (!workout.type) return;
      
      if (!types[workout.type]) {
        types[workout.type] = 0;
      }
      
      types[workout.type]++;
    });
    
    return types;
  },
  
  // Get distribution of muscle groups
  getMuscleGroupDistribution: function() {
    const groups = {};
    
    this.workoutData.forEach(workout => {
      if (!workout.muscleGroup) return;
      
      if (!groups[workout.muscleGroup]) {
        groups[workout.muscleGroup] = 0;
      }
      
      groups[workout.muscleGroup]++;
    });
    
    return groups;
  },
  
  // Count workouts in the past N days
  getWorkoutCount: function(days) {
    const today = new Date();
    
    return this.workoutData.filter(workout => {
      const workoutDate = new Date(workout.date);
      const diffTime = today - workoutDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays < days;
    }).length;
  },
  
  // Get average workout duration for the past N days
  getAverageDuration: function(days) {
    const today = new Date();
    const workouts = this.workoutData.filter(workout => {
      const workoutDate = new Date(workout.date);
      const diffTime = today - workoutDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays < days && workout.duration;
    });
    
    if (workouts.length === 0) return 0;
    
    const totalDuration = workouts.reduce((sum, workout) => sum + workout.duration, 0);
    return Math.round(totalDuration / workouts.length);
  },
  
  // Get total calories burned in the past N days
  getTotalCalories: function(days) {
    const today = new Date();
    
    return this.workoutData.reduce((sum, workout) => {
      const workoutDate = new Date(workout.date);
      const diffTime = today - workoutDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < days && workout.calories) {
        return sum + workout.calories;
      }
      
      return sum;
    }, 0);
  },
  
  // Calculate consistency score (0-100) based on workout frequency
  getConsistencyScore: function(days) {
    const workoutCount = this.getWorkoutCount(days);
    // Assuming 5 workouts per week is 100% consistency
    const targetWorkouts = Math.round((days / 7) * 5);
    const score = Math.min(100, Math.round((workoutCount / targetWorkouts) * 100));
    
    return score;
  },
  
  // Generate workout insights based on data analysis
  generateInsights: function() {
    const insights = [];
    
    // Most frequent workout type
    const typeData = this.getWorkoutTypeDistribution();
    if (Object.keys(typeData).length > 0) {
      const mostFrequent = Object.keys(typeData).reduce((a, b) => 
        typeData[a] > typeData[b] ? a : b
      );
      
      insights.push({
        title: 'Preferred Workout Type',
        description: `You tend to favor ${mostFrequent} workouts. Consider adding variety with other types for balanced fitness.`,
        icon: 'fa-dumbbell'
      });
    }
    
    // Workout frequency pattern
    const workoutCount = this.getWorkoutCount(30);
    if (workoutCount > 0) {
      const frequency = workoutCount / 30 * 7; // Average workouts per week
      
      let frequencyInsight;
      if (frequency < 2) {
        frequencyInsight = 'Your workout frequency is low. Aim for at least 3-4 workouts per week for better results.';
      } else if (frequency < 4) {
        frequencyInsight = 'You have a moderate workout frequency. This is a good balance for most fitness goals.';
      } else if (frequency < 6) {
        frequencyInsight = 'You have a high workout frequency. Ensure you\'re allowing enough recovery time between sessions.';
      } else {
        frequencyInsight = 'Your workout frequency is very high. Be sure to incorporate rest days to avoid overtraining.';
      }
      
      insights.push({
        title: 'Workout Frequency',
        description: frequencyInsight,
        icon: 'fa-calendar-check'
      });
    }
    
    // Duration trend
    const avgDuration = this.getAverageDuration(30);
    if (avgDuration > 0) {
      let durationInsight;
      if (avgDuration < 20) {
        durationInsight = 'Your workouts tend to be short. Even brief sessions are beneficial, but consider adding some longer workouts.';
      } else if (avgDuration < 40) {
        durationInsight = 'Your workout duration is in the optimal range for most fitness goals.';
      } else {
        durationInsight = 'Your workouts tend to be longer. Quality often matters more than quantity - consider high-intensity interval training.';
      }
      
      insights.push({
        title: 'Workout Duration',
        description: durationInsight,
        icon: 'fa-clock'
      });
    }
    
    // Muscle group balance
    const muscleData = this.getMuscleGroupDistribution();
    if (Object.keys(muscleData).length > 2) {
      const values = Object.values(muscleData);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const ratio = max / (min || 1);
      
      let balanceInsight;
      if (ratio > 3) {
        balanceInsight = 'Your training shows significant muscle group imbalance. Consider a more balanced approach to prevent injuries.';
      } else if (ratio > 1.5) {
        balanceInsight = 'Your training shows some muscle group preferences. A balanced approach yields the best overall results.';
      } else {
        balanceInsight = 'Your training shows good balance across muscle groups. This is ideal for overall fitness.';
      }
      
      insights.push({
        title: 'Muscle Group Balance',
        description: balanceInsight,
        icon: 'fa-balance-scale'
      });
    }
    
    // Consistency insight
    const consistencyScore = this.getConsistencyScore(30);
    if (consistencyScore > 0) {
      let consistencyInsight;
      if (consistencyScore < 40) {
        consistencyInsight = 'Your workout consistency could use improvement. Regular exercise yields better long-term results.';
      } else if (consistencyScore < 70) {
        consistencyInsight = 'You have moderate consistency in your workout routine. Keep building on this foundation.';
      } else {
        consistencyInsight = 'You show excellent workout consistency! This commitment will lead to great results.';
      }
      
      insights.push({
        title: 'Workout Consistency',
        description: consistencyInsight,
        icon: 'fa-chart-line'
      });
    }
    
    return insights;
  }
};

// Initialize if the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Initialize WorkoutAnalytics
  if (typeof WorkoutAnalytics === 'object' && WorkoutAnalytics.initialize) {
    WorkoutAnalytics.initialize();
  }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkoutAnalytics;
} else {
  // Make available globally in browser
  window.WorkoutAnalytics = WorkoutAnalytics;
}
