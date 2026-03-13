
// Grok AI Agent for FitMunch app

const GrokAgent = {
  name: "Grok",
  capabilities: ["nutrition advice", "workout tips", "meal planning", "shopping recommendations"],
  context: {
    userPreferences: {},
    recentQueries: [],
    conversationHistory: []
  },
  isInitialized: false,

  async initialize() {
    console.log("Initializing Grok Agent...");
    try {
      // Simulate loading models and data
      await this.simulateLoading();
      this.isInitialized = true;
      console.log("Grok Agent initialized successfully");
      return true;
    } catch (error) {
      console.error("Error initializing Grok Agent:", error);
      return false;
    }
  },

  simulateLoading() {
    return new Promise(resolve => setTimeout(resolve, 1000));
  },

  async processQuery(query) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.context.recentQueries.push(query);

    // Keep history limited to last 10 queries
    if (this.context.recentQueries.length > 10) {
      this.context.recentQueries.shift();
    }

    // Process query based on content
    if (query.toLowerCase().includes("meal") || query.toLowerCase().includes("food") || query.toLowerCase().includes("diet")) {
      return this.generateNutritionResponse(query);
    } else if (query.toLowerCase().includes("workout") || query.toLowerCase().includes("exercise") || query.toLowerCase().includes("training")) {
      return this.generateWorkoutResponse(query);
    } else if (query.toLowerCase().includes("shop") || query.toLowerCase().includes("buy") || query.toLowerCase().includes("store")) {
      return this.generateShoppingResponse(query);
    } else {
      return this.generateGeneralResponse(query);
    }
  },

  generateNutritionResponse(query) {
    const responses = [
      "Based on your profile, I recommend increasing your protein intake to support your fitness goals.",
      "For your current activity level, you should aim for approximately 2000-2200 calories per day.",
      "Your meal plan looks well balanced, but you could add more vegetables for additional micronutrients.",
      "Consider timing your carbohydrate intake around your workouts for optimal energy levels.",
      "For weight management, focus on maintaining a slight caloric deficit of 300-500 calories per day."
    ];
    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      type: "nutrition",
      confidence: 0.85
    };
  },

  generateWorkoutResponse(query) {
    const responses = [
      "For your goals, I suggest focusing on compound movements like squats, deadlifts, and bench press.",
      "Adding 20-30 minutes of moderate cardio after your strength training can help with recovery and fat loss.",
      "Based on your schedule, a 4-day split routine might be more manageable than your current plan.",
      "Remember to incorporate rest days to allow proper recovery, especially after intense training sessions.",
      "Progressive overload is key - aim to increase either weight, reps, or sets gradually each week."
    ];
    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      type: "workout",
      confidence: 0.9
    };
  },

  generateShoppingResponse(query) {
    const responses = [
      "I've found the best deals on protein sources at Woolworths this week - chicken breast is on special.",
      "Based on your meal plan, here's an optimized shopping list that should cost approximately $85 for the week.",
      "Buying in bulk can save you around 15% on items like rice, oats, and frozen vegetables.",
      "Consider shopping at Aldi for basics and Woolworths for fresh produce based on current pricing trends.",
      "I've noticed you frequently buy pre-made meals - preparing these yourself could save approximately $40 weekly."
    ];
    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      type: "shopping",
      confidence: 0.8
    };
  },

  generateGeneralResponse(query) {
    const responses = [
      "I'm here to help with nutrition, workout planning, and shopping optimization. What specific area would you like guidance on?",
      "To give you more personalized advice, I'd need to know more about your fitness goals and preferences.",
      "I can analyze your current routine and suggest improvements based on efficiency and your specific goals.",
      "Would you like me to help you create a personalized plan for your fitness journey?",
      "I notice you haven't set specific goals in your profile. Setting clear, measurable goals can improve your results significantly."
    ];
    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      type: "general",
      confidence: 0.75
    };
  },

  setUserContext(userProfile) {
    this.context.userPreferences = {
      fitnessGoal: userProfile.goals?.description || "general fitness",
      dietType: userProfile.dietPreferences?.type || "balanced",
      calorieTarget: userProfile.goals?.calories || 2000,
      activityLevel: userProfile.goals?.activityPlan?.level || "Beginner",
      activityType: userProfile.goals?.activityPlan?.type || "gym",
      preferredTime: userProfile.goals?.activityPlan?.preferredTime || "Morning"
    };
    console.log("Grok agent - User context updated:", this.context.userPreferences);
    
    // Trigger app functions based on user preferences
    this.adaptToUserPreferences();
  },
  
  adaptToUserPreferences() {
    // Automatically optimize app based on user preferences
    if (this.context.userPreferences.activityLevel === 'Beginner') {
      console.log("Grok: Detected beginner user, enabling guided mode");
    }
    
    // If user prefers mobile, ensure mobile optimization
    if (window.isMobileDevice && window.isMobileDevice()) {
      if (window.optimizeForMobile) {
        window.optimizeForMobile();
      }
    }
  },

  generateInsight() {
    const insights = [
      "Based on your recent activity, you might benefit from increasing your protein intake slightly.",
      "I've noticed your workouts are mostly in the evening. Studies show morning workouts can boost metabolism throughout the day.",
      "Your meal patterns show irregular eating times, which might impact your energy levels and recovery.",
      "You're consistently hitting your step goals - great job maintaining that daily activity!",
      "Your shopping patterns indicate you could save about 20% by purchasing some items in bulk."
    ];
    return insights[Math.floor(Math.random() * insights.length)];
  },
  
  // Function registry for app integration
  functionRegistry: {},
  
  registerFunction(name, func) {
    if (typeof func === 'function') {
      this.functionRegistry[name] = func;
      console.log(`Grok agent: Registered function ${name}`);
      return true;
    }
    return false;
  },
  
  executeFunction(name, ...args) {
    if (name in this.functionRegistry) {
      try {
        console.log(`Grok agent: Executing function ${name}`);
        return this.functionRegistry[name](...args);
      } catch (error) {
        console.error(`Grok agent: Error executing ${name}:`, error);
        return null;
      }
    }
    console.warn(`Grok agent: Function ${name} not found in registry`);
    return null;
  },
  
  getRegisteredFunctions() {
    return Object.keys(this.functionRegistry);
  },
  
  // Enhanced capability assessment
  assessAppCapabilities() {
    const capabilities = {
      navigation: !!window.showSection,
      profileManagement: !!window.updateProfileDisplay && !!window.editProfile,
      mealPlanning: !!window.generateMealPlan,
      workoutPlanning: !!window.generateActivityPlan,
      foodLogging: !!window.showFoodSearch && !!window.updateFoodLogDisplay,
      shopping: !!window.updateShoppingList,
      mobileOptimization: !!window.optimizeForMobile
    };
    
    console.log("Grok agent: App capabilities assessment:", capabilities);
    return capabilities;
  }
};

// Make globally available
window.grokAgent = GrokAgent;
GrokAgent.initialize();

// If running in Node.js environment, export the module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GrokAgent };
}
