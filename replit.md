# Overview

FitMunch is a comprehensive health and fitness companion application that helps users track nutrition, plan meals, manage workouts, and achieve their wellness goals. The app combines meal planning, workout tracking, recipe management, and progress monitoring in a unified platform, featuring AI-powered recommendations and subscription-based premium features.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Single Page Application (SPA)**: Built with vanilla HTML, CSS, and JavaScript for simplicity and performance
- **Responsive Design**: Mobile-first approach with CSS Grid and Flexbox for cross-device compatibility
- **Component-based UI**: Modular components for navigation, forms, and feature sections
- **Progressive Web App (PWA)**: Includes manifest file and service worker capabilities for app-like experience

## Backend Architecture
- **API Server**: Express.js-based server with comprehensive REST API endpoints
- **Database**: PostgreSQL with Drizzle ORM for all data persistence
- **Storage Strategy**: 
  - PostgreSQL database for all user data (profiles, meals, workouts, progress, analytics)
  - Auto-provisioning system for user creation
  - UUID-based user identification (RFC 4122 v4 format)
  - LocalStorage only for user ID persistence (no data storage)

## Authentication & User Management
- **User Account System**: Complete registration, login, and profile management
- **Session Management**: Token-based authentication with automatic logout
- **Cross-device Sync**: Cloud-based data synchronization across multiple devices
- **Privacy Controls**: User data encryption and secure storage practices

## Subscription & Monetization
- **Tiered Subscription Model**: Free, Basic ($5.99), Premium ($12.99), and Pro Coach ($29.99) plans
- **In-App Purchase Integration**: Supports both iOS App Store and Google Play billing
- **Receipt Validation**: Server-side validation for purchase verification
- **Subscription Management**: User-friendly subscription controls and billing management

## Data Management
- **Database-first Architecture**: PostgreSQL for all data persistence with Drizzle ORM
- **9 Database Tables**: users, user_profiles, meal_logs, workout_logs, progress_logs, meal_plans, workout_plans, achievements, analytics_events
- **Data Models**: 
  - User profiles with fitness goals, dietary preferences, and target macros
  - Meal logging with nutrition tracking (calories, protein, carbs, fat, fiber)
  - Workout logs with exercise details and calorie tracking
  - Progress tracking with weight, body fat %, and measurements
  - Analytics events for user behavior tracking
- **11 REST API Endpoints**: Complete CRUD operations for all features
- **Auto-provisioning**: Automatic user creation on first use to prevent foreign key violations

## Mobile Integration
- **Capacitor Framework**: Cross-platform mobile app development using web technologies
- **Native Features**: Push notifications, health data integration (HealthKit/Google Fit), camera access
- **Platform-specific Optimizations**: iOS and Android specific UI adjustments and feature implementations
- **Offline Capabilities**: Core functionality available without internet connection

## External Dependencies

- **UI Frameworks**: Font Awesome for icons, custom CSS framework for styling
- **Development Tools**: 
  - Capacitor for mobile app compilation
  - Jest for testing framework
  - Express.js for API server
- **Analytics**: PostgreSQL-backed analytics with event tracking to analytics_events table
- **Health Integrations**: 
  - Apple HealthKit for iOS health data
  - Google Fit for Android fitness tracking
- **Payment Processing**: 
  - Apple In-App Purchases for iOS
  - Google Play Billing for Android
  - Stripe integration for web-based payments
- **Cloud Services**: 
  - Receipt validation services for App Store and Play Store
  - Push notification services
  - Cloud storage for data synchronization
- **Third-party APIs**: 
  - Nutrition data APIs for food information
  - Recipe databases for meal planning
  - Fitness tracking integrations

## Recent Changes (November 2, 2025)

### File Cleanup & Optimization
- Reduced public folder from 75+ to 48 files (36% reduction)
- Removed duplicate files, development tools, and unnecessary build scripts
- Cleaned up analytics files and test files

### Database Architecture
- Implemented PostgreSQL with Drizzle ORM
- Created 9 database tables with proper foreign keys and constraints
- Converted TypeScript schema to JavaScript for compatibility
- Added auto-provisioning system to prevent foreign key violations

### API Backend (11 Endpoints)
- POST /api/user/profile - Save user profile
- GET /api/user/profile/:userId - Get user profile
- POST /api/meals/log - Log meals
- GET /api/meals/daily/:userId/:date - Get daily meals
- POST /api/workouts/log - Log workouts
- GET /api/workouts/history/:userId - Get workout history
- POST /api/progress/log - Log progress
- GET /api/progress/history/:userId - Get progress history
- POST /api/analytics/events - Track analytics events
- GET /api/recommendations/meals/:userId - Get meal recommendations
- GET /api/recommendations/workouts/:userId - Get workout recommendations

### Frontend Integration
- Fixed critical bug: upgradeToEremium() → upgradeToPremium()
- Created global window.fitMunchAPI object for API access
- Fixed "fitMunchAPI is not defined" errors
- Implemented loading states with window.showLoading()
- Updated Service Worker to v1.3.0 with cache-busting
- Implemented RFC 4122 v4 UUID generation for user IDs
- Added automatic migration from old user IDs

### Performance & Security
- Fixed database connection timeout (2s → 30s)
- Fixed rate limiting trust proxy warnings
- Helmet.js security headers configured
- CORS configured for API access
- Body size limits (1mb) for security
- Gzip compression enabled

### Testing & Verification
- Created test_api_endpoints.js for automated testing
- 9/9 endpoints tested and verified (100% success rate)
- Database persistence confirmed
- Foreign key constraints working correctly
- No mock data - all endpoints use real database