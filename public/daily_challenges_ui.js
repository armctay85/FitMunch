
// FitMunch Daily Challenges UI
// Provides UI components for displaying and interacting with daily challenges

class DailyChallengesUI {
  constructor(challengesManager) {
    this.manager = challengesManager || window.dailyChallenges;
    this.initialized = false;
    this.container = null;
    this.streakContainer = null;
    this.challengeTemplate = `
      <div class="challenge-card {completed_class}" data-id="{id}">
        <div class="challenge-header">
          <span class="challenge-category">{category}</span>
          <span class="challenge-points">{points} pts</span>
        </div>
        <h3 class="challenge-title">{title}</h3>
        <p class="challenge-description">{description}</p>
        <div class="challenge-footer">
          <span class="challenge-difficulty">{difficulty}</span>
          <button class="challenge-complete-btn" data-id="{id}">{button_text}</button>
        </div>
        <div class="challenge-completed-badge">
          <i class="fas fa-check-circle"></i>
          <span>Completed</span>
        </div>
      </div>
    `;
    this.streakTemplate = `
      <div class="streak-container">
        <div class="streak-info">
          <div class="current-streak">
            <span class="streak-count">{current_streak}</span>
            <span class="streak-label">Current Streak</span>
          </div>
          <div class="streak-flame {streak_active}">
            <i class="fas fa-fire"></i>
          </div>
          <div class="longest-streak">
            <span class="streak-count">{longest_streak}</span>
            <span class="streak-label">Longest Streak</span>
          </div>
        </div>
        <div class="streak-progress">
          <div class="streak-progress-bar" style="width: {progress}%"></div>
          <div class="streak-progress-text">{completed_count}/{total_count} Challenges Completed</div>
        </div>
      </div>
    `;
  }

  // Initialize the UI
  async initialize(challengesContainerId = 'daily-challenges', streakContainerId = 'streak-container') {
    if (this.initialized) {
      console.log("Daily challenges UI already initialized");
      return true;
    }

    console.log("Initializing daily challenges UI...");
    
    try {
      // Make sure challenges manager is initialized
      if (!this.manager.initialized) {
        await this.manager.initialize();
      }
      
      // Find containers
      this.container = document.getElementById(challengesContainerId);
      this.streakContainer = document.getElementById(streakContainerId);
      
      if (!this.container) {
        console.warn(`Challenges container not found: #${challengesContainerId}`);
      }
      
      if (!this.streakContainer) {
        console.warn(`Streak container not found: #${streakContainerId}`);
      }
      
      // Add event listeners
      this.setupEventListeners();
      
      // Render initial UI
      this.renderChallenges();
      this.renderStreak();
      
      this.initialized = true;
      console.log("Daily challenges UI initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize daily challenges UI:", error);
      return false;
    }
  }

