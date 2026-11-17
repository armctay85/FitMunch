'use strict';
/**
 * users.role default is user. Existing rows are not updated.
 * Needs TEST_DATABASE_URL. Skipped locally without it. Fails in CI if it is missing.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_allergen_hotfix_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;

const { Pool } = require('pg');

maybe('role default user, no backfill', () => {
  let pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, ssl: false });
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS role_default_hotfix');
    await pool.end();
  });

  test('ALTER DEFAULT does not change an existing row, and a new row is user', async () => {
    await pool.query('DROP TABLE IF EXISTS role_default_hotfix');
    await pool.query(`CREATE TABLE role_default_hotfix (
      id serial primary key,
      email text NOT NULL,
      role text DEFAULT 'pt'
    )`);
    await pool.query(`INSERT INTO role_default_hotfix (email) VALUES ('old@example.test')`);
    await pool.query(`ALTER TABLE role_default_hotfix ALTER COLUMN role SET DEFAULT 'user'`);
    await pool.query(`INSERT INTO role_default_hotfix (email) VALUES ('new@example.test')`);
    const rows = await pool.query(`SELECT email, role FROM role_default_hotfix ORDER BY id`);
    expect(rows.rows).toEqual([
      { email: 'old@example.test', role: 'pt' },
      { email: 'new@example.test', role: 'user' },
    ]);
    const def = await pool.query(`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'role_default_hotfix' AND column_name = 'role'
    `);
    expect(def.rows[0].column_default).toBe(`'user'::text`);
  });
});
