'use strict';
/**
 * EQA acceptance list, FitMunch account deletion + support form, round 7. Owned by Elite QA. LOCKED 24 Nov 2026 AEDT.
 * Rows: R7-M5 (account delete also removes pt_leads, client_invitations, stripe_claim_tokens, ai_usage_monthly rows, in the same transaction),
 * R7-S2 (a 503 tells the customer the message was NOT sent and the page keeps what they typed), R7-S3 (signed-in row stores user_id + topic; r6 todo converted).
 * r6 support file stays committed and must stay green. No network, no real DB. Commit unchanged, add to jest.config.js testMatch. Do not edit, skip, loosen or retry.
 */
const SAVED = {};
for (const k of ['RESEND_API_KEY', 'RESEND_FROM', 'DATABASE_URL', 'SUPPORT_FORWARD_TO', 'STRIPE_SECRET_KEY']) SAVED[k] = process.env[k];
process.env.RESEND_API_KEY = 're_eqa_acceptance_dummy';
delete process.env.DATABASE_URL; delete process.env.STRIPE_SECRET_KEY; delete process.env.RESEND_FROM;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fitmunch-dev-secret';
const OPS = 'ops-inbox@example.test';
const USER = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'Riley.Case@Example.com';
const CUS = 'cus_EQA_r7_dummy';
const TABLES = ['pt_leads', 'client_invitations', 'stripe_claim_tokens', 'ai_usage_monthly'];

