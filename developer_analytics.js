
// Developer Analytics Integration Module
// Connects the Analytics Service with Developer Dashboard activities

import grokDeveloper from './grok_developer.js';

const DeveloperAnalytics = {
  initialize: function() {
    if (typeof AnalyticsService === 'undefined') {
      console.warn('Analytics service not found, developer analytics will be disabled');
      return false;
    }
    
    // Track dashboard views
    document.addEventListener('DOMContentLoaded', () => {
      this.trackPageView('developer_dashboard');
    });
    
    // Track section navigation
    const navItems = document.querySelectorAll('.dev-sidebar .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const section = e.currentTarget.getAttribute('data-section');
        if (section) {
          this.trackSectionView(section);
        }
      });
    });
    
    // Track enhancement interactions
    window.originalStartEnhancement = window.startEnhancement;
    window.startEnhancement = function(enhancementId) {
      const enhancement = window.originalStartEnhancement(enhancementId);
      DeveloperAnalytics.trackEnhancementStart(enhancementId, enhancement.title);
      return enhancement;
    };
    
    window.originalViewImplementationPlan = window.viewImplementationPlan;
    window.viewImplementationPlan = function(enhancementId) {
      DeveloperAnalytics.trackEnhancementView(enhancementId);
      return window.originalViewImplementationPlan(enhancementId);
    };
    
    // Track code analysis
    const analyzeCodeBtn = document.getElementById('analyze-code-btn');
    if (analyzeCodeBtn) {
      const originalClickHandler = analyzeCodeBtn.onclick;
      analyzeCodeBtn.onclick = function(e) {
        const fileSelect = document.getElementById('file-select');
        if (fileSelect) {
          DeveloperAnalytics.trackCodeAnalysisStart(fileSelect.value);
        }
        if (originalClickHandler) {
          return originalClickHandler.call(this, e);
        }
      };
    }
    
    console.log('Developer analytics initialized');
    return true;
  },
  
  // Tracking methods
  trackPageView: function(page) {
    if (AnalyticsService) {
      AnalyticsService.trackPageView(page);
    }
  },
  
  trackSectionView: function(section) {
    if (AnalyticsService) {
      AnalyticsService.trackDeveloperActivity('section_view', { section: section });
    }
  },
  
  trackEnhancementView: function(enhancementId) {
    if (AnalyticsService) {
      AnalyticsService.trackEnhancementView(enhancementId);
    }
  },
  
  trackEnhancementStart: function(enhancementId, title) {
    if (AnalyticsService) {
      AnalyticsService.trackEnhancementStart(enhancementId, title);
    }
  },
  
  trackCodeAnalysisStart: function(fileName) {
    if (AnalyticsService) {
      AnalyticsService.trackDeveloperActivity('code_analysis_start', { file: fileName });
    }
  },
  
  trackImplementationProgress: function(enhancementId, percentComplete) {
    if (AnalyticsService) {
      AnalyticsService.trackImplementationProgress(enhancementId, percentComplete);
    }
  },
  
  // Track roadmap generation
  trackRoadmapGeneration: function() {
    if (AnalyticsService) {
      AnalyticsService.trackDeveloperActivity('roadmap_generation');
    }
  },
  
  // Track project analysis
  trackProjectAnalysis: function(metrics) {
    if (AnalyticsService) {
      AnalyticsService.trackDeveloperActivity('project_analysis', metrics);
    }
  }
};

// Export for use in developer dashboard
export default DeveloperAnalytics;
