// AI-Powered Recommendations Engine for FitMunch
class AIRecommendations {
  constructor() {
    this.userProfile = null;
    this.userHistory = [];
    this.recommendations = {};
  }

  // Initialize with user data
  initialize(userProfile, userHistory = []) {
    this.userProfile = userProfile;
    this.userHistory = userHistory;
  }

  // Generate personalized meal recommendations
  generateMealRecommendations() {
    const { goals, dietaryPreferences, allergies } = this.userProfile;
    const { targetCalories, targetProtein, targetCarbs, targetFat } = goals;

    // Calculate recommended meals based on goals
    const recommendations = [];

    // Breakfast recommendations
    const breakfastCalories = Math.round(targetCalories * 0.25);
    recommendations.push({
      meal: 'breakfast',
      suggestion: this.findOptimalMeal(breakfastCalories, targetProtein * 0.25, dietaryPreferences, allergies),
      calories: breakfastCalories,
      timing: '7:00 AM - 9:00 AM',
      reason: 'Jumpstart your metabolism with a protein-rich breakfast',
    });

    // Lunch recommendations
    const lunchCalories = Math.round(targetCalories * 0.35);
    recommendations.push({
      meal: 'lunch',
      suggestion: this.findOptimalMeal(lunchCalories, targetProtein * 0.35, dietaryPreferences, allergies),
      calories: lunchCalories,
      timing: '12:00 PM - 2:00 PM',
      reason: 'Maintain energy levels throughout the day',
    });

    // Dinner recommendations
    const dinnerCalories = Math.round(targetCalories * 0.30);
    recommendations.push({
      meal: 'dinner',
      suggestion: this.findOptimalMeal(dinnerCalories, targetProtein * 0.30, dietaryPreferences, allergies),
      calories: dinnerCalories,
      timing: '6:00 PM - 8:00 PM',
      reason: 'Support muscle recovery and sleep quality',
    });

    // Snack recommendations
    const snackCalories = targetCalories - (breakfastCalories + lunchCalories + dinnerCalories);
    recommendations.push({
      meal: 'snacks',
      suggestion: this.findOptimalMeal(snackCalories, targetProtein * 0.10, dietaryPreferences, allergies),
      calories: snackCalories,
      timing: 'Between meals',
      reason: 'Prevent hunger and maintain steady energy',
    });

    return recommendations;
  }

  findOptimalMeal(targetCalories, targetProtein, preferences, allergies) {
    // Simplified meal database (in production, this would query a real database)
    const mealDatabase = [
      { name: 'Grilled Chicken Salad', calories: 350, protein: 35, type: 'high-protein', tags: ['gluten-free', 'dairy-free'] },
      { name: 'Salmon with Quinoa', calories: 450, protein: 38, type: 'balanced', tags: ['gluten-free', 'omega-3'] },
      { name: 'Greek Yogurt Bowl', calories: 250, protein: 20, type: 'breakfast', tags: ['vegetarian', 'probiotic'] },
      { name: 'Protein Smoothie', calories: 280, protein: 25, type: 'snack', tags: ['quick', 'portable'] },
      { name: 'Turkey Wrap', calories: 380, protein: 28, type: 'lunch', tags: ['portable', 'balanced'] },
    ];

    // Filter by preferences and allergies
    const filteredMeals = mealDatabase.filter(meal => {
      // Check allergies
      if (allergies && allergies.some(allergy => meal.tags.includes(allergy.toLowerCase()))) {
        return false;
      }
      // Check preferences
      if (preferences && preferences.length > 0) {
        return preferences.some(pref => meal.tags.includes(pref.toLowerCase()));
      }
      return true;
    });

    // Find closest match to target calories and protein
    const bestMatch = filteredMeals.reduce((best, meal) => {
      const caloriesDiff = Math.abs(meal.calories - targetCalories);
      const proteinDiff = Math.abs(meal.protein - targetProtein);
      const currentScore = caloriesDiff + (proteinDiff * 2); // Weight protein higher

      if (!best || currentScore < best.score) {
        return { meal, score: currentScore };
      }
      return best;
    }, null);

    return bestMatch ? bestMatch.meal : { name: 'Custom Meal', calories: targetCalories, protein: targetProtein };
  }

  // Generate workout recommendations
  generateWorkoutRecommendations() {
    const { fitnessGoal, activityLevel, workoutHistory } = this.userProfile;
    
    const recommendations = [];

    if (fitnessGoal === 'weight_loss') {
      recommendations.push({
        type: 'HIIT',
        duration: 30,
        frequency: 4,
        intensity: 'high',
        reason: 'High-intensity intervals maximize calorie burn',
        benefits: ['Burns fat efficiently', 'Boosts metabolism', 'Time-efficient'],
      });
      recommendations.push({
        type: 'Cardio',
        duration: 45,
        frequency: 3,
        intensity: 'moderate',
        reason: 'Steady-state cardio improves endurance',
        benefits: ['Sustainable fat loss', 'Cardiovascular health', 'Recovery-friendly'],
      });
    } else if (fitnessGoal === 'muscle_gain') {
      recommendations.push({
        type: 'Strength Training',
        duration: 60,
        frequency: 5,
        intensity: 'high',
        reason: 'Progressive overload builds muscle mass',
        benefits: ['Increases strength', 'Builds muscle', 'Boosts metabolism'],
      });
      recommendations.push({
        type: 'Compound Exercises',
        duration: 45,
        frequency: 4,
        intensity: 'high',
        reason: 'Multi-joint movements maximize growth',
        benefits: ['Efficient muscle building', 'Functional strength', 'Hormone optimization'],
      });
    } else {
      recommendations.push({
        type: 'Mixed Training',
        duration: 45,
        frequency: 4,
        intensity: 'moderate',
        reason: 'Balanced approach for overall fitness',
        benefits: ['Maintains muscle', 'Improves endurance', 'Prevents plateaus'],
      });
    }

    return recommendations;
  }

