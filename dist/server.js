const express = require('express');
const path = require('path');
const cors = require('cors');
const { configureCustomDomain } = require('./custom_domain_setup');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Enable CORS for all routes
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Configure custom domain support
configureCustomDomain(app);

// Add API router
const apiRouter = require('./api_server');
app.use('/api', apiRouter);

// Test Stripe API connection
app.get('/api/stripe-test', async (req, res) => {
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

// Endpoint to complete subscription after payment success
app.post('/api/complete-subscription', async (req, res) => {
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

// Authentication middleware
app.use((req, res, next) => {
  const userId = req.headers['x-replit-user-id'];
  const userName = req.headers['x-replit-user-name'];
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = { id: userId, name: userName };
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

const port = 3030;

// Start the server - make sure it's accessible externally
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`Server is accessible at https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  console.log(`Access the app at: http://0.0.0.0:${port}`);
}).on('error', (err) => {
  console.error('Server error:', err);

  // If port is already in use, try another port
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${port} is already in use, trying port ${port + 1}`);
    app.listen(port + 1, '0.0.0.0', () => {
      console.log(`Server running on port ${port + 1}`);
    });
  }
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