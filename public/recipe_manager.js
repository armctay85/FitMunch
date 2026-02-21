
// FitMunch Recipe Manager
class RecipeManager {
  constructor() {
    this.recipes = [];
    this.favoriteRecipes = [];
    this.recipeCategories = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Smoothies', 'Protein Shakes'];
    this.dietaryFilters = ['Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Gluten-Free', 'Dairy-Free'];
    this.difficultyLevels = ['Easy', 'Medium', 'Hard'];
    this.initialize();
  }

  initialize() {
    console.log("Initializing Recipe Manager...");
    this.loadSampleRecipes();
    this.setupRecipeEventListeners();
  }

  // Generate personalized recipes based on goals
  generatePersonalizedRecipes(goalType = 'Maintenance', dietaryRestrictions = []) {
    const recipes = [];
    const calorieTargets = {
      'Weight Loss': { breakfast: 300, lunch: 400, dinner: 500, snack: 200 },
      'Maintenance': { breakfast: 400, lunch: 500, dinner: 600, snack: 300 },
      'Muscle Gain': { breakfast: 500, lunch: 600, dinner: 700, snack: 400 }
    };

    const target = calorieTargets[goalType] || calorieTargets['Maintenance'];

    // Breakfast recipes
    recipes.push({
      id: 'recipe_001',
      name: 'Protein Power Oatmeal',
      category: 'Breakfast',
      calories: target.breakfast,
      protein: Math.round(target.breakfast * 0.25 / 4),
      carbs: Math.round(target.breakfast * 0.45 / 4),
      fat: Math.round(target.breakfast * 0.30 / 9),
      prepTime: '10 minutes',
      difficulty: 'Easy',
      servings: 1,
      ingredients: [
        { name: 'Rolled oats', amount: '1/2 cup', price: 0.50 },
        { name: 'Protein powder', amount: '1 scoop', price: 1.20 },
        { name: 'Banana', amount: '1 medium', price: 0.80 },
        { name: 'Almond milk', amount: '1 cup', price: 0.60 },
        { name: 'Chia seeds', amount: '1 tbsp', price: 0.40 }
      ],
      instructions: [
        'Heat almond milk in a saucepan over medium heat',
        'Add rolled oats and cook for 5 minutes, stirring occasionally',
        'Remove from heat and stir in protein powder',
        'Top with sliced banana and chia seeds',
        'Serve warm and enjoy!'
      ],
      nutrition: {
        fiber: 8,
        sugar: 15,
        sodium: 120
      },
      tags: ['High Protein', 'Breakfast', 'Quick'],
      dietary: dietaryRestrictions.includes('Vegan') ? ['Vegan'] : ['Vegetarian']
    });

    // Lunch recipes
    recipes.push({
      id: 'recipe_002',
      name: 'Quinoa Power Bowl',
      category: 'Lunch',
      calories: target.lunch,
      protein: Math.round(target.lunch * 0.30 / 4),
      carbs: Math.round(target.lunch * 0.40 / 4),
      fat: Math.round(target.lunch * 0.30 / 9),
      prepTime: '20 minutes',
      difficulty: 'Medium',
      servings: 1,
      ingredients: [
        { name: 'Quinoa', amount: '1/2 cup dry', price: 1.20 },
        { name: 'Chicken breast', amount: '150g', price: 4.50 },
        { name: 'Sweet potato', amount: '1 medium', price: 1.00 },
        { name: 'Spinach', amount: '2 cups', price: 1.50 },
        { name: 'Avocado', amount: '1/2 medium', price: 1.25 },
        { name: 'Olive oil', amount: '1 tbsp', price: 0.30 }
      ],
      instructions: [
        'Cook quinoa according to package instructions',
        'Season and grill chicken breast until cooked through',
        'Roast diced sweet potato at 400°F for 25 minutes',
        'Massage spinach with a little olive oil',
        'Assemble bowl with quinoa, chicken, sweet potato, spinach, and avocado',
        'Drizzle with remaining olive oil and season to taste'
      ],
      nutrition: {
        fiber: 12,
        sugar: 8,
        sodium: 200
      },
      tags: ['Complete Meal', 'High Protein', 'Balanced'],
      dietary: ['Gluten-Free']
    });

    // Smart recipe suggestions based on available ingredients
    return this.filterRecipesByDietaryRestrictions(recipes, dietaryRestrictions);
  }

  // Recipe search and filtering
  searchRecipes(query, filters = {}) {
    let results = [...this.recipes];

    // Text search
    if (query) {
      results = results.filter(recipe => 
        recipe.name.toLowerCase().includes(query.toLowerCase()) ||
        recipe.ingredients.some(ing => ing.name.toLowerCase().includes(query.toLowerCase())) ||
        recipe.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
      );
    }

    // Apply filters
    if (filters.category) {
      results = results.filter(recipe => recipe.category === filters.category);
    }
    if (filters.maxCalories) {
      results = results.filter(recipe => recipe.calories <= filters.maxCalories);
    }
    if (filters.difficulty) {
      results = results.filter(recipe => recipe.difficulty === filters.difficulty);
    }
    if (filters.maxPrepTime) {
      const maxMinutes = parseInt(filters.maxPrepTime);
      results = results.filter(recipe => parseInt(recipe.prepTime) <= maxMinutes);
    }
    if (filters.dietary && filters.dietary.length > 0) {
      results = results.filter(recipe => 
        filters.dietary.every(diet => recipe.dietary.includes(diet))
      );
    }

    return results;
  }

