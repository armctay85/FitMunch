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
  trackEvent,
  db,
  schema,
} = require('./server/storage.js');
const { eq, and, desc, gte } = require('drizzle-orm');
const { Pool } = require('pg');
const _pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    if (mealData.date) mealData.date = new Date(mealData.date);
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
    if (workoutData.date) workoutData.date = new Date(workoutData.date);
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
    if (progressData.date) progressData.date = new Date(progressData.date);
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

    // Check for invite token — if present, register as client
    let role = 'pt';
    let ptId = null;
    if (req.body.inviteToken) {
      const invite = await _pool.query(
        'SELECT * FROM client_invitations WHERE token=$1 AND accepted=FALSE AND expires_at > NOW()',
        [req.body.inviteToken]
      );
      if (invite.rows[0]) {
        role = 'client';
        ptId = invite.rows[0].pt_id;
      }
    }

    const user = await createUser(email.toLowerCase(), name, passwordHash);

    // Set role and pt_id
    await _pool.query('UPDATE users SET role=$1, pt_id=$2 WHERE id=$3', [role, ptId, user.id]);

    // If client, link to PT
    if (role === 'client' && ptId && req.body.inviteToken) {
      await _pool.query(
        'INSERT INTO pt_clients (pt_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [ptId, user.id]
      );
      await _pool.query('UPDATE client_invitations SET accepted=TRUE WHERE token=$1', [req.body.inviteToken]);
    }

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role } });
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

    const roleRow = await _pool.query('SELECT role, pt_id FROM users WHERE id=$1', [user.id]);
    const role = roleRow.rows[0]?.role || 'pt';
    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, subscriptionTier: user.subscriptionTier, role } });
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

    const roleRow = await _pool.query('SELECT role, pt_id FROM users WHERE id=$1', [user.id]);
    const role = roleRow.rows[0]?.role || 'pt';
    const ptId = roleRow.rows[0]?.pt_id;
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, subscriptionTier: user.subscriptionTier, role, ptId } });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
});

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── CLIENT INVITATIONS ───────────────────────────────────────────────────────
const crypto = require('crypto');

