// FitMunch API Service
const fitMunchAPI = {
  // Nutrition data functions
  searchFoodNutrition: async function(query) {
    try {
      console.log(`Searching for food: ${query}`);
      // Simulate API call with mock data
      return [
        { name: `${query} (100g)`, calories: 180, protein: 5, carbs: 27, fat: 9 },
        { name: `${query} (organic)`, calories: 165, protein: 6, carbs: 25, fat: 8 },
        { name: `${query} (fortified)`, calories: 210, protein: 8, carbs: 30, fat: 10 }
      ];
    } catch (error) {
      console.error('Error searching for food:', error);
      throw error;
    }
  },

  getFoodDetails: async function(foodName) {
    try {
      console.log(`Getting details for: ${foodName}`);
      // Simulate API call with mock data
      return {
        name: foodName,
        calories: 180,
        protein: 5,
        carbs: 27,
        fat: 9,
        fiber: 3,
        sugar: 12,
        vitamins: ['A', 'C', 'D'],
        minerals: ['Calcium', 'Iron', 'Magnesium']
      };
    } catch (error) {
      console.error('Error getting food details:', error);
      throw error;
    }
  },

  // Recipe data functions
  searchRecipes: async function(query, diet = null, maxCalories = null) {
    try {
      console.log(`Searching for recipes: ${query}, diet: ${diet}, maxCalories: ${maxCalories}`);
      // Simulate API call with mock data
      return [
        { id: 1, name: `${query} Stir Fry`, calories: 450, prepTime: 25, servings: 4 },
        { id: 2, name: `Baked ${query}`, calories: 380, prepTime: 45, servings: 6 },
        { id: 3, name: `${query} Salad`, calories: 280, prepTime: 15, servings: 2 }
      ];
    } catch (error) {
      console.error('Error searching for recipes:', error);
      throw error;
    }
  },

  getRecipeDetails: async function(recipeId) {
    try {
      console.log(`Getting recipe details for ID: ${recipeId}`);
      // Simulate API call with mock data
      return {
        id: recipeId,
        name: `Recipe ${recipeId}`,
        calories: 450,
        protein: 25,
        carbs: 45,
        fat: 15,
        ingredients: [
          '2 cups ingredient 1',
          '1 tbsp ingredient 2',
          '3 medium ingredient 3'
        ],
        instructions: [
          'Preheat oven to 350°F',
          'Mix ingredients in a bowl',
          'Cook for 30 minutes'
        ],
        prepTime: 25,
        cookTime: 30,
        servings: 4
      };
    } catch (error) {
      console.error('Error getting recipe details:', error);
      throw error;
    }
  },

  // Exercise data functions
  searchExercises: async function(query, bodyPart = null, level = 'beginner') {
    try {
      console.log(`Searching for exercises: ${query}, bodyPart: ${bodyPart}, level: ${level}`);
      // Simulate API call with mock data
      return [
        { 
          id: 1, 
          name: `${bodyPart || query} Exercise 1`, 
          bodyPart: bodyPart || 'full body', 
          level: level,
          caloriesBurned: 150,
          duration: 20
        },
        { 
          id: 2, 
          name: `${bodyPart || query} Exercise 2`, 
          bodyPart: bodyPart || 'full body', 
          level: level,
          caloriesBurned: 180,
          duration: 25
        },
        { 
          id: 3, 
          name: `${bodyPart || query} Exercise 3`, 
          bodyPart: bodyPart || 'full body', 
          level: level,
          caloriesBurned: 200,
          duration: 30
        }
      ];
    } catch (error) {
      console.error('Error searching for exercises:', error);
      throw error;
    }
  },

  // Plan generation functions
  generateWorkoutPlan: async function(preferences) {
    try {
      console.log(`Generating workout plan with preferences:`, preferences);
      // Simulate API call with mock data
      const level = preferences.level || 'beginner';
      const focus = preferences.focus || 'strength';
      const days = preferences.days || 3;

      const workoutPlan = {
        level: level,
        focus: focus,
        daysPerWeek: days,
        plan: []
      };

      for (let i = 1; i <= days; i++) {
        let exercises = [];
        switch (focus) {
          case 'strength':
            exercises = [
              { name: `Compound Exercise ${i}.1`, sets: 4, reps: 8, rest: 90 },
              { name: `Isolation Exercise ${i}.2`, sets: 3, reps: 12, rest: 60 },
              { name: `Core Exercise ${i}.3`, sets: 3, reps: 15, rest: 45 }
            ];
            break;
          case 'cardio':
            exercises = [
              { name: `Cardio Exercise ${i}.1`, duration: 20, intensity: 'medium' },
              { name: `HIIT Exercise ${i}.2`, duration: 15, intensity: 'high' },
              { name: `Cool Down ${i}.3`, duration: 10, intensity: 'low' }
            ];
            break;
          default:
            exercises = [
              { name: `Full Body Exercise ${i}.1`, sets: 3, reps: 10, rest: 60 },
              { name: `Cardio Exercise ${i}.2`, duration: 15, intensity: 'medium' },
              { name: `Flexibility Exercise ${i}.3`, duration: 10, intensity: 'low' }
            ];
        }

        workoutPlan.plan.push({
          day: i,
          focus: (i % 2 === 0) ? 'Upper Body' : 'Lower Body',
          exercises: exercises
        });
      }

      return workoutPlan;
    } catch (error) {
      console.error('Error generating workout plan:', error);
      throw error;
    }
  },

  generateMealPlan: async function(preferences) {
    try {
      console.log(`Generating meal plan with preferences:`, preferences);
      // Simulate API call with mock data
      const diet = preferences.diet || 'balanced';
      const calories = preferences.calories || 2000;
      const meals = preferences.mealsPerDay || 3;

      const mealPlan = {
        diet: diet,
        calories: calories,
        mealsPerDay: meals,
        plan: []
      };

      const mealTypes = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Snack'];

      for (let i = 0; i < meals; i++) {
        const mealCalories = Math.floor(calories / meals);

        mealPlan.plan.push({
          type: mealTypes[i],
          calories: mealCalories,
          macros: {
            protein: Math.floor(mealCalories * 0.3 / 4), // 30% protein (4 calories per gram)
            carbs: Math.floor(mealCalories * 0.5 / 4),   // 50% carbs (4 calories per gram)
            fat: Math.floor(mealCalories * 0.2 / 9)      // 20% fat (9 calories per gram)
          },
          foods: [
            `Main ${mealTypes[i]} Item`,
            `Side ${mealTypes[i]} Item`,
            `${diet.charAt(0).toUpperCase() + diet.slice(1)} Option`
          ]
        });
      }

      return mealPlan;
    } catch (error) {
      console.error('Error generating meal plan:', error);
      throw error;
    }
  },

  // Price comparison functions
  getProductPrices: async function(productName) {
    try {
      console.log(`Getting prices for product: ${productName}`);
      // Simulate API call with mock data
      return [
        { store: 'Supermarket A', price: 3.99, unit: '500g' },
        { store: 'Supermarket B', price: 4.49, unit: '500g' },
        { store: 'Supermarket C', price: 3.79, unit: '500g' },
        { store: 'Online Store', price: 3.29, unit: '500g' }
      ];
    } catch (error) {
      console.error('Error getting product prices:', error);
      throw error;
    }
  }
};

// If running in Node.js environment, export the module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = fitMunchAPI;
}