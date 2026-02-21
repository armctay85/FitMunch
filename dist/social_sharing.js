
// FitMunch Social Sharing Module
// Enables users to share their progress, meal plans, and workouts on social media

const SocialSharingService = {
  // Platforms supported
  platforms: {
    FACEBOOK: 'facebook',
    TWITTER: 'twitter',
    INSTAGRAM: 'instagram',
    PINTEREST: 'pinterest',
    WHATSAPP: 'whatsapp',
    EMAIL: 'email',
    COPY_LINK: 'copy_link'
  },
  
  // Content types that can be shared
  contentTypes: {
    MEAL_PLAN: 'meal_plan',
    WORKOUT: 'workout',
    PROGRESS: 'progress',
    ACHIEVEMENT: 'achievement',
    RECIPE: 'recipe'
  },
  
  // Initialize social sharing
  initialize: function() {
    // Add meta tags for social sharing if not present
    this.setupMetaTags();
    
    console.log('Social sharing initialized');
  },
  
  // Set up meta tags for better social sharing
  setupMetaTags: function() {
    // Only add if not already present
    if (!document.querySelector('meta[property="og:title"]')) {
      const metaTags = [
        { property: 'og:title', content: 'FitMunch - Your Personalized Nutrition & Fitness Companion' },
        { property: 'og:description', content: 'Plan meals, track workouts, and achieve your fitness goals with FitMunch!' },
        { property: 'og:image', content: window.location.origin + '/social-share-image.jpg' },
        { property: 'og:url', content: window.location.href },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary_large_image' }
      ];
      
      metaTags.forEach(tag => {
        const metaTag = document.createElement('meta');
        
        if (tag.property) {
          metaTag.setAttribute('property', tag.property);
        } else if (tag.name) {
          metaTag.setAttribute('name', tag.name);
        }
        
        metaTag.setAttribute('content', tag.content);
        document.head.appendChild(metaTag);
      });
    }
  },
  
  // Generate share URL for different platforms
  generateShareUrl: function(platform, content) {
    const baseUrl = window.location.origin;
    const shareText = encodeURIComponent(content.text || 'Check out my progress on FitMunch!');
    const shareUrl = encodeURIComponent(content.url || baseUrl);
    const shareImage = encodeURIComponent(content.image || baseUrl + '/social-share-image.jpg');
    
    // Add tracking parameters
    const trackingParams = `?utm_source=${platform}&utm_medium=social&utm_campaign=user_share&share_id=${content.id || ''}`;
    const trackableUrl = encodeURIComponent(baseUrl + trackingParams);
    
    switch (platform) {
      case this.platforms.FACEBOOK:
        return `https://www.facebook.com/sharer/sharer.php?u=${trackableUrl}`;
      case this.platforms.TWITTER:
        return `https://twitter.com/intent/tweet?text=${shareText}&url=${trackableUrl}`;
      case this.platforms.PINTEREST:
        return `https://pinterest.com/pin/create/button/?url=${trackableUrl}&media=${shareImage}&description=${shareText}`;
      case this.platforms.WHATSAPP:
        return `https://api.whatsapp.com/send?text=${shareText}%20${trackableUrl}`;
      case this.platforms.EMAIL:
        return `mailto:?subject=Check out FitMunch&body=${shareText}%20${trackableUrl}`;
      default:
        return baseUrl + trackingParams;
    }
  },
  
  // Share content to a specific platform
  shareContent: function(platform, contentType, contentData) {
    // Create content object for sharing
    const content = {
      id: contentData.id || Date.now().toString(),
      text: this.generateShareText(contentType, contentData),
      url: window.location.href,
      image: contentData.image || null
    };
    
    const shareUrl = this.generateShareUrl(platform, content);
    
    // Track sharing event
    if (typeof AnalyticsService !== 'undefined') {
      AnalyticsService.trackSocialShare(platform, contentType, content.id);
    }
    
    if (platform === this.platforms.COPY_LINK) {
      this.copyToClipboard(shareUrl);
      this.showShareConfirmation('Link copied to clipboard!');
    } else {
      // Open in new window
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }
    
    return shareUrl;
  },
  
  // Generate share text based on content type
  generateShareText: function(contentType, contentData) {
    switch (contentType) {
      case this.contentTypes.MEAL_PLAN:
        return `I just created a ${contentData.days || 7}-day meal plan with FitMunch! Join me on my health journey.`;
      case this.contentTypes.WORKOUT:
        return `Check out my ${contentData.type || 'custom'} workout plan on FitMunch! 💪`;
      case this.contentTypes.PROGRESS:
        return `I've made great progress with FitMunch! ${contentData.achievement || ''}`;
      case this.contentTypes.ACHIEVEMENT:
        return `I just earned the "${contentData.name}" achievement on FitMunch! 🏆`;
      case this.contentTypes.RECIPE:
        return `Found this amazing ${contentData.name} recipe on FitMunch. Delicious and healthy!`;
      default:
        return 'Check out FitMunch - the ultimate nutrition and fitness companion!';
    }
  },
  
  // Create social sharing UI element
  createSharingWidget: function(container, contentType, contentData, platforms = []) {
    if (!container) return;
    
    // Use all platforms if none specified
    if (!platforms.length) {
      platforms = Object.values(this.platforms);
    }
    
    const widgetEl = document.createElement('div');
    widgetEl.className = 'social-sharing-widget';
    widgetEl.innerHTML = `
      <div class="sharing-title">Share this ${contentType.replace('_', ' ')}:</div>
      <div class="sharing-platforms"></div>
    `;
    
    const platformsContainer = widgetEl.querySelector('.sharing-platforms');
    
    // Add platform buttons
    platforms.forEach(platform => {
      if (platform === this.platforms.COPY_LINK) {
        platformsContainer.innerHTML += `
          <button class="share-btn share-${platform}" data-platform="${platform}">
            <i class="fas fa-link"></i>
          </button>
        `;
      } else {
        platformsContainer.innerHTML += `
          <button class="share-btn share-${platform}" data-platform="${platform}">
            <i class="fab fa-${platform}"></i>
          </button>
        `;
      }
    });
    
    // Add event listeners
    widgetEl.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.getAttribute('data-platform');
        this.shareContent(platform, contentType, contentData);
      });
    });
    
    // Append to container
    container.appendChild(widgetEl);
    
    return widgetEl;
  },
  
  // Copy to clipboard helper
  copyToClipboard: function(text) {
    const tempInput = document.createElement('input');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
  },
  
  // Show share confirmation message
  showShareConfirmation: function(message) {
    const confirmation = document.createElement('div');
    confirmation.className = 'share-confirmation';
    confirmation.textContent = message;
    
    document.body.appendChild(confirmation);
    
    setTimeout(() => {
      confirmation.classList.add('show');
      
      setTimeout(() => {
        confirmation.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(confirmation);
        }, 300);
      }, 2000);
    }, 10);
  },
  
  // Create referral link for user
  generateReferralLink: function(userId, referralCode) {
    const baseUrl = window.location.origin;
    return `${baseUrl}?ref=${referralCode}&id=${userId}`;
  }
};

// Initialize social sharing on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    SocialSharingService.initialize();
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SocialSharingService;
} else {
  // Make available globally in browser
  window.SocialSharingService = SocialSharingService;
}
