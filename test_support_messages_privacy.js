'use strict';

/**
 * Help-form rows follow the account on delete and export.
 * A row with no user id is still that person's when the email matches,
 * in any case. Another person's row stays.
 * No network and no database. The pool is a fake store.
 */

const savedDatabaseUrl = process.env.DATABASE_URL;
const savedStripe = process.env.STRIPE_SECRET_KEY;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'fitmunch-dev-secret';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_EMAIL = 'Jordan.Case@example.com';

jest.mock('pg', () => {
  const rows = [];
  function applySql(sql, params) {
    const text = String(sql);
    const args = params || [];
    if (/DELETE FROM support_messages WHERE lower\(email\)=lower\(\$1\) OR user_id=\$2/i.test(text)) {
      const email = String(args[0] || '').toLowerCase();
      const userId = args[1] == null ? '' : String(args[1]);
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        const emailHit = String(row.email || '').toLowerCase() === email;
        const idHit = row.user_id != null && String(row.user_id) === userId;
        if (emailHit || idHit) {
          rows.splice(i, 1);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }
    if (/FROM support_messages WHERE user_id IS DISTINCT FROM \$1 AND lower\(email\)=lower\(\$2\)/i.test(text)) {
      const userId = args[0] == null ? '' : String(args[0]);
      const email = String(args[1] || '').toLowerCase();
      const found = rows.filter((row) => String(row.user_id == null ? '' : row.user_id) !== userId
        && String(row.email || '').toLowerCase() === email);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }
    if (/FROM support_messages WHERE user_id=\$1/i.test(text)) {
      const userId = String(args[0]);
      const found = rows.filter((row) => row.user_id != null && String(row.user_id) === userId);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }
    if (/DELETE FROM users/i.test(text)) return { rows: [], rowCount: 1 };
    if (/SELECT role, pt_id FROM users/i.test(text)) return { rows: [{ role: 'client', pt_id: null }] };
    return { rows: [], rowCount: 0 };
  }
  class Pool {
    query(sql, params) { return Promise.resolve(applySql(sql, params)); }
    end() { return Promise.resolve(); }
  }
  return { Pool, __supportRows: rows };
});

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => {
      if (String(id) !== '11111111-1111-4111-8111-111111111111') return null;
      return {
        id,
        name: 'Jordan',
        email: 'Jordan.Case@example.com',
        subscriptionTier: 'free',
        settings: {},
        emailVerified: true,
      };
    }),
    getProfile: jest.fn(async () => ({})),
    effectiveTier: () => 'free',
    consumerBillingFromUser: () => ({}),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { __supportRows } = require('pg');

const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));

function token() {
  return jwt.sign({ userId: USER, role: 'client' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

afterAll(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
  if (savedStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedStripe;
});

describe('support message privacy', () => {
  beforeEach(() => { __supportRows.splice(0, __supportRows.length); });

  test('account deletion removes a null user id row matched by email in another case', async () => {
    __supportRows.push(
      { id: 'a', email: 'jordan.case@example.com', user_id: null, message: 'help form' },
      { id: 'b', email: 'other@example.com', user_id: USER, message: 'signed in' },
      { id: 'c', email: 'someone@example.com', user_id: OTHER, message: 'not mine' },
    );
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(__supportRows.map((row) => row.id)).toEqual(['c']);
  });

  test('account deletion removes the row stored against the account user id', async () => {
    __supportRows.push({ id: 'b', email: 'other@example.com', user_id: USER, message: 'signed in' });
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(__supportRows).toEqual([]);
  });

  test('account deletion leaves another person row', async () => {
    __supportRows.push({ id: 'c', email: 'someone@example.com', user_id: OTHER, message: 'not mine' });
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(__supportRows.map((row) => row.id)).toEqual(['c']);
  });

  test('data export returns the null user id row matched by email', async () => {
    __supportRows.push(
      { id: 'a', email: 'JORDAN.CASE@example.com', user_id: null, message: 'help form' },
      { id: 'c', email: 'someone@example.com', user_id: OTHER, message: 'not mine' },
    );
    const res = await request(app).get('/api/auth/export').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const ids = (body.support_messages || []).map((row) => row.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('c');
  });
});
