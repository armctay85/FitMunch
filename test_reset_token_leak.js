'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');

jest.mock('./server/storage', () => {
  const actual = jest.requireActual('./server/storage');
  return {
    ...actual,
    trackEvent: jest.fn(async () => {}),
    getFunnelStats: jest.fn(async () => ({ days: 14, totalEvents: 0, events: [], steps: [] })),
  };
});

const request = require('supertest');
const storage = require('./server/storage');
const app = require('./server');
const { JSDOM } = require('jsdom');
const {
  UTM_KEYS,
  sanitizeAnalyticsPayload,
  redactLogString,
  redactLogArg,
  setLogForwarderForTests,
} = require('./lib/url-redact');
const {
  RESET_TTL_MS,
  hashResetToken,
  tokenHashesEqual,
  consumePasswordReset,
  passwordResetUrl,
} = require('./lib/password-reset');
const {
  ANALYTICS_PURGE_SQL,
  RESET_MIGRATION_ID,
  PURGE_MIGRATION_ID,
  analyticsPayloadLeaks,
  purgeLeakedAnalytics,
  invalidateOutstandingPasswordResets,
  runSecurityBoot,
  scheduleSecurityBoot,
} = require('./lib/security-boot');

const FAKE_RESET = 'fake-reset-value';
const FAKE_TOKEN = 'fake-token';

function loadTracker(location, attribution, title) {
  const posts = [];
  const sandbox = {
    location,
    document: {
      title: title || 'FitMunch sign in',
      readyState: 'complete',
      addEventListener() {},
    },
    navigator: {
      sendBeacon(_url, blob) {
        posts.push(blob && blob._text ? blob._text : '');
        return true;
      },
    },
    sessionStorage: {
      getItem() { return 's_page'; },
      setItem() {},
    },
    localStorage: {
      getItem() { return attribution || '{}'; },
      setItem() {},
    },
    Blob: class Blob {
      constructor(parts) { this._text = parts.join(''); }
    },
    URLSearchParams,
    JSON,
    Object,
    Math,
    Date,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/js/fm-track.js'), 'utf8'), sandbox);
  return { posts, track: sandbox.FMTrack };
}

function captureConsole(fn) {
  // Jest --silent swaps in a console that never writes stdout, so hook the
  // redaction wrapper's forwarder instead of process.stdout.
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const previous = methods.map((method) => setLogForwarderForTests(method, (...args) => {
    lines.push(util.format(...args));
  }));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      methods.forEach((method, index) => setLogForwarderForTests(method, previous[index]));
    })
    .then((result) => ({ result, text: lines.join('\n') }));
}

