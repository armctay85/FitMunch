// Enhanced Features Module for FitMunch
// Adds advanced UI components and interactive elements

class EnhancedFeatures {
  constructor() {
    this.features = {};
    this.animations = {};
    this.testimonials = [
      {
        name: "Sarah M.",
        role: "Fitness Enthusiast",
        text: "FitMunch helped me lose 15kg in 6 months! The meal plans are so easy to follow.",
        rating: 5,
        image: "https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&q=80"
      },
      {
        name: "James L.",
        role: "Busy Professional",
        text: "Finally, an app that understands my hectic schedule. Smart shopping lists save me hours!",
        rating: 5,
        image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80"
      },
      {
        name: "Emma R.",
        role: "New Mom",
        text: "The AI recommendations are spot-on. Perfect for getting back in shape after pregnancy.",
        rating: 5,
        image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80"
      }
    ];
    this.initialize();
  }

  createFeatureShowcase() {
    const showcase = document.createElement('div');
    showcase.className = 'enhanced-features-showcase';
    showcase.innerHTML = `
      <div class="showcase-header">
        <h2>🚀 Enhanced Features</h2>
        <p>Discover what makes FitMunch the ultimate health companion</p>
      </div>

      <div class="features-grid">
        ${this.createFeatureCard('🧠', 'AI Nutrition Coach', 'Get personalized meal recommendations powered by advanced AI algorithms')}
        ${this.createFeatureCard('📊', 'Advanced Analytics', 'Track your progress with detailed insights and trends')}
        ${this.createFeatureCard('🛒', 'Smart Shopping', 'Automated grocery lists with price comparisons from major supermarkets')}
        ${this.createFeatureCard('💪', 'Custom Workouts', 'Personalized exercise plans that adapt to your fitness level')}
        ${this.createFeatureCard('🏆', 'Achievement System', 'Stay motivated with challenges, badges, and progress milestones')}
        ${this.createFeatureCard('📱', 'Mobile Optimized', 'Seamless experience across all your devices')}
      </div>

      <div class="testimonials-section">
        <h3>What Our Users Say</h3>
        <div class="testimonials-carousel">
          ${this.createTestimonialsCarousel()}
        </div>
      </div>
    `;

    return showcase;
  }

  createTestimonialsCarousel() {
    return this.testimonials.map((testimonial, index) => `
      <div class="testimonial-card ${index === 0 ? 'active' : ''}" data-index="${index}">
        <div class="testimonial-avatar">
          <img src="${testimonial.image}" alt="${testimonial.name}">
        </div>
        <div class="testimonial-content">
          <div class="testimonial-rating">
            ${'★'.repeat(testimonial.rating)}
          </div>
          <p class="testimonial-text">"${testimonial.text}"</p>
          <div class="testimonial-author">
            <strong>${testimonial.name}</strong>
            <span>${testimonial.role}</span>
          </div>
        </div>
      </div>
    `).join('');
  }
}