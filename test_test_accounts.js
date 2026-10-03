'use strict';

const fs = require('fs');
const path = require('path');
const { isTestAccountEmail, ELITE_QA_EMAIL } = require('./lib/test-accounts');

describe('test accounts', () => {
  test('marks Elite QA and the QA mailbox patterns', () => {
    expect(isTestAccountEmail(ELITE_QA_EMAIL)).toBe(true);
    expect(isTestAccountEmail('QA-ELITE-20261003-66049@fitmunch.com.au')).toBe(true);
    expect(isTestAccountEmail('qa-elite-later@fitmunch.com.au')).toBe(true);
    expect(isTestAccountEmail('consumerqa+1@fitmunch.com.au')).toBe(true);
    expect(isTestAccountEmail('coachqa+trial@fitmunch.com.au')).toBe(true);
    expect(isTestAccountEmail('dup-test+a@fitmunch.com.au')).toBe(true);
    expect(isTestAccountEmail('drew@fitmunch.com.au')).toBe(false);
    expect(isTestAccountEmail('consumer@fitmunch.com.au')).toBe(false);
    expect(isTestAccountEmail('')).toBe(false);
  });

  test('migration adds users.is_test and backfills the QA addresses', () => {
    const sql = fs.readFileSync(path.join(__dirname, 'lib', 'db-migrate.js'), 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain(ELITE_QA_EMAIL);
    expect(sql).toContain("LIKE 'consumerqa+%'");
    expect(sql).toContain("LIKE 'coachqa+%'");
    expect(sql).toContain("LIKE 'dup-test+%'");
  });

  test('funnel query drops rows owned by test users and createUser sets the flag', () => {
    const storage = fs.readFileSync(path.join(__dirname, 'server', 'storage.js'), 'utf8');
    expect(storage).toContain('isTestAccountEmail');
    expect(storage).toContain('isTest: extras.isTest === true || isTestAccountEmail(email)');
    expect(storage).toContain('leftJoin(schema.users');
    expect(storage).toContain('eq(schema.users.isTest, false)');
    expect(storage).toContain('isNull(schema.analyticsEvents.userId)');
  });
});
