// Node.js v20+ has native fetch support - no import needed
const BASE_URL = 'http://localhost:5000';
// Use the test user created in the database
const testUserId = '70f1676b-8259-4bf0-b7f2-ff81008fcbcd';

// Test results tracking
const results = {
  passed: [],
  failed: [],
  details: []
};

function logTest(testName, passed, details) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${testName}`);
  console.log(`STATUS: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  if (details) {
    console.log(`DETAILS:`, JSON.stringify(details, null, 2));
  }
  console.log('='.repeat(70));
  
  if (passed) {
    results.passed.push(testName);
  } else {
    results.failed.push(testName);
  }
  results.details.push({ testName, passed, details });
}

// Helper to add delay between tests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// TEST 1: Profile Save
async function testProfileSave() {
  try {
    const profileData = {
      userId: testUserId,
      height: 175,
      weight: 70,
      age: 30,
      gender: 'male',
      fitnessGoal: 'weight_loss',
      targetCalories: 2000,
      targetProtein: 150,
      targetCarbs: 200,
      targetFat: 60,
      activityLevel: 'moderate'
    };
    
    const response = await fetch(`${BASE_URL}/api/user/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    });
    
    const result = await response.json();
    const success = response.ok && result.success === true;
    logTest('1. Profile Save (POST /api/user/profile)', success, result);
    return success;
  } catch (error) {
    logTest('1. Profile Save (POST /api/user/profile)', false, { error: error.message });
    return false;
  }
}

// TEST 2: Profile Retrieval
async function testProfileRetrieval() {
  try {
    await delay(500); // Small delay to ensure data is written
    
    const response = await fetch(`${BASE_URL}/api/user/profile/${testUserId}`);
    const result = await response.json();
    
    const success = response.ok && 
                   result.success && 
                   result.profile && 
                   result.profile.userId === testUserId &&
                   result.profile.height === 175 &&
                   result.profile.weight === 70;
    
    logTest('2. Profile Retrieval (GET /api/user/profile/:userId)', success, result);
    return success;
  } catch (error) {
    logTest('2. Profile Retrieval (GET /api/user/profile/:userId)', false, { error: error.message });
    return false;
  }
}

// TEST 3: Meal Log (Individual food item)
async function testMealLog() {
  try {
    const mealData = {
      userId: testUserId,
      mealType: 'breakfast',
      foodName: 'Oatmeal with Berries',
      calories: 350,
      protein: 12,
      carbs: 54,
      fat: 8,
      fiber: 8,
      servingSize: '1 bowl (250g)'
    };
    
    const response = await fetch(`${BASE_URL}/api/meals/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mealData)
    });
    
    const result = await response.json();
    const success = response.ok && result.success === true;
    logTest('3. Meal Log (POST /api/meals/log)', success, result);
    return success;
  } catch (error) {
    logTest('3. Meal Log (POST /api/meals/log)', false, { error: error.message });
    return false;
  }
}

// TEST 4: Meal Retrieval
async function testMealRetrieval() {
  try {
    await delay(500);
    
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`${BASE_URL}/api/meals/daily/${testUserId}/${today}`);
    const result = await response.json();
    
    const success = response.ok && 
                   result.success && 
                   Array.isArray(result.meals) &&
                   result.meals.length > 0;
    
    logTest('4. Meal Retrieval (GET /api/meals/daily/:userId/:date)', success, result);
    return success;
  } catch (error) {
    logTest('4. Meal Retrieval (GET /api/meals/daily/:userId/:date)', false, { error: error.message });
    return false;
  }
}

// TEST 5: Workout Log
async function testWorkoutLog() {
  try {
    const workoutData = {
      userId: testUserId,
      workoutType: 'strength_training',
      duration: 45,
      caloriesBurned: 300,
      exercises: [
        { name: 'Bench Press', sets: 3, reps: 10, weight: 135 },
        { name: 'Squats', sets: 3, reps: 12, weight: 185 },
        { name: 'Deadlifts', sets: 3, reps: 8, weight: 225 }
      ],
      notes: 'Great workout, felt strong',
      rating: 5
    };
    
    const response = await fetch(`${BASE_URL}/api/workouts/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workoutData)
    });
    
    const result = await response.json();
    const success = response.ok && result.success === true;
    logTest('5. Workout Log (POST /api/workouts/log)', success, result);
    return success;
  } catch (error) {
    logTest('5. Workout Log (POST /api/workouts/log)', false, { error: error.message });
    return false;
  }
}

// TEST 6: Workout Retrieval
async function testWorkoutRetrieval() {
  try {
    await delay(500);
    
    const response = await fetch(`${BASE_URL}/api/workouts/history/${testUserId}?limit=30`);
    const result = await response.json();
    
    const success = response.ok && 
                   result.success && 
                   Array.isArray(result.workouts) &&
                   result.workouts.length > 0;
    
    logTest('6. Workout Retrieval (GET /api/workouts/history/:userId)', success, result);
    return success;
  } catch (error) {
    logTest('6. Workout Retrieval (GET /api/workouts/history/:userId)', false, { error: error.message });
    return false;
  }
}

// TEST 7: Progress Log
async function testProgressLog() {
  try {
    const progressData = {
      userId: testUserId,
      weight: 70,
      bodyFatPercentage: 15,
      measurements: {
        chest: 100,
        waist: 80,
        hips: 95,
        arms: 35,
        thighs: 55
      },
      notes: 'Feeling strong and energized! Making great progress.',
      photos: []
    };
    
    const response = await fetch(`${BASE_URL}/api/progress/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progressData)
    });
    
    const result = await response.json();
    const success = response.ok && result.success === true;
    logTest('7. Progress Log (POST /api/progress/log)', success, result);
    return success;
  } catch (error) {
    logTest('7. Progress Log (POST /api/progress/log)', false, { error: error.message });
    return false;
  }
}