jest.mock('pg', () => {
  const state = { failTable: null, failCode: null, calls: [] };
  class Pool {
    query(sql, params) {
      const t = String(sql); state.calls.push({ sql: t, params: params || [] });
      if (state.failTable && new RegExp(`(DELETE FROM|UPDATE)\\s+${state.failTable}\\b`, 'i').test(t)) {
        return Promise.reject(Object.assign(new Error('mock'), { code: state.failCode }));
      }
      if (/DELETE FROM users/i.test(t)) return Promise.resolve({ rows: [], rowCount: 1 });
      if (/SELECT role, pt_id FROM users/i.test(t)) return Promise.resolve({ rows: [{ role: 'client', pt_id: null }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    connect() { return Promise.resolve({ query: (s, p) => this.query(s, p), release() {} }); }
    end() { return Promise.resolve(); }
  }
  return { Pool, __state: state };
});
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return { ...actual,
    getUserById: jest.fn(async (id) => (String(id) === '22222222-2222-4222-8222-222222222222'
      ? { id, name: 'Riley', email: 'Riley.Case@Example.com', stripeCustomerId: 'cus_EQA_r7_dummy', subscriptionTier: 'free', settings: {}, emailVerified: true } : null)),
    getProfile: jest.fn(async () => ({})), effectiveTier: () => 'free', consumerBillingFromUser: () => ({}) };
});

const fs = require('fs');
const path = require('path');
const sc = require('./lib/support-confirm');
const lc = (v) => String(v || '').trim().toLowerCase();
const addrOf = (v) => { const m = String(v || '').match(/<([^<>\s]+)>/); return lc(m ? m[1] : v); };
const toList = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map(addrOf);
const ORIGINAL_FETCH = global.fetch;
let seq = 0;
const uniqueEmail = (tag) => { seq += 1; return `eqa-r7-${tag}-${seq}@example.test`; };

let appCache = null;
function app() {
  if (appCache) return appCache;
  const express = require('express');
  const a = express(); a.use(express.json()); a.use('/api', require('./api_server'));
  appCache = a; return a;
}
function token() {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ userId: USER, role: 'client' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}
async function deleteAccount() {
  const request = require('supertest');
  return request(app()).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
}
function installMocks({ submitter, failForward = false, throwForward = false, storeOk = true }) {
  const rec = { sends: [], queries: [] };
  global.fetch = async (url, opts = {}) => {
    if (!String(url).includes('api.resend.com')) throw new Error('unexpected fetch ' + url);
    const body = JSON.parse(opts.body || '{}');
    const isAck = toList(body.to).includes(lc(submitter));
    rec.sends.push(body);
    if (!isAck && throwForward) throw Object.assign(new Error('mock network'), { code: 'ECONNRESET' });
    if (!isAck && failForward) return { ok: false, status: 502, json: async () => ({ message: 'mock failure' }) };
    return { ok: true, status: 200, json: async () => ({ id: 'email_' + rec.sends.length }) };
  };
  sc.setSupportQueryForTests(async (s, params) => {
    rec.queries.push({ sql: String(s), params: params || [] });
    if (!storeOk) throw Object.assign(new Error('mock db down'), { code: 'ECONNREFUSED' });
    return { rows: [{ id: 'row-eqa-r7' }], rowCount: 1 };
  });
  return rec;
}
async function quiet(fn) {
  const orig = { error: console.error, warn: console.warn, log: console.log };
  for (const k of ['error', 'warn', 'log']) console[k] = () => {};
  try { return await fn(); } finally { Object.assign(console, orig); }
}

beforeEach(() => {
  process.env.SUPPORT_FORWARD_TO = OPS;
  const { __state } = require('pg'); __state.failTable = null; __state.failCode = null; __state.calls.length = 0;
});
afterEach(() => { sc.setSupportQueryForTests(null); global.fetch = ORIGINAL_FETCH; });
afterAll(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

function inTxn(calls) {
  const b = calls.findIndex((c) => /^\s*BEGIN/i.test(c.sql)); const e = calls.findIndex((c) => /^\s*COMMIT/i.test(c.sql));
  return b >= 0 && e > b ? calls.slice(b + 1, e) : [];
}
const KEY_OK = {
  pt_leads: (p) => p.some((x) => lc(x) === lc(EMAIL)),
  client_invitations: (p) => p.some((x) => lc(x) === lc(EMAIL)),
  stripe_claim_tokens: (p) => p.some((x) => String(x) === USER || String(x) === CUS),
  ai_usage_monthly: (p) => p.some((x) => String(x) === USER),
};

describe('EQA r7, M5 account deletion removes every row keyed to the customer', () => {
  test('R7-M5a a 200 "deleted" response removes or anonymises pt_leads, client_invitations, stripe_claim_tokens and ai_usage_monthly rows inside the delete transaction, keyed to this customer', async () => {
    const res = await quiet(deleteAccount);
    expect(res.status).toBe(200);
    const { __state } = require('pg'); const tx = inTxn(__state.calls);
    const missing = TABLES.filter((t) => !tx.some((c) => new RegExp(`(DELETE FROM|UPDATE)\\s+${t}\\b`, 'i').test(c.sql) && KEY_OK[t](c.params)));
    expect(missing).toEqual([]);
  });
  test('R7-M5b the email match is case-insensitive (lower(...) on both sides or a lowered parameter) for pt_leads and client_invitations', async () => {
    await quiet(deleteAccount);
    const { __state } = require('pg');
    const bad = ['pt_leads', 'client_invitations'].filter((t) => !__state.calls.some((c) => new RegExp(`(DELETE FROM|UPDATE)\\s+${t}\\b`, 'i').test(c.sql)
      && (/lower\s*\(\s*email\s*\)/i.test(c.sql) || c.params.some((x) => String(x) === lc(EMAIL)))));
    expect(bad).toEqual([]);
  });
  for (const t of TABLES) {
    test(`R7-M5c a failing ${t} delete (ECONNRESET) means no success response and no committed users delete`, async () => {
      const { __state } = require('pg'); __state.failTable = t; __state.failCode = 'ECONNRESET';
      const res = await quiet(deleteAccount);
      const usersDeleted = __state.calls.some((c) => /DELETE FROM users/i.test(c.sql));
      const committed = __state.calls.some((c) => /^\s*COMMIT/i.test(c.sql));
      expect({ touched: __state.calls.some((c) => new RegExp(`(DELETE FROM|UPDATE)\\s+${t}\\b`, 'i').test(c.sql)), success: !!(res.body && res.body.success), usersDeletedAndCommitted: usersDeleted && committed })
        .toEqual({ touched: true, success: false, usersDeletedAndCommitted: false });
    });
  }
});

describe('EQA r7, S2 a 503 never loses the customer message', () => {
  for (const [label, opts] of [['store fails, forward fails', { storeOk: false, failForward: true }], ['store fails, forward throws', { storeOk: false, throwForward: true }]]) {
    test(`R7-S2a ${label}: 503 says the message was not sent and gives support@fitmunch.com.au, never "confirmation"`, async () => {
      const submitter = uniqueEmail('s2'); installMocks({ submitter, ...opts });
      const r = await quiet(() => sc.sendSupportConfirmation({ email: submitter, message: 'my trial charged twice' }));
      const msg = String((r.body && (r.body.error || r.body.message)) || '');
      expect({ status: r.status, success: !!(r.body && r.body.success), notSent: /\bnot\b[^.]*\bsent\b|wasn'?t sent|didn'?t send|did not send/i.test(msg), email: msg.includes('support@fitmunch.com.au'), saysConfirmation: /confirmation/i.test(msg) })
        .toEqual({ status: 503, success: false, notSent: true, email: true, saysConfirmation: false });
    });
  }
  test('R7-S2b public/support.html clears the form only on a 200 success, and shows the server error text otherwise', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'support.html'), 'utf8');
    const resets = html.match(/(support-form|form)\s*\.reset\(\)|support-message['"]\)\.value\s*=\s*['"]{2}/g) || [];
    const okBlock = html.match(/if\s*\(\s*result\.status\s*===\s*200[^{]*\{([\s\S]*?)\n\s*\}/);
    expect({ resetCount: resets.length, resetInsideSuccess: !!(okBlock && /\.reset\(\)/.test(okBlock[1])), showsServerError: /result\.data\s*&&\s*result\.data\.error/.test(html) })
      .toEqual({ resetCount: 1, resetInsideSuccess: true, showsServerError: true });
  });
});

describe('EQA r7, S3 signed-in support row (r6 todo converted)', () => {
  test('R7-S3 a signed-in submission stores user_id and topic on the support_messages row', async () => {
    const submitter = uniqueEmail('s3'); const rec = installMocks({ submitter });
    const r = await quiet(() => sc.sendSupportConfirmation({ email: submitter, message: 's3', topic: 'billing' }, { userId: USER }));
    expect(r.status).toBe(200);
    const ins = rec.queries.find((q) => /^\s*INSERT\s+INTO\s+support_messages/i.test(q.sql));
    expect({ hasInsert: !!ins, userIdCol: !!ins && /\buser_id\b/.test(ins.sql), userIdParam: !!ins && ins.params.includes(USER), topicCol: !!ins && /\btopic\b/.test(ins.sql) })
      .toEqual({ hasInsert: true, userIdCol: true, userIdParam: true, topicCol: true });
  });
  test('R7-S3b the delete removes support rows by user_id as well as email (survives an email change)', async () => {
    await quiet(deleteAccount);
    const { __state } = require('pg');
    expect(__state.calls.some((c) => /DELETE FROM support_messages/i.test(c.sql) && /user_id/i.test(c.sql) && c.params.includes(USER))).toBe(true);
  });
});