  // Setup event listeners
  setupEventListeners() {
    // Listen for challenge completion
    this.manager.addEventListener(event => {
      if (event.type === 'challenge_completed' || event.type === 'challenge_uncompleted') {
        this.renderChallenges();
        this.renderStreak();
      } else if (event.type === 'streak_updated') {
        this.renderStreak();
      }
    });
    
    // Listen for clicks on the challenges container
    if (this.container) {
      this.container.addEventListener('click', event => {
        const button = event.target.closest('.challenge-complete-btn');
        if (button) {
          const challengeId = button.getAttribute('data-id');
          if (challengeId) {
            const card = button.closest('.challenge-card');
            const isCompleted = card.classList.contains('completed');
            
            if (isCompleted) {
              // Only allow uncompleting challenges in development/testing
              if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
                this.manager.uncompleteChallenge(challengeId);
              }
            } else {
              this.manager.completeChallenge(challengeId);
              
              // Add animation
              card.classList.add('completing');
              setTimeout(() => {
                card.classList.remove('completing');
                card.classList.add('completed');
              }, 500);
            }
          }
        }
      });
    }
  }

  // Render challenges
  renderChallenges() {
    if (!this.container) {
      return false;
    }
    
    const challenges = this.manager.getTodaysChallenges();
    
    if (challenges.length === 0) {
      this.container.innerHTML = `
        <div class="no-challenges">
          <p>No challenges available today. Check back tomorrow!</p>
        </div>
      `;
      return true;
    }
    
    let html = '';
    
    challenges.forEach(challenge => {
      html += this.challengeTemplate
        .replace('{id}', challenge.id)
        .replace('{id}', challenge.id)
        .replace('{title}', challenge.title)
        .replace('{description}', challenge.description)
        .replace('{category}', this.formatCategory(challenge.category))
        .replace('{points}', challenge.points)
        .replace('{difficulty}', this.formatDifficulty(challenge.difficulty))
        .replace('{completed_class}', challenge.completed ? 'completed' : '')
        .replace('{button_text}', challenge.completed ? 'Completed' : 'Complete');
    });
    
    this.container.innerHTML = html;
    
    return true;
  }

  // Render streak information
  renderStreak() {
    if (!this.streakContainer) {
      return false;
    }
    
    const streakInfo = this.manager.getStreakInfo();
    const challenges = this.manager.getTodaysChallenges();
    const completedCount = challenges.filter(c => c.completed).length;
    const totalCount = challenges.length;
    const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    
    const html = this.streakTemplate
      .replace('{current_streak}', streakInfo.currentStreak)
      .replace('{longest_streak}', streakInfo.longestStreak)
      .replace('{streak_active}', streakInfo.currentStreak > 0 ? 'active' : '')
      .replace('{progress}', progress)
      .replace('{completed_count}', completedCount)
      .replace('{total_count}', totalCount);
    
    this.streakContainer.innerHTML = html;
    
    return true;
  }

  // Format category name
  formatCategory(category) {
    if (!category) return '';
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  // Format difficulty
  formatDifficulty(difficulty) {
    switch (difficulty) {
      case 'easy':
        return '<span class="difficulty easy">Easy</span>';
      case 'medium':
        return '<span class="difficulty medium">Medium</span>';
      case 'hard':
        return '<span class="difficulty hard">Hard</span>';
      default:
        return '<span class="difficulty">' + difficulty + '</span>';
    }
  }

  // Create a new challenge widget to insert into the DOM
  createChallengesWidget(parentElement) {
    if (!parentElement) {
      console.error("No parent element provided for challenges widget");
      return null;
    }
    
    // Create containers
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'challenges-widget';
    
    const widgetHeader = document.createElement('div');
    widgetHeader.className = 'widget-header';
    widgetHeader.innerHTML = `
      <h2>Daily Challenges</h2>
      <span class="widget-subtitle">Complete challenges to earn points and build your streak</span>
    `;
    
    const streakContainer = document.createElement('div');
    streakContainer.id = 'streak-container';
    streakContainer.className = 'streak-container';
    
    const challengesContainer = document.createElement('div');
    challengesContainer.id = 'daily-challenges';
    challengesContainer.className = 'daily-challenges';
    
    // Assemble widget
    widgetContainer.appendChild(widgetHeader);
    widgetContainer.appendChild(streakContainer);
    widgetContainer.appendChild(challengesContainer);
    
    // Add widget to parent
    parentElement.appendChild(widgetContainer);
    
    // Initialize
    this.container = challengesContainer;
    this.streakContainer = streakContainer;
    this.renderChallenges();
    this.renderStreak();
    
    return widgetContainer;
  }

  // Get challenge completion rate
  getChallengeCompletionRate() {
    const history = this.manager.getChallengeHistory();
    
    if (history.length === 0) {
      return 0;
    }
    
    // Group by date
    const byDate = {};
    history.forEach(entry => {
      if (!byDate[entry.date]) {
        byDate[entry.date] = [];
      }
      byDate[entry.date].push(entry);
    });
    
    // Count days with at least one completed challenge
    const daysWithCompletions = Object.keys(byDate).length;
    
    // Count total possible days since first completion
    const dates = Object.keys(byDate).sort();
    if (dates.length === 0) {
      return 0;
    }
    
    const firstDate = new Date(dates[0]);
    const lastDate = new Date();
    const daysDiff = Math.ceil((lastDate - firstDate) / (24 * 60 * 60 * 1000)) + 1;
    
    return daysWithCompletions / daysDiff;
  }

  // Get CSS styles for the challenges UI
  static getStylesCSS() {
    return `
      /* Daily Challenges Styles */
      .challenges-widget {
        margin-bottom: 24px;
        padding: 20px;
        background-color: white;
        border-radius: 12px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      
      .widget-header {
        margin-bottom: 16px;
      }
      
      .widget-header h2 {
        margin: 0 0 4px 0;
        font-size: 20px;
        color: var(--primary);
      }
      
      .widget-subtitle {
        font-size: 14px;
        color: var(--text);
        opacity: 0.8;
      }
      
      .streak-container {
        background: linear-gradient(135deg, #f5f7fa, #e4e7eb);
        border-radius: 10px;
        padding: 16px;
        margin-bottom: 16px;
      }
      
      .streak-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      
      .current-streak, .longest-streak {
        text-align: center;
      }
      
      .streak-count {
        font-size: 24px;
        font-weight: 600;
        color: var(--text);
        display: block;
      }
      
      .streak-label {
        font-size: 12px;
        color: var(--text);
        opacity: 0.7;
      }
      
      .streak-flame {
        font-size: 32px;
        color: #ccc;
      }
      
      .streak-flame.active {
        color: #ff6b35;
      }
      
      .streak-flame.active i {
        animation: flicker 1.5s infinite alternate;
      }
      
      .streak-progress {
        height: 10px;
        background-color: #ddd;
        border-radius: 5px;
        overflow: hidden;
        position: relative;
      }
      
      .streak-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--accent), var(--primary));
        border-radius: 5px;
        transition: width 0.5s ease;
      }
      
      .streak-progress-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 10px;
        color: #444;
        text-shadow: 0 0 3px rgba(255, 255, 255, 0.7);
        white-space: nowrap;
      }
      
      .daily-challenges {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
      }
      
      @media (min-width: 768px) {
        .daily-challenges {
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        }
      }
      
      .challenge-card {
        background-color: white;
        border-radius: 10px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        border-left: 4px solid var(--primary);
        position: relative;
        overflow: hidden;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      
      .challenge-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      }
      
      .challenge-card.completed {
        border-left-color: #4CAF50;
        background-color: #f8f8f8;
      }
      
      .challenge-card.completing {
        animation: completeAnimation 0.5s;
      }
      
      .challenge-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
      }
      
      .challenge-category {
        color: var(--primary);
        font-weight: 500;
      }
      
      .challenge-points {
        font-weight: 600;
        color: #ff6b35;
      }
      
      .challenge-title {
        margin: 0 0 8px 0;
        font-size: 18px;
        color: var(--text);
      }
      
      .challenge-description {
        font-size: 14px;
        color: var(--text);
        opacity: 0.8;
        margin: 0 0 16px 0;
      }
      
      .challenge-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .challenge-difficulty {
        font-size: 12px;
      }
      
      .difficulty {
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 12px;
      }
      
      .difficulty.easy {
        background-color: #e1f5e4;
        color: #2e7d32;
      }
      
      .difficulty.medium {
        background-color: #fff8e1;
        color: #ff8f00;
      }
      
      .difficulty.hard {
        background-color: #ffebee;
        color: #c62828;
      }
      
      .challenge-complete-btn {
        padding: 6px 12px;
        background-color: var(--primary);
        color: white;
        border: none;
        border-radius: 6px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .challenge-complete-btn:hover {
        background-color: var(--primary-dark);
      }
      
      .completed .challenge-complete-btn {
        background-color: #4CAF50;
        cursor: default;
      }
      
      .challenge-completed-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background-color: #4CAF50;
        color: white;
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.3s, transform 0.3s;
      }
      
      .completed .challenge-completed-badge {
        opacity: 1;
        transform: translateY(0);
      }
      
      .no-challenges {
        text-align: center;
        padding: 24px;
        color: var(--text);
        opacity: 0.7;
      }
      
      @keyframes completeAnimation {
        0% {
          transform: scale(1);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
        50% {
          transform: scale(1.03);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.12);
        }
        100% {
          transform: scale(1);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      }
      
      @keyframes flicker {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.8;
        }
        100% {
          opacity: 1;
        }
      }
    `;
  }
}

// Create singleton instance
const dailyChallengesUI = new DailyChallengesUI();

// Export for different environments
if (typeof window !== 'undefined') {
  window.dailyChallengesUI = dailyChallengesUI;
  
  // Add styles to head
  const styleElement = document.createElement('style');
  styleElement.textContent = DailyChallengesUI.getStylesCSS();
  document.head.appendChild(styleElement);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = dailyChallengesUI;
}