// TEST 8: Progress Retrieval
async function testProgressRetrieval() {
  try {
    await delay(500);
    
    const response = await fetch(`${BASE_URL}/api/progress/history/${testUserId}?limit=30`);
    const result = await response.json();
    
    const success = response.ok && 
                   result.success && 
                   Array.isArray(result.history) &&
                   result.history.length > 0;
    
    logTest('8. Progress Retrieval (GET /api/progress/history/:userId)', success, result);
    return success;
  } catch (error) {
    logTest('8. Progress Retrieval (GET /api/progress/history/:userId)', false, { error: error.message });
    return false;
  }
}

// TEST 9: Analytics Tracking
async function testAnalyticsTracking() {
  try {
    const eventsData = {
      events: [
        {
          userId: testUserId,
          eventType: 'app_opened',
          eventData: { 
            platform: 'web', 
            timestamp: new Date().toISOString(),
            userAgent: 'Mozilla/5.0 Test Browser'
          },
          sessionId: 'session-' + Date.now()
        },
        {
          userId: testUserId,
          eventType: 'feature_used',
          eventData: { 
            feature: 'meal_logging', 
            timestamp: new Date().toISOString(),
            action: 'create'
          },
          sessionId: 'session-' + Date.now()
        },
        {
          userId: testUserId,
          eventType: 'feature_used',
          eventData: { 
            feature: 'workout_logging', 
            timestamp: new Date().toISOString(),
            action: 'create'
          },
          sessionId: 'session-' + Date.now()
        }
      ]
    };
    
    const response = await fetch(`${BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventsData)
    });
    
    const result = await response.json();
    const success = response.ok && 
                   result.success === true && 
                   result.eventsProcessed === 3;
    
    logTest('9. Analytics Tracking (POST /api/analytics/events)', success, result);
    return success;
  } catch (error) {
    logTest('9. Analytics Tracking (POST /api/analytics/events)', false, { error: error.message });
    return false;
  }
}

// Main test runner
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 FITMUNCH API ENDPOINT TESTING - COMPREHENSIVE VERIFICATION');
  console.log('='.repeat(70));
  console.log(`Test User ID: ${testUserId}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Started: ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  
  // Run tests sequentially to avoid race conditions
  await testProfileSave();
  await testProfileRetrieval();
  await testMealLog();
  await testMealRetrieval();
  await testWorkoutLog();
  await testWorkoutRetrieval();
  await testProgressLog();
  await testProgressRetrieval();
  await testAnalyticsTracking();
  
  // Print comprehensive summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📈 Total Tests: ${results.passed.length + results.failed.length}`);
  console.log(`🎯 Success Rate: ${((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));
  
  if (results.passed.length > 0) {
    console.log('\n✅ PASSED TESTS:');
    results.passed.forEach((test, idx) => console.log(`   ${idx + 1}. ${test}`));
  }
  
  if (results.failed.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.failed.forEach((test, idx) => console.log(`   ${idx + 1}. ${test}`));
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📋 NEXT STEPS:');
  console.log('='.repeat(70));
  console.log('1. ✓ Verify data persistence in PostgreSQL database');
  console.log('2. ✓ Run SQL queries to confirm data storage');
  console.log('3. ✓ Check server logs for any errors');
  console.log('4. ✓ Validate all endpoints are working correctly');
  console.log('='.repeat(70));
  
  console.log(`\n🔍 Test User ID for Database Verification: ${testUserId}`);
  console.log(`📅 Test Completed: ${new Date().toISOString()}\n`);
  
  return results.failed.length === 0;
}

// Run tests
runAllTests()
  .then(success => {
    if (success) {
      console.log('✅ ALL TESTS PASSED! Data persistence verified.\n');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED. Review the output above.\n');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test execution failed with error:', error);
    process.exit(1);
  });
