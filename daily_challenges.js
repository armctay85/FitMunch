
// FitMunch Daily Challenges
// Manages daily challenges and streaks to boost user engagement and retention

class DailyChallenges {
  constructor() {
    this.initialized = false;
    this.challenges = [];
    this.userChallenges = [];
    this.currentStreak = 0;
    this.longestStreak = 0;
    this.lastCompletedDate = null;
    this.todaysChallenges = [];
    this.challengeCategories = ['nutrition', 'fitness', 'mindfulness', 'hydration'];
    this.storageKeys = {
      challenges: 'fitmunch_user_challenges',
      streak: 'fitmunch_challenge_streak',
      longest: 'fitmunch_longest_streak',
      lastCompleted: 'fitmunch_last_completed',
      history: 'fitmunch_challenge_history'
    };
    this.listeners = [];
  }

  // Initialize the challenge system
  async initialize() {
    if (this.initialized) {
      console.log("Daily challenges already initialized");
      return true;
    }

    console.log("Initializing daily challenges...");
    
    try {
      // Set up default challenges
      this.setupDefaultChallenges();
      
      // Load user data
      this.loadUserData();
      
      // Generate today's challenges if needed
      if (this.todaysChallenges.length === 0) {
        this.generateTodaysChallenges();
      }
      
      // Update streak if needed
      this.updateStreak();
      
      this.initialized = true;
      this.notifyListeners({type: 'init', success: true});
      console.log("Daily challenges initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize daily challenges:", error);
      this.notifyListeners({type: 'init', success: false, error: error.message});
      return false;
    }
  }

  // Set up default challenges
  setupDefaultChallenges() {
    this.challenges = [
      // Nutrition challenges
      {
        id: 'log_all_meals',
        category: 'nutrition',
        title: 'Log All Meals',
        description: 'Log breakfast, lunch, dinner, and snacks today',
        points: 50,
        difficulty: 'medium',
        verification: 'auto'
      },
      {
        id: 'eat_veggies',
        category: 'nutrition',
        title: 'Vegetable Variety',
        description: 'Include at least 3 different vegetables in your meals today',
        points: 30,
        difficulty: 'easy',
        verification: 'self'
      },
      {
        id: 'protein_goal',
        category: 'nutrition',
        title: 'Protein Power',
        description: 'Meet your daily protein goal',
        points: 40,
        difficulty: 'medium',
        verification: 'auto'
      },
      {
        id: 'no_added_sugar',
        category: 'nutrition',
        title: 'Sugar Detox',
        description: 'Avoid foods with added sugar today',
        points: 60,
        difficulty: 'hard',
        verification: 'self'
      },
      {
        id: 'meal_prep',
        category: 'nutrition',
        title: 'Meal Planner',
        description: 'Plan your meals for the next 3 days',
        points: 50,
        difficulty: 'medium',
        verification: 'auto'
      },
      
      // Fitness challenges
      {
        id: 'complete_workout',
        category: 'fitness',
        title: 'Workout Warrior',
        description: 'Complete a full workout session',
        points: 50,
        difficulty: 'medium',
        verification: 'auto'
      },
      {
        id: 'steps_goal',
        category: 'fitness',
        title: 'Step Master',
        description: 'Reach your daily step goal',
        points: 40,
        difficulty: 'medium',
        verification: 'auto'
      },
      {
        id: 'morning_stretch',
        category: 'fitness',
        title: 'Morning Stretches',
        description: 'Do 5 minutes of stretching in the morning',
        points: 20,
        difficulty: 'easy',
        verification: 'self'
      },
      {
        id: 'strength_training',
        category: 'fitness',
        title: 'Strength Builder',
        description: 'Complete a strength training session',
        points: 40,
        difficulty: 'medium',
        verification: 'auto'
      },
      {
        id: 'cardio_session',
        category: 'fitness',
        title: 'Cardio Boost',
        description: 'Do at least 20 minutes of cardio exercise',
        points: 40,
        difficulty: 'medium',
        verification: 'auto'
      },
      
      // Mindfulness challenges
      {
        id: 'meditation',
        category: 'mindfulness',
        title: 'Mindful Moment',
        description: 'Meditate for at least 5 minutes',
        points: 30,
        difficulty: 'easy',
        verification: 'self'
      },
      {
        id: 'sleep_well',
        category: 'mindfulness',
        title: 'Quality Sleep',
        description: 'Get at least 7 hours of sleep',
        points: 40,
        difficulty: 'medium',
        verification: 'self'
      },
      {
        id: 'digital_detox',
        category: 'mindfulness',
        title: 'Digital Detox',
        description: 'Take a 2-hour break from screens (except FitMunch!)',
        points: 30,
        difficulty: 'medium',
        verification: 'self'
      },
      
      // Hydration challenges
      {
        id: 'water_intake',
        category: 'hydration',
        title: 'Hydration Hero',
        description: 'Drink at least 8 glasses of water',
        points: 30,
        difficulty: 'easy',
        verification: 'auto'
      },
      {
        id: 'morning_water',
        category: 'hydration',
        title: 'Morning Hydration',
        description: 'Drink a glass of water right after waking up',
        points: 20,
        difficulty: 'easy',
        verification: 'self'
      }
    ];

    console.log(`Set up ${this.challenges.length} default challenges`);
  }