  // Recipe cost calculator
  calculateRecipeCost(recipe) {
    const totalCost = recipe.ingredients.reduce((sum, ingredient) => sum + ingredient.price, 0);
    return {
      totalCost: totalCost.toFixed(2),
      costPerServing: (totalCost / recipe.servings).toFixed(2),
      costPerCalorie: (totalCost / recipe.calories).toFixed(4)
    };
  }

  // Meal prep suggestions
  generateMealPrepPlan(recipes, days = 7) {
    const plan = {
      recipes: recipes,
      totalCost: 0,
      shoppingList: new Map(),
      prepInstructions: []
    };

    recipes.forEach(recipe => {
      const multiplier = Math.ceil(days / recipe.servings);
      const cost = this.calculateRecipeCost(recipe);
      plan.totalCost += parseFloat(cost.totalCost) * multiplier;

      // Aggregate shopping list
      recipe.ingredients.forEach(ingredient => {
        const key = ingredient.name;
        if (plan.shoppingList.has(key)) {
          const existing = plan.shoppingList.get(key);
          existing.amount += ` + ${ingredient.amount}`;
          existing.totalPrice += ingredient.price * multiplier;
        } else {
          plan.shoppingList.set(key, {
            ...ingredient,
            totalPrice: ingredient.price * multiplier
          });
        }
      });

      // Add prep instructions
      plan.prepInstructions.push({
        recipe: recipe.name,
        batchSize: `${multiplier} servings`,
        tips: [
          `This recipe can be stored for up to ${recipe.storageTime || '3-4 days'} in the refrigerator`,
          `Consider preparing ingredients in bulk to save time`
        ]
      });
    });

    return plan;
  }

  // Nutritional analysis
  analyzeNutrition(recipes) {
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sugar: 0,
      sodium: 0
    };

    recipes.forEach(recipe => {
      totals.calories += recipe.calories;
      totals.protein += recipe.protein;
      totals.carbs += recipe.carbs;
      totals.fat += recipe.fat;
      totals.fiber += recipe.nutrition.fiber;
      totals.sugar += recipe.nutrition.sugar;
      totals.sodium += recipe.nutrition.sodium;
    });

    return {
      daily: totals,
      percentages: {
        proteinPercent: Math.round((totals.protein * 4 / totals.calories) * 100),
        carbsPercent: Math.round((totals.carbs * 4 / totals.calories) * 100),
        fatPercent: Math.round((totals.fat * 9 / totals.calories) * 100)
      },
      recommendations: this.getNutritionalRecommendations(totals)
    };
  }

  getNutritionalRecommendations(totals) {
    const recommendations = [];
    
    if (totals.protein < 80) {
      recommendations.push("Consider adding more protein-rich foods like lean meats, eggs, or legumes");
    }
    if (totals.fiber < 25) {
      recommendations.push("Increase fiber intake with more vegetables, fruits, and whole grains");
    }
    if (totals.sodium > 2300) {
      recommendations.push("Try to reduce sodium by using herbs and spices instead of salt");
    }
    
    return recommendations;
  }

  filterRecipesByDietaryRestrictions(recipes, restrictions) {
    if (!restrictions || restrictions.length === 0) return recipes;
    
    return recipes.filter(recipe => 
      restrictions.every(restriction => recipe.dietary.includes(restriction))
    );
  }

  loadSampleRecipes() {
    // Load sample recipes for demonstration
    this.recipes = this.generatePersonalizedRecipes('Maintenance', []);
  }

  setupRecipeEventListeners() {
    // Set up event listeners for recipe interactions
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('recipe-favorite-btn')) {
        this.toggleFavorite(e.target.dataset.recipeId);
      }
      if (e.target.classList.contains('recipe-cook-btn')) {
        this.markAsCooked(e.target.dataset.recipeId);
      }
    });
  }

  toggleFavorite(recipeId) {
    const index = this.favoriteRecipes.findIndex(id => id === recipeId);
    if (index > -1) {
      this.favoriteRecipes.splice(index, 1);
    } else {
      this.favoriteRecipes.push(recipeId);
    }
    this.saveFavorites();
  }

  markAsCooked(recipeId) {
    const cookedRecipes = JSON.parse(localStorage.getItem('fitmunch_cooked_recipes') || '[]');
    if (!cookedRecipes.includes(recipeId)) {
      cookedRecipes.push(recipeId);
      localStorage.setItem('fitmunch_cooked_recipes', JSON.stringify(cookedRecipes));
    }
  }

  saveFavorites() {
    localStorage.setItem('fitmunch_favorite_recipes', JSON.stringify(this.favoriteRecipes));
  }
}

// Initialize Recipe Manager
if (typeof window !== 'undefined') {
  window.recipeManager = new RecipeManager();
}
