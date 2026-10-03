'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  adherenceFromLogs,
  resolveCoachClientLimit,
  transitionPlanStatus,
} = require('./coach-plan');

const PREVIEW_PT = Object.freeze({
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Trainer',
  email: 'pt-test@fitmunch.test',
  role: 'pt',
});

const PREVIEW_CLIENT = Object.freeze({
  id: '00000000-0000-4000-8000-0000000000b1',
  label: 'Sample client',
  email: 'client@fitmunch.test',
});

const SAMPLE_PRACTICE = 'Paperbark Coaching';
let sampleLogoDataUrl = null;

function sampleBranding() {
  if (!sampleLogoDataUrl) {
    const file = path.join(__dirname, '..', 'public', 'img', 'sample-wordmark.png');
    const buf = fs.readFileSync(file);
    sampleLogoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return {
    practiceName: SAMPLE_PRACTICE,
    accent: '#14532d',
    logoDataUrl: sampleLogoDataUrl,
  };
}

const DDL = `
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
`;

let pool = null;
let schemaReady = null;
const memory = blankMemory();

function blankMemory() {
  return {
    plans: new Map(),
    branding: new Map(),
    limits: new Map(),
    logs: new Map(),
  };
}

function previewEnabled() {
  if (process.env.COACH_PREVIEW === '0') return false;
  if (process.env.COACH_PREVIEW === '1') return true;
  if (process.env.VERCEL_ENV === 'preview') return true;
  if (process.env.JEST_WORKER_ID) return true;
  return process.env.NODE_ENV !== 'production';
}

function previewLogs(now) {
  const end = now ? new Date(now) : new Date();
  const logs = [];
  for (const ago of [0, 1, 2, 4]) {
    const date = new Date(end);
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ago);
    logs.push(
      { date: date.toISOString(), calories: 500, protein: 30, carbs: 50, fat: 15 },
      { date: date.toISOString(), calories: 700, protein: 40, carbs: 70, fat: 20 },
      { date: date.toISOString(), calories: 600, protein: 35, carbs: 55, fat: 18 }
    );
  }
  return logs;
}

function seedPreview() {
  memory.logs.set(PREVIEW_CLIENT.id, previewLogs());
}

function resetMemory() {
  memory.plans.clear();
  memory.branding.clear();
  memory.limits.clear();
  memory.logs.clear();
  seedPreview();
}

seedPreview();

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

