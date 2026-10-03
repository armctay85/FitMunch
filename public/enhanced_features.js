// Enhanced Features Module for FitMunch
// Adds advanced UI components and interactive elements

class EnhancedFeatures {
  constructor() {
    this.features = {};
    this.animations = {};
  }

  createFeatureCard(_icon, title, copy) {
    return `<article class="feature-card"><h3>${title}</h3><p>${copy}</p></article>`;
  }

  createFeatureShowcase() {
    const showcase = document.createElement('div');
    showcase.className = 'enhanced-features-showcase';
    showcase.innerHTML = `
      <div class="showcase-header">
        <h2>Enhanced Features</h2>
        <p>Discover what makes FitMunch the health engine between body and trolley.</p>
      </div>

      <div class="features-grid">
        ${this.createFeatureCard('AI', 'AI Nutrition Coach', 'Meal plans from the targets you log.')}
        ${this.createFeatureCard('Stats', 'Progress', 'Track the meals and workouts you actually log.')}
        ${this.createFeatureCard('List', 'Shopping lists', 'Aisle and protein on the list. Prices vary by store and week.')}
        ${this.createFeatureCard('Train', 'Workouts', 'Training plans that follow the week you commit.')}
      </div>
    `;

    return showcase;
  }
}
