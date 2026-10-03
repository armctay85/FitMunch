'use strict';

const fs = require('fs');
const path = require('path');
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
const {
  sanitizeAnalyticsPayload,
  redactLogString,
} = require('./lib/url-redact');
const {
  RESET_TTL_MS,
  hashResetToken,
  tokenHashesEqual,
  consumePasswordReset,
} = require('./lib/password-reset');
const {
  ANALYTICS_PURGE_SQL,
  RESET_MIGRATION_ID,
  analyticsPayloadLeaks,
  purgeLeakedAnalytics,
  invalidateOutstandingPasswordResets,
} = require('./lib/security-boot');

const FAKE_RESET = 'fake-reset-value';
const FAKE_TOKEN = 'fake-token';

function loadTracker(location, attribution) {
  const posts = [];
  const sandbox = {
    location,
    document: {
      title: 'FitMunch sign in',
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
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stdout.write = write;
    })
    .then((result) => ({ result, text: lines.join('') }));
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

  it('purge statement matches reset= rows', async () => {
    expect(ANALYTICS_PURGE_SQL).toContain("LIKE '%reset=%'");
    expect(ANALYTICS_PURGE_SQL).toContain('analytics_events');
    expect(ANALYTICS_PURGE_SQL).toContain('referrer');
    expect(ANALYTICS_PURGE_SQL).toContain('properties');
    const leaked = { path: `/login.html?reset=${FAKE_RESET}` };
    const nested = { properties: { referrer: `https://x.test/?token=${FAKE_TOKEN}` } };
    const clean = { path: '/pricing', utm_source: 'qa' };
    expect(analyticsPayloadLeaks(leaked)).toBe(true);
    expect(analyticsPayloadLeaks(nested)).toBe(true);
    expect(analyticsPayloadLeaks(clean)).toBe(false);

    const analytics = [
      { id: 1, event_data: leaked },
      { id: 2, event_data: clean },
      { id: 3, event_data: nested },
    ];
    const db = {
      async query(sql) {
        expect(sql).toContain("LIKE '%reset=%'");
        expect(sql).toContain("LIKE '%token=%'");
        const doomed = analytics.filter((row) => analyticsPayloadLeaks(row.event_data));
        const kept = analytics.filter((row) => !analyticsPayloadLeaks(row.event_data));
        analytics.length = 0;
        analytics.push(...kept);
        return { rowCount: doomed.length, rows: [] };
      },
    };
    const { text, result } = await captureConsole(() => purgeLeakedAnalytics((sql) => db.query(sql)));
    expect(result).toBe(2);
    expect(analytics.map((row) => row.id)).toEqual([2]);
    expect(text).toContain('[db-migrate] purged analytics rows 2');
    expect(text).not.toContain(FAKE_RESET);
    expect(text).not.toContain(FAKE_TOKEN);
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
    expect(html).toContain("cleaned.delete('reset')");
    expect(html).toContain('history.replaceState');
    const res = await request(app).get('/login.html');
    expect(res.status).toBe(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
