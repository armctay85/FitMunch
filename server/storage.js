// FitMunch Database Storage Layer
const { drizzle } = require('drizzle-orm/node-postgres');
const { eq, and, gte, lte, desc } = require('drizzle-orm');
const { Pool } = require('pg');
const schema = require('../shared/schema.js');

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 30000, // Increased from 2s to 30s to prevent timeout errors
  statement_timeout: 60000, // Query timeout 60 seconds
});

// Initialize Drizzle ORM
const db = drizzle(pool, { schema });

// Self-healing schema — ensures all tables exist on first DB use (cached).
const { ensureSchema } = require('../lib/db-migrate');

// User operations
async function createUser(email, name, passwordHash, extras = {}) {
  await ensureSchema();
  const [user] = await db.insert(schema.users).values({
    email,
    name,
    passwordHash,
  }).returning();
  // Role/pt_id are raw SQL columns (not in drizzle schema yet) — set immediately after insert.
  if (extras.role || extras.ptId != null || extras.trialExpiresAt) {
    await pool.query(
      `UPDATE users SET
         role = COALESCE($1, role),
         pt_id = COALESCE($2, pt_id),
         subscription_expires_at = COALESCE($3, subscription_expires_at),
         updated_at = NOW()
       WHERE id = $4`,
      [extras.role || null, extras.ptId || null, extras.trialExpiresAt || null, user.id]
    );
    if (extras.role) user.role = extras.role;
  }
  return user;
}

async function getUserByEmail(email) {
  await ensureSchema();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return user;
}

async function getUserById(id) {
  await ensureSchema();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

async function updateUserSubscription(userId, tier, expiresAt) {
  await db.update(schema.users)
    .set({ 
      subscriptionTier: tier,
      subscriptionExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

async function ensureUserExists(userId, email = null, name = 'Anonymous User') {
  try {
    const existing = await getUserById(userId);
    if (existing) {
      return existing;
    }
    
    const [user] = await db.insert(schema.users).values({
      id: userId,
      email: email || `user_${userId}@fitmunch.app`,
      name: name,
      passwordHash: 'not_set',
    }).returning();
    
    console.log('✅ Auto-provisioned user:', userId);
    return user;
  } catch (error) {
    console.error('Error ensuring user exists:', error);
    throw error;
  }
}

// Profile operations
async function createOrUpdateProfile(userId, profileData) {
  await ensureSchema();
  await ensureUserExists(userId);
  
  const existing = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  
  if (existing.length > 0) {
    await db.update(schema.userProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(schema.userProfiles.userId, userId));
  } else {
    await db.insert(schema.userProfiles).values({
      userId,
      ...profileData,
    });
  }
}

async function getProfile(userId) {
  await ensureSchema();
  const [profile] = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  return profile;
}

// Meal logging operations
async function logMeal(userId, mealData) {
  await ensureUserExists(userId);
  
  const [meal] = await db.insert(schema.mealLogs).values({
    userId,
    ...mealData,
  }).returning();
  return meal;
}

async function getMealLogsByDate(userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return await db.select()
    .from(schema.mealLogs)
    .where(
      and(
        eq(schema.mealLogs.userId, userId),
        gte(schema.mealLogs.date, startOfDay),
        lte(schema.mealLogs.date, endOfDay)
      )
    );
}

async function getMealLogsForPeriod(userId, startDate, endDate) {
  return await db.select()
    .from(schema.mealLogs)
    .where(
      and(
        eq(schema.mealLogs.userId, userId),
        gte(schema.mealLogs.date, startDate),
        lte(schema.mealLogs.date, endDate)
      )
    )
    .orderBy(desc(schema.mealLogs.date));
}

// Workout logging operations
async function logWorkout(userId, workoutData) {
  await ensureUserExists(userId);
  
  const [workout] = await db.insert(schema.workoutLogs).values({
    userId,
    ...workoutData,
  }).returning();
  return workout;
}

async function getWorkoutLogsByDate(userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return await db.select()
    .from(schema.workoutLogs)
    .where(
      and(
        eq(schema.workoutLogs.userId, userId),
        gte(schema.workoutLogs.date, startOfDay),
        lte(schema.workoutLogs.date, endOfDay)
      )
    );
}

async function getRecentWorkouts(userId, limit = 10) {
  return await db.select()
    .from(schema.workoutLogs)
    .where(eq(schema.workoutLogs.userId, userId))
    .orderBy(desc(schema.workoutLogs.date))
    .limit(limit);
}

// Progress tracking operations
async function logProgress(userId, progressData) {
  await ensureUserExists(userId);
  
  const [progress] = await db.insert(schema.progressLogs).values({
    userId,
    ...progressData,
  }).returning();
  return progress;
}

async function getProgressHistory(userId, limit = 30) {
  return await db.select()
    .from(schema.progressLogs)
    .where(eq(schema.progressLogs.userId, userId))
    .orderBy(desc(schema.progressLogs.date))
    .limit(limit);
}

// Analytics operations
async function trackEvent(userId, eventType, eventData, sessionId) {
  // Anonymous analytics must not try to auto-provision a users row.
  const uid = userId || null;
  if (uid) {
    try { await ensureUserExists(uid); } catch (_) { /* non-fatal */ }
  }

  await db.insert(schema.analyticsEvents).values({
    userId: uid,
    eventType,
    eventData: eventData || {},
    sessionId: sessionId || null,
  });
}

async function getFunnelStats(days = 14) {
  const d = Math.min(90, Math.max(1, Number(days) || 14));
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  const rows = await db.select({
    eventType: schema.analyticsEvents.eventType,
    sessionId: schema.analyticsEvents.sessionId,
  })
    .from(schema.analyticsEvents)
    .where(gte(schema.analyticsEvents.createdAt, since))
    .limit(20000);

  const byType = new Map();
  for (const row of rows) {
    const key = row.eventType || 'unknown';
    let bucket = byType.get(key);
    if (!bucket) {
      bucket = { eventType: key, count: 0, sessions: new Set() };
      byType.set(key, bucket);
    }
    bucket.count += 1;
    if (row.sessionId) bucket.sessions.add(row.sessionId);
  }

  const events = [...byType.values()]
    .map((b) => ({ eventType: b.eventType, count: b.count, sessions: b.sessions.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const totalEvents = events.reduce((n, r) => n + r.count, 0);
  return { days: d, totalEvents, events, asOf: new Date().toISOString() };
}

// Export all functions and database instance
module.exports = {
  db,
  createUser,
  getUserByEmail,
  getUserById,
  updateUserSubscription,
  ensureUserExists,
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
  getFunnelStats,
  schema,
};
