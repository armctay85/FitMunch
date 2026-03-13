
// FitMunch Progress Tracker
// This module adds visual progress tracking features to the app

const ProgressTracker = {
  // Store historical data
  history: {
    weight: [],
    workouts: [],
    nutrition: [],
    measurements: []
  },

  // Initialize the tracker
  initialize: function() {
    console.log("Initializing progress tracker...");
    this.loadHistoricalData();
    this.setupEventListeners();
    return this;
  },

  // Load historical data from localStorage
  loadHistoricalData: function() {
    const savedHistory = localStorage.getItem('progressHistory');
    if (savedHistory) {
      try {
        this.history = JSON.parse(savedHistory);
        console.log("Loaded progress history:", this.history);
      } catch (error) {
        console.error("Error loading progress history:", error);
      }
    }
  },

  // Save historical data to localStorage
  saveHistoricalData: function() {
    localStorage.setItem('progressHistory', JSON.stringify(this.history));
  },

  // Set up event listeners
  setupEventListeners: function() {
    document.addEventListener('DOMContentLoaded', () => {
      // Set up weight log form if it exists
      const weightLogForm = document.getElementById('weightLogForm');
      if (weightLogForm) {
        weightLogForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const weight = document.getElementById('weightInput').value;
          const date = document.getElementById('weightDateInput').value || new Date().toISOString().split('T')[0];
          this.logWeight(parseFloat(weight), date);
        });
      }

      // Set up measurement log form if it exists
      const measurementForm = document.getElementById('measurementForm');
      if (measurementForm) {
        measurementForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const measurements = {
            chest: document.getElementById('chestInput').value,
            waist: document.getElementById('waistInput').value,
            hips: document.getElementById('hipsInput').value,
            thighs: document.getElementById('thighsInput').value,
            arms: document.getElementById('armsInput').value
          };
          const date = document.getElementById('measureDateInput').value || new Date().toISOString().split('T')[0];
          this.logMeasurements(measurements, date);
        });
      }

      // Initialize charts if the dashboard is shown
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
          const section = item.getAttribute('data-section');
          if (section === 'dashboard' || section === 'progress') {
            setTimeout(() => this.renderCharts(), 100);
          }
        });
      });
    });
  },

  // Log a new weight entry
  logWeight: function(weight, date) {
    if (!weight || isNaN(weight)) return false;
    
    // Create entry
    const entry = {
      date: date || new Date().toISOString().split('T')[0],
      value: weight
    };
    
    // Add to history
    this.history.weight.push(entry);
    
    // Sort by date
    this.history.weight.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Save to localStorage
    this.saveHistoricalData();
    
    // Update profile
    const userProfile = JSON.parse(localStorage.getItem('userProfile')) || {};
    userProfile.weight = weight;
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    
    // Update UI if updateProfileDisplay function exists
    if (typeof updateProfileDisplay === 'function') {
      updateProfileDisplay();
    }
    
    // Render updated charts
    this.renderCharts();
    
    return true;
  },

  // Log measurements
  logMeasurements: function(measurements, date) {
    if (!measurements) return false;
    
    // Create entry
    const entry = {
      date: date || new Date().toISOString().split('T')[0],
      ...measurements
    };
    
    // Add to history
    this.history.measurements.push(entry);
    
    // Sort by date
    this.history.measurements.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Save to localStorage
    this.saveHistoricalData();
    
    // Render updated charts
    this.renderCharts();
    
    return true;
  },

  // Log completed workout
  logWorkout: function(workout) {
    if (!workout) return false;
    
    // Create entry
    const entry = {
      date: new Date().toISOString().split('T')[0],
      workout: workout
    };
    
    // Add to history
    this.history.workouts.push(entry);
    
    // Save to localStorage
    this.saveHistoricalData();
    
    // Render updated charts
    this.renderCharts();
    
    return true;
  },

  // Log nutrition data
  logNutrition: function(nutritionData) {
    if (!nutritionData) return false;
    
    // Create entry
    const entry = {
      date: new Date().toISOString().split('T')[0],
      ...nutritionData
    };
    
    // Add to history
    this.history.nutrition.push(entry);
    
    // Save to localStorage
    this.saveHistoricalData();
    
    // Render updated charts
    this.renderCharts();
    
    return true;
  },

  // Render progress charts
  renderCharts: function() {
    this.renderWeightChart();
    this.renderMeasurementsChart();
    this.renderWorkoutChart();
    this.renderNutritionChart();
  },

  // Render weight progress chart
  renderWeightChart: function() {
    const weightChartEl = document.getElementById('weightProgressChart');
    if (!weightChartEl) return;
    
    // Data preparation
    const weightData = this.history.weight || [];
    if (weightData.length === 0) {
      weightChartEl.innerHTML = '<div class="no-data">No weight data available yet</div>';
      return;
    }
    
    // Prepare chart data
    const labels = weightData.map(entry => this.formatDate(entry.date));
    const data = weightData.map(entry => entry.value);
    
    // Create chart
    if (window.weightChart) {
      window.weightChart.destroy();
    }
    
    window.weightChart = new Chart(weightChartEl, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Weight (kg)',
          data: data,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: false
          }
        },
        plugins: {
          legend: {
            display: true
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        }
      }
    });
  },

  // Render measurements chart
  renderMeasurementsChart: function() {
    const measureChartEl = document.getElementById('measurementsChart');
    if (!measureChartEl) return;
    
    // Data preparation
    const measureData = this.history.measurements || [];
    if (measureData.length === 0) {
      measureChartEl.innerHTML = '<div class="no-data">No measurement data available yet</div>';
      return;
    }
    
    // Get the most recent 5 entries
    const recentData = measureData.slice(-5);
    
    // Prepare chart data
    const labels = recentData.map(entry => this.formatDate(entry.date));
    const datasets = [
      {
        label: 'Chest (cm)',
        data: recentData.map(entry => entry.chest),
        borderColor: '#f44336',
        backgroundColor: 'rgba(244, 67, 54, 0.1)'
      },
      {
        label: 'Waist (cm)',
        data: recentData.map(entry => entry.waist),
        borderColor: '#2196F3',
        backgroundColor: 'rgba(33, 150, 243, 0.1)'
      },
      {
        label: 'Hips (cm)',
        data: recentData.map(entry => entry.hips),
        borderColor: '#FF9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)'
      }
    ];
    
    // Create chart
    if (window.measurementsChart) {
      window.measurementsChart.destroy();
    }
    
    window.measurementsChart = new Chart(measureChartEl, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: false
          }
        },
        plugins: {
          legend: {
            display: true
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        }
      }
    });
  },

  // Render workout history chart
  renderWorkoutChart: function() {
    const workoutChartEl = document.getElementById('workoutHistoryChart');
    if (!workoutChartEl) return;
    
    // Data preparation
    const workoutData = this.history.workouts || [];
    if (workoutData.length === 0) {
      workoutChartEl.innerHTML = '<div class="no-data">No workout data available yet</div>';
      return;
    }
    
    // Count workout types for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentWorkouts = workoutData.filter(entry => 
      new Date(entry.date) >= thirtyDaysAgo
    );
    
    const workoutCounts = {};
    recentWorkouts.forEach(entry => {
      const type = entry.workout.type || 'Unknown';
      workoutCounts[type] = (workoutCounts[type] || 0) + 1;
    });
    
    // Prepare chart data
    const labels = Object.keys(workoutCounts);
    const data = Object.values(workoutCounts);
    
    // Create chart
    if (window.workoutChart) {
      window.workoutChart.destroy();
    }
    
    window.workoutChart = new Chart(workoutChartEl, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Workouts in Last 30 Days',
          data: data,
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(255, 206, 86, 0.8)',
            'rgba(75, 192, 192, 0.8)',
            'rgba(153, 102, 255, 0.8)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.parsed.y} workouts`;
              }
            }
          }
        }
      }
    });
  },

  // Render nutrition history chart
  renderNutritionChart: function() {
    const nutritionChartEl = document.getElementById('nutritionHistoryChart');
    if (!nutritionChartEl) return;
    
    // Data preparation
    const nutritionData = this.history.nutrition || [];
    if (nutritionData.length === 0) {
      nutritionChartEl.innerHTML = '<div class="no-data">No nutrition data available yet</div>';
      return;
    }
    
    // Get the most recent 7 days
    const recentData = nutritionData.slice(-7);
    
    // Prepare chart data
    const labels = recentData.map(entry => this.formatDate(entry.date));
    const caloriesData = recentData.map(entry => entry.calories || 0);
    const proteinData = recentData.map(entry => entry.protein || 0);
    const carbsData = recentData.map(entry => entry.carbs || 0);
    const fatData = recentData.map(entry => entry.fat || 0);
    
    // Create chart
    if (window.nutritionChart) {
      window.nutritionChart.destroy();
    }
    
    window.nutritionChart = new Chart(nutritionChartEl, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Calories',
            data: caloriesData,
            borderColor: '#E53935',
            backgroundColor: 'rgba(229, 57, 53, 0.1)',
            fill: true,
            yAxisID: 'calories'
          },
          {
            label: 'Protein (g)',
            data: proteinData,
            borderColor: '#43A047',
            backgroundColor: 'transparent',
            yAxisID: 'macros'
          },
          {
            label: 'Carbs (g)',
            data: carbsData,
            borderColor: '#1E88E5',
            backgroundColor: 'transparent',
            yAxisID: 'macros'
          },
          {
            label: 'Fat (g)',
            data: fatData,
            borderColor: '#FDD835',
            backgroundColor: 'transparent',
            yAxisID: 'macros'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          calories: {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: 'Calories'
            }
          },
          macros: {
            type: 'linear',
            position: 'right',
            title: {
              display: true,
              text: 'Grams'
            }
          }
        },
        plugins: {
          legend: {
            display: true
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        }
      }
    });
  },

  // Format date for display
  formatDate: function(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  // Get progress summary
  getProgressSummary: function() {
    // Weight change calculation
    let weightChange = 0;
    if (this.history.weight && this.history.weight.length >= 2) {
      const oldestWeight = this.history.weight[0].value;
      const newestWeight = this.history.weight[this.history.weight.length - 1].value;
      weightChange = newestWeight - oldestWeight;
    }
    
    // Workout consistency calculation
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const workoutsLast30Days = this.history.workouts.filter(entry => 
      new Date(entry.date) >= thirtyDaysAgo
    ).length;
    
    // Return summary
    return {
      weightChange: weightChange,
      weightChangeDirection: weightChange < 0 ? 'loss' : 'gain',
      workoutsLast30Days: workoutsLast30Days,
      workoutConsistency: (workoutsLast30Days / 30) * 100,
      measurementChanges: this.calculateMeasurementChanges()
    };
  },

  // Calculate measurement changes
  calculateMeasurementChanges: function() {
    if (!this.history.measurements || this.history.measurements.length < 2) {
      return {};
    }
    
    const oldest = this.history.measurements[0];
    const newest = this.history.measurements[this.history.measurements.length - 1];
    
    const changes = {};
    for (const key in newest) {
      if (key !== 'date' && oldest[key]) {
        changes[key] = newest[key] - oldest[key];
      }
    }
    
    return changes;
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
  window.ProgressTracker = ProgressTracker;
  ProgressTracker.initialize();
});

// If in Node.js environment, export the module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProgressTracker;
}