  // Load user challenge data
  loadUserData() {
    try {
      // Load user challenges
      const userChallengesStr = localStorage.getItem(this.storageKeys.challenges);
      if (userChallengesStr) {
        this.userChallenges = JSON.parse(userChallengesStr);
      }
      
      // Load today's challenges
      const today = this.getDateString();
      this.todaysChallenges = this.userChallenges.filter(c => c.date === today);
      
      // Load streak data
      this.currentStreak = parseInt(localStorage.getItem(this.storageKeys.streak) || '0');
      this.longestStreak = parseInt(localStorage.getItem(this.storageKeys.longest) || '0');
      
      // Load last completed date
      const lastCompletedStr = localStorage.getItem(this.storageKeys.lastCompleted);
      if (lastCompletedStr) {
        this.lastCompletedDate = lastCompletedStr;
      }
      
      console.log(`Loaded user challenge data: ${this.todaysChallenges.length} challenges for today, streak: ${this.currentStreak}`);
    } catch (error) {
      console.error("Error loading user challenge data:", error);
      
      // Reset to defaults
      this.userChallenges = [];
      this.todaysChallenges = [];
      this.currentStreak = 0;
      this.longestStreak = 0;
      this.lastCompletedDate = null;
    }
  }

  // Generate today's challenges
  generateTodaysChallenges() {
    const today = this.getDateString();
    
    // Check if we already have challenges for today
    if (this.todaysChallenges.length > 0) {
      console.log("Today's challenges already generated");
      return this.todaysChallenges;
    }
    
    console.log("Generating today's challenges...");
    
    try {
      const numChallenges = 3; // Number of daily challenges
      this.todaysChallenges = [];
      
      // Select challenges from different categories
      for (const category of this.challengeCategories) {
        const categoryChallenges = this.challenges.filter(c => c.category === category);
        
        if (categoryChallenges.length > 0) {
          // Randomly select one challenge from each category
          const randomIndex = Math.floor(Math.random() * categoryChallenges.length);
          const challenge = categoryChallenges[randomIndex];
          
          // Create user challenge
          const userChallenge = {
            id: challenge.id,
            date: today,
            title: challenge.title,
            description: challenge.description,
            category: challenge.category,
            points: challenge.points,
            difficulty: challenge.difficulty,
            verification: challenge.verification,
            completed: false,
            completedTimestamp: null
          };
          
          this.todaysChallenges.push(userChallenge);
          
          // Stop when we have enough challenges
          if (this.todaysChallenges.length >= numChallenges) {
            break;
          }
        }
      }
      
      // If we still need more challenges, add randomly from any category
      while (this.todaysChallenges.length < numChallenges) {
        const remainingChallenges = this.challenges.filter(c => 
          !this.todaysChallenges.some(tc => tc.id === c.id)
        );
        
        if (remainingChallenges.length === 0) {
          break;
        }
        
        const randomIndex = Math.floor(Math.random() * remainingChallenges.length);
        const challenge = remainingChallenges[randomIndex];
        
        // Create user challenge
        const userChallenge = {
          id: challenge.id,
          date: today,
          title: challenge.title,
          description: challenge.description,
          category: challenge.category,
          points: challenge.points,
          difficulty: challenge.difficulty,
          verification: challenge.verification,
          completed: false,
          completedTimestamp: null
        };
        
        this.todaysChallenges.push(userChallenge);
      }
      
      // Save to user challenges
      this.userChallenges = this.userChallenges.filter(c => c.date !== today);
      this.userChallenges.push(...this.todaysChallenges);
      
      // Save to local storage
      this.saveUserChallenges();
      
      console.log(`Generated ${this.todaysChallenges.length} challenges for today`);
      
      // Notify listeners
      this.notifyListeners({
        type: 'challenges_generated',
        challenges: this.todaysChallenges
      });
      
      return this.todaysChallenges;
    } catch (error) {
      console.error("Error generating today's challenges:", error);
      return [];
    }
  }

