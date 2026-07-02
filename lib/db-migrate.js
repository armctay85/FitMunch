'use strict';
/**
 * Self-healing schema migration.
 *
 * Runs `CREATE TABLE IF NOT EXISTS` for the full FitMunch schema against the
 * live DATABASE_URL. This fixes environments where some tables (e.g.
 * user_profiles) were never created, without needing to know the connection
 * string out-of-band. Idempotent and cached — only runs once per process.
 *
 * Column names mirror shared/schema.js exactly so Drizzle queries line up.
 */

const { Pool } = require('pg');

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
  return _pool;
}

const DDL = `
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pgcrypto; EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  email_verified BOOLEAN DEFAULT FALSE,
  subscription_tier VARCHAR(50) DEFAULT 'free',
  subscription_expires_at TIMESTAMPTZ,
  stripe_customer_id VARCHAR(255),
  settings JSONB DEFAULT '{}'::jsonb,
  profile_image TEXT
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'pt';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pt_id UUID;

CREATE TABLE IF NOT EXISTS user_profiles (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  height REAL,
  weight REAL,
  age INTEGER,
  gender VARCHAR(20),
  activity_level VARCHAR(50),
  fitness_goal VARCHAR(100),
  dietary_preferences JSONB DEFAULT '[]'::jsonb,
  allergies JSONB DEFAULT '[]'::jsonb,
  target_calories INTEGER DEFAULT 2000,
  target_steps INTEGER DEFAULT 10000,
  target_protein INTEGER,
  target_carbs INTEGER,
  target_fat INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meal_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  meal_type VARCHAR(50) NOT NULL,
  food_name TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  serving_size TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  workout_type VARCHAR(100) NOT NULL,
  duration INTEGER,
  calories_burned INTEGER,
  exercises JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  rating INTEGER,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  weight REAL,
  body_fat_percentage REAL,
  measurements JSONB DEFAULT '{}'::jsonb,
  photos JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  goal_type VARCHAR(50),
  meals JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_calories INTEGER,
  total_protein REAL,
  total_carbs REAL,
  total_fat REAL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_plans (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  level VARCHAR(50),
  frequency INTEGER,
  workouts JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_type VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  session_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_invitations (
  id SERIAL PRIMARY KEY,
  pt_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255),
  token VARCHAR(64) NOT NULL UNIQUE,
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pt_clients (
  id SERIAL PRIMARY KEY,
  pt_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active',
  phase VARCHAR(50),
  notes TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopping_lists (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_plan_id INTEGER REFERENCES meal_plans(id),
  name TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favourites (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type VARCHAR(50) NOT NULL,
  item_id TEXT NOT NULL,
  item_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_assignments (
  id SERIAL PRIMARY KEY,
  pt_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_type VARCHAR(20) NOT NULL,
  plan_id INTEGER NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ai_usage_monthly (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  feature TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month, feature)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);
`;

let _promise = null;
/** Idempotent, cached. Resolves true on success, false if no DB or failure. */
function ensureSchema() {
  if (_promise) return _promise;
  const pool = getPool();
  if (!pool) return Promise.resolve(false);
  _promise = pool
    .query(DDL)
    .then(() => {
      console.log('[db-migrate] schema ensured');
      return true;
    })
    .catch((err) => {
      console.error('[db-migrate] failed:', err.message);
      _promise = null; // allow retry on next call
      return false;
    });
  return _promise;
}

module.exports = { ensureSchema };
