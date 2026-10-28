'use strict';
// POST /api/workouts/log uses the same isRealIsoDate check as meals (EQA low).

jest.mock('pg', () => ({ Pool: class { query() { return Promise.resolve({ rows: [] }); } end() { return Promise.resolve(); } } }));

jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async () => ({
      id: 'u-test', name: 'Tester', email: 't@example.com', subscriptionTier: 'free', settings: {},
    })),
    logWorkout: jest.fn(async (userId, data) => ({ id: 1, userId, ...data })),
    logMeal: jest.fn(),
    logProgress: jest.fn(),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const token = jwt.sign({ userId: 'u-test', name: 'Tester' }, JWT_SECRET);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('./api_server'));
  return app;
}

describe('POST /api/workouts/log rejects impossible dates', () => {
  const storage = require('./server/storage.js');
  const app = makeApp();

  beforeEach(() => storage.logWorkout.mockClear());

  it.each([
    '2026-02-30',
    '0000-01-01',
    'not-a-date',
    '2026-02-30T00:00:00Z',
    '0000-01-01T00:00:00Z',
  ])('%s returns 400 and is not saved', async (date) => {
    const res = await request(app)
      .post('/api/workouts/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ workoutType: 'Run', date });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Date is not valid.' });
    expect(storage.logWorkout).not.toHaveBeenCalled();
  });

  it('a real ISO date is saved', async () => {
    const date = '2026-10-15T08:30:00.000Z';
    const res = await request(app)
      .post('/api/workouts/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ workoutType: 'Run', duration: 30, date });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storage.logWorkout).toHaveBeenCalledWith('u-test', expect.objectContaining({
      workoutType: 'Run',
      date: new Date(date),
    }));
  });
});