  // Get today's challenges
  getTodaysChallenges() {
    if (!this.initialized) {
      this.initialize();
    }
    
    if (this.todaysChallenges.length === 0) {
      this.generateTodaysChallenges();
    }
    
    return this.todaysChallenges;
  }

  // Complete a challenge
  completeChallenge(challengeId) {
    if (!this.initialized) {
      this.initialize();
    }
    
    try {
      // Find the challenge in today's challenges
      const today = this.getDateString();
      const challenge = this.todaysChallenges.find(c => c.id === challengeId && c.date === today);
      
      if (!challenge) {
        console.error(`Challenge not found: ${challengeId}`);
        return false;
      }
      
      if (challenge.completed) {
        console.log(`Challenge already completed: ${challengeId}`);
        return true;
      }
      
      // Mark as completed
      challenge.completed = true;
      challenge.completedTimestamp = new Date().toISOString();
      
      // Update the challenge in the main array
      const index = this.userChallenges.findIndex(c => c.id === challengeId && c.date === today);
      if (index !== -1) {
        this.userChallenges[index] = challenge;
      }
      
      // Save changes
      this.saveUserChallenges();
      
      // Update streak
      this.updateStreak();
      
      // Record in history
      this.recordChallengeCompletion(challenge);
      
      // Notify listeners
      this.notifyListeners({
        type: 'challenge_completed',
        challenge: challenge
      });
      
      console.log(`Challenge completed: ${challenge.title}`);
      
      return true;
    } catch (error) {
      console.error("Error completing challenge:", error);
      return false;
    }
  }

  // Uncomplete a challenge (for testing)
  uncompleteChallenge(challengeId) {
    if (!this.initialized) {
      this.initialize();
    }
    
    try {
      // Find the challenge in today's challenges
      const today = this.getDateString();
      const challenge = this.todaysChallenges.find(c => c.id === challengeId && c.date === today);
      
      if (!challenge) {
        console.error(`Challenge not found: ${challengeId}`);
        return false;
      }
      
      if (!challenge.completed) {
        console.log(`Challenge already not completed: ${challengeId}`);
        return true;
      }
      
      // Mark as not completed
      challenge.completed = false;
      challenge.completedTimestamp = null;
      
      // Update the challenge in the main array
      const index = this.userChallenges.findIndex(c => c.id === challengeId && c.date === today);
      if (index !== -1) {
        this.userChallenges[index] = challenge;
      }
      
      // Save changes
      this.saveUserChallenges();
      
      // Update streak
      this.updateStreak();
      
      // Notify listeners
      this.notifyListeners({
        type: 'challenge_uncompleted',
        challenge: challenge
      });
      
      console.log(`Challenge uncompleted: ${challenge.title}`);
      
      return true;
    } catch (error) {
      console.error("Error uncompleting challenge:", error);
      return false;
    }
  }

