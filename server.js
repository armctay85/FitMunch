require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
// Custom domain configuration (simplified for Replit)
const configureCustomDomain = (app) => {
  // Basic configuration for Replit environment
  app.set('trust proxy', true);
};
// Initialize Stripe only if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.log('Warning: STRIPE_SECRET_KEY not found. Stripe functionality will be disabled.');
}

const app = express();

// Security: Enhanced Helmet configuration with Replit preview support
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      frameAncestors: ["'self'"], // Allow Replit preview
      scriptSrcAttr: ["'unsafe-inline'"], // Allow onclick="" handlers (app uses inline event handlers throughout)
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow external fonts
  frameguard: false, // Disable X-Frame-Options to allow Replit preview iframe
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Enable CORS with security options
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : ["*"]) 
    : true,
  credentials: true,
  maxAge: 86400
}));
// Serve only essential static files from public directory for security
app.use(express.static('public', {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // Never cache HTML — always serve fresh JS fixes
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      // Cache assets (images, fonts, css) for 1 day
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Configure custom domain support
configureCustomDomain(app);

// Add compression middleware for better performance
const compression = require('compression');
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Add body size limits for security and parse JSON/URL-encoded data
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Rate limiting for API endpoints
const rateLimit = require('express-rate-limit');
// Railway proxies all traffic through one IP — must use X-Forwarded-For to get real client IP
const realIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: realIp,
});

app.use('/api/', apiLimiter);

// Strict limiter ONLY on login + register — NOT on /me (called on every page load)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 min per real IP
  message: 'Too many login attempts, please try again in 15 minutes.',
  keyGenerator: realIp,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── STRIPE WEBHOOK (raw body BEFORE json parser) ──────────────────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe) return res.status(503).send('Stripe not configured');
  if (!webhookSecret) return res.status(400).send('STRIPE_WEBHOOK_SECRET not set');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook sig failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { updateUserSubscription, db, schema } = require('./server/storage.js');
  const { eq } = require('drizzle-orm');

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items?.data[0]?.price?.id;
        const tier = priceId === 'price_1T3SyDGMuYRuJYDrF8mvMrwi' ? 'pro' : 'starter';
        const active = ['active','trialing'].includes(sub.status);
        const users = await db.select().from(schema.users).where(eq(schema.users.stripeCustomerId, sub.customer));
        if (users[0]) await updateUserSubscription(users[0].id, active ? tier : 'free', sub.id);
        console.log(`Subscription ${event.type}: customer ${sub.customer} → ${active ? tier : 'free'}`);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const users = await db.select().from(schema.users).where(eq(schema.users.stripeCustomerId, sub.customer));
        if (users[0]) await updateUserSubscription(users[0].id, 'free', null);
        console.log(`Subscription cancelled: customer ${sub.customer}`);
        break;
      }
      case 'invoice.payment_failed':
        console.warn(`Payment failed: customer ${event.data.object.customer}`);
        break;
      default:
        console.log(`Webhook: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).send('Handler error');
  }
  res.json({ received: true });
});

// Add API router before auth middleware
const apiRouter = require('./api_server');
app.use('/api', apiRouter);

// Receipt scanner (multer file upload — must mount separately)
const receiptScanner = require('./receipt-scanner');
app.use('/api/receipt', receiptScanner);

// Health check — used by Railway to verify the app is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'fitmunch' });
});

// Test Stripe API connection
app.get('/api/stripe-test', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.',
      connectionStatus: 'disabled'
    });
  }
  
  try {
    // Attempt to list customers as a basic test
    const customers = await stripe.customers.list({ limit: 1 });
    res.json({ 
      success: true, 
      message: 'Stripe API connected successfully',
      connectionStatus: 'active',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Stripe API connection error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Stripe API connection failed',
      error: error.message
    });
  }
});

// Endpoint to create a Stripe checkout session
app.post('/api/stripe/checkout-sessions', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const { priceId, customerId, successUrl, cancelUrl } = req.body;

    if (!priceId || !customerId || !successUrl || !cancelUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters'
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    res.json({ 
      success: true, 
      url: session.url,
      id: session.id
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
});

// ── CLEAN CHECKOUT ENDPOINT (JWT-authenticated, 14-day trial) ──────────────────
const PRICE_IDS = {
  starter: 'price_1T3SvgGMuYRuJYDrOyR2hYoq', // FitMunch PT Starter $59.99 AUD/mo
  pro:     'price_1T3SyDGMuYRuJYDrF8mvMrwi', // FitMunch PT Pro     $99.00 AUD/mo
};

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });

  try {
    // Verify JWT
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required.' });

    const jwtLib = require('jsonwebtoken');
    const decoded = jwtLib.verify(authHeader.slice(7), process.env.JWT_SECRET || 'fitmunch-secret-key');

    const { plan = 'pro' } = req.body;
    const priceId = PRICE_IDS[plan];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan.' });

    // Get or create Stripe customer
    const { getUserById, updateUserSubscription } = require('./server/storage.js');
    const user = await getUserById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name,
        metadata: { userId: user.id } });
      customerId = customer.id;
      await updateUserSubscription(user.id, user.subscriptionTier || 'free', null);
      // Persist stripe customer ID
      const storage = require('./server/storage.js');
      const { eq } = require('drizzle-orm');
      await storage.db.update(storage.schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(storage.schema.users.id, user.id));
    }

    const origin = req.headers.origin || 'https://fitmunch.com.au';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${origin}/app.html?subscribed=1`,
      cancel_url:  `${origin}/?cancelled=1`,
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
});