// POST /api/clients/invite — PT creates invite link
router.post('/clients/invite', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await _pool.query(
      'INSERT INTO client_invitations (pt_id, email, token, expires_at) VALUES ($1,$2,$3,$4)',
      [req.user.userId, email || null, token, expires]
    );
    const inviteUrl = `${req.headers.origin || 'https://fitmunch.com.au'}/login.html?invite=${token}`;
    res.json({ success: true, token, inviteUrl, expiresAt: expires });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/clients/invite/:token — validate invite token
router.get('/clients/invite/:token', async (req, res) => {
  try {
    const r = await _pool.query(
      'SELECT ci.*, u.name as pt_name FROM client_invitations ci JOIN users u ON u.id=ci.pt_id WHERE ci.token=$1 AND ci.accepted=FALSE AND ci.expires_at > NOW()',
      [req.params.token]
    );
    if (!r.rows[0]) return res.status(404).json({ valid: false, error: 'Invalid or expired invite link.' });
    res.json({ valid: true, ptName: r.rows[0].pt_name, email: r.rows[0].email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PT CLIENT MANAGEMENT ─────────────────────────────────────────────────────

// GET /api/clients — PT gets their client list with recent activity
router.get('/clients', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query(`
      SELECT u.id, u.name, u.email, u.created_at, pc.status, pc.phase, pc.joined_at,
        (SELECT COUNT(*) FROM meal_logs ml WHERE ml.user_id=u.id AND ml.date > NOW()-INTERVAL '7 days') as meals_7d,
        (SELECT COUNT(*) FROM workout_logs wl WHERE wl.user_id=u.id AND wl.date > NOW()-INTERVAL '7 days') as workouts_7d,
        (SELECT MAX(ml2.date) FROM meal_logs ml2 WHERE ml2.user_id=u.id) as last_logged,
        (SELECT MAX(pl.date) FROM progress_logs pl WHERE pl.user_id=u.id) as last_progress
      FROM pt_clients pc
      JOIN users u ON u.id=pc.client_id
      WHERE pc.pt_id=$1
      ORDER BY pc.joined_at DESC
    `, [req.user.userId]);
    res.json({ success: true, clients: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/clients/:clientId — full client detail for PT
router.get('/clients/:clientId', authMiddleware, async (req, res) => {
  try {
    // Verify PT owns this client
    const owns = await _pool.query(
      'SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2', [req.user.userId, req.params.clientId]
    );
    if (!owns.rows[0]) return res.status(403).json({ error: 'Not your client' });
    const user = await getUserById(req.params.clientId);
    const profile = await getProfile(req.params.clientId);
    const meals = await getMealLogsForPeriod(req.params.clientId, new Date(Date.now()-30*86400000), new Date());
    const workouts = await getRecentWorkouts(req.params.clientId, 20);
    const progress = await getProgressHistory(req.params.clientId, 20);
    const plans = await _pool.query(
      'SELECT * FROM plan_assignments WHERE client_id=$1 AND active=TRUE', [req.params.clientId]
    );
    res.json({ success: true, client: user, profile, meals, workouts, progress, assignments: plans.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/clients/:clientId — update phase/notes/status
router.patch('/clients/:clientId', authMiddleware, async (req, res) => {
  try {
    const { phase, notes, status } = req.body;
    await _pool.query(
      'UPDATE pt_clients SET phase=$1, notes=$2, status=$3 WHERE pt_id=$4 AND client_id=$5',
      [phase, notes, status, req.user.userId, req.params.clientId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/clients/:clientId/assign-plan — PT assigns a meal or workout plan to client
router.post('/clients/:clientId/assign-plan', authMiddleware, async (req, res) => {
  try {
    const { planType, planId } = req.body;
    if (!['meal','workout'].includes(planType)) return res.status(400).json({ error: 'planType must be meal or workout' });
    // Deactivate old assignment of same type
    await _pool.query('UPDATE plan_assignments SET active=FALSE WHERE client_id=$1 AND plan_type=$2', [req.params.clientId, planType]);
    await _pool.query(
      'INSERT INTO plan_assignments (pt_id, client_id, plan_type, plan_id) VALUES ($1,$2,$3,$4)',
      [req.user.userId, req.params.clientId, planType, planId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SHOPPING LISTS ────────────────────────────────────────────────────────────

// POST /api/shopping-list/generate — auto-generate from a meal plan
router.post('/shopping-list/generate', authMiddleware, async (req, res) => {
  try {
    const { mealPlanId, name } = req.body;
    // Get the meal plan
    const plan = await _pool.query('SELECT * FROM meal_plans WHERE id=$1', [mealPlanId]);
    if (!plan.rows[0]) return res.status(404).json({ error: 'Meal plan not found' });
    const meals = plan.rows[0].meals || [];
    
    // Extract ingredients, group by category
    const itemMap = {};
    const CATEGORIES = {
      meat: ['chicken','beef','pork','turkey','lamb','fish','salmon','tuna','egg','eggs','prawn','shrimp'],
      dairy: ['milk','yogurt','yoghurt','cheese','cream','butter','whey'],
      grains: ['rice','oats','bread','pasta','noodle','quinoa','wheat','flour','cereal','wrap','tortilla'],
      vegetables: ['broccoli','spinach','kale','carrot','onion','garlic','tomato','capsicum','pepper','zucchini','cucumber','lettuce','asparagus','avocado','celery'],
      fruit: ['apple','banana','orange','berry','berries','grape','mango','pear','strawberry','blueberry'],
      pantry: ['oil','sauce','spice','salt','pepper','vinegar','honey','syrup','sugar','protein powder','supplement'],
      other: [],
    };
    function categorise(name) {
      const n = name.toLowerCase();
      for (const [cat, words] of Object.entries(CATEGORIES)) {
        if (words.some(w => n.includes(w))) return cat;
      }
      return 'other';
    }
    
    // Walk meals structure — support array or object
    const mealItems = Array.isArray(meals) ? meals : Object.values(meals).flat();
    mealItems.forEach(day => {
      const dayMeals = Array.isArray(day) ? day : (day.meals ? Object.values(day.meals).flat() : [day]);
      dayMeals.forEach(item => {
        const foodName = item.name || item.foodName || item.food || String(item);
        if (!foodName || foodName === '[object Object]') return;
        const key = foodName.toLowerCase().trim();
        if (itemMap[key]) {
          itemMap[key].qty = (parseFloat(itemMap[key].qty) || 1) + 1;
        } else {
          itemMap[key] = {
            name: foodName,
            qty: item.servingSize || item.quantity || 1,
            unit: item.unit || '',
            category: categorise(foodName),
            checked: false,
          };
        }
      });
    });
    
    const items = Object.values(itemMap).sort((a,b) => a.category.localeCompare(b.category));
    const list = await _pool.query(
      'INSERT INTO shopping_lists (user_id, meal_plan_id, name, items) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.userId, mealPlanId, name || plan.rows[0].name + ' — Shopping List', JSON.stringify(items)]
    );
    res.json({ success: true, list: list.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/shopping-list — get all shopping lists for user
router.post('/shopping-list', authMiddleware, async (req, res) => {
  try {
    const { name, items = [] } = req.body;
    const result = await _pool.query(
      `INSERT INTO shopping_lists (user_id, name, items) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.userId, name || 'My List', JSON.stringify(items)]
    );
    res.json({ success: true, list: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/shopping-list', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM shopping_lists WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, lists: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/shopping-list/:id — single list
router.get('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM shopping_lists WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, list: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/shopping-list/:id — update items (check/uncheck) or complete
router.patch('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    const { items, completed } = req.body;
    const sets = [];
    const vals = [];
    let i = 1;
    if (items !== undefined) { sets.push(`items=$${i++}`); vals.push(JSON.stringify(items)); }
    if (completed !== undefined) { sets.push(`completed=$${i++}`); vals.push(completed); }
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id, req.user.userId);
    await _pool.query(`UPDATE shopping_lists SET ${sets.join(',')} WHERE id=$${i++} AND user_id=$${i++}`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/shopping-list/:id
router.delete('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM shopping_lists WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FAVOURITES ────────────────────────────────────────────────────────────────

// GET /api/favourites — get all favourites for user
router.get('/favourites', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM favourites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, favourites: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/favourites — add a favourite
router.post('/favourites', authMiddleware, async (req, res) => {
  try {
    const { itemType, itemId, itemData } = req.body;
    const r = await _pool.query(
      'INSERT INTO favourites (user_id, item_type, item_id, item_data) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, item_type, item_id) DO NOTHING RETURNING *',
      [req.user.userId, itemType, String(itemId), JSON.stringify(itemData || {})]
    );
    res.json({ success: true, favourite: r.rows[0] || null, alreadyExists: !r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/favourites/:type/:itemId — remove a favourite
router.delete('/favourites/:type/:itemId', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM favourites WHERE user_id=$1 AND item_type=$2 AND item_id=$3',
      [req.user.userId, req.params.type, req.params.itemId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── MEAL PLANS (CRUD) ─────────────────────────────────────────────────────────

router.get('/meal-plans', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM meal_plans WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, plans: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/meal-plans', authMiddleware, async (req, res) => {
  try {
    const { name, description, goalType, meals, totalCalories, totalProtein, totalCarbs, totalFat } = req.body;
    const r = await _pool.query(
      'INSERT INTO meal_plans (user_id, name, description, goal_type, meals, total_calories, total_protein, total_carbs, total_fat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.userId, name, description, goalType, JSON.stringify(meals||[]), totalCalories||0, totalProtein||0, totalCarbs||0, totalFat||0]
    );
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/meal-plans/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM meal_plans WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WORKOUT PLANS (CRUD) ──────────────────────────────────────────────────────

router.get('/workout-plans', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM workout_plans WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, plans: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/workout-plans', authMiddleware, async (req, res) => {
  try {
    const { name, description, level, frequency, workouts } = req.body;
    const r = await _pool.query(
      'INSERT INTO workout_plans (user_id, name, description, level, frequency, workouts) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.userId, name, description, level, frequency||3, JSON.stringify(workouts||[])]
    );
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/workout-plans/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM workout_plans WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CLIENT PORTAL (for clients to get their assigned data) ───────────────────
router.get('/portal/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.userId);
    const profile = await getProfile(req.user.userId);
    // Get assigned plans
    const assigned = await _pool.query(
      'SELECT pa.*, mp.name as meal_plan_name, mp.meals, mp.total_calories, wp.name as workout_plan_name, wp.workouts FROM plan_assignments pa LEFT JOIN meal_plans mp ON pa.plan_id=mp.id AND pa.plan_type=\'meal\' LEFT JOIN workout_plans wp ON pa.plan_id=wp.id AND pa.plan_type=\'workout\' WHERE pa.client_id=$1 AND pa.active=TRUE',
      [req.user.userId]
    );
    const mealAssignment = assigned.rows.find(r => r.plan_type === 'meal');
    const workoutAssignment = assigned.rows.find(r => r.plan_type === 'workout');
    // Shopping lists
    const lists = await _pool.query('SELECT * FROM shopping_lists WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.userId]);
    // Recent logs
    const meals = await getMealLogsForPeriod(req.user.userId, new Date(Date.now()-7*86400000), new Date());
    const workouts = await getRecentWorkouts(req.user.userId, 10);
    const progress = await getProgressHistory(req.user.userId, 10);
    const favs = await _pool.query('SELECT * FROM favourites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    // PT info
    const ptRow = await _pool.query('SELECT u.name, u.email FROM pt_clients pc JOIN users u ON u.id=pc.pt_id WHERE pc.client_id=$1', [req.user.userId]);
    res.json({
      success: true, user, profile,
      mealPlan: mealAssignment,
      workoutPlan: workoutAssignment,
      shoppingLists: lists.rows,
      recentMeals: meals,
      recentWorkouts: workouts,
      progress,
      favourites: favs.rows,
      pt: ptRow.rows[0] || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
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