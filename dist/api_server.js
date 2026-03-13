const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fitMunchAPI = require('./api_service');
const apiRouter = require('./api'); // Import the new API router

const app = express();
const port = process.env.PORT || 3030;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

// Use the new API router
app.use('/api', apiRouter);


// API Routes for Nutrition Data
app.get('/api/foods/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const results = await fitMunchAPI.searchFoodNutrition(query);
    res.json(results);
  } catch (error) {
    console.error('Error searching for foods:', error);
    res.status(500).json({ error: 'Failed to search for foods' });
  }
});

app.get('/api/foods/:name', async (req, res) => {
  try {
    const foodName = req.params.name;
    const details = await fitMunchAPI.getFoodDetails(foodName);
    res.json(details);
  } catch (error) {
    console.error('Error getting food details:', error);
    res.status(500).json({ error: 'Failed to get food details' });
  }
});

// API Routes for Recipe Data
app.get('/api/recipes/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const diet = req.query.diet || null;
    const maxCalories = req.query.maxCalories || null;

    if (query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const results = await fitMunchAPI.searchRecipes(query, diet, maxCalories);
    res.json(results);
  } catch (error) {
    console.error('Error searching for recipes:', error);
    res.status(500).json({ error: 'Failed to search for recipes' });
  }
});

app.get('/api/recipes/:id', async (req, res) => {
  try {
    const recipeId = req.params.id;
    const details = await fitMunchAPI.getRecipeDetails(recipeId);
    res.json(details);
  } catch (error) {
    console.error('Error getting recipe details:', error);
    res.status(500).json({ error: 'Failed to get recipe details' });
  }
});

// API Routes for Exercise Data
app.get('/api/exercises/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const bodyPart = req.query.bodyPart || null;
    const level = req.query.level || 'beginner';

    const results = await fitMunchAPI.searchExercises(query, bodyPart, level);
    res.json(results);
  } catch (error) {
    console.error('Error searching for exercises:', error);
    res.status(500).json({ error: 'Failed to search for exercises' });
  }
});

// API Routes for Plan Generation
app.post('/api/workouts/generate', async (req, res) => {
  try {
    const preferences = req.body || {};
    const plan = await fitMunchAPI.generateWorkoutPlan(preferences);
    res.json(plan);
  } catch (error) {
    console.error('Error generating workout plan:', error);
    res.status(500).json({ error: 'Failed to generate workout plan' });
  }
});

app.post('/api/meals/generate', async (req, res) => {
  try {
    const preferences = req.body || {};
    const plan = await fitMunchAPI.generateMealPlan(preferences);
    res.json(plan);
  } catch (error) {
    console.error('Error generating meal plan:', error);
    res.status(500).json({ error: 'Failed to generate meal plan' });
  }
});

// API Routes for Price Comparison
app.get('/api/prices/:product', async (req, res) => {
  try {
    const productName = req.params.product;
    const prices = await fitMunchAPI.getProductPrices(productName);
    res.json(prices);
  } catch (error) {
    console.error('Error getting product prices:', error);
    res.status(500).json({ error: 'Failed to get product prices' });
  }
});

// Add route for web scraping nutrition data (advanced)
app.get('/api/scrape/nutrition', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // In a real implementation, this would use a web scraping library
    // For now, we'll return mock data
    res.json({
      source: 'scrape',
      results: [
        {
          name: query,
          calories: Math.floor(Math.random() * 300) + 100,
          protein: Math.floor(Math.random() * 30) + 5,
          carbs: Math.floor(Math.random() * 40) + 10,
          fat: Math.floor(Math.random() * 20) + 2,
          source: 'WebScrape: Australian Food Standards'
        }
      ]
    });
  } catch (error) {
    console.error('Error scraping nutrition data:', error);
    res.status(500).json({ error: 'Failed to scrape nutrition data' });
  }
});

// User data API routes (for saving meal and workout plans)
let userPlans = {};

