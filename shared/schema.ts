// FitMunch Database Schema - PostgreSQL with Drizzle ORM
import { pgTable, serial, text, integer, timestamp, boolean, jsonb, real, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table - Enhanced with comprehensive profile data
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
  emailVerified: boolean('email_verified').default(false),
  subscriptionTier: varchar('subscription_tier', { length: 50 }).default('free'),
  subscriptionExpiresAt: timestamp('subscription_expires_at'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  settings: jsonb('settings').default('{}'),
  profileImage: text('profile_image'),
});

// User profiles - Detailed fitness and health data
export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  height: real('height'), // in cm
  weight: real('weight'), // in kg
  age: integer('age'),
  gender: varchar('gender', { length: 20 }),
  activityLevel: varchar('activity_level', { length: 50 }),
  fitnessGoal: varchar('fitness_goal', { length: 100 }),
  dietaryPreferences: jsonb('dietary_preferences').default('[]'),
  allergies: jsonb('allergies').default('[]'),
  targetCalories: integer('target_calories').default(2000),
  targetSteps: integer('target_steps').default(10000),
  targetProtein: integer('target_protein'),
  targetCarbs: integer('target_carbs'),
  targetFat: integer('target_fat'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Meal logs - Track daily nutrition
export const mealLogs = pgTable('meal_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: timestamp('date').defaultNow().notNull(),
  mealType: varchar('meal_type', { length: 50 }).notNull(), // breakfast, lunch, dinner, snack
  foodName: text('food_name').notNull(),
  calories: integer('calories').notNull(),
  protein: real('protein').default(0),
  carbs: real('carbs').default(0),
  fat: real('fat').default(0),
  fiber: real('fiber').default(0),
  servingSize: text('serving_size'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Workout logs - Track exercise activities
export const workoutLogs = pgTable('workout_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: timestamp('date').defaultNow().notNull(),
  workoutType: varchar('workout_type', { length: 100 }).notNull(),
  duration: integer('duration'), // in minutes
  caloriesBurned: integer('calories_burned'),
  exercises: jsonb('exercises').default('[]'),
  notes: text('notes'),
  rating: integer('rating'), // 1-5
  completedAt: timestamp('completed_at').defaultNow().notNull(),
});

// Progress tracking - Weight, measurements, and milestones
export const progressLogs = pgTable('progress_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: timestamp('date').defaultNow().notNull(),
  weight: real('weight'),
  bodyFatPercentage: real('body_fat_percentage'),
  measurements: jsonb('measurements').default('{}'), // chest, waist, hips, etc.
  photos: jsonb('photos').default('[]'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Meal plans - Saved meal plans
export const mealPlans = pgTable('meal_plans', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  goalType: varchar('goal_type', { length: 50 }), // weight_loss, maintenance, muscle_gain
  meals: jsonb('meals').notNull(),
  totalCalories: integer('total_calories'),
  totalProtein: real('total_protein'),
  totalCarbs: real('total_carbs'),
  totalFat: real('total_fat'),
  isActive: boolean('is_active').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Workout plans - Saved workout routines
export const workoutPlans = pgTable('workout_plans', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  level: varchar('level', { length: 50 }), // beginner, intermediate, advanced
  frequency: integer('frequency'), // days per week
  workouts: jsonb('workouts').notNull(),
  isActive: boolean('is_active').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Achievements and badges
export const achievements = pgTable('achievements', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  achievementType: varchar('achievement_type', { length: 100 }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  icon: text('icon'),
  earnedAt: timestamp('earned_at').defaultNow().notNull(),
});

// Analytics events - Track user behavior
export const analyticsEvents = pgTable('analytics_events', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  eventData: jsonb('event_data').default('{}'),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  mealLogs: many(mealLogs),
  workoutLogs: many(workoutLogs),
  progressLogs: many(progressLogs),
  mealPlans: many(mealPlans),
  workoutPlans: many(workoutPlans),
  achievements: many(achievements),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const mealLogsRelations = relations(mealLogs, ({ one }) => ({
  user: one(users, {
    fields: [mealLogs.userId],
    references: [users.id],
  }),
}));

export const workoutLogsRelations = relations(workoutLogs, ({ one }) => ({
  user: one(users, {
    fields: [workoutLogs.userId],
    references: [users.id],
  }),
}));

export const progressLogsRelations = relations(progressLogs, ({ one }) => ({
  user: one(users, {
    fields: [progressLogs.userId],
    references: [users.id],
  }),
}));
