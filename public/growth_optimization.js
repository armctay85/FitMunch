
// FitMunch Growth Optimization Module
// Implements growth strategies including referrals, onboarding optimization, and A/B testing

const GrowthOptimizationService = {
  // Feature variants for A/B testing
  activeExperiments: {},
  
  // Referral program configuration
  referralProgram: {
    rewardsEnabled: true,
    signupBonus: "7-day premium trial",
    referralBonus: "1-month premium extension", 
    requiredSignups: 3,
    maxRewards: 12 // Maximum months of premium that can be earned
  },
  
  // Initialize growth optimization
  initialize: function() {
    // Check for referral parameters
    this.checkReferralParams();
    
    // Initialize A/B testing
    this.initializeABTesting();
    
    // Check if we need to show onboarding
    this.checkOnboardingStatus();
    
    console.log('Growth optimization initialized');
  },
  
  //
  // REFERRAL SYSTEM
  //
  
  // Check URL for referral parameters
  checkReferralParams: function() {
    const urlParams = new URLSearchParams(window.location.search);
    const referralCode = urlParams.get('ref');
    const referrerId = urlParams.get('id');
    
    if (referralCode && referrerId) {
      // Store referral info for later use during signup
      localStorage.setItem('referralCode', referralCode);
      localStorage.setItem('referrerId', referrerId);
      
      // Track referral visit
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackReferralVisit(referralCode, referrerId);
      }
      
      console.log('Referral detected:', referralCode, referrerId);
    }
    
    // Check for UTM parameters
    const utmSource = urlParams.get('utm_source');
    if (utmSource) {
      const utmParams = {
        utm_source: utmSource,
        utm_medium: urlParams.get('utm_medium'),
        utm_campaign: urlParams.get('utm_campaign'),
        utm_content: urlParams.get('utm_content'),
        utm_term: urlParams.get('utm_term')
      };
      
      // Store UTM data
      localStorage.setItem('utmParams', JSON.stringify(utmParams));
      
      // Track UTM visit
      if (typeof AnalyticsService !== 'undefined') {
        AnalyticsService.trackUTMVisit(utmParams);
      }
    }
  },
  
  // Generate a unique referral code for a user
  generateReferralCode: function(userId) {
    // Create a code that's readable but unique
    const namePrefix = userId.substring(0, 3).toUpperCase();
    const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${namePrefix}-${randomChars}`;
  },
  
  // Create referral UI widget
  createReferralWidget: function(container, userId) {
    if (!container) return;
    
    // Generate or retrieve referral code
    const referralCode = localStorage.getItem(`referralCode_${userId}`) || 
                         this.generateReferralCode(userId);
    
    // Store for future use
    localStorage.setItem(`referralCode_${userId}`, referralCode);
    
    // Get referral metrics if available
    const referralsSent = parseInt(localStorage.getItem(`referralsSent_${userId}`) || '0');
    const referralsCompleted = parseInt(localStorage.getItem(`referralsCompleted_${userId}`) || '0');
    
    // Create referral link
    const referralLink = typeof SocialSharingService !== 'undefined' ? 
                        SocialSharingService.generateReferralLink(userId, referralCode) :
                        `${window.location.origin}?ref=${referralCode}&id=${userId}`;
    
    // Create widget UI
    const widgetEl = document.createElement('div');
    widgetEl.className = 'referral-widget';
    widgetEl.innerHTML = `
      <div class="referral-header">
        <h3>Invite Friends & Earn Rewards</h3>
        <p>Share FitMunch with friends and earn premium membership extensions!</p>
      </div>
      
      <div class="referral-progress">
        <div class="progress-label">Successful Referrals: ${referralsCompleted} / ${this.referralProgram.requiredSignups}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min(100, (referralsCompleted / this.referralProgram.requiredSignups) * 100)}%"></div>
        </div>
        <div class="progress-reward">${this.referralProgram.referralBonus} when you reach ${this.referralProgram.requiredSignups} referrals</div>
      </div>
      
      <div class="referral-link-container">
        <input type="text" readonly class="referral-link" value="${referralLink}">
        <button class="copy-link-btn">Copy</button>
      </div>
      
      <div class="referral-share-options">
        <p>Share your link via:</p>
        <div class="share-buttons">
          <button class="share-btn share-facebook" data-platform="facebook">
            <i class="fab fa-facebook-f"></i>
          </button>
          <button class="share-btn share-twitter" data-platform="twitter">
            <i class="fab fa-twitter"></i>
          </button>
          <button class="share-btn share-whatsapp" data-platform="whatsapp">
            <i class="fab fa-whatsapp"></i>
          </button>
          <button class="share-btn share-email" data-platform="email">
            <i class="fas fa-envelope"></i>
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners
    widgetEl.querySelector('.copy-link-btn').addEventListener('click', () => {
      const linkInput = widgetEl.querySelector('.referral-link');
      linkInput.select();
      document.execCommand('copy');
      
      // Show confirmation
      const copyBtn = widgetEl.querySelector('.copy-link-btn');
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    });
    
    // Add share button functionality
    widgetEl.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.getAttribute('data-platform');
        const shareContent = {
          text: `Join me on FitMunch and get a ${this.referralProgram.signupBonus}! I've been using it to manage my meals and workouts.`,
          url: referralLink
        };
        
        // Use SocialSharingService if available
        if (typeof SocialSharingService !== 'undefined') {
          SocialSharingService.shareContent(platform, 'referral', shareContent);
        } else {
          // Fallback sharing mechanism
          let shareUrl;
          
          switch (platform) {
            case 'facebook':
              shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`;
              break;
            case 'twitter':
              shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareContent.text)}&url=${encodeURIComponent(referralLink)}`;
              break;
            case 'whatsapp':
              shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareContent.text + ' ' + referralLink)}`;
              break;
            case 'email':
              shareUrl = `mailto:?subject=Join me on FitMunch&body=${encodeURIComponent(shareContent.text + '\n\n' + referralLink)}`;
              break;
          }
          
          if (shareUrl) {
            window.open(shareUrl, '_blank', 'width=600,height=400');
          }
        }
        
        // Track referral sent
        localStorage.setItem(`referralsSent_${userId}`, (referralsSent + 1).toString());
      });
    });
    
    // Append widget to container
    container.appendChild(widgetEl);
    
    return widgetEl;
  },
  
  // Process a successful referral
  processReferralSignup: function(newUserId, referralCode, referrerId) {
    // Update referrer's stats
    const referralsCompleted = parseInt(localStorage.getItem(`referralsCompleted_${referrerId}`) || '0');
    localStorage.setItem(`referralsCompleted_${referrerId}`, (referralsCompleted + 1).toString());
    
    // Check if referrer should receive a reward
    if (referralsCompleted + 1 >= this.referralProgram.requiredSignups) {
      this.awardReferralBonus(referrerId);
    }
    
    // Award signup bonus to new user
    this.awardSignupBonus(newUserId);
    
    console.log('Referral signup processed:', newUserId, 'referred by', referrerId);
    
    return {
      success: true,
      newUser: newUserId,
      referrer: referrerId,
      referrerCompletions: referralsCompleted + 1
    };
  },
  
  // Award signup bonus to new user
  awardSignupBonus: function(userId) {
    // In a real implementation, this would grant the user their bonus
    console.log('Awarded signup bonus to user:', userId);
    
    // Show notification to user
    if (typeof grokNotifications !== 'undefined') {
      grokNotifications.success(
        `You've received a ${this.referralProgram.signupBonus} for signing up through a referral!`,
        'Welcome Bonus'
      );
    }
  },
  
  // Award referral bonus to referring user
  awardReferralBonus: function(userId) {
    // In a real implementation, this would grant the user their bonus
    console.log('Awarded referral bonus to user:', userId);
    
    // Show notification to user
    if (typeof grokNotifications !== 'undefined') {
      grokNotifications.success(
        `You've earned a ${this.referralProgram.referralBonus} for your successful referrals!`,
        'Referral Reward'
      );
    }
  },
  
  //
  // A/B TESTING SYSTEM
  //
  
  // Initialize A/B testing
  initializeABTesting: function() {
    // Define experiments
    const experiments = [
      {
        id: 'landing_headline',
        variants: ['Achieve Your Fitness Goals', 'Nutrition Made Simple', 'Your Personal Fitness Coach'],
        weights: [0.33, 0.33, 0.34]
      },
      {
        id: 'cta_button_color',
        variants: ['green', 'blue', 'orange'],
        weights: [0.4, 0.3, 0.3]
      },
      {
        id: 'subscription_layout',
        variants: ['card', 'table', 'comparison'],
        weights: [0.5, 0.25, 0.25]
      }
    ];
    
    // Assign variants for each experiment
    experiments.forEach(experiment => {
      this.assignExperimentVariant(experiment);
    });
  },
  
  // Assign user to experiment variant
  assignExperimentVariant: function(experiment) {
    // Check if user already has an assigned variant
    const storedVariant = localStorage.getItem(`exp_${experiment.id}`);
    
    if (storedVariant) {
      this.activeExperiments[experiment.id] = storedVariant;
      return storedVariant;
    }
    
    // Assign new variant based on weights
    const random = Math.random();
    let cumulativeWeight = 0;
    let chosenVariant = experiment.variants[0]; // Default to first variant
    
    for (let i = 0; i < experiment.variants.length; i++) {
      cumulativeWeight += experiment.weights[i];
      if (random <= cumulativeWeight) {
        chosenVariant = experiment.variants[i];
        break;
      }
    }
    
    // Store the chosen variant
    localStorage.setItem(`exp_${experiment.id}`, chosenVariant);
    this.activeExperiments[experiment.id] = chosenVariant;
    
    // Track experiment assignment
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('experiment_assignment', {
        experimentId: experiment.id,
        variant: chosenVariant
      });
    }
    
    return chosenVariant;
  },
  
  // Get current variant for an experiment
  getExperimentVariant: function(experimentId) {
    return this.activeExperiments[experimentId] || null;
  },
  
  // Track conversion for experiment
  trackExperimentConversion: function(experimentId, conversionType) {
    const variant = this.getExperimentVariant(experimentId);
    
    if (!variant) return;
    
    // Track the conversion
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('experiment_conversion', {
        experimentId: experimentId,
        variant: variant,
        conversionType: conversionType
      });
    }
  },
  
  //
  // ONBOARDING OPTIMIZATION
  //
  
  // Check if user needs onboarding
  checkOnboardingStatus: function() {
    const onboardingComplete = localStorage.getItem('onboardingComplete') === 'true';
    const onboardingStep = parseInt(localStorage.getItem('onboardingStep') || '0');
    
    if (!onboardingComplete) {
      // Show onboarding on appropriate pages
      if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        setTimeout(() => {
          this.showOnboarding(onboardingStep);
        }, 1000); // Slight delay to allow page to load
      }
    }
  },
  
  // Show onboarding flow
  showOnboarding: function(step = 0) {
    // If onboarding UI doesn't exist, create it
    let onboardingEl = document.getElementById('app-onboarding');
    
    if (!onboardingEl) {
      onboardingEl = document.createElement('div');
      onboardingEl.id = 'app-onboarding';
      onboardingEl.className = 'onboarding-container';
      document.body.appendChild(onboardingEl);
    }
    
    // Define onboarding steps
    const steps = [
      {
        title: 'Welcome to FitMunch!',
        content: 'Your personal nutrition and fitness companion. Let\'s get you set up in just a few steps.',
        image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=500',
        ctaText: 'Get Started'
      },
      {
        title: 'Set Your Goals',
        content: 'What do you want to achieve? Weight loss, muscle gain, or maintaining a healthy lifestyle?',
        image: 'https://images.unsplash.com/photo-1535743686920-55e4145369b9?w=500',
        ctaText: 'Next',
        inputHtml: `
          <div class="goal-options">
            <div class="goal-option" data-goal="weight_loss">
              <i class="fas fa-weight"></i>
              <span>Weight Loss</span>
            </div>
            <div class="goal-option" data-goal="muscle_gain">
              <i class="fas fa-dumbbell"></i>
              <span>Muscle Gain</span>
            </div>
            <div class="goal-option" data-goal="maintain">
              <i class="fas fa-balance-scale"></i>
              <span>Maintain Health</span>
            </div>
          </div>
        `
      },
      {
        title: 'Dietary Preferences',
        content: 'Do you have any specific dietary requirements or restrictions?',
        image: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=500',
        ctaText: 'Next',
        inputHtml: `
          <div class="preference-options">
            <label class="preference-option">
              <input type="checkbox" name="diet_pref" value="vegetarian">
              <span>Vegetarian</span>
            </label>
            <label class="preference-option">
              <input type="checkbox" name="diet_pref" value="vegan">
              <span>Vegan</span>
            </label>
            <label class="preference-option">
              <input type="checkbox" name="diet_pref" value="gluten_free">
              <span>Gluten Free</span>
            </label>
            <label class="preference-option">
              <input type="checkbox" name="diet_pref" value="keto">
              <span>Keto</span>
            </label>
            <label class="preference-option">
              <input type="checkbox" name="diet_pref" value="paleo">
              <span>Paleo</span>
            </label>
          </div>
        `
      },
      {
        title: 'Track Your Progress',
        content: 'FitMunch helps you track your progress and stay motivated with visual charts and achievements.',
        image: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=500',
        ctaText: 'Next'
      },
      {
        title: 'You\'re All Set!',
        content: 'Your personalized nutrition and fitness journey begins now. Explore the app to get started!',
        image: 'https://images.unsplash.com/photo-1494597564530-871f2b93ac55?w=500',
        ctaText: 'Start Using FitMunch'
      }
    ];
    
    // Ensure valid step
    if (step >= steps.length) {
      step = 0;
    }
    
    // Update current step
    const currentStep = steps[step];
    
    // Create step content
    onboardingEl.innerHTML = `
      <div class="onboarding-overlay"></div>
      <div class="onboarding-modal">
        <div class="onboarding-progress">
          ${steps.map((_, i) => `<div class="progress-dot ${i === step ? 'active' : i < step ? 'completed' : ''}"></div>`).join('')}
        </div>
        <div class="onboarding-image">
          <img src="${currentStep.image}" alt="${currentStep.title}">
        </div>
        <div class="onboarding-content">
          <h2>${currentStep.title}</h2>
          <p>${currentStep.content}</p>
          ${currentStep.inputHtml ? currentStep.inputHtml : ''}
          <div class="onboarding-actions">
            ${step > 0 ? `<button class="back-btn">Back</button>` : ''}
            <button class="cta-btn">${currentStep.ctaText}</button>
          </div>
        </div>
        ${step > 0 ? `<button class="skip-btn">Skip</button>` : ''}
      </div>
    `;
    
    // Show the onboarding
    requestAnimationFrame(() => {
      onboardingEl.classList.add('visible');
    });
    
    // Store current step
    localStorage.setItem('onboardingStep', step.toString());
    
    // Add event listeners
    const ctaBtn = onboardingEl.querySelector('.cta-btn');
    ctaBtn.addEventListener('click', () => {
      // Handle any input collection
      this.collectOnboardingData(step);
      
      // Move to next step or complete
      if (step < steps.length - 1) {
        this.showOnboarding(step + 1);
      } else {
        this.completeOnboarding();
      }
    });
    
    const backBtn = onboardingEl.querySelector('.back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.showOnboarding(step - 1);
      });
    }
    
    const skipBtn = onboardingEl.querySelector('.skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.completeOnboarding();
      });
    }
    
    // Add click handlers for option selections
    const goalOptions = onboardingEl.querySelectorAll('.goal-option');
    goalOptions.forEach(option => {
      option.addEventListener('click', () => {
        // Remove active class from all options
        goalOptions.forEach(opt => opt.classList.remove('active'));
        // Add active class to clicked option
        option.classList.add('active');
      });
    });
    
    // Track onboarding step view
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('onboarding_step_view', {
        step: step,
        stepName: currentStep.title
      });
    }
  },
  
  // Collect data from onboarding step
  collectOnboardingData: function(step) {
    const onboardingData = JSON.parse(localStorage.getItem('onboardingData') || '{}');
    
    // Based on step, collect relevant data
    switch(step) {
      case 1: // Goals
        const selectedGoal = document.querySelector('.goal-option.active');
        if (selectedGoal) {
          onboardingData.goal = selectedGoal.getAttribute('data-goal');
        }
        break;
      case 2: // Dietary preferences
        const selectedPrefs = Array.from(document.querySelectorAll('input[name="diet_pref"]:checked'))
                                  .map(input => input.value);
        onboardingData.dietaryPreferences = selectedPrefs;
        break;
    }
    
    // Save data
    localStorage.setItem('onboardingData', JSON.stringify(onboardingData));
    
    // Track data collection
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('onboarding_data_collected', {
        step: step,
        data: onboardingData
      });
    }
    
    return onboardingData;
  },
  
  // Complete onboarding
  completeOnboarding: function() {
    // Mark onboarding as complete
    localStorage.setItem('onboardingComplete', 'true');
    
    // Remove onboarding UI
    const onboardingEl = document.getElementById('app-onboarding');
    if (onboardingEl) {
      onboardingEl.classList.remove('visible');
      setTimeout(() => {
        onboardingEl.remove();
      }, 500);
    }
    
    // Get collected data
    const onboardingData = JSON.parse(localStorage.getItem('onboardingData') || '{}');
    
    // Track completion
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackEvent('onboarding_complete', {
        data: onboardingData
      });
    }
    
    // Show completion notification
    if (typeof grokNotifications !== 'undefined') {
      grokNotifications.success(
        'Your profile is set up and you\'re ready to go!',
        'Welcome to FitMunch'
      );
    }
    
    return onboardingData;
  }
};

