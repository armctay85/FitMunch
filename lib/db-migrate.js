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
const { sslFor } = require('./pg-ssl');

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL),
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'client';
-- Existing installs may still have DEFAULT 'pt' from older migrate; force consumer-first.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'client';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pt_id UUID;
-- One Stripe customer id per row. Duplicate values (legacy double-submit) must not
-- take down schema ensure, so a conflict is warned and left for the checkout lock.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_uidx
    ON users (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> '';
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'users.stripe_customer_id has duplicates; unique index not created';
END $$;

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
-- Heal legacy pt_clients shapes (some envs only had pt_id/client_id/status).
ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS phase VARCHAR(50);
ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

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
CREATE UNIQUE INDEX IF NOT EXISTS favourites_user_type_item_uidx
  ON favourites (user_id, item_type, item_id);

CREATE TABLE IF NOT EXISTS pt_referrals (
  id SERIAL PRIMARY KEY,
  pt_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  uses INTEGER DEFAULT 0,
  credits INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
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

CREATE TABLE IF NOT EXISTS coach_branding (
  pt_id TEXT PRIMARY KEY,
  practice_name TEXT,
  accent TEXT,
  logo_data_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coach_plans (
  id TEXT PRIMARY KEY,
  pt_id TEXT NOT NULL,
  client_id TEXT,
  client_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  token TEXT UNIQUE,
  payload JSONB NOT NULL,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_plans_pt_idx ON coach_plans (pt_id);

-- Price memory. Own-receipt prices only. Row level security is forced on.
DO $$
BEGIN
  CREATE ROLE fm_price_memory NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE WARNING 'price memory role skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS price_memory_consents (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('own_price_memory')),
  granted BOOLEAN NOT NULL,
  policy_version TEXT NOT NULL,
  surface TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_memory_consents_user_idx
  ON price_memory_consents (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL CHECK (store_id IN ('woolworths','coles','aldi','iga','harris_farm','costco','foodworks','other')),
  store_label TEXT NULL CHECK (store_label IS NULL OR (store_id = 'other' AND char_length(store_label) <= 60)),
  purchased_on DATE NOT NULL,
  date_source TEXT NOT NULL CHECK (date_source IN ('receipt','scan')),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('web','ios')),
  item_count INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS receipts_user_purchased_idx ON receipts (user_id, purchased_on DESC);

CREATE TABLE IF NOT EXISTS price_observations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_key_source TEXT NOT NULL CHECK (item_key_source IN ('rule','user')),
  item_label TEXT NOT NULL CHECK (char_length(item_label) <= 80),
  category TEXT NOT NULL,
  store_id TEXT NOT NULL,
  purchased_on DATE NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  pack_size_value NUMERIC(10,3) NULL,
  pack_size_unit TEXT NULL CHECK (pack_size_unit IN ('g','ml','each')),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents > 0 AND line_total_cents <= 50000),
  unit_price_cents INTEGER NOT NULL,
  unit_rate_cents INTEGER NULL,
  unit_rate_basis TEXT NULL CHECK (unit_rate_basis IN ('per_kg','per_l','each')),
  promo_flag BOOLEAN NOT NULL DEFAULT false,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','low')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_observations_user_item_idx
  ON price_observations (user_id, item_key, purchased_on DESC);
CREATE INDEX IF NOT EXISTS price_observations_user_receipt_idx
  ON price_observations (user_id, receipt_id);

CREATE TABLE IF NOT EXISTS price_memory_aliases (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_label_slug TEXT NOT NULL,
  item_key TEXT NOT NULL,
  PRIMARY KEY (user_id, raw_label_slug)
);

ALTER TABLE price_memory_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_memory_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE price_memory_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_memory_aliases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_isolation ON price_memory_consents;
CREATE POLICY pm_isolation ON price_memory_consents
  USING (
    user_id::text = current_setting('app.user_id', true)
    OR current_setting('app.price_memory_maintenance', true) = 'purge'
  )
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

DROP POLICY IF EXISTS pm_isolation ON receipts;
CREATE POLICY pm_isolation ON receipts
  USING (
    user_id::text = current_setting('app.user_id', true)
    OR current_setting('app.price_memory_maintenance', true) = 'purge'
  )
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

DROP POLICY IF EXISTS pm_isolation ON price_observations;
CREATE POLICY pm_isolation ON price_observations
  USING (
    user_id::text = current_setting('app.user_id', true)
    OR current_setting('app.price_memory_maintenance', true) = 'purge'
  )
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

DROP POLICY IF EXISTS pm_isolation ON price_memory_aliases;
CREATE POLICY pm_isolation ON price_memory_aliases
  USING (
    user_id::text = current_setting('app.user_id', true)
    OR current_setting('app.price_memory_maintenance', true) = 'purge'
  )
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    price_memory_consents, receipts, price_observations, price_memory_aliases
    TO fm_price_memory;
  GRANT USAGE, SELECT ON SEQUENCE price_memory_consents_id_seq, price_observations_id_seq TO fm_price_memory;
  GRANT SELECT (id) ON users TO fm_price_memory;
  GRANT fm_price_memory TO CURRENT_USER;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'price memory grants skipped: %', SQLERRM;
END $$;
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

async function resetForTests() {
  if (_pool) {
    try { await _pool.end(); } catch (_) { /* ignore */ }
  }
  _pool = null;
  _promise = null;
}

module.exports = { ensureSchema, resetForTests };
