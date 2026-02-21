// Enhanced Analytics Module for FitMunch
class EnhancedAnalytics {
  constructor() {
    this.sessionId = this.generateSessionId();
    this.events = [];
    this.isTracking = true;
    this.batchSize = 10;
    this.batchTimeout = 5000; // 5 seconds
    this.timer = null;
    this.initializeTracking();
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  initializeTracking() {
    // Track page visibility
    document.addEventListener('visibilitychange', () => {
      this.trackEvent('page_visibility', {
        state: document.hidden ? 'hidden' : 'visible',
      });
    });

    // Track scroll depth
    let maxScrollDepth = 0;
    window.addEventListener('scroll', this.throttle(() => {
      const scrollPercentage = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
      );
      if (scrollPercentage > maxScrollDepth) {
        maxScrollDepth = scrollPercentage;
        if (scrollPercentage % 25 === 0) {
          this.trackEvent('scroll_depth', { percentage: scrollPercentage });
        }
      }
    }, 1000));

    // Track engagement time
    let engagementTime = 0;
    setInterval(() => {
      if (!document.hidden) {
        engagementTime += 1;
        if (engagementTime % 30 === 0) {
          this.trackEvent('engagement_time', { seconds: engagementTime });
        }
      }
    }, 1000);

    // Track errors
    window.addEventListener('error', (event) => {
      this.trackEvent('error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });

    // Track performance metrics
    if (window.performance && window.performance.timing) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const timing = window.performance.timing;
          const pageLoadTime = timing.loadEventEnd - timing.navigationStart;
          const domReadyTime = timing.domContentLoadedEventEnd - timing.navigationStart;
          
          this.trackEvent('page_performance', {
            pageLoadTime,
            domReadyTime,
            dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
            tcpTime: timing.connectEnd - timing.connectStart,
            serverTime: timing.responseEnd - timing.requestStart,
          });
        }, 0);
      });
    }
  }

  trackEvent(eventType, eventData = {}) {
    if (!this.isTracking) return;

    const event = {
      eventType,
      eventData,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
    };

    this.events.push(event);

    // Send batch if size limit reached
    if (this.events.length >= this.batchSize) {
      this.sendBatch();
    } else {
      // Schedule batch send
      this.scheduleBatchSend();
    }
  }

  scheduleBatchSend() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.sendBatch();
    }, this.batchTimeout);
  }

  async sendBatch() {
    if (this.events.length === 0) return;

    const eventsToSend = [...this.events];
    this.events = [];

    try {
      if (window.fitMunchAPI && typeof window.fitMunchAPI.apiCall === 'function') {
        await window.fitMunchAPI.apiCall('/api/analytics/events', 'POST', {
          events: eventsToSend
        });
      } else {
        console.warn('fitMunchAPI not available, using fallback fetch');
        const response = await fetch('/api/analytics/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ events: eventsToSend }),
        });

        if (!response.ok) {
          throw new Error('Failed to send analytics events');
        }
      }
    } catch (error) {
      console.error('Error sending analytics:', error);
      this.events.unshift(...eventsToSend);
    }
  }

  // Track custom fitness events
  trackWorkoutStart(workoutType) {
    this.trackEvent('workout_start', {
      workoutType,
      timestamp: Date.now(),
    });
  }

  trackWorkoutComplete(workoutType, duration, caloriesBurned) {
    this.trackEvent('workout_complete', {
      workoutType,
      duration,
      caloriesBurned,
    });
  }

  trackMealLog(mealType, calories, macros) {
    this.trackEvent('meal_log', {
      mealType,
      calories,
      macros,
    });
  }

  trackGoalUpdate(goalType, goalValue) {
    this.trackEvent('goal_update', {
      goalType,
      goalValue,
    });
  }

  trackPremiumFeatureView(featureName) {
    this.trackEvent('premium_feature_view', {
      featureName,
    });
  }

  trackSubscriptionPurchase(plan, price) {
    this.trackEvent('subscription_purchase', {
      plan,
      price,
      timestamp: Date.now(),
    });
  }

  // Utility functions
  throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  // Stop tracking
  stopTracking() {
    this.isTracking = false;
    this.sendBatch(); // Send any remaining events
  }

  // Resume tracking
  resumeTracking() {
    this.isTracking = true;
  }
}

// Initialize analytics
const enhancedAnalytics = new EnhancedAnalytics();

// Export for global use
if (typeof window !== 'undefined') {
  window.enhancedAnalytics = enhancedAnalytics;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedAnalytics;
}