  // Update streaks
  updateStreak() {
    try {
      const today = this.getDateString();
      const yesterday = this.getDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
      
      // Check if any challenges completed today
      const anyCompletedToday = this.todaysChallenges.some(c => c.completed);
      
      if (anyCompletedToday) {
        // If last completed was yesterday, increment streak
        if (this.lastCompletedDate === yesterday) {
          this.currentStreak++;
        } 
        // If last completed was not yesterday (or null), reset streak to 1
        else if (this.lastCompletedDate !== today) {
          this.currentStreak = 1;
        }
        
        // Update last completed date
        this.lastCompletedDate = today;
      } 
      // If no challenges completed today, but last completed was yesterday, don't change streak
      else if (this.lastCompletedDate !== yesterday) {
        // If it's been more than a day, reset streak
        if (this.lastCompletedDate && this.lastCompletedDate < yesterday) {
          this.currentStreak = 0;
        }
      }
      
      // Update longest streak
      if (this.currentStreak > this.longestStreak) {
        this.longestStreak = this.currentStreak;
      }
      
      // Save streak data
      localStorage.setItem(this.storageKeys.streak, this.currentStreak.toString());
      localStorage.setItem(this.storageKeys.longest, this.longestStreak.toString());
      localStorage.setItem(this.storageKeys.lastCompleted, this.lastCompletedDate || '');
      
      // Notify listeners if there was a change
      this.notifyListeners({
        type: 'streak_updated',
        currentStreak: this.currentStreak,
        longestStreak: this.longestStreak
      });
      
      console.log(`Streak updated: ${this.currentStreak} days (longest: ${this.longestStreak})`);
      
      return true;
    } catch (error) {
      console.error("Error updating streak:", error);
      return false;
    }
  }

  // Record challenge completion in history
  recordChallengeCompletion(challenge) {
    try {
      // Get existing history
      const historyStr = localStorage.getItem(this.storageKeys.history);
      let history = historyStr ? JSON.parse(historyStr) : [];
      
      // Add to history
      history.push({
        id: challenge.id,
        title: challenge.title,
        category: challenge.category,
        points: challenge.points,
        timestamp: challenge.completedTimestamp,
        date: challenge.date
      });
      
      // Keep only the last 100 entries
      if (history.length > 100) {
        history = history.slice(history.length - 100);
      }
      
      // Save to local storage
      localStorage.setItem(this.storageKeys.history, JSON.stringify(history));
      
      return true;
    } catch (error) {
      console.error("Error recording challenge completion:", error);
      return false;
    }
  }

  // Get challenge completion history
  getChallengeHistory() {
    try {
      const historyStr = localStorage.getItem(this.storageKeys.history);
      const history = historyStr ? JSON.parse(historyStr) : [];
      
      return history;
    } catch (error) {
      console.error("Error getting challenge history:", error);
      return [];
    }
  }

  // Get streak information
  getStreakInfo() {
    if (!this.initialized) {
      this.initialize();
    }
    
    return {
      currentStreak: this.currentStreak,
      longestStreak: this.longestStreak,
      lastCompleted: this.lastCompletedDate
    };
  }

  // Check if all challenges for today are completed
  areTodaysChallengesCompleted() {
    if (this.todaysChallenges.length === 0) {
      return false;
    }
    
    return this.todaysChallenges.every(c => c.completed);
  }

  // Save user challenges to local storage
  saveUserChallenges() {
    localStorage.setItem(this.storageKeys.challenges, JSON.stringify(this.userChallenges));
  }

  // Get date string in YYYY-MM-DD format
  getDateString(date = new Date()) {
    return date.toISOString().split('T')[0];
  }

  // Add event listener
  addEventListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
      return true;
    }
    return false;
  }

  // Remove event listener
  removeEventListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index !== -1) {
      this.listeners.splice(index, 1);
      return true;
    }
    return false;
  }

  // Notify all listeners
  notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in challenge event listener:", error);
      }
    });
  }
}

// Create singleton instance
const dailyChallenges = new DailyChallenges();

// Export for different environments
if (typeof window !== 'undefined') {
  window.dailyChallenges = dailyChallenges;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = dailyChallenges;
}
