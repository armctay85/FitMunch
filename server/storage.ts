// FitMunch Database Storage Layer
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../shared/schema';

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize Drizzle ORM
export const db = drizzle(pool, { schema });

// User operations
export async function createUser(email: string, name: string, passwordHash: string) {
  const [user] = await db.insert(schema.users).values({
    email,
    name,
    passwordHash,
  }).returning();
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return user;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

export async function updateUserSubscription(userId: string, tier: string, expiresAt: Date) {
  await db.update(schema.users)
    .set({ 
      subscriptionTier: tier,
      subscriptionExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

// Profile operations
export async function createOrUpdateProfile(userId: string, profileData: any) {
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

export async function getProfile(userId: string) {
  const [profile] = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  return profile;
}

// Meal logging operations
export async function logMeal(userId: string, mealData: any) {
  const [meal] = await db.insert(schema.mealLogs).values({
    userId,
    ...mealData,
  }).returning();
  return meal;
}

export async function getMealLogsByDate(userId: string, date: Date) {
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

export async function getMealLogsForPeriod(userId: string, startDate: Date, endDate: Date) {
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
export async function logWorkout(userId: string, workoutData: any) {
  const [workout] = await db.insert(schema.workoutLogs).values({
    userId,
    ...workoutData,
  }).returning();
  return workout;
}

export async function getWorkoutLogsByDate(userId: string, date: Date) {
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

export async function getRecentWorkouts(userId: string, limit: number = 10) {
  return await db.select()
    .from(schema.workoutLogs)
    .where(eq(schema.workoutLogs.userId, userId))
    .orderBy(desc(schema.workoutLogs.date))
    .limit(limit);
}

// Progress tracking operations
export async function logProgress(userId: string, progressData: any) {
  const [progress] = await db.insert(schema.progressLogs).values({
    userId,
    ...progressData,
  }).returning();
  return progress;
}

export async function getProgressHistory(userId: string, limit: number = 30) {
  return await db.select()
    .from(schema.progressLogs)
    .where(eq(schema.progressLogs.userId, userId))
    .orderBy(desc(schema.progressLogs.date))
    .limit(limit);
}

// Analytics operations
export async function trackEvent(userId: string | null, eventType: string, eventData: any, sessionId: string) {
  await db.insert(schema.analyticsEvents).values({
    userId,
    eventType,
    eventData,
    sessionId,
  });
}

// Export database instance and schema
export { schema };
