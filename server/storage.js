// FitMunch Database Storage Layer
const { drizzle } = require('drizzle-orm/node-postgres');
const { eq, and, gte, lte, desc, sql } = require('drizzle-orm');
const { Pool } = require('pg');
const schema = require('../shared/schema.js');
const { summarizeFunnel } = require('../lib/funnel-events');

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 30000, // Increased from 2s to 30s to prevent timeout errors
  statement_timeout: 60000, // Query timeout 60 seconds
  // An idle client must not hold the process open after tests. The server
  // stays up on its listen socket.
  allowExitOnIdle: true,
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
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return undefined;
  await ensureSchema();
  const [user] = await db.select().from(schema.users).where(
    sql`lower(trim(${schema.users.email})) = ${normalized}`
  );
  return user;
}

async function getUserById(id) {
  await ensureSchema();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

async function setAIDataConsent(userId, allowed) {
  const { mergeChoice } = require('../lib/ai-data-consent');
  const user = await getUserById(userId);
  if (!user) return null;
  const settings = mergeChoice(user.settings, allowed);
  await db.update(schema.users)
    .set({
      settings,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  return settings.aiDataConsent === true;
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

// Quiet comp. Stored tier stays 'free'. Premium access lasts until
// settings.compPremiumUntil, then drops on the next read. No cron, email, or Stripe.
// Do not read subscriptionExpiresAt here: RevenueCat and Stripe sync do not refresh it,
// so a paying user would look expired.
function readUserSettings(user) {
  const raw = user && user.settings;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

// Coach tier lives on settings.coach. Consumer subscription_tier stays untouched.
async function updateUserCoachBilling(userId, coach, existingSettings) {
  const settings = { ...readUserSettings({ settings: existingSettings }) };
  settings.coach = {
    tier: coach && coach.tier ? coach.tier : 'cancelled',
    plan: coach && coach.plan ? coach.plan : null,
    priceId: coach && coach.priceId ? coach.priceId : null,
    subscriptionId: coach && coach.subscriptionId ? coach.subscriptionId : null,
    updatedAt: new Date().toISOString(),
  };
  await db.update(schema.users)
    .set({
      settings,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  return settings.coach;
}

function effectiveTier(user) {
  const stored = user && user.subscriptionTier ? String(user.subscriptionTier) : 'free';
  if (stored !== 'free') return stored;
  const untilRaw = readUserSettings(user).compPremiumUntil;
  if (!untilRaw) return 'free';
  const until = untilRaw instanceof Date ? untilRaw : new Date(untilRaw);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return 'free';
  return 'premium';
}

async function ensureUserExists(userId, email = null, name = 'Anonymous User') {
  try {
    const existing = await getUserById(userId);
    if (existing) {
      return existing;
    }
    
    // ON CONFLICT: two first requests at once must not throw (EQA #141 r2 L1).
    const [user] = await db.insert(schema.users).values({
      id: userId,
      email: email || `user_${userId}@fitmunch.app`,
      name: name,
      passwordHash: 'not_set',
    }).onConflictDoNothing().returning();
    if (!user) return getUserById(userId);
    
    console.log('✅ Auto-provisioned user:', userId);
    return user;
  } catch (error) {
    console.error('Error ensuring user exists:', error);
    throw error;
  }
}

// Profile operations
// Every profile write takes this per-user lock (two-key form: own namespace, no clash with other locks),
// then the row lock, so a generate's filter merge and a profile save never interleave (EQA #141 r2 M1).
const PROFILE_LOCK_NS = 1410141;
const lockProfile = (client, userId) => client.query('select pg_advisory_xact_lock($1, hashtext($2::text))', [PROFILE_LOCK_NS, String(userId)]);

async function inProfileTx(userId, fn) {
  const client = await pool.connect();
  let broken = null;
  // A backend killed mid-transaction emits 'error' on the checked-out client; without a listener
  // Node crashes. The broken client is then destroyed, never returned to the pool (EQA #142 S2).
  const onError = (e) => { broken = broken || e || new Error('connection error'); };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    await lockProfile(client, userId);
    const { rows } = await client.query('select * from user_profiles where user_id = $1 order by id limit 1 for update', [userId]);
    const out = await fn(client, rows[0] || null);
    await client.query(out && out.rollback ? 'ROLLBACK' : 'COMMIT');
    return out ? out.value : undefined;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { broken = e; }
    throw err;
  } finally {
    client.off('error', onError);
    client.release(broken || undefined);
  }
}

const PROFILE_COLUMNS = {
  height: 'height', weight: 'weight', age: 'age', gender: 'gender', activityLevel: 'activity_level',
  fitnessGoal: 'fitness_goal', dietaryPreferences: 'dietary_preferences', allergies: 'allergies',
  targetCalories: 'target_calories', targetSteps: 'target_steps', targetProtein: 'target_protein',
  targetCarbs: 'target_carbs', targetFat: 'target_fat',
};
const JSON_COLUMNS = new Set(['dietary_preferences', 'allergies']);

async function writeProfileRow(client, userId, row, patch) {
  const cols = Object.keys(patch).filter((k) => Object.hasOwn(PROFILE_COLUMNS, k) && patch[k] !== undefined);
  const vals = cols.map((k) => (JSON_COLUMNS.has(PROFILE_COLUMNS[k]) ? JSON.stringify(patch[k]) : patch[k]));
  const cast = (k, i) => `$${i + 2}${JSON_COLUMNS.has(PROFILE_COLUMNS[k]) ? '::jsonb' : ''}`;
  if (row) {
    const set = cols.map((k, i) => `${PROFILE_COLUMNS[k]} = ${cast(k, i)}`).concat('updated_at = now()').join(', ');
    await client.query(`update user_profiles set ${set} where id = $1`, [row.id, ...vals]);
  } else {
    const names = ['user_id', ...cols.map((k) => PROFILE_COLUMNS[k])].join(', ');
    const params = ['$1', ...cols.map(cast)].join(', ');
    await client.query(`insert into user_profiles(${names}) values (${params})`, [userId, ...vals]);
  }
}

/**
 * Save a profile under the profile lock. opts.ifUpdatedAt (the updated_at the form loaded) makes a
 * save that sends filters fail with code PROFILE_STALE if the profile changed since, so a stale form
 * can't silently drop a filter a generate just added.
 */
async function createOrUpdateProfile(userId, profileData, opts = {}) {
  await ensureSchema();
  await ensureUserExists(userId);
  return inProfileTx(userId, async (client, row) => {
    // Compared in SQL at millisecond precision (JSON dates carry ms; Postgres stores µs).
    const stale = row && opts.ifUpdatedAt != null && !(await client.query(
      "select date_trunc('milliseconds', $2::timestamptz) = date_trunc('milliseconds', updated_at) as same from user_profiles where id = $1",
      [row.id, opts.ifUpdatedAt])).rows[0].same;
    // A filter save must name the version it edits once a row exists (EQA #142 follow-up).
    if (row && opts.requireVersion && opts.ifUpdatedAt == null) {
      const err = new Error('Profile version required'); err.code = 'PROFILE_VERSION_REQUIRED'; throw err;
    }
    if (stale) {
      const err = new Error('Profile changed since it was loaded'); err.code = 'PROFILE_STALE'; throw err;
    }
    await writeProfileRow(client, userId, row, profileData || {});
    return { value: undefined };
  });
}

/**
 * Atomically merge ticked filters into a profile. Under the profile lock, merge({ dietaryPreferences,
 * allergies }) of the stored row returns a patch ({ dietaryPreferences } or { allergies }) or null for no
 * write. Returns true if written.
 */
async function mergeProfileFilters(userId, merge) {
  await ensureSchema();
  await ensureUserExists(userId);
  return inProfileTx(userId, async (client, row) => {
    const patch = merge(row ? { dietaryPreferences: row.dietary_preferences, allergies: row.allergies } : { dietaryPreferences: null, allergies: null });
    if (!patch) return { rollback: true, value: false };
    await writeProfileRow(client, userId, row, patch);
    return { value: true };
  });
}

async function getProfile(userId) {
  await ensureSchema();
  // Lowest id first, the same row every write targets (old duplicate rows read deterministically).
  const [profile] = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId)).orderBy(schema.userProfiles.id).limit(1);
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
    eventData: schema.analyticsEvents.eventData,
  })
    .from(schema.analyticsEvents)
    .where(gte(schema.analyticsEvents.createdAt, since))
    .limit(20000);

  return summarizeFunnel(rows, d);
}

// In-process critical section for checkout customer create. Production also takes a
// Postgres advisory lock when DATABASE_URL is set, so two app processes cannot
// both insert a Stripe customer for the same user or email.
const checkoutMemoryLocks = new Map();

function withMemoryLock(key, fn) {
  const prev = checkoutMemoryLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => gate, () => gate);
  checkoutMemoryLocks.set(key, tail);
  return prev.then(fn, fn).finally(() => {
    release();
    if (checkoutMemoryLocks.get(key) === tail) checkoutMemoryLocks.delete(key);
  });
}

async function withStripeCustomerLock(lockKey, fn) {
  const key = String(lockKey || 'checkout');
  return withMemoryLock(key, async () => {
    if (!process.env.DATABASE_URL) return fn();
    let client = null;
    try {
      client = await pool.connect();
    } catch (err) {
      console.warn('[checkout] db lock unavailable, using process lock:', err.message);
      return fn();
    }
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fm-checkout:${key}`]);
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* already closed */ }
      throw err;
    } finally {
      client.release();
    }
  });
}

/** Tests only. Closes the storage pool so the next Jest file does not inherit its clients. */
async function endPoolForTests() {
  if (pool && typeof pool.end === 'function') {
    try { await pool.end(); } catch (_) { /* already closed */ }
  }
}

// Export all functions and database instance
module.exports = {
  endPoolForTests,
  db,
  // Test seam only: lets a test hand inProfileTx a fake client (EQA #142 S2).
  __profileTx: { pool, inProfileTx },
  mergeProfileFilters,
  createUser,
  getUserByEmail,
  getUserById,
  updateUserSubscription,
  setAIDataConsent,
  updateUserCoachBilling,
  effectiveTier,
  withStripeCustomerLock,
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