async function ensureTables() {
  const db = getPool();
  if (!db) return false;
  if (!schemaReady) {
    schemaReady = db.query(DDL).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
  return true;
}

function useMemory() {
  return !process.env.DATABASE_URL;
}

function newId() {
  return crypto.randomUUID();
}

function publicPlan(row, extras) {
  return {
    id: row.id,
    ptId: row.ptId,
    clientId: row.clientId,
    clientLabel: row.clientLabel,
    status: row.status,
    token: row.token || null,
    sharePath: row.token ? `/c/${row.token}` : null,
    targets: row.targets,
    flags: row.flags,
    householdSize: row.householdSize,
    storeId: row.storeId,
    plan: row.plan,
    sentAt: row.sentAt || null,
    viewedAt: row.viewedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(extras || {}),
  };
}

async function listClients(ptId) {
  if (ptId === PREVIEW_PT.id) {
    return [{ id: PREVIEW_CLIENT.id, label: PREVIEW_CLIENT.label }];
  }
  const db = getPool();
  if (!db) return [];
  await ensureTables();
  const result = await db.query(
    `SELECT u.id, u.name
     FROM pt_clients pc
     JOIN users u ON u.id = pc.client_id
     WHERE pc.pt_id = $1 AND (pc.status IS NULL OR pc.status = 'active')
     ORDER BY pc.joined_at DESC NULLS LAST`,
    [ptId]
  );
  return result.rows.map((row) => ({ id: String(row.id), label: row.name || 'Client' }));
}

function previewClientRows() {
  const logged = memory.logs.get(PREVIEW_CLIENT.id) || [];
  const last = logged.length ? logged[0].date : null;
  return [{
    id: PREVIEW_CLIENT.id,
    name: PREVIEW_CLIENT.label,
    email: PREVIEW_CLIENT.email,
    created_at: new Date().toISOString(),
    status: 'active',
    phase: 'maintain',
    joined_at: new Date().toISOString(),
    meals_7d: 4,
    workouts_7d: 0,
    last_logged: last,
    last_progress: null,
  }];
}

async function getLogs(clientId) {
  if (memory.logs.has(clientId)) return memory.logs.get(clientId);
  const db = getPool();
  if (!db) return [];
  const result = await db.query(
    `SELECT date, calories, protein, carbs, fat
     FROM meal_logs
     WHERE user_id = $1 AND date > NOW() - INTERVAL '8 days'`,
    [clientId]
  );
  return result.rows;
}

async function getGateRecord(ptId) {
  if (memory.limits.has(ptId)) {
    return { id: ptId, coachClientLimit: memory.limits.get(ptId) };
  }
  const db = getPool();
  if (!db || ptId === PREVIEW_PT.id) return { id: ptId, coachClientLimit: null };
  try {
    const result = await db.query('SELECT settings FROM users WHERE id = $1', [ptId]);
    const settings = result.rows[0] && result.rows[0].settings;
    const limit = settings && Object.prototype.hasOwnProperty.call(settings, 'coachClientLimit')
      ? settings.coachClientLimit
      : null;
    return { id: ptId, coachClientLimit: limit };
  } catch (_) {
    return { id: ptId, coachClientLimit: null };
  }
}

function setClientLimit(ptId, limit) {
  if (limit == null || limit === '') memory.limits.delete(ptId);
  else memory.limits.set(ptId, limit);
}

async function getBranding(ptId) {
  let stored = null;
  if (!useMemory()) {
    try {
      await ensureTables();
      const result = await getPool().query('SELECT * FROM coach_branding WHERE pt_id = $1', [ptId]);
      const row = result.rows[0];
      if (row) {
        stored = {
          practiceName: row.practice_name || '',
          accent: row.accent || '#1f9d4a',
          logoDataUrl: row.logo_data_url || null,
        };
      }
    } catch (err) {
      console.warn('[coach] branding read failed:', err.message);
    }
  }
  if (!stored) stored = memory.branding.get(ptId) || null;
  if (ptId === PREVIEW_PT.id && (!stored || !stored.practiceName)) return sampleBranding();
  return stored || { practiceName: '', accent: '#1f9d4a', logoDataUrl: null };
}

async function saveBranding(ptId, branding) {
  const stored = {
    practiceName: branding.practiceName,
    accent: branding.accent,
    logoDataUrl: branding.logoDataUrl || null,
  };
  memory.branding.set(ptId, stored);
  if (!useMemory()) {
    await ensureTables();
    await getPool().query(
      `INSERT INTO coach_branding (pt_id, practice_name, accent, logo_data_url, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (pt_id) DO UPDATE
       SET practice_name = EXCLUDED.practice_name,
           accent = EXCLUDED.accent,
           logo_data_url = EXCLUDED.logo_data_url,
           updated_at = NOW()`,
      [ptId, stored.practiceName, stored.accent, stored.logoDataUrl]
    );
  }
  return stored;
}

async function insertPlan(row) {
  memory.plans.set(row.id, row);
  if (useMemory()) return row;
  await ensureTables();
  await getPool().query(
    `INSERT INTO coach_plans
      (id, pt_id, client_id, client_label, status, token, payload, sent_at, viewed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id,
      row.ptId,
      row.clientId,
      row.clientLabel,
      row.status,
      row.token,
      JSON.stringify(row),
      row.sentAt,
      row.viewedAt,
      row.createdAt,
      row.updatedAt,
    ]
  );
  return row;
}

async function writePlan(row) {
  row.updatedAt = new Date().toISOString();
  memory.plans.set(row.id, row);
  if (useMemory()) return row;
  await ensureTables();
  await getPool().query(
    `UPDATE coach_plans
     SET status = $2, token = $3, payload = $4, sent_at = $5, viewed_at = $6, updated_at = NOW()
     WHERE id = $1`,
    [row.id, row.status, row.token, JSON.stringify(row), row.sentAt, row.viewedAt]
  );
  return row;
}

async function createPlan(row) {
  const now = new Date().toISOString();
  const stored = {
    id: newId(),
    ptId: row.ptId,
    clientId: row.clientId,
    clientLabel: row.clientLabel,
    status: 'draft',
    token: null,
    targets: row.plan.targets,
    flags: row.plan.flags,
    householdSize: row.plan.householdSize,
    storeId: row.plan.storeId,
    plan: row.plan,
    source: row.source || 'manual',
    sentAt: null,
    viewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertPlan(stored);
  return stored;
}

async function listPlans(ptId) {
  if (useMemory()) {
    return [...memory.plans.values()]
      .filter((row) => row.ptId === ptId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  await ensureTables();
  const result = await getPool().query(
    'SELECT payload FROM coach_plans WHERE pt_id = $1 ORDER BY created_at DESC',
    [ptId]
  );
  return result.rows.map((row) => row.payload);
}

async function getPlan(id, ptId) {
  if (useMemory()) {
    const local = memory.plans.get(id);
    return local && local.ptId === ptId ? local : null;
  }
  const local = memory.plans.get(id);
  if (local && local.ptId === ptId) return local;
  await ensureTables();
  const result = await getPool().query(
    'SELECT payload FROM coach_plans WHERE id = $1 AND pt_id = $2',
    [id, ptId]
  );
  return result.rows[0] ? result.rows[0].payload : null;
}

async function getByToken(token) {
  for (const row of memory.plans.values()) {
    if (row.token === token) return row;
  }
  const db = getPool();
  if (!db) return null;
  await ensureTables();
  const result = await db.query('SELECT payload FROM coach_plans WHERE token = $1', [token]);
  return result.rows[0] ? result.rows[0].payload : null;
}

async function withAdherence(row) {
  const logs = row.clientId ? await getLogs(row.clientId) : [];
  const adherence = adherenceFromLogs(logs, row.targets || row.plan.targets);
  return publicPlan(row, { adherence });
}

async function markStatus(row, event) {
  const next = transitionPlanStatus(row.status, event);
  const now = new Date().toISOString();
  if (event === 'send' && row.status === 'draft') {
    row.token = crypto.randomBytes(18).toString('base64url');
    row.sentAt = now;
  }
  if (next === 'viewed' && !row.viewedAt) row.viewedAt = now;
  row.status = next;
  await writePlan(row);
  return row;
}

function limitFor(pt) {
  return resolveCoachClientLimit(pt);
}

module.exports = {
  PREVIEW_PT,
  PREVIEW_CLIENT,
  DDL,
  previewEnabled,
  previewClientRows,
  previewLogs,
  resetMemory,
  listClients,
  getLogs,
  getGateRecord,
  setClientLimit,
  getBranding,
  saveBranding,
  createPlan,
  writePlan,
  listPlans,
  getPlan,
  getByToken,
  withAdherence,
  markStatus,
  limitFor,
  publicPlan,
};