app.post('/api/user/:userId/plans/meal', (req, res) => {
  const userId = req.params.userId;
  const plan = req.body;

  if (!userPlans[userId]) {
    userPlans[userId] = { meals: [], workouts: [] };
  }

  userPlans[userId].meals.push({
    id: Date.now(),
    date: new Date().toISOString(),
    plan: plan
  });

  res.json({ success: true, message: 'Meal plan saved successfully' });
});

app.post('/api/user/:userId/plans/workout', (req, res) => {
  const userId = req.params.userId;
  const plan = req.body;

  if (!userPlans[userId]) {
    userPlans[userId] = { meals: [], workouts: [] };
  }

  userPlans[userId].workouts.push({
    id: Date.now(),
    date: new Date().toISOString(),
    plan: plan
  });

  res.json({ success: true, message: 'Workout plan saved successfully' });
});

app.get('/api/user/:userId/plans', (req, res) => {
  const userId = req.params.userId;

  if (!userPlans[userId]) {
    return res.json({ meals: [], workouts: [] });
  }

  res.json(userPlans[userId]);
});

// API Routes for Subscription Management
app.post('/api/subscription/create', async (req, res) => {
  try {
    const { planId, isAnnual, userId, paymentMethodId } = req.body;

    // In a real implementation, this would create a subscription in the payment gateway
    // For now, we'll return a mock response
    res.json({
      success: true,
      subscriptionId: `sub_${Math.random().toString(36).substr(2, 9)}`,
      planId: planId,
      isAnnual: isAnnual,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + (isAnnual ? 365 : 30) * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

app.post('/api/subscription/cancel', async (req, res) => {
  try {
    const { subscriptionId, userId } = req.body;

    // In a real implementation, this would cancel a subscription in the payment gateway
    // For now, we'll return a mock response
    res.json({
      success: true,
      subscriptionId: subscriptionId,
      status: 'canceled'
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

app.post('/api/subscription/update-payment', async (req, res) => {
  try {
    const { userId, paymentMethodId } = req.body;

    // In a real implementation, this would update the payment method in the payment gateway
    // For now, we'll return a mock response
    res.json({
      success: true,
      userId: userId,
      updatedPaymentMethod: true
    });
  } catch (error) {
    console.error('Error updating payment method:', error);
    res.status(500).json({ error: 'Failed to update payment method' });
  }
});

app.get('/api/subscription/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // In a real implementation, this would get the subscription from the database
    // For now, we'll return a mock response
    res.json({
      userId: userId,
      plan: 'free',
      status: 'active',
      nextBillingDate: null
    });
  } catch (error) {
    console.error('Error getting subscription:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});


// API endpoint for completing subscription after Stripe payment
app.post('/api/complete-subscription', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    // Load the Stripe payment gateway
    const StripePaymentGateway = require('./payment-gateway.js');

    // Retrieve session from Stripe
    const session = await StripePaymentGateway.verifyPaymentSession(sessionId);

    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Invalid payment session' });
    }

    // Get the customer ID and subscription ID from the session
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Get user ID from metadata or look up by customer ID
    // This is just a placeholder, you would implement user lookup based on your system
    const userId = session.metadata.userId;

    // Load the subscription manager
    const SubscriptionManager = require('./subscription_manager.js');
    const subscriptionManager = new SubscriptionManager();

    // Activate the subscription
    const activationResult = await subscriptionManager.activateSubscription(
      userId,
      session.metadata.planId || 'basic', // Default to basic if not specified
      subscriptionId,
      'stripe'
    );

    if (activationResult.success) {
      res.json({ success: true, message: 'Subscription activated successfully' });
    } else {
      res.status(500).json({ success: false, error: activationResult.error });
    }
  } catch (error) {
    console.error('Error completing subscription:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`FitMunch API server running on port ${port}`);
  console.log(`Server is accessible at https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
});