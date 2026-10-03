
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
    this.setupRecipeEventListeners();
  }

  // Generate personalized recipes based on goals
  generatePersonalizedRecipes() {
    return [];
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
  calculateRecipeCost(_recipe) {
    return { note: 'Check prices at checkout.' };
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
      
      // Aggregate shopping list
      recipe.ingredients.forEach(ingredient => {
        const key = ingredient.name;
        if (plan.shoppingList.has(key)) {
          const existing = plan.shoppingList.get(key);
          existing.amount += ` + ${ingredient.amount}`;
                  } else {
          plan.shoppingList.set(key, {
            ...ingredient,
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
    this.recipes = [];
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
