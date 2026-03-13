
// FitMunch SEO Optimization Module
// Implements search engine optimization techniques to improve visibility

const SEOService = {
  // SEO metadata
  metadata: {
    title: 'FitMunch - Your Personal Nutrition & Fitness Companion',
    description: 'Plan your meals, track your workouts, and achieve your fitness goals with FitMunch. Create personalized meal plans, generate shopping lists, and monitor your progress.',
    keywords: 'nutrition app, fitness app, meal planning, workout tracker, diet planner, healthy recipes, fitness goals',
    ogImage: '/social-share-image.jpg',
    locale: 'en_US',
    siteName: 'FitMunch',
    twitterHandle: '@fitmunch'
  },
  
  // Page-specific metadata
  pageMetadata: {
    'home': {
      title: 'FitMunch - Your Personal Nutrition & Fitness Companion',
      description: 'Plan your meals, track your workouts, and achieve your fitness goals with FitMunch.'
    },
    'meal': {
      title: 'Meal Planning | FitMunch',
      description: 'Create personalized meal plans based on your dietary preferences and fitness goals.'
    },
    'workout': {
      title: 'Workout Planning | FitMunch',
      description: 'Generate custom workout routines tailored to your fitness level and goals.'
    },
    'shopping': {
      title: 'Shopping Lists | FitMunch',
      description: 'Automatically generate shopping lists based on your meal plans and save time at the grocery store.'
    },
    'progress': {
      title: 'Progress Tracking | FitMunch',
      description: 'Track your fitness progress over time with interactive charts and visual data.'
    },
    'subscription': {
      title: 'Premium Plans | FitMunch',
      description: 'Unlock advanced features with FitMunch premium plans. Cancel anytime.'
    }
  },
  
  // Initialize SEO optimization
  initialize: function() {
    // Set default metadata
    this.setDefaultMetadata();
    
    // Listen for navigation changes
    this.setupNavigationListener();
    
    console.log('SEO optimization initialized');
  },
  
  // Set default metadata tags
  setDefaultMetadata: function() {
    // Set page title
    document.title = this.metadata.title;
    
    // Create meta tags if they don't exist
    this.setMetaTag('description', this.metadata.description);
    this.setMetaTag('keywords', this.metadata.keywords);
    
    // Set Open Graph meta tags
    this.setMetaTag('og:title', this.metadata.title, 'property');
    this.setMetaTag('og:description', this.metadata.description, 'property');
    this.setMetaTag('og:type', 'website', 'property');
    this.setMetaTag('og:url', window.location.href, 'property');
    this.setMetaTag('og:image', window.location.origin + this.metadata.ogImage, 'property');
    this.setMetaTag('og:locale', this.metadata.locale, 'property');
    this.setMetaTag('og:site_name', this.metadata.siteName, 'property');
    
    // Set Twitter meta tags
    this.setMetaTag('twitter:card', 'summary_large_image', 'name');
    this.setMetaTag('twitter:title', this.metadata.title, 'name');
    this.setMetaTag('twitter:description', this.metadata.description, 'name');
    this.setMetaTag('twitter:image', window.location.origin + this.metadata.ogImage, 'name');
    this.setMetaTag('twitter:site', this.metadata.twitterHandle, 'name');
    
    // Add canonical link
    this.setCanonicalLink(window.location.href);
  },
  
  // Set a meta tag
  setMetaTag: function(name, content, attributeName = 'name') {
    // Check if meta tag exists
    let metaTag = document.querySelector(`meta[${attributeName}="${name}"]`);
    
    if (!metaTag) {
      // Create meta tag if it doesn't exist
      metaTag = document.createElement('meta');
      metaTag.setAttribute(attributeName, name);
      document.head.appendChild(metaTag);
    }
    
    // Set content
    metaTag.setAttribute('content', content);
  },
  
  // Set canonical link
  setCanonicalLink: function(url) {
    // Remove any existing canonical links
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }
    
    // Create new canonical link
    const canonicalLink = document.createElement('link');
    canonicalLink.rel = 'canonical';
    canonicalLink.href = url;
    document.head.appendChild(canonicalLink);
  },
  
  // Update metadata for specific page
  updatePageMetadata: function(pageName) {
    // Get page-specific metadata
    const pageData = this.pageMetadata[pageName];
    
    if (!pageData) return;
    
    // Update title and meta tags
    document.title = pageData.title;
    this.setMetaTag('description', pageData.description);
    this.setMetaTag('og:title', pageData.title, 'property');
    this.setMetaTag('og:description', pageData.description, 'property');
    this.setMetaTag('twitter:title', pageData.title, 'name');
    this.setMetaTag('twitter:description', pageData.description, 'name');
    
    // Update canonical link to include section
    this.setCanonicalLink(window.location.origin + window.location.pathname + '#' + pageName);
    
    console.log('Updated metadata for page:', pageName);
  },
  
  // Set up listener for navigation changes
  setupNavigationListener: function() {
    // Listen for navigation clicks
    document.addEventListener('click', event => {
      const navItem = event.target.closest('.nav-item');
      if (navItem) {
        const section = navItem.getAttribute('data-section');
        if (section && this.pageMetadata[section]) {
          // Update metadata when navigation changes
          setTimeout(() => {
            this.updatePageMetadata(section);
          }, 100);
        }
      }
    });
    
    // Check for initial section
    const initialSection = window.location.hash.substring(1);
    if (initialSection && this.pageMetadata[initialSection]) {
      this.updatePageMetadata(initialSection);
    }
  },
  
  // Generate a sitemap.xml file
  generateSitemap: function() {
    const baseUrl = window.location.origin;
    const pages = Object.keys(this.pageMetadata);
    
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Add homepage
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/</loc>\n`;
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';
    
    // Add section pages
    pages.forEach(page => {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/#${page}</loc>\n`;
      sitemap += '    <priority>0.8</priority>\n';
      sitemap += '  </url>\n';
    });
    
    sitemap += '</urlset>';
    
    return sitemap;
  },
  
  // Add structured data for rich results
  addStructuredData: function() {
    // Organization schema
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "FitMunch",
      "applicationCategory": "HealthApplication",
      "operatingSystem": "Web",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      },
      "description": this.metadata.description,
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.8",
        "ratingCount": "254"
      }
    };
    
    // Create script element for JSON-LD
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(organizationSchema);
    document.head.appendChild(script);
  }
};

// Initialize on load if in browser
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    SEOService.initialize();
    SEOService.addStructuredData();
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SEOService;
} else {
  // Make available globally in browser
  window.SEOService = SEOService;
}