describe('reset token leak', () => {
  it('tracker payload never contains ? or reset=', () => {
    const { posts, track } = loadTracker(
      {
        pathname: '/login.html',
        search: `?reset=${FAKE_RESET}&utm_source=qa&token=${FAKE_TOKEN}`,
        hash: '#reset',
      },
      JSON.stringify({
        landing: `/login.html?reset=${FAKE_RESET}`,
        utm_campaign: 'spring',
        reset: 'nope',
      })
    );
    track.trackCta({
      getAttribute(name) {
        if (name === 'href') return `/login.html?plan=premium&reset=${FAKE_RESET}#register`;
        if (name === 'data-fm-plan') return 'premium';
        if (name === 'data-fm-track') return 'hero_trial';
        return '';
      },
      textContent: 'Start trial',
    });
    expect(posts.length).toBeGreaterThan(0);
    for (const body of posts) {
      expect(body).not.toContain('?');
      expect(body).not.toContain('reset=');
      expect(body).not.toContain(FAKE_RESET);
      expect(body).not.toContain(FAKE_TOKEN);
    }
    const pageView = JSON.parse(posts[0]);
    expect(pageView.events[0].eventData.path).toBe('/login.html');
    expect(pageView.events[0].eventData.utm_source).toBe('qa');
    expect(pageView.events[0].eventData.utm_campaign).toBe('spring');
    const src = fs.readFileSync(path.join(__dirname, 'public/js/fm-track.js'), 'utf8');
    expect(src).not.toContain('location.search.slice');
    expect(src).not.toContain('location.href');
    const enhanced = fs.readFileSync(path.join(__dirname, 'public/enhanced_analytics.js'), 'utf8');
    expect(enhanced).not.toContain('window.location.href');
    expect(enhanced).toContain('window.location.pathname');
  });

  it('server strips reset and token params before insert and before logging', async () => {
    storage.trackEvent.mockClear();
    const dirty = {
      path: `/login.html?reset=${FAKE_RESET}&utm_source=qa`,
      href: `/login.html?token=${FAKE_TOKEN}`,
      url: `https://www.fitmunch.com.au/login.html?reset=${FAKE_RESET}`,
      referrer: `https://evil.example/login.html?token=${FAKE_TOKEN}`,
      properties: { path: `/x?reset=${FAKE_RESET}` },
    };
    const logged = await captureConsole(async () => {
      console.log(`req.url /login.html?reset=${FAKE_RESET}&token=${FAKE_TOKEN}&utm_source=qa`);
      console.log({ method: 'GET', url: `/login.html?reset=${FAKE_RESET}`, originalUrl: `/login.html?token=${FAKE_TOKEN}` });
      return request(app)
        .post('/api/analytics/events')
        .send({
          events: [{ eventType: 'page_view', sessionId: 's_page', eventData: dirty }],
        });
    });
    expect(logged.result.status).toBe(200);
    expect(storage.trackEvent).toHaveBeenCalled();
    for (const call of storage.trackEvent.mock.calls) {
      const payload = JSON.stringify(call[2]);
      expect(payload).not.toContain('?');
      expect(payload).not.toContain('reset=');
      expect(payload).not.toContain('token=');
      expect(payload).not.toContain(FAKE_RESET);
      expect(payload).not.toContain(FAKE_TOKEN);
    }
    expect(storage.trackEvent.mock.calls[0][2].path).toBe('/login.html');
    expect(storage.trackEvent.mock.calls[0][2].utm_source).toBe('qa');
    expect(sanitizeAnalyticsPayload(dirty).referrer).toBe('https://evil.example/login.html');
    expect(logged.text).not.toContain(FAKE_RESET);
    expect(logged.text).not.toContain(FAKE_TOKEN);
    expect(logged.text).toContain('reset=[redacted]');
    expect(logged.text).toContain('token=[redacted]');
    expect(redactLogString(`email=person@example.com&sig=abc&jwt=header.payload`)).not.toContain('person@example.com');
  });

  it('a reset token cannot be used twice and an expired token is rejected', async () => {
    expect(RESET_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
    const rows = [];
    const db = {
      async query(sql, params) {
        if (sql.includes('SELECT id, user_id, token_hash')) {
          const match = rows.filter((row) => row.token_hash === params[0]);
          return { rows: match.slice(0, 1) };
        }
        if (sql.includes('SET used = TRUE') && sql.includes('expires_at > $2')) {
          const now = params[1];
          const row = rows.find((item) => item.id === params[0] && item.used === false && new Date(item.expires_at) > now);
          if (!row) return { rows: [] };
          row.used = true;
          return { rows: [{ id: row.id, user_id: row.user_id }] };
        }
        throw new Error('unexpected sql');
      },
    };
    const secret = FAKE_RESET;
    rows.push({
      id: 1,
      user_id: 'user-1',
      token_hash: hashResetToken(secret),
      used: false,
      expires_at: new Date(Date.now() + 60 * 1000),
    });
    const first = await consumePasswordReset(db, secret);
    expect(first).toMatchObject({ ok: true, userId: 'user-1' });
    const second = await consumePasswordReset(db, secret);
    expect(second.ok).toBe(false);
    expect(rows[0].used).toBe(true);

    rows.push({
      id: 2,
      user_id: 'user-2',
      token_hash: hashResetToken('fake-expired'),
      used: false,
      expires_at: new Date(Date.now() - 1000),
    });
    const expired = await consumePasswordReset(db, 'fake-expired');
    expect(expired.ok).toBe(false);
    expect(rows[1].used).toBe(false);

    const mismatched = await consumePasswordReset({
      async query(sql) {
        if (sql.includes('SELECT')) {
          return {
            rows: [{
              id: 9,
              user_id: 'user-9',
              token_hash: 'a'.repeat(64),
              used: false,
              expires_at: new Date(Date.now() + 60 * 1000),
            }],
          };
        }
        throw new Error('must not claim a hash that fails constant-time compare');
      },
    }, FAKE_RESET);
    expect(mismatched.ok).toBe(false);
    expect(tokenHashesEqual(hashResetToken(FAKE_RESET), hashResetToken(FAKE_RESET))).toBe(true);
    expect(tokenHashesEqual(hashResetToken(FAKE_RESET), hashResetToken(FAKE_TOKEN))).toBe(false);
    expect(tokenHashesEqual('abc', 'abcd')).toBe(false);
  });

  it('purge on seeded rows removes case and encoded leaks and keeps share links and prose', async () => {
    expect(ANALYTICS_PURGE_SQL).toContain('analytics_events');
    expect(ANALYTICS_PURGE_SQL).toMatch(/ILIKE\s+'%reset=%'/i);
    expect(ANALYTICS_PURGE_SQL).toMatch(/ILIKE\s+'%token=%'/i);
    expect(ANALYTICS_PURGE_SQL).toContain('%3d');
    expect(ANALYTICS_PURGE_SQL).toContain('%73');
    expect(ANALYTICS_PURGE_SQL).toContain('LIMIT 5000');

    const analytics = [
      { id: 1, event_data: { path: `/login.html?reset=${FAKE_RESET}` } },
      { id: 2, event_data: { path: '/pricing', title: 'What is FitMunch?', label: 'Top #1' } },
      { id: 3, event_data: { href: `/login.html?RESET=${FAKE_RESET}` } },
      { id: 4, event_data: { path: `/login.html%3Freset%3D${FAKE_RESET}` } },
      { id: 5, event_data: { path: `/login.html?re%73et=${FAKE_RESET}` } },
      { id: 6, event_data: { properties: { referrer: `https://x.test/?token=${FAKE_TOKEN}` } } },
      { id: 7, event_data: { path: '/c/sharetokenvalue' } },
    ];
    const migrations = new Map();
    const db = {
      async query(sql, params) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO schema_migrations')) {
          if (migrations.has(params[0])) return { rows: [], rowCount: 0 };
          migrations.set(params[0], new Date());
          return { rows: [{ id: params[0], applied_at: migrations.get(params[0]) }], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM analytics_events')) {
          const armed = /ILIKE\s+'%reset=%'/i.test(sql) && /ILIKE\s+'%token=%'/i.test(sql);
          if (!armed) return { rowCount: 0, rows: [] };
          const doomed = analytics.filter((row) => analyticsPayloadLeaks(row.event_data));
          const kept = analytics.filter((row) => !analyticsPayloadLeaks(row.event_data));
          analytics.length = 0;
          analytics.push(...kept);
          return { rowCount: doomed.length, rows: [] };
        }
        throw new Error('unexpected sql ' + sql);
      },
    };
    const { text, result } = await captureConsole(() => purgeLeakedAnalytics((sql, params) => db.query(sql, params)));
    expect(result).toBe(5);
    expect(analytics.map((row) => row.id)).toEqual([2, 7]);
    expect(JSON.stringify(analytics)).toContain('What is FitMunch?');
    expect(JSON.stringify(analytics)).toContain('Top #1');
    expect(JSON.stringify(analytics)).toContain('/c/sharetokenvalue');
    expect(text).toContain('[db-migrate] purged analytics rows 5');
    expect(text).not.toContain(FAKE_RESET);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(migrations.has(PURGE_MIGRATION_ID)).toBe(true);
  });

  it('boot invalidates outstanding reset tokens once and keeps tokens issued after the marker', async () => {
    const migrations = new Map();
    const resets = [
      {
        id: 1,
        used: false,
        token_hash: 'old-hash',
        created_at: new Date('2020-01-01T00:00:00.000Z'),
        expires_at: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        id: 2,
        used: false,
        token_hash: 'later-hash',
        created_at: new Date(Date.now() + 60 * 60 * 1000),
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    ];
    const db = {
      async query(sql, params) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
        if (sql.includes('INSERT INTO schema_migrations')) {
          expect(params[0]).toBe(RESET_MIGRATION_ID);
          if (migrations.has(params[0])) return { rows: [], rowCount: 0 };
          const appliedAt = new Date();
          migrations.set(params[0], appliedAt);
          return { rows: [{ id: params[0], applied_at: appliedAt }], rowCount: 1 };
        }
        if (sql.includes('UPDATE password_resets') && sql.includes('created_at <=')) {
          const cutoff = new Date(params[0]);
          const cleared = [];
          for (const row of resets) {
            if (!row.used && row.created_at <= cutoff) {
              row.used = true;
              row.token_hash = 'revoked';
              row.expires_at = row.created_at;
              cleared.push({ id: row.id });
            }
          }
          return { rows: cleared, rowCount: cleared.length };
        }
        throw new Error('unexpected sql ' + sql);
      },
    };

    const first = await captureConsole(() => invalidateOutstandingPasswordResets((sql, params) => db.query(sql, params)));
    expect(first.result).toBe(1);
    expect(resets[0]).toMatchObject({ used: true, token_hash: 'revoked' });
    expect(resets[0].expires_at).toEqual(resets[0].created_at);
    expect(resets[1]).toMatchObject({ used: false, token_hash: 'later-hash' });
    expect(first.text).toContain('[db-migrate] invalidated password reset tokens 1');
    expect(first.text).not.toContain('old-hash');
    expect(first.text).not.toContain('later-hash');

    const appliedAt = migrations.get(RESET_MIGRATION_ID);
    resets.push({
      id: 3,
      used: false,
      token_hash: 'after-hash',
      created_at: new Date(appliedAt.getTime() + 5000),
      expires_at: new Date(appliedAt.getTime() + 60 * 60 * 1000),
    });
    const second = await captureConsole(() => invalidateOutstandingPasswordResets((sql, params) => db.query(sql, params)));
    expect(second.result).toBe(0);
    expect(second.text).toContain('[db-migrate] invalidated password reset tokens 0');
    expect(resets[2]).toMatchObject({ used: false, token_hash: 'after-hash' });
    expect(second.text).not.toContain('after-hash');
  });

  it('login.html drops the reset token from the address bar and sends no referrer', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain('history.replaceState');
    expect(html).toContain("search.delete(key)");
    const res = await request(app).get('/login.html');
    expect(res.status).toBe(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const loginHeaders = vercel.headers.find((rule) => rule.source === '/login.html');
    expect(loginHeaders.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'Referrer-Policy', value: 'no-referrer' }),
    ]));
  });

  it('replaceState strips a legacy query token and a fragment token', () => {
    const legacy = bootLogin(`https://www.fitmunch.com.au/login.html?reset=${FAKE_RESET}&utm_source=qa#register`);
    expect(legacy.calls.length).toBeGreaterThan(0);
    expect(legacy.dom.window.location.href).not.toContain(FAKE_RESET);
    expect(legacy.dom.window.location.href).not.toContain('reset=');
    expect(legacy.dom.window.location.search).toBe('?utm_source=qa');
    expect(legacy.dom.window.location.hash).toBe('#register');
    expect(legacy.dom.window.document.getElementById('panel-reset').classList.contains('active')).toBe(true);

    const fragment = bootLogin(`https://www.fitmunch.com.au/login.html#reset=${FAKE_RESET}`);
    expect(fragment.calls.length).toBeGreaterThan(0);
    expect(fragment.calls[0][2]).not.toContain(FAKE_RESET);
    expect(fragment.dom.window.location.href).toBe('https://www.fitmunch.com.au/login.html');
    expect(fragment.dom.window.location.hash).toBe('');
    expect(fragment.dom.window.document.getElementById('panel-reset').classList.contains('active')).toBe(true);
  });

  it('password reset emails use the fragment form', () => {
    expect(passwordResetUrl(FAKE_RESET)).toBe(`https://www.fitmunch.com.au/login.html#reset=${FAKE_RESET}`);
    expect(passwordResetUrl(FAKE_RESET)).not.toContain('?reset=');
    const src = fs.readFileSync(path.join(__dirname, 'api_server.js'), 'utf8');
    expect(src).toContain('passwordResetUrl(token)');
    expect(src).not.toContain('login.html?reset=');
  });
});

