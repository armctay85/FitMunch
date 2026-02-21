// Analytics Service for FitMunch App
class AnalyticsService {
  static eventTypes = {
    APP_OPENED: 'app_opened',
    SECTION_VIEWED: 'section_viewed',
    MEAL_GENERATED: 'meal_generated',
    WORKOUT_GENERATED: 'workout_generated',
    PROFILE_UPDATED: 'profile_updated',
    FOOD_LOGGED: 'food_logged'
  };

  static initialize() {
    console.log('Analytics Service initialized');
    this.initialized = true;
  }

  static trackEvent(eventType, data = {}) {
    if (!this.initialized) {
      console.warn('Analytics not initialized, skipping event:', eventType);
      return;
    }

    console.log('Analytics Event:', eventType, data);

    // Store event in localStorage for demo purposes
    const events = JSON.parse(localStorage.getItem('analytics_events') || '[]');
    events.push({
      type: eventType,
      data: data,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 events
    if (events.length > 100) {
      events.splice(0, events.length - 100);
    }

    localStorage.setItem('analytics_events', JSON.stringify(events));
  }

  static getEvents() {
    return JSON.parse(localStorage.getItem('analytics_events') || '[]');
  }
}

// For Node.js environments
if (typeof module !== 'undefined') {
  module.exports = { AnalyticsService };
}