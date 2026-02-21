// FitMunch Theme Manager
document.addEventListener('DOMContentLoaded', function() {
  const themeToggle = document.getElementById('themeToggle');

  // Check for saved theme preference
  const savedTheme = localStorage.getItem('fitmunch_theme');

  // Apply saved theme or default to light theme
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (themeToggle) themeToggle.checked = true;
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    if (themeToggle) themeToggle.checked = false;
  }

  // Toggle theme when switch is clicked
  if (themeToggle) {
    themeToggle.addEventListener('change', function() {
      if (this.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('fitmunch_theme', 'dark');

        // Track theme change in analytics if available
        if (window.AnalyticsService) {
          window.AnalyticsService.logEvent('theme_changed', { theme: 'dark' });
        }
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('fitmunch_theme', 'light');

        // Track theme change in analytics if available
        if (window.AnalyticsService) {
          window.AnalyticsService.logEvent('theme_changed', { theme: 'light' });
        }
      }
    });
  }

  // Update logo to match the brand without changing images
  const logoContainer = document.querySelector('.logo');
  if (logoContainer) {
    const logoText = logoContainer.querySelector('h1');
    if (logoText) {
      logoText.style.color = 'var(--primary)';
      const span = logoText.querySelector('span');
      if (span) {
        span.style.color = 'var(--accent)';
      }
    }
  }

  console.log('Theme manager initialized');
});