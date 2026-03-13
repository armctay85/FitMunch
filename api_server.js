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

// ── OWNERSHIP CHECK HELPER ────────────────────────────────────────────────────
// Allows access if: requester is the user themselves, OR requester is a PT with that client
async function canAccessUser(requesterId, targetUserId) {
  if (requesterId === targetUserId) return true;
  // Check if requester is a PT with targetUserId as their client
  const r = await _pool.query(
    'SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2 AND status=$3',
    [requesterId, targetUserId, 'active']
  );
  return r.rows.length > 0;
}

// User Profile API routes
router.get('/user/profile/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const profile = await getProfile(req.params.userId);
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/user/profile', authMiddleware, async (req, res) => {
  try {
    const profileData = { ...req.body };
    delete profileData.userId; // ignore body userId — use token
    await createOrUpdateProfile(req.user.userId, profileData);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Meal Logging API routes
router.post('/meals/log', authMiddleware, async (req, res) => {
  try {
    const mealData = { ...req.body };
    delete mealData.userId; // ignore body userId — use token
    if (mealData.date) mealData.date = new Date(mealData.date);
    const meal = await logMeal(req.user.userId, mealData);
    res.json({ success: true, meal });
  } catch (error) {
    console.error('Error logging meal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/meals/daily/:userId/:date', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const meals = await getMealLogsByDate(req.params.userId, new Date(req.params.date));
    res.json({ success: true, meals });
  } catch (error) {
    console.error('Error fetching daily meals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Workout Logging API routes
router.post('/workouts/log', authMiddleware, async (req, res) => {
  try {
    const workoutData = { ...req.body };
    delete workoutData.userId; // ignore body userId — use token
    if (workoutData.date) workoutData.date = new Date(workoutData.date);
    const workout = await logWorkout(req.user.userId, workoutData);
    res.json({ success: true, workout });
  } catch (error) {
    console.error('Error logging workout:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/workouts/history/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const limit = parseInt(req.query.limit) || 30;
    const workouts = await getRecentWorkouts(req.params.userId, limit);
    res.json({ success: true, workouts });
  } catch (error) {
    console.error('Error fetching workout history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Progress Tracking API routes
router.post('/progress/log', authMiddleware, async (req, res) => {
  try {
    const progressData = { ...req.body };
    delete progressData.userId; // ignore body userId — use token
    if (progressData.date) progressData.date = new Date(progressData.date);
    const progress = await logProgress(req.user.userId, progressData);
    res.json({ success: true, progress });
  } catch (error) {
    console.error('Error logging progress:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/progress/history/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
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

    // Set role, pt_id, and 14-day trial
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + 14);
    await _pool.query(
      'UPDATE users SET role=$1, pt_id=$2, subscription_expires_at=$3 WHERE id=$4',
      [role, ptId, trialExpiresAt, user.id]
    );

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

router.put('/meal-plans/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, goalType, meals, totalCalories, totalProtein, totalCarbs, totalFat } = req.body;
    // Compute totals from meals if provided
    let calcCalories = totalCalories, calcProtein = totalProtein, calcCarbs = totalCarbs, calcFat = totalFat;
    if (meals && Array.isArray(meals)) {
      const allFoods = meals.flatMap(m => m.foods || []);
      calcCalories = allFoods.reduce((s,f) => s+(f.calories||0), 0) || totalCalories || 0;
      calcProtein  = allFoods.reduce((s,f) => s+(f.protein||0), 0) || totalProtein  || 0;
      calcCarbs    = allFoods.reduce((s,f) => s+(f.carbs||0),   0) || totalCarbs    || 0;
      calcFat      = allFoods.reduce((s,f) => s+(f.fat||0),     0) || totalFat      || 0;
    }
    const r = await _pool.query(
      `UPDATE meal_plans SET name=COALESCE($1,name), description=COALESCE($2,description),
       goal_type=COALESCE($3,goal_type), meals=COALESCE($4,meals),
       total_calories=COALESCE($5,total_calories), total_protein=COALESCE($6,total_protein),
       total_carbs=COALESCE($7,total_carbs), total_fat=COALESCE($8,total_fat), updated_at=NOW()
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [name, description, goalType, meals ? JSON.stringify(meals) : null,
       calcCalories, calcProtein, calcCarbs, calcFat, req.params.id, req.user.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan not found' });
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

router.put('/workout-plans/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, level, frequency, workouts } = req.body;
    const r = await _pool.query(
      `UPDATE workout_plans SET name=COALESCE($1,name), description=COALESCE($2,description),
       level=COALESCE($3,level), frequency=COALESCE($4,frequency),
       workouts=COALESCE($5,workouts), updated_at=NOW()
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name, description, level, frequency, workouts ? JSON.stringify(workouts) : null,
       req.params.id, req.user.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/workout-plans/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM workout_plans WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AI COACHING INSIGHT ───────────────────────────────────────────────────────
router.post('/ai/insight', authMiddleware, async (req, res) => {
  try {
    const { todayCalories = 0, todayProtein = 0, streak = 0, goal = 'general_fitness', targetCalories = 2000, targetProtein = 150 } = req.body;
    const calPct = targetCalories > 0 ? Math.round((todayCalories / targetCalories) * 100) : 0;
    const protPct = targetProtein > 0 ? Math.round((todayProtein / targetProtein) * 100) : 0;

    const goalLabel = { weight_loss: 'weight loss', muscle_gain: 'muscle gain', maintenance: 'maintenance', general_fitness: 'general fitness' }[goal] || 'your goals';

    let insight = '';

    // Build smart coaching tip based on context
    if (todayCalories === 0 && todayProtein === 0) {
      const motivators = [
        `Fresh day, fresh start 🌅 Log your first meal to kick off your ${goalLabel} journey today.`,
        `Nothing logged yet — no stress. Your next meal is the only one that matters right now. Log it and let's go.`,
        `Day ${streak > 0 ? streak + 1 : 1} begins. Log your first meal and keep the momentum going 💪`,
      ];
      insight = motivators[streak % motivators.length];
    } else if (calPct < 40 && protPct < 40) {
      insight = `You're at ${calPct}% of your calorie target and ${protPct}% of your protein goal for today. Front-loading food earlier in the day tends to reduce evening snacking — try fitting in a balanced meal soon.`;
    } else if (protPct < 50 && calPct > 60) {
      insight = `Calories are on track but protein is lagging at ${protPct}% of your ${targetProtein}g target. Try adding a high-protein snack (Greek yoghurt, cottage cheese, or a protein shake) to close the gap without blowing your calorie budget.`;
    } else if (calPct > 110) {
      insight = goal === 'muscle_gain'
        ? `You're at ${calPct}% of your calorie target — solid surplus for muscle growth. Make sure that extra energy is hitting with strong protein numbers too.`
        : `You've hit ${calPct}% of your calorie target today. If you're still hungry, prioritise high-volume, low-calorie options like veggies or broth-based soups to stay satiated without overshooting.`;
    } else if (calPct >= 80 && protPct >= 80) {
      const wins = [
        `On track — ${calPct}% calories and ${protPct}% protein hit for the day. Stay consistent and the results will follow 🏆`,
        `Solid numbers today. ${streak > 2 ? `${streak}-day logging streak` : 'Keep this up'} and you'll be seeing results before you know it.`,
        `You're dialled in: ${calPct}% of calories, ${protPct}% of protein. Keep that energy going into your workout.`,
      ];
      insight = wins[Math.floor(Math.random() * wins.length)];
    } else if (streak >= 7) {
      insight = `${streak}-day streak 🔥 — that kind of consistency is how results actually happen. Protein at ${protPct}% today; push it over the line for a perfect day.`;
    } else {
      insight = `${calPct}% of calories and ${protPct}% of protein logged so far. ${protPct < 70 ? `Boost protein with a high-protein snack to hit your ${targetProtein}g target.` : `You're on a good path — keep going.`}`;
    }

    res.json({ success: true, insight });
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

// ── PT Referral System ──────────────────────────────────────────────────────

// Get or generate a referral code for logged-in PT
router.get('/referral/code', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS pt_referrals (
      id SERIAL PRIMARY KEY,
      pt_id INTEGER UNIQUE REFERENCES users(id),
      code TEXT UNIQUE NOT NULL,
      uses INTEGER DEFAULT 0,
      credits INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    let row = await pool.query('SELECT * FROM pt_referrals WHERE pt_id=$1', [req.user.userId]);
    if (!row.rows.length) {
      const code = 'FM-' + Math.random().toString(36).substring(2,8).toUpperCase();
      row = await pool.query(
        'INSERT INTO pt_referrals (pt_id, code) VALUES ($1,$2) RETURNING *',
        [req.user.userId, code]
      );
    }
    const ref = row.rows[0];
    res.json({
      success: true,
      code: ref.code,
      uses: ref.uses,
      credits: ref.credits,
      link: `https://fitmunch.com.au/login.html?plan=starter&ref=${ref.code}`
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Claim a referral code at signup (extends trial by 30 days for referrer)
router.post('/referral/claim', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    const pool = getPool();
    const ref = await pool.query('SELECT * FROM pt_referrals WHERE code=$1', [code.toUpperCase()]);
    if (!ref.rows.length) return res.status(404).json({ error: 'Invalid referral code' });
    const referrer = ref.rows[0];
    if (referrer.pt_id === req.user.userId) return res.status(400).json({ error: 'Cannot use your own code' });
    // Give referrer 30 extra days
    await pool.query(
      'UPDATE users SET subscription_expires_at = COALESCE(subscription_expires_at, NOW()) + INTERVAL \'30 days\' WHERE id=$1',
      [referrer.pt_id]
    );
    await pool.query('UPDATE pt_referrals SET uses=uses+1, credits=credits+1 WHERE code=$1', [code.toUpperCase()]);
    // Give new PT 7 extra trial days (on top of 14-day default)
    await pool.query(
      'UPDATE users SET subscription_expires_at = COALESCE(subscription_expires_at, NOW()) + INTERVAL \'7 days\' WHERE id=$1',
      [req.user.userId]
    );
    console.log(`[referral] ${code} used by user ${req.user.userId} — referrer ${referrer.pt_id} gets +30 days`);
    res.json({ success: true, bonus: '7 extra trial days added to your account' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shopping-list/budget — generate shopping list from nutritional targets + budget
// Advertised feature: "150g protein/day on $80/week → here's what to buy"
router.post('/shopping-list/budget', authMiddleware, async (req, res) => {
  try {
    const { protein = 150, calories = 2200, budget = 80, days = 7 } = req.body;

    // AU supermarket staples with approx Woolies/Coles prices (AUD)
    const STAPLES = [
      { name: 'Chicken breast (1kg)', price: 9.00, proteinPer100g: 22, calsPer100g: 110, grams: 1000, category: 'meat' },
      { name: 'Beef mince 500g', price: 7.00, proteinPer100g: 21, calsPer100g: 153, grams: 500, category: 'meat' },
      { name: 'Eggs (12 pack)', price: 6.00, proteinPer100g: 13, calsPer100g: 155, grams: 660, category: 'dairy' },
      { name: 'Greek yoghurt (1kg)', price: 5.50, proteinPer100g: 9, calsPer100g: 59, grams: 1000, category: 'dairy' },
      { name: 'Cottage cheese 500g', price: 4.00, proteinPer100g: 11, calsPer100g: 98, grams: 500, category: 'dairy' },
      { name: 'Canned tuna (4 pack)', price: 5.00, proteinPer100g: 27, calsPer100g: 116, grams: 400, category: 'meat' },
      { name: 'Rolled oats 1kg', price: 3.50, proteinPer100g: 13, calsPer100g: 389, grams: 1000, category: 'grains' },
      { name: 'Brown rice 2kg', price: 4.50, proteinPer100g: 8, calsPer100g: 370, grams: 2000, category: 'grains' },
      { name: 'Sweet potato 1kg', price: 4.00, proteinPer100g: 2, calsPer100g: 86, grams: 1000, category: 'vegetables' },
      { name: 'Broccoli (bunch)', price: 2.50, proteinPer100g: 3, calsPer100g: 34, grams: 400, category: 'vegetables' },
      { name: 'Spinach 250g bag', price: 3.00, proteinPer100g: 3, calsPer100g: 23, grams: 250, category: 'vegetables' },
      { name: 'Banana bunch (~6)', price: 2.80, proteinPer100g: 1, calsPer100g: 89, grams: 600, category: 'fruit' },
      { name: 'Olive oil 500mL', price: 7.00, proteinPer100g: 0, calsPer100g: 884, grams: 500, category: 'pantry' },
      { name: 'Whey protein 1kg', price: 35.00, proteinPer100g: 75, calsPer100g: 380, grams: 1000, category: 'supplements' },
      { name: 'Milk 2L', price: 3.20, proteinPer100g: 3.4, calsPer100g: 65, grams: 2000, category: 'dairy' },
      { name: 'Almonds 500g', price: 9.00, proteinPer100g: 21, calsPer100g: 579, grams: 500, category: 'pantry' },
      { name: 'Peanut butter 375g', price: 4.50, proteinPer100g: 25, calsPer100g: 588, grams: 375, category: 'pantry' },
      { name: 'Frozen mixed veg 1kg', price: 3.50, proteinPer100g: 3, calsPer100g: 70, grams: 1000, category: 'vegetables' },
      { name: 'Salmon portions 500g', price: 14.00, proteinPer100g: 20, calsPer100g: 208, grams: 500, category: 'meat' },
    ];

    const dailyProtein = protein;
    const dailyCalories = calories;
    const weeklyBudget = budget;

    // Score each item by protein per dollar (higher = better value)
    const scored = STAPLES.map(item => ({
      ...item,
      totalProtein: (item.proteinPer100g / 100) * item.grams,
      totalCalories: (item.calsPer100g / 100) * item.grams,
      proteinPerDollar: ((item.proteinPer100g / 100) * item.grams) / item.price,
    })).sort((a, b) => b.proteinPerDollar - a.proteinPerDollar);

    // Greedy selection: always include high-protein staples first
    const selected = [];
    let totalCost = 0;
    let weeklyProtein = 0;
    let weeklyCalories = 0;

    // Always include eggs and at least one protein source
    const mustHave = ['Chicken breast (1kg)', 'Eggs (12 pack)', 'Rolled oats 1kg'];
    mustHave.forEach(name => {
      const item = scored.find(i => i.name === name);
      if (item && totalCost + item.price <= weeklyBudget) {
        selected.push(item);
        totalCost += item.price;
        weeklyProtein += item.totalProtein;
        weeklyCalories += item.totalCalories;
      }
    });

    // Fill remaining budget with best value items
    for (const item of scored) {
      if (selected.find(s => s.name === item.name)) continue;
      if (totalCost + item.price > weeklyBudget * 1.05) continue; // 5% over budget tolerance
      selected.push(item);
      totalCost += item.price;
      weeklyProtein += item.totalProtein;
      weeklyCalories += item.totalCalories;
      if (selected.length >= 12) break;
    }

    const dailyAvgProtein = Math.round(weeklyProtein / days);
    const dailyAvgCalories = Math.round(weeklyCalories / days);
    const meetsProtein = dailyAvgProtein >= dailyProtein * 0.85;
    const meetsCalories = dailyAvgCalories >= dailyCalories * 0.75;

    // Save as a shopping list
    const pool = getPool();
    const listItems = selected.map(i => ({
      name: i.name,
      price: i.price,
      category: i.category,
      protein: Math.round(i.totalProtein),
      calories: Math.round(i.totalCalories),
      checked: false,
    }));
    const saved = await pool.query(
      `INSERT INTO shopping_lists (user_id, name, items) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.userId, `${protein}g protein / $${budget} budget — ${new Date().toLocaleDateString('en-AU')}`, JSON.stringify(listItems)]
    );

    res.json({
      success: true,
      list: saved.rows[0],
      items: listItems,
      summary: {
        totalCost: Math.round(totalCost * 100) / 100,
        dailyProtein: dailyAvgProtein,
        dailyCalories: dailyAvgCalories,
        meetsProteinTarget: meetsProtein,
        meetsCalorieTarget: meetsCalories,
        message: meetsProtein
          ? `✅ Hits ~${dailyAvgProtein}g protein/day on $${Math.round(totalCost * 100) / 100}/week`
          : `⚠️ ~${dailyAvgProtein}g protein/day — add whey protein to hit ${dailyProtein}g target`,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PT lead capture — no auth required, public endpoint
router.post('/pt-leads', async (req, res) => {
  try {
    const { email, source } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    const pool = getPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pt_leads (id SERIAL PRIMARY KEY, email TEXT UNIQUE, source TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`
    );
    await pool.query(
      `INSERT INTO pt_leads (email, source) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET source=EXCLUDED.source`,
      [email.toLowerCase().trim(), source || 'landing']
    );
    console.log(`[pt-lead] captured: ${email} via ${source}`);
    res.json({ success: true });
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