function bootLogin(url) {
  const html = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      const original = window.history.replaceState.bind(window.history);
      window.history.replaceState = function replaceStateSpy(...args) {
        calls.push(args);
        return original(...args);
      };
    },
  });
  return { dom, calls };
}

describe('reset token follow-up', () => {
  it('a concurrent claim has one winner', async () => {
    const secret = 'concurrent-reset-token';
    const row = {
      id: 7,
      user_id: 'user-7',
      token_hash: hashResetToken(secret),
      used: false,
      expires_at: new Date(Date.now() + 60 * 1000),
    };
    let reads = 0;
    let releaseFirst;
    const firstWaiting = new Promise((resolve) => { releaseFirst = resolve; });
    const updateSql = [];
    const db = {
      async query(sql) {
        if (sql.includes('SELECT id, user_id, token_hash')) {
          reads += 1;
          if (reads === 1) await firstWaiting;
          return {
            rows: [{
              id: row.id,
              user_id: row.user_id,
              token_hash: row.token_hash,
              used: false,
              expires_at: row.expires_at,
            }],
          };
        }
        if (sql.includes('SET used = TRUE')) {
          updateSql.push(sql);
          const conditional = /used\s*=\s*FALSE/i.test(sql) && /expires_at\s*>\s*\$2/i.test(sql);
          if (!conditional) {
            row.used = true;
            return { rows: [{ id: row.id, user_id: row.user_id }] };
          }
          if (row.used === true) return { rows: [] };
          row.used = true;
          return { rows: [{ id: row.id, user_id: row.user_id }] };
        }
        throw new Error('unexpected sql ' + sql);
      },
    };
    const claimA = consumePasswordReset(db, secret);
    const claimB = consumePasswordReset(db, secret);
    releaseFirst();
    const [a, b] = await Promise.all([claimA, claimB]);
    const winners = [a, b].filter((item) => item.ok);
    expect(winners).toHaveLength(1);
    expect(winners[0].userId).toBe('user-7');
    expect(updateSql).toHaveLength(2);
    expect(updateSql.every((sql) => /used\s*=\s*FALSE/i.test(sql))).toBe(true);
  });

  it('the invalidation marker persists across two boots and a later token still consumes', async () => {
    const migrations = new Map();
    const resets = [
      {
        id: 1,
        user_id: 'user-old',
        used: false,
        token_hash: hashResetToken('old-secret'),
        created_at: new Date('2020-01-01T00:00:00.000Z'),
        expires_at: new Date('2099-01-01T00:00:00.000Z'),
      },
    ];
    const analytics = [{ id: 1, event_data: { path: `/login.html?reset=${FAKE_RESET}` } }];
    const sqlLog = [];
    const db = {
      async query(sql, params) {
        sqlLog.push(sql);
        if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO schema_migrations')) {
          expect([RESET_MIGRATION_ID, PURGE_MIGRATION_ID]).toContain(params[0]);
          if (migrations.has(params[0])) return { rows: [], rowCount: 0 };
          const appliedAt = new Date();
          migrations.set(params[0], appliedAt);
          return { rows: [{ id: params[0], applied_at: appliedAt }], rowCount: 1 };
        }
        if (sql.includes('UPDATE password_resets') && sql.includes('created_at <=')) {
          const cutoff = new Date(params[0]);
          const cleared = [];
          for (const item of resets) {
            if (!item.used && item.created_at <= cutoff) {
              item.used = true;
              item.token_hash = 'revoked';
              item.expires_at = item.created_at;
              cleared.push({ id: item.id });
            }
          }
          return { rows: cleared, rowCount: cleared.length };
        }
        if (sql.includes('DELETE FROM analytics_events')) {
          const doomed = analytics.filter((item) => analyticsPayloadLeaks(item.event_data));
          analytics.length = 0;
          analytics.push(...analytics.filter((item) => !analyticsPayloadLeaks(item.event_data)));
          return { rowCount: doomed.length, rows: [] };
        }
        if (sql.includes('SELECT id, user_id, token_hash')) {
          const match = resets.filter((item) => item.token_hash === params[0]);
          return { rows: match.slice(0, 1) };
        }
        if (sql.includes('SET used = TRUE') && sql.includes('expires_at >')) {
          const now = new Date(params[1]);
          const item = resets.find((row) => row.id === params[0] && row.used === false && new Date(row.expires_at) > now);
          if (!item) return { rows: [], rowCount: 0 };
          item.used = true;
          return { rows: [{ id: item.id, user_id: item.user_id }], rowCount: 1 };
        }
        throw new Error('unexpected sql ' + sql);
      },
    };
    const query = (sql, params) => db.query(sql, params);
    const first = await runSecurityBoot(query);
    expect(first.invalidated).toBe(1);
    expect(first.purged).toBe(1);
    expect(resets[0].token_hash).toBe('revoked');
    const invalidateAt = sqlLog.findIndex((sql) => sql.includes('UPDATE password_resets'));
    const purgeAt = sqlLog.findIndex((sql) => sql.includes('DELETE FROM analytics_events'));
    expect(invalidateAt).toBeGreaterThanOrEqual(0);
    expect(purgeAt).toBeGreaterThan(invalidateAt);

    const appliedAt = migrations.get(RESET_MIGRATION_ID);
    resets.push({
      id: 2,
      user_id: 'user-new',
      used: false,
      token_hash: hashResetToken('after-secret'),
      created_at: new Date(appliedAt.getTime() + 5),
      expires_at: new Date(appliedAt.getTime() + 60 * 60 * 1000),
    });
    const deletesBefore = sqlLog.filter((sql) => sql.includes('DELETE FROM analytics_events')).length;
    const updatesBefore = sqlLog.filter((sql) => sql.includes('UPDATE password_resets')).length;
    const second = await runSecurityBoot(query);
    expect(second.invalidated).toBe(0);
    expect(second.purged).toBe(0);
    expect(sqlLog.filter((sql) => sql.includes('DELETE FROM analytics_events')).length).toBe(deletesBefore);
    expect(sqlLog.filter((sql) => sql.includes('UPDATE password_resets')).length).toBe(updatesBefore);
    expect(resets[1]).toMatchObject({ used: false, token_hash: hashResetToken('after-secret') });
    const consumed = await consumePasswordReset(db, 'after-secret', new Date(appliedAt.getTime() + 10000));
    expect(consumed).toMatchObject({ ok: true, userId: 'user-new' });
    const replay = await consumePasswordReset(db, 'after-secret', new Date(appliedAt.getTime() + 10000));
    expect(replay.ok).toBe(false);
  });

  it('a detached purge does not block the boot login waits on', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let purgeStarted = false;
    const migrations = new Map();
    const query = async (sql, params) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO schema_migrations')) {
        if (migrations.has(params[0])) return { rows: [], rowCount: 0 };
        const appliedAt = new Date();
        migrations.set(params[0], appliedAt);
        return { rows: [{ id: params[0], applied_at: appliedAt }], rowCount: 1 };
      }
      if (sql.includes('UPDATE password_resets')) return { rows: [], rowCount: 0 };
      if (sql.includes('DELETE FROM analytics_events')) {
        purgeStarted = true;
        await gate;
        return { rowCount: 0, rows: [] };
      }
      throw new Error('unexpected sql ' + sql);
    };
    const pending = scheduleSecurityBoot(query);
    const raced = await Promise.race([
      pending.then(async (result) => {
        await new Promise((resolve) => setImmediate(resolve));
        return { done: true, result };
      }),
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), 300)),
    ]);
    expect(raced.done).toBe(true);
    expect(purgeStarted).toBe(true);
    expect(raced.result.invalidated).toBe(0);
    release();
    await raced.result.purge;
    const migrateSrc = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');
    expect(migrateSrc).toContain('scheduleSecurityBoot');
    expect(migrateSrc).not.toContain('await runSecurityBoot');
    expect(migrateSrc).not.toContain('purgeLeakedAnalytics');
  });

  it('each boot step has its own try/catch so one failure cannot block the other', async () => {
    const seen = [];
    const query = async (sql, params) => {
      seen.push(sql + ' ' + JSON.stringify(params || []));
      if (sql.includes('UPDATE password_resets')) throw new Error('invalidation down');
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO schema_migrations')) {
        if (params[0] === RESET_MIGRATION_ID) throw new Error('reset marker down');
        return { rows: [{ id: params[0], applied_at: new Date() }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM analytics_events')) throw new Error('purge down');
      if (sql.includes('DELETE FROM schema_migrations')) return { rows: [], rowCount: 0 };
      throw new Error('unexpected sql ' + sql);
    };
    const result = await runSecurityBoot(query);
    expect(result.invalidated).toBe(0);
    expect(result.purged).toBe(0);
    const invalidateAt = seen.findIndex((sql) => sql.includes('UPDATE password_resets') || sql.includes(RESET_MIGRATION_ID));
    const purgeAt = seen.findIndex((sql) => sql.includes('DELETE FROM analytics_events'));
    expect(invalidateAt).toBeGreaterThanOrEqual(0);
    expect(purgeAt).toBeGreaterThan(invalidateAt);
  });

  it('redacts t, otp, access_token, id_token, encoded names, and object args', () => {
    const secret = 'SUPERSECRETVALUE';
    for (const line of [
      `GET /login.html?t=${secret}`,
      `GET /login.html?otp=${secret}`,
      `GET /login.html?access_token=${secret}`,
      `GET /login.html#id_token=${secret}`,
      `GET /login.html?re%73et=${secret}`,
      `%3Freset%3D${secret}`,
    ]) {
      const redacted = redactLogString(line);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain('[redacted]');
    }
    const obj = redactLogArg({
      href: `https://www.fitmunch.com.au/login.html?reset=${secret}`,
      otp: secret,
      access_token: secret,
      nested: { id_token: secret },
    });
    const dumped = JSON.stringify(obj);
    expect(dumped).not.toContain(secret);
    expect(dumped).toContain('[redacted]');
  });

  it('preserves ordinary question marks and hashes and leaves share links alone', () => {
    expect(sanitizeAnalyticsPayload({
      title: 'What is FitMunch?',
      label: 'Top #1',
    })).toEqual({
      title: 'What is FitMunch?',
      label: 'Top #1',
    });
    expect(sanitizeAnalyticsPayload('What is FitMunch?')).toBe('What is FitMunch?');
    expect(sanitizeAnalyticsPayload({
      path: '/c/sharetokenvalue',
      href: 'https://www.fitmunch.com.au/c/sharetokenvalue',
    })).toEqual({
      path: '/c/sharetokenvalue',
      href: 'https://www.fitmunch.com.au/c/sharetokenvalue',
    });
    const utm = sanitizeAnalyticsPayload({
      path: '/pricing?utm_source=' + 'x'.repeat(100) + '&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=meal&utm_id=nope&gclid=nope',
    });
    expect(UTM_KEYS).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
    expect(utm.path).toBe('/pricing');
    expect(utm.utm_source).toHaveLength(80);
    expect(utm.utm_medium).toBe('email');
    expect(utm.utm_campaign).toBe('spring');
    expect(utm.utm_content).toBe('hero');
    expect(utm.utm_term).toBe('meal');
    expect(utm.utm_id).toBeUndefined();
    expect(utm.gclid).toBeUndefined();
    expect(sanitizeAnalyticsPayload({
      path: `/login.html?reset=${FAKE_RESET}&utm_source=qa`,
    })).toMatchObject({ path: '/login.html', utm_source: 'qa' });
  });

  it('landers do not save location.search on attr.landing', () => {
    const dir = path.join(__dirname, 'public');
    const offenders = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.html')) continue;
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const re = /attr\.landing\s*=\s*([^;]+);/g;
      let match;
      while ((match = re.exec(text))) {
        const expr = match[1].trim();
        if (/location\.search|location\.href|location\.hash/.test(expr) || expr !== 'location.pathname') {
          offenders.push(`${name}: ${expr}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    for (const name of [
      'index.html',
      'login.html',
      'pricing.html',
      'for-pts.html',
      'receipt-nutrition-scanner.html',
      'budget-meal-planner.html',
      'haul-teardown.html',
      'ai-meal-planner-australia.html',
    ]) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      expect(text).toContain('attr.landing = location.pathname');
    }
  });

  it('tracker titles keep question marks and still drop reset tokens', () => {
    const { posts } = loadTracker(
      { pathname: '/pricing', search: '', hash: '' },
      '{}',
      'What is FitMunch?'
    );
    const pageView = JSON.parse(posts[0]);
    expect(pageView.events[0].eventData.title).toBe('What is FitMunch?');
    expect(pageView.events[0].eventData.path).toBe('/pricing');
  });
});
