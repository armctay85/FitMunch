/**
 * HTTP-level checks for server.js (health, JSON 404 for unknown /api routes).
 */
const request = require('supertest');
const app = require('./server.js');

describe('Server API shell', () => {
  it('GET /api/health returns ok JSON', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('fitmunch');
  });

  it('GET unknown /api path returns JSON 404', async () => {
    const res = await request(app)
      .get('/api/__smoke_no_such_route__')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });
});
