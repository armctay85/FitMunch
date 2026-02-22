// FitMunch API Server
// This module provides API endpoints for the FitMunch app

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// Import database functions
const {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserSubscription,
  createOrUpdateProfile,
  getProfile,
  logMeal,
  getMealLogsByDate,
  getMealLogsForPeriod,
  logWorkout,
  getWorkoutLogsByDate,
  getRecentWorkouts,
  logProgress,
  getProgressHistory,
  trackEvent
} = require('./server/storage.js');

class ApiServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.server = null;
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use(cors());

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // User authentication routes
    this.app.post('/api/users/register', this.handleUserRegister.bind(this));
    this.app.post('/api/users/login', this.handleUserLogin.bind(this));

    // Receipt validation route
    this.app.post('/api/validate-receipt', this.handleReceiptValidation.bind(this));

    // Subscription management routes
    this.app.post('/api/subscriptions', this.handleCreateSubscription.bind(this));
    this.app.get('/api/subscriptions/:userId', this.handleGetSubscription.bind(this));

    // Data synchronization routes
    this.app.post('/api/sync/profile', this.handleProfileSync.bind(this));
    this.app.post('/api/sync/workouts', this.handleWorkoutsSync.bind(this));
    this.app.post('/api/sync/meals', this.handleMealsSync.bind(this));

    // Health check route
    this.app.get('/api/health', (req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Fallback route
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'API endpoint not found' });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
          console.log(`API server running on http://0.0.0.0:${this.port}`);
          resolve(this.port);
        });
      } catch (error) {
        console.error('Failed to start API server:', error);
        reject(error);
      }
    });
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close(err => {
          if (err) {
            console.error('Error closing API server:', err);
            reject(err);
          } else {
            console.log('API server stopped');
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  // Route handlers
  handleUserRegister(req, res) {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // In a real app, this would validate inputs and create a user in the database
    // For demo purposes, we'll simulate a successful registration
    res.status(201).json({
      id: Math.random().toString(36).substring(2, 15),
      username,
      email,
      createdAt: new Date().toISOString()
    });
  }

  handleUserLogin(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    // In a real app, this would validate credentials against a database
    // For demo purposes, we'll accept a test account
    if (email === 'test@example.com' && password === 'password') {
      res.status(200).json({
        id: '123456',
        username: 'testuser',
        email: 'test@example.com',
        token: 'dummy-jwt-token-' + Date.now(),
        expiresIn: 3600
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  }

  handleReceiptValidation(req, res) {
    const { receipt, productId, userId } = req.body;

    if (!receipt || !productId) {
      return res.status(400).json({ error: 'Missing receipt or product ID' });
    }

    // In a real app, this would validate the receipt with Apple/Google
    // For demo purposes, we'll simulate validation
    const isValid = Math.random() < 0.95; // 95% success rate

    if (isValid) {
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month subscription

      res.status(200).json({
        isValid: true,
        purchaseDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        productId,
        orderId: receipt.orderId || `order-${Date.now()}`,
        purchaseToken: receipt.purchaseToken,
        validatedAt: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        isValid: false,
        error: 'Invalid receipt'
      });
    }
  }

  handleCreateSubscription(req, res) {
    const { userId, planId, receipt } = req.body;

    if (!userId || !planId) {
      return res.status(400).json({ error: 'Missing user ID or plan ID' });
    }

    // In a real app, this would create a subscription record in the database
    // For demo purposes, we'll simulate a successful subscription
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month subscription

    res.status(201).json({
      userId,
      planId,
      startDate: new Date().toISOString(),
      endDate: expiryDate.toISOString(),
      status: 'active'
    });
  }

  handleGetSubscription(req, res) {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing user ID' });
    }

    // In a real app, this would fetch subscription data from a database
    // For demo purposes, we'll return a simulated subscription
    res.status(200).json({
      userId,
      planId: 'free', // Default plan
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      status: 'active'
    });
  }

  handleProfileSync(req, res) {
    const { userId, profile, timestamp } = req.body;

    if (!userId || !profile) {
      return res.status(400).json({ error: 'Missing user ID or profile data' });
    }

    // In a real app, this would sync with a database
    // For demo purposes, we'll just acknowledge the sync
    res.status(200).json({
      status: 'success',
      syncedAt: new Date().toISOString(),
      profile: {
        ...profile,
        lastSynced: new Date().toISOString()
      }
    });
  }

  handleWorkoutsSync(req, res) {
    const { userId, workouts, timestamp } = req.body;

    if (!userId || !workouts) {
      return res.status(400).json({ error: 'Missing user ID or workout data' });
    }

    // In a real app, this would sync with a database
    // For demo purposes, we'll just acknowledge the sync
    res.status(200).json({
      status: 'success',
      syncedAt: new Date().toISOString(),
      workoutsCount: Array.isArray(workouts) ? workouts.length : 1
    });
  }

  handleMealsSync(req, res) {
    const { userId, meals, timestamp } = req.body;

    if (!userId || !meals) {
      return res.status(400).json({ error: 'Missing user ID or meal data' });
    }

    // In a real app, this would sync with a database
    // For demo purposes, we'll just acknowledge the sync
    res.status(200).json({
      status: 'success',
      syncedAt: new Date().toISOString(),
      mealsCount: Array.isArray(meals) ? meals.length : 1
    });
  }
}

// Create and export a router instance for use as middleware
const router = express.Router();

// User Profile API routes
router.get('/user/profile/:userId', async (req, res) => {
  try {
    const profile = await getProfile(req.params.userId);
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/user/profile', async (req, res) => {
  try {
    const { userId, ...profileData } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    await createOrUpdateProfile(userId, profileData);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Meal Logging API routes
router.post('/meals/log', async (req, res) => {
  try {
    const { userId, ...mealData } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    const meal = await logMeal(userId, mealData);
    res.json({ success: true, meal });
  } catch (error) {
    console.error('Error logging meal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/meals/daily/:userId/:date', async (req, res) => {
  try {
    const { userId, date } = req.params;
    const meals = await getMealLogsByDate(userId, new Date(date));
    res.json({ success: true, meals });
  } catch (error) {
    console.error('Error fetching daily meals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Workout Logging API routes
router.post('/workouts/log', async (req, res) => {
  try {
    const { userId, ...workoutData } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    const workout = await logWorkout(userId, workoutData);
    res.json({ success: true, workout });
  } catch (error) {
    console.error('Error logging workout:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/workouts/history/:userId', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const workouts = await getRecentWorkouts(req.params.userId, limit);
    res.json({ success: true, workouts });
  } catch (error) {
    console.error('Error fetching workout history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Progress Tracking API routes
router.post('/progress/log', async (req, res) => {
  try {
    const { userId, ...progressData } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    const progress = await logProgress(userId, progressData);
    res.json({ success: true, progress });
  } catch (error) {
    console.error('Error logging progress:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/progress/history/:userId', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const history = await getProgressHistory(req.params.userId, limit);
    res.json({ success: true, history });
  } catch (error) {
    console.error('Error fetching progress history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Analytics API routes
router.post('/analytics/events', async (req, res) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ success: false, error: 'Invalid events data' });
    }
    for (const event of events) {
      await trackEvent(
        event.userId || null,
        event.eventType,
        event.eventData,
        event.sessionId
      );
    }
    res.json({ success: true, eventsProcessed: events.length });
  } catch (error) {
    console.error('Error tracking analytics events:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── AUTH ROUTES (real JWT + bcrypt + PostgreSQL) ──────────────────────────────
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const JWT_EXPIRES = '30d';
const SALT_ROUNDS = 12;

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, error: 'Name, email and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });

    const existing = await getUserByEmail(email.toLowerCase());
    if (existing)
      return res.status(409).json({ success: false, error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email.toLowerCase(), name, passwordHash);

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, error: 'Email and password are required.' });

    const user = await getUserByEmail(email.toLowerCase());
    if (!user)
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, subscriptionTier: user.subscriptionTier } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me  — verify token + return user info
router.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ success: false, error: 'No token provided.' });

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.userId);
    if (!user)
      return res.status(401).json({ success: false, error: 'User not found.' });

    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, subscriptionTier: user.subscriptionTier } });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
});

// Export router for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = router;
}

// If this file is run directly (not imported), start a standalone server
if (require.main === module) {
  const apiServer = new ApiServer();
  apiServer.start().catch(console.error);
}