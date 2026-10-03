'use strict';

const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

let envSnapshot = null;

function assertDatabaseUrl() {
  if (!envSnapshot) {
    envSnapshot = {
      DATABASE_URL: process.env.DATABASE_URL,
      PRICE_MEMORY_ENABLED: process.env.PRICE_MEMORY_ENABLED,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      JWT_SECRET: process.env.JWT_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
    };
  }
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is required. Price memory database tests do not skip.');
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fitmunch-price-memory-test';
  if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.PRICE_MEMORY_ENABLED = 'true';
}

async function resetDatabase() {
  assertDatabaseUrl();
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO public');
  await client.end();
  const migrate = require('../../lib/db-migrate');
  await migrate.resetForTests();
  const store = require('../../lib/price-memory-store');
  await store.closeForTests();
  const ok = await migrate.ensureSchema();
  if (!ok) throw new Error('ensureSchema failed');
}

async function createUser(label, role) {
  const id = crypto.randomUUID();
  const email = `${label}-${id.slice(0, 8)}@price-memory.test`;
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  await client.query(
    'INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
    [id, email, label, 'x', role || 'client']
  );
  await client.end();
  const token = jwt.sign(
    { userId: id, name: label, email, role: role || 'client' },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
  return { id, email, token, role: role || 'client' };
}

async function linkTrainer(ptId, clientId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  await client.query(
    `INSERT INTO pt_clients (pt_id, client_id, status) VALUES ($1, $2, 'active')`,
    [ptId, clientId]
  );
  await client.end();
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function restoreEnv() {
  if (!envSnapshot) return;
  Object.keys(envSnapshot).forEach((key) => {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  });
}

module.exports = {
  assertDatabaseUrl,
  resetDatabase,
  createUser,
  linkTrainer,
  auth,
  restoreEnv,
};