// Endpoint to complete subscription after payment success
app.post('/api/complete-subscription', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID is required'
      });
    }

    // Retrieve the session to verify payment
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer']
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    // Return subscription details
    res.json({
      success: true,
      message: 'Subscription completed successfully',
      subscription: session.subscription,
      customer: session.customer
    });

  } catch (error) {
    console.error('Error completing subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete subscription',
      error: error.message
    });
  }
});

// Endpoint to create or get Stripe customer
app.post('/api/stripe/customers', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured'
    });
  }
  
  try {
    const { email, name, metadata } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required'
      });
    }

    const customer = await stripe.customers.create({
      email,
      name: name || '',
      metadata: metadata || {}
    });

    res.json({ 
      success: true, 
      id: customer.id,
      email: customer.email
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message
    });
  }
});

// Authentication middleware — JWT or anonymous pass-through
app.use((req, res, next) => {
  // Support JWT Bearer token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader.slice(7);
      const secret = process.env.JWT_SECRET || 'fitmunch-secret-key';
      const decoded = jwt.verify(token, secret);
      req.user = { id: decoded.userId, name: decoded.name };
    } catch (e) {
      // Invalid token — continue as anonymous
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
});

const foodDatabase = {
  items: [
    { name: "Chicken Breast", calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    { name: "Brown Rice", calories: 216, protein: 5, carbs: 45, fat: 1.8 },
    { name: "Salmon", calories: 208, protein: 22, carbs: 0, fat: 13 }
  ]
};

let userLogs = {};

// Food database endpoints
app.get('/api/foods/search', (req, res) => {
  const query = req.query.q.toLowerCase();
  const results = foodDatabase.items.filter(item => 
    item.name.toLowerCase().includes(query)
  );
  res.json(results);
});

app.post('/api/log/food', (req, res) => {
  const { userId, date, meal, food } = req.body;
  if (!userLogs[userId]) {
    userLogs[userId] = {};
  }
  if (!userLogs[userId][date]) {
    userLogs[userId][date] = { meals: {} };
  }
  if (!userLogs[userId][date].meals[meal]) {
    userLogs[userId][date].meals[meal] = [];
  }
  userLogs[userId][date].meals[meal].push(food);
  res.json({ success: true });
});

app.get('/api/log/:userId/:date', (req, res) => {
  const { userId, date } = req.params;
  res.json(userLogs[userId]?.[date] || { meals: {} });
});

app.post('/api/analyze-goals', (req, res) => {
  try {
    const { goals } = req.body;
    const recommendations = {
      calories: Math.max(1800, parseInt(goals.calories)),
      activity: {
        type: goals.activityPlan.type || 'gym',
        frequency: goals.activityPlan.frequency || 3,
        level: goals.activityPlan.level || 'Beginner',
        duration: goals.activityPlan.duration || 1
      }
    };
    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User profile endpoints
let userProfiles = {};

app.post('/api/user/profile', (req, res) => {
  try {
    const { userId, profile } = req.body;
    if (!userId || !profile) {
      return res.status(400).json({ error: 'Missing userId or profile data' });
    }
    userProfiles[userId] = {
      ...profile,
      updatedAt: new Date().toISOString()
    };
    res.json({ success: true, profile: userProfiles[userId] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/profile/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const profile = userProfiles[userId] || null;
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Meal logging endpoints
let mealLogs = {};

app.post('/api/meals/log', (req, res) => {
  try {
    const { userId, date, mealType, foodItems, calories, macros } = req.body;
    if (!userId || !date || !mealType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const logKey = `${userId}_${date}`;
    if (!mealLogs[logKey]) {
      mealLogs[logKey] = { meals: {}, totalCalories: 0 };
    }
    if (!mealLogs[logKey].meals[mealType]) {
      mealLogs[logKey].meals[mealType] = [];
    }
    
    const mealEntry = {
      foodItems: foodItems || [],
      calories: calories || 0,
      macros: macros || { protein: 0, carbs: 0, fat: 0 },
      loggedAt: new Date().toISOString()
    };
    
    mealLogs[logKey].meals[mealType].push(mealEntry);
    mealLogs[logKey].totalCalories += (calories || 0);
    
    res.json({ success: true, meal: mealEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/meals/daily/:userId/:date', (req, res) => {
  try {
    const { userId, date } = req.params;
    const logKey = `${userId}_${date}`;
    const dailyLog = mealLogs[logKey] || { meals: {}, totalCalories: 0 };
    res.json({ success: true, data: dailyLog });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Workout logging endpoints
let workoutLogs = {};

app.post('/api/workouts/log', (req, res) => {
  try {
    const { userId, date, workoutType, duration, caloriesBurned, exercises } = req.body;
    if (!userId || !workoutType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!workoutLogs[userId]) {
      workoutLogs[userId] = [];
    }
    
    const workoutEntry = {
      id: Date.now().toString(),
      date: date || new Date().toISOString(),
      workoutType,
      duration: duration || 0,
      caloriesBurned: caloriesBurned || 0,
      exercises: exercises || [],
      loggedAt: new Date().toISOString()
    };
    
    workoutLogs[userId].unshift(workoutEntry);
    res.json({ success: true, workout: workoutEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/workouts/history/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const history = workoutLogs[userId] || [];
    res.json({ success: true, workouts: history.slice(0, limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Progress tracking endpoints
let progressLogs = {};

app.post('/api/progress/log', (req, res) => {
  try {
    const { userId, date, weight, bodyFat, measurements, notes } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    
    if (!progressLogs[userId]) {
      progressLogs[userId] = [];
    }
    
    const progressEntry = {
      id: Date.now().toString(),
      date: date || new Date().toISOString(),
      weight: weight || 0,
      bodyFat: bodyFat || 0,
      measurements: measurements || {},
      notes: notes || '',
      loggedAt: new Date().toISOString()
    };
    
    progressLogs[userId].unshift(progressEntry);
    res.json({ success: true, progress: progressEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/progress/history/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const history = progressLogs[userId] || [];
    res.json({ success: true, progress: history.slice(0, limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics endpoint
let analyticsEvents = [];

app.post('/api/analytics/events', (req, res) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Invalid events data' });
    }
    
    analyticsEvents.push(...events);
    
    // Keep only last 10000 events to prevent memory issues
    if (analyticsEvents.length > 10000) {
      analyticsEvents = analyticsEvents.slice(-10000);
    }
    
    res.json({ success: true, eventsLogged: events.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recommendations endpoints
app.get('/api/recommendations/meals/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const userProfile = userProfiles[userId] || {};
    const targetCalories = userProfile.goals?.calories || 2000;
    
    const recommendations = [
      {
        meal: 'breakfast',
        suggestion: {
          name: 'Greek Yogurt Bowl',
          calories: Math.round(targetCalories * 0.25),
          protein: 20,
          carbs: 30,
          fat: 8,
          ingredients: ['Greek yogurt', 'Berries', 'Granola', 'Honey']
        },
        timing: '7:00 AM - 9:00 AM',
        reason: 'High-protein breakfast to kickstart your metabolism'
      },
      {
        meal: 'lunch',
        suggestion: {
          name: 'Grilled Chicken Salad',
          calories: Math.round(targetCalories * 0.35),
          protein: 35,
          carbs: 25,
          fat: 12,
          ingredients: ['Chicken breast', 'Mixed greens', 'Vegetables', 'Olive oil dressing']
        },
        timing: '12:00 PM - 2:00 PM',
        reason: 'Balanced meal with lean protein and vegetables'
      },
      {
        meal: 'dinner',
        suggestion: {
          name: 'Salmon with Quinoa',
          calories: Math.round(targetCalories * 0.30),
          protein: 30,
          carbs: 35,
          fat: 15,
          ingredients: ['Salmon fillet', 'Quinoa', 'Broccoli', 'Lemon']
        },
        timing: '6:00 PM - 8:00 PM',
        reason: 'Omega-3 rich meal supporting recovery and sleep'
      }
    ];
    
    res.json({ success: true, recommendations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recommendations/workouts/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const userProfile = userProfiles[userId] || {};
    const fitnessLevel = userProfile.goals?.activityPlan?.level || 'Beginner';
    const preferredType = userProfile.goals?.activityPlan?.type || 'gym';
    
    const recommendations = [
      {
        type: 'Strength Training',
        duration: 45,
        frequency: 3,
        intensity: fitnessLevel.toLowerCase(),
        exercises: [
          { name: 'Squats', sets: 3, reps: 12 },
          { name: 'Bench Press', sets: 3, reps: 10 },
          { name: 'Deadlifts', sets: 3, reps: 8 },
          { name: 'Shoulder Press', sets: 3, reps: 10 }
        ],
        benefits: ['Build muscle', 'Increase strength', 'Boost metabolism'],
        reason: 'Based on your fitness level and goals'
      },
      {
        type: 'Cardio',
        duration: 30,
        frequency: 2,
        intensity: 'moderate',
        exercises: [
          { name: 'Running', duration: 20, intensity: 'moderate' },
          { name: 'Cycling', duration: 15, intensity: 'light' }
        ],
        benefits: ['Improve cardiovascular health', 'Burn calories', 'Increase endurance'],
        reason: 'Complement strength training with cardio'
      },
      {
        type: 'Flexibility',
        duration: 15,
        frequency: 5,
        intensity: 'light',
        exercises: [
          { name: 'Yoga', duration: 15 },
          { name: 'Stretching', duration: 10 }
        ],
        benefits: ['Improve flexibility', 'Reduce injury risk', 'Aid recovery'],
        reason: 'Essential for overall fitness and recovery'
      }
    ];
    
    res.json({ success: true, recommendations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 5000;

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 FitMunch running on port ${port}`);
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});

// Handle process termination gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});