  // Generate hydration recommendations
  generateHydrationRecommendations() {
    const { weight, activityLevel } = this.userProfile;
    
    // Base calculation: 35ml per kg of body weight
    let baseHydration = weight * 35;

    // Adjust for activity level
    const activityMultipliers = {
      sedentary: 1.0,
      light: 1.1,
      moderate: 1.2,
      active: 1.3,
      veryActive: 1.4,
    };

    const multiplier = activityMultipliers[activityLevel] || 1.0;
    const recommendedHydration = Math.round(baseHydration * multiplier);

    return {
      dailyTarget: recommendedHydration,
      perMeal: Math.round(recommendedHydration / 6),
      beforeWorkout: 500,
      duringWorkout: 250,
      afterWorkout: 500,
      tips: [
        'Start your day with a glass of water',
        'Drink water before meals',
        'Hydrate before, during, and after workouts',
        'Monitor urine color (pale yellow is ideal)',
      ],
    };
  }

  // Analyze user progress and provide insights
  analyzeProgress(progressData) {
    const insights = [];

    // Weight trend analysis
    if (progressData.weight && progressData.weight.length > 1) {
      const weightTrend = this.calculateTrend(progressData.weight);
      insights.push({
        type: 'weight',
        trend: weightTrend,
        message: this.getWeightInsight(weightTrend, this.userProfile.fitnessGoal),
      });
    }

    // Workout consistency analysis
    if (progressData.workouts && progressData.workouts.length > 0) {
      const consistency = this.calculateConsistency(progressData.workouts);
      insights.push({
        type: 'consistency',
        value: consistency,
        message: this.getConsistencyInsight(consistency),
      });
    }

    // Nutrition adherence analysis
    if (progressData.meals && progressData.meals.length > 0) {
      const adherence = this.calculateNutritionAdherence(progressData.meals);
      insights.push({
        type: 'nutrition',
        value: adherence,
        message: this.getNutritionInsight(adherence),
      });
    }

    return insights;
  }

  calculateTrend(data) {
    if (data.length < 2) return 'stable';
    
    const recentValues = data.slice(-7); // Last 7 days
    const average = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
    const firstValue = recentValues[0];
    const lastValue = recentValues[recentValues.length - 1];

    const change = ((lastValue - firstValue) / firstValue) * 100;

    if (change > 2) return 'increasing';
    if (change < -2) return 'decreasing';
    return 'stable';
  }

  calculateConsistency(workouts) {
    const weeklyGoal = this.userProfile.goals?.workoutFrequency || 3;
    const recentWorkouts = workouts.filter(w => {
      const workoutDate = new Date(w.date);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return workoutDate >= weekAgo;
    });

    return Math.min((recentWorkouts.length / weeklyGoal) * 100, 100);
  }

  calculateNutritionAdherence(meals) {
    const targetCalories = this.userProfile.goals?.targetCalories || 2000;
    const dailyLogs = {};

    meals.forEach(meal => {
      const date = new Date(meal.date).toDateString();
      if (!dailyLogs[date]) {
        dailyLogs[date] = 0;
      }
      dailyLogs[date] += meal.calories;
    });

    const adherenceDays = Object.values(dailyLogs).filter(calories => {
      const diff = Math.abs(calories - targetCalories);
      return diff / targetCalories < 0.15; // Within 15% of target
    }).length;

    return (adherenceDays / Object.keys(dailyLogs).length) * 100;
  }

  getWeightInsight(trend, goal) {
    if (goal === 'weight_loss') {
      if (trend === 'decreasing') return '🎉 Great progress! Your weight is trending down consistently.';
      if (trend === 'stable') return '⚖️ Weight is stable. Consider adjusting calories or increasing activity.';
      return '⚠️ Weight is increasing. Review your nutrition and activity levels.';
    } else if (goal === 'muscle_gain') {
      if (trend === 'increasing') return '💪 Excellent! Weight is increasing as expected for muscle gain.';
      if (trend === 'stable') return '⚖️ Weight is stable. Consider increasing calories and protein.';
      return '⚠️ Weight is decreasing. Increase caloric intake to support muscle growth.';
    }
    return '✅ Weight is stable and healthy.';
  }

  getConsistencyInsight(consistency) {
    if (consistency >= 90) return '🌟 Outstanding workout consistency! Keep it up!';
    if (consistency >= 70) return '✅ Good workout routine. Try to maintain this consistency.';
    if (consistency >= 50) return '⚠️ Moderate consistency. Aim for more regular workouts.';
    return '🔴 Low workout frequency. Schedule regular workout times to build a habit.';
  }

  getNutritionInsight(adherence) {
    if (adherence >= 85) return '🎯 Excellent nutrition tracking! You\'re hitting your targets consistently.';
    if (adherence >= 70) return '✅ Good nutrition habits. Keep tracking to maintain progress.';
    if (adherence >= 50) return '⚠️ Room for improvement. Focus on consistent meal planning.';
    return '🔴 Nutrition tracking needs attention. Plan meals in advance for better results.';
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.AIRecommendations = AIRecommendations;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIRecommendations;
}
