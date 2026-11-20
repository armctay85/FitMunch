'use strict';
/**
 * EQA acceptance list, FitMunch support form + account deletion, round 6. Owned by Elite QA. FINAL 21 Nov 2026 9:10am AEDT.
 * Rows: M4 (deletion must not claim success when help rows survive), A9-A11, B6, B7, C5 (accepted by Wilson 20 Nov), S1 (Should, round 6).
 * Commit unchanged on the 223 branch, add to jest.config.js testMatch. No network, no real DB. Do not edit, skip, loosen or retry.
 */
const SAVED = {};
for (const k of ['RESEND_API_KEY', 'RESEND_FROM', 'DATABASE_URL', 'SUPPORT_FORWARD_TO', 'STRIPE_SECRET_KEY']) SAVED[k] = process.env[k];
process.env.RESEND_API_KEY = 're_eqa_acceptance_dummy';
delete process.env.DATABASE_URL; delete process.env.STRIPE_SECRET_KEY; delete process.env.RESEND_FROM;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fitmunch-dev-secret';
const OPS = 'ops-inbox@example.test';
const USER = '11111111-1111-4111-8111-111111111111';

jest.mock('pg', () => {
  const state = { supportDeleteError: null, calls: [] };
  class Pool {
    query(sql, params) {
      const t = String(sql); state.calls.push(t);
      if (/DELETE FROM support_messages/i.test(t) && state.supportDeleteError) {
        return Promise.reject(Object.assign(new Error('mock'), { code: state.supportDeleteError }));
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
    getUserById: jest.fn(async (id) => (String(id) === '11111111-1111-4111-8111-111111111111'
      ? { id, name: 'Jordan', email: 'Jordan.Case@example.com', subscriptionTier: 'free', settings: {}, emailVerified: true } : null)),
    getProfile: jest.fn(async () => ({})), effectiveTier: () => 'free', consumerBillingFromUser: () => ({}) };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { __state } = require('pg');
const sc = require('./lib/support-confirm');
const counters = require('./lib/shared-counters');

const app = express(); app.use(express.json()); app.use('/api', require('./api_server'));
const token = () => jwt.sign({ userId: USER, role: 'client' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
const ORIGINAL_FETCH = global.fetch;
let seq = 0;
const uniqueEmail = (tag) => { seq += 1; return `eqa-r6-${tag}-${seq}@example.test`; };
const lc = (v) => String(v || '').trim().toLowerCase();
const addrOf = (v) => { const m = String(v || '').match(/<([^<>\s]+)>/); return lc(m ? m[1] : v); };
const toList = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map(addrOf);

function installMocks({ submitter, failForward = false, throwForward = false, storeOk = true }) {
  const rec = { sends: [], queries: [], order: [] };
  global.fetch = async (url, opts = {}) => {
    if (!String(url).includes('api.resend.com')) throw new Error('unexpected fetch ' + url);
    const body = JSON.parse(opts.body || '{}');
    const isAck = toList(body.to).includes(lc(submitter));
    rec.sends.push(body); rec.order.push(isAck ? 'ack' : 'forward');
    if (!isAck && throwForward) throw Object.assign(new Error('mock network'), { code: 'ECONNRESET' });
    if (!isAck && failForward) return { ok: false, status: 502, json: async () => ({ message: 'mock failure' }) };
    return { ok: true, status: 200, json: async () => ({ id: (isAck ? 'email_ack_' : 'email_fwd_') + rec.sends.length }) };
  };
  sc.setSupportQueryForTests(async (s, params) => {
    rec.queries.push({ sql: String(s), params });
    if (/^\s*INSERT/i.test(String(s))) rec.order.push('store');
    if (!storeOk) throw Object.assign(new Error('mock db down'), { code: 'ECONNREFUSED' });
    return { rows: [{ id: 'row-eqa-r6' }], rowCount: 1 };
  });
  return rec;
}
async function capture(fn) {
  const logged = []; const orig = { error: console.error, warn: console.warn, log: console.log };
  for (const k of ['error', 'warn', 'log']) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  try { return { r: await fn(), logged }; } finally { Object.assign(console, orig); }
}
const forwardsTo = (rec, submitter) => rec.sends.filter((s) => !toList(s.to).includes(lc(submitter)));

beforeEach(async () => {
  process.env.SUPPORT_FORWARD_TO = OPS;
  __state.supportDeleteError = null; __state.calls.length = 0;
  if (typeof counters.resetSharedCountersForTests === 'function') await counters.resetSharedCountersForTests();
});
afterEach(() => { sc.setSupportQueryForTests(null); global.fetch = ORIGINAL_FETCH; });
afterAll(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe('EQA r6, M4 account deletion privacy', () => {
  for (const code of ['ECONNRESET', '57014', '40P01']) {
    test(`M4 support_messages DELETE fails with ${code}: no "all data deleted" success, users row not deleted`, async () => {
      __state.supportDeleteError = code;
      const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
      const usersDeleted = __state.calls.some((c) => /DELETE FROM users/i.test(c));
      const committed = __state.calls.some((c) => /^\s*COMMIT/i.test(c));
      expect({ status: res.status >= 500, success: !!(res.body && res.body.success), usersDeletedWithoutRollback: usersDeleted && committed })
        .toEqual({ status: true, success: false, usersDeletedWithoutRollback: false });
      if (!__state.calls.some((c) => /^\s*BEGIN/i.test(c))) expect(usersDeleted).toBe(false);
    });
  }
  test('M4b table missing (42P01) still deletes the account: 200, users row deleted', async () => {
    __state.supportDeleteError = '42P01';
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(__state.calls.some((c) => /DELETE FROM users/i.test(c))).toBe(true);
  });
});

describe('EQA r6, forward target rules', () => {
  for (const target of ['help@fitmunch.com.au', 'support+tag@fitmunch.com.au', 'relay+x@fitmunch.com.au', 'HELP@FitMunch.com.au', 'Ops <hello@fitmunch.com.au>']) {
    test(`A9 own-domain SUPPORT_FORWARD_TO "${target}": failed forward, logged, never sent`, async () => {
      process.env.SUPPORT_FORWARD_TO = target;
      const submitter = uniqueEmail('a9'); const rec = installMocks({ submitter });
      const { r, logged } = await capture(() => sc.sendSupportConfirmation({ email: submitter, message: 'a9' }));
      expect(r.status).toBe(200);
      expect(r.body && r.body.forward_status).toBe('failed');
      expect(forwardsTo(rec, submitter)).toHaveLength(0);
      expect(logged.some((l) => /\[support\] forward_(failed|target_)/.test(l))).toBe(true);
    });
  }
  for (const target of ['a@x.test, b@y.test', 'A <a@x.test>, B <b@y.test>', 'a@x.test;b@y.test', 'a@x.test b@y.test']) {
    test(`A10 two addresses in SUPPORT_FORWARD_TO "${target}": failed, never half-sent`, async () => {
      process.env.SUPPORT_FORWARD_TO = target;
      const submitter = uniqueEmail('a10'); const rec = installMocks({ submitter });
      const { r } = await capture(() => sc.sendSupportConfirmation({ email: submitter, message: 'a10' }));
      expect(r.body && r.body.forward_status).toBe('failed');
      expect(forwardsTo(rec, submitter)).toHaveLength(0);
    });
  }
  for (const target of ['  ops-inbox@example.test  ', 'OPS-INBOX@EXAMPLE.TEST', 'Ops <ops-inbox@example.test>']) {
    test(`A11 SUPPORT_FORWARD_TO "${target}" resolves to exactly one send to ${OPS}`, async () => {
      process.env.SUPPORT_FORWARD_TO = target;
      const submitter = uniqueEmail('a11'); const rec = installMocks({ submitter });
      const { r } = await capture(() => sc.sendSupportConfirmation({ email: submitter, message: 'a11' }));
      expect(r.status).toBe(200);
      const fw = forwardsTo(rec, submitter);
      expect(fw.map((s) => toList(s.to))).toEqual([[OPS]]);
    });
  }
});

describe('EQA r6, failure ordering', () => {
  test('B6 store throws and forward throws: 503, 0 acks', async () => {
    const submitter = uniqueEmail('b6'); const rec = installMocks({ submitter, storeOk: false, throwForward: true });
    const { r } = await capture(() => sc.sendSupportConfirmation({ email: submitter, message: 'b6' }));
    expect(r.status).toBe(503);
    expect(rec.order.filter((x) => x === 'ack')).toHaveLength(0);
  });
  for (const [label, opts] of [['all_ok', {}], ['forward_fails', { failForward: true }], ['forward_throws', { throwForward: true }], ['store_fails', { storeOk: false }]]) {
    test(`B7 ${label}: the ack is sent only after store and forward have both been attempted`, async () => {
      const submitter = uniqueEmail('b7'); const rec = installMocks({ submitter, ...opts });
      await capture(() => sc.sendSupportConfirmation({ email: submitter, message: 'b7' }));
      const ackAt = rec.order.indexOf('ack');
      if (ackAt >= 0) {
        expect(rec.order.indexOf('store')).toBeGreaterThan(-1);
        expect(rec.order.indexOf('store')).toBeLessThan(ackAt);
        expect(rec.order.indexOf('forward')).toBeGreaterThan(-1);
        expect(rec.order.indexOf('forward')).toBeLessThan(ackAt);
      }
    });
  }
});

describe('EQA r6, submitter rules', () => {
  for (const email of ['hello@fitmunch.com.au', 'SUPPORT@FITMUNCH.COM.AU', 'Ops <help@fitmunch.com.au>', 'someone+x@fitmunch.com.au']) {
    test(`C5 own-domain submitter "${email}": 400, 0 rows, 0 sends`, async () => {
      const rec = installMocks({ submitter: email });
      const { r } = await capture(() => sc.sendSupportConfirmation({ email, message: 'c5' }));
      expect(r.status).toBe(400);
      expect(rec.queries.filter((q) => /^\s*INSERT/i.test(q.sql))).toHaveLength(0);
      expect(rec.sends).toHaveLength(0);
    });
  }
});

describe('EQA r6, Shoulds carried into round 6', () => {
  test('S1 restored masked-log assert (ccbaaff test_customer_critical_1117.js:266): a successful submission logs one [support line with j***@g***.com, and no line carries the raw email, name or message', async () => {
    const submitter = 'jordan@gmail.com'; installMocks({ submitter });
    const { logged } = await capture(() => sc.sendSupportConfirmation({ email: submitter, name: 'Jordan', message: 'Please look at my trial' }));
    const line = logged.find((l) => l.startsWith('[support'));
    expect(Boolean(line)).toBe(true);
    expect(String(line)).toContain('j***@g***.com');
    const blob = logged.join('\n');
    expect(blob).not.toContain(submitter);
    expect(blob).not.toContain('Jordan');
    expect(blob).not.toContain('Please look at my trial');
  });
  test.todo('S3 Should: a signed-in submission stores user_id (and topic); deletion and export find it after the account email changes. Builder states the signed-in call shape in the PR body and EQA converts this row.');
  test.todo('S2 Should (225 follow-up): 503 copy tells the customer the message was not sent and gives support@fitmunch.com.au');
});