// Add CSS for growth optimization UI
const addGrowthStyles = function() {
  const style = document.createElement('style');
  style.textContent = `
    /* Referral Widget */
    .referral-widget {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
      padding: 20px;
      margin: 20px 0;
    }
    
    .referral-header h3 {
      margin-top: 0;
      color: var(--primary-color);
    }
    
    .referral-progress {
      margin: 15px 0;
    }
    
    .progress-bar {
      height: 10px;
      background-color: #f0f0f0;
      border-radius: 5px;
      overflow: hidden;
      margin: 5px 0;
    }
    
    .progress-fill {
      height: 100%;
      background-color: var(--primary-color);
      transition: width 0.3s ease;
    }
    
    .progress-reward {
      font-size: 14px;
      color: #666;
    }
    
    .referral-link-container {
      display: flex;
      margin: 15px 0;
    }
    
    .referral-link {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px 0 0 4px;
      font-size: 14px;
    }
    
    .copy-link-btn {
      background: var(--primary-color);
      color: white;
      border: none;
      border-radius: 0 4px 4px 0;
      padding: 0 15px;
      cursor: pointer;
    }
    
    .share-buttons {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }
    
    .share-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      cursor: pointer;
    }
    
    .share-facebook {
      background-color: #1877F2;
    }
    
    .share-twitter {
      background-color: #1DA1F2;
    }
    
    .share-whatsapp {
      background-color: #25D366;
    }
    
    .share-email {
      background-color: #DD4B39;
    }
    
    /* Onboarding */
    .onboarding-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }
    
    .onboarding-container.visible {
      opacity: 1;
      visibility: visible;
    }
    
    .onboarding-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0,0,0,0.7);
    }
    
    .onboarding-modal {
      position: relative;
      width: 90%;
      max-width: 700px;
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      max-height: 80vh;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    
    .onboarding-progress {
      display: flex;
      padding: 15px;
      justify-content: center;
      gap: 8px;
    }
    
    .progress-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: #ddd;
    }
    
    .progress-dot.active {
      background-color: var(--primary-color);
      transform: scale(1.2);
    }
    
    .progress-dot.completed {
      background-color: var(--primary-dark);
    }
    
    .onboarding-image {
      width: 100%;
      height: 200px;
      overflow: hidden;
    }
    
    .onboarding-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .onboarding-content {
      padding: 20px;
    }
    
    .onboarding-content h2 {
      margin-top: 0;
      color: var(--primary-color);
    }
    
    .onboarding-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
    }
    
    .cta-btn {
      background-color: var(--primary-color);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-weight: bold;
    }
    
    .back-btn {
      background-color: #f0f0f0;
      color: #333;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
    }
    
    .skip-btn {
      position: absolute;
      top: 15px;
      right: 15px;
      background: transparent;
      border: none;
      color: #999;
      cursor: pointer;
    }
    
    .goal-options {
      display: flex;
      justify-content: space-between;
      margin: 20px 0;
    }
    
    .goal-option {
      flex: 1;
      text-align: center;
      padding: 15px;
      border: 2px solid #ddd;
      border-radius: 8px;
      margin: 0 5px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .goal-option:hover {
      border-color: var(--primary-color);
    }
    
    .goal-option.active {
      border-color: var(--primary-color);
      background-color: rgba(75, 181, 67, 0.1);
    }
    
    .goal-option i {
      display: block;
      font-size: 24px;
      margin-bottom: 10px;
      color: #555;
    }
    
    .goal-option.active i {
      color: var(--primary-color);
    }
    
    .preference-options {
      display: flex;
      flex-wrap: wrap;
      margin: 20px 0;
    }
    
    .preference-option {
      width: 50%;
      padding: 10px;
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    
    .preference-option input {
      margin-right: 10px;
    }
    
    /* Social Sharing */
    .social-sharing-widget {
      margin: 15px 0;
    }
    
    .sharing-title {
      font-weight: bold;
      margin-bottom: 10px;
    }
    
    .sharing-platforms {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    
    .share-confirmation {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100%);
      background-color: #333;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      opacity: 0;
      transition: transform 0.3s ease, opacity 0.3s ease;
      z-index: 9999;
    }
    
    .share-confirmation.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  `;
  
  document.head.appendChild(style);
};

// Initialize on load if in browser
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    addGrowthStyles();
    GrowthOptimizationService.initialize();
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GrowthOptimizationService;
} else {
  // Make available globally in browser
  window.GrowthOptimizationService = GrowthOptimizationService;
}
