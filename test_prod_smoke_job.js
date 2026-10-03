const fs = require('fs');
const ops = require('./scripts/lib/vercel-deploy-ops');
const { runProdSmokeJob, chooseRollbackTarget, isAllowlistedDeploymentUrl, autoRollbackEnabled } = require('./scripts/prod-smoke-job');

const TOKEN = 'super-secret-token-value';

function json(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body), headers: { get: () => '' } };
}

function harness(overrides) {
  const logs = [];
  const statuses = [];
  const notices = [];
  let rolled = false;
  const calls = [];
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (method === 'POST' && url.includes('/rollback/')) {
      rolled = true;
      return json({});
    }
    if (url.includes('/api/health')) return json({ success: true });
    if (url.includes('www.fitmunch.com.au')) {
      const id = rolled ? 'dpl_old' : 'dpl_new';
      return json({ id, uid: id, created: rolled ? 100 : 300, target: 'production', state: 'READY', meta: { githubCommitSha: rolled ? '1111111aaa' : 'abcdef0fff' } });
    }
    if (url.includes('fit-munch-abc.vercel.app')) {
      return json({ id: 'dpl_new', uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fff' } });
    }
    if (url.includes('/v6/deployments')) {
      return json({
        deployments: [
          { uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fff' } },
          { uid: 'dpl_old', created: 200, target: 'production', state: 'READY', meta: { githubCommitSha: '1111111aaa' } },
          { uid: 'dpl_older', created: 100, target: 'production', state: 'READY', meta: { githubCommitSha: '2222222bbb' } },
          { uid: 'dpl_preview', created: 250, target: 'preview', state: 'READY' },
        ],
      });
    }
    if (url.includes('fit-munch-preview.vercel.app')) {
      return json({ id: 'dpl_preview_deploy', url: 'fit-munch-preview.vercel.app', created: 50, target: 'preview', state: 'READY' });
    }
    return json({}, 404);
  };
  return {
    logs,
    statuses,
    notices,
    calls,
    deps: {
      env: {
        VERCEL_TOKEN: TOKEN,
        VERCEL_TEAM_ID: 'team_123',
        VERCEL_PROJECT_ID: 'prj_123',
        PROD_URL: 'https://www.fitmunch.com.au',
        SMOKE_TOKEN: 'tok',
        SMOKE_USER_EMAIL: 'smoke-prod@fitmunch.com.au',
        SMOKE_USER_PASSWORD: 'pw',
        GITHUB_TOKEN: 'gh-token',
        GITHUB_REPOSITORY: 'armctay85/FitMunch',
      },
      fetch,
      log: (line) => logs.push(line),
      sleep: async () => {},
      aliasAttempts: 2,
      intervalMs: 0,
      postStatus: async (status) => statuses.push(status),
      incident: async (details) => { notices.push(details); return { emailed: false }; },
      smoke: async () => ({ code: 0, result: { ok: true, checks: [] }, log: '' }),
      ...overrides,
    },
  };
}

function rollbackPosts(calls) {
  return calls.filter((call) => call.method === 'POST' && String(call.url).includes('/rollback/'));
}

function prodEvent(extra) {
  return {
    event_name: 'deployment_status',
    deployment_status: { state: 'success', environment_url: 'https://fit-munch-abc.vercel.app' },
    deployment: { environment: 'Production – fit-munch', sha: 'abcdef0123456789' },
    ...extra,
  };
}

describe('production smoke job', () => {
  it('does not roll back when smoke configuration is missing', async () => {
    let smoked = false;
    const { deps, statuses, logs } = harness({
      env: { VERCEL_TOKEN: TOKEN },
      smoke: async () => { smoked = true; return { code: 0, result: {}, log: '' }; },
    });
    const result = await runProdSmokeJob(prodEvent(), deps);
    expect(result.exitCode).toBe(0);
    expect(result.rollback).toBe(false);
    expect(smoked).toBe(false);
    expect(statuses.map((status) => status.state)).toEqual(['error']);
    expect(statuses[0].description).toContain('SMOKE_TOKEN');
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('passes without a rollback POST when production smoke passes', async () => {
    const box = harness();
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.exitCode).toBe(0);
    expect(result.rollback).toBe(false);
    expect(box.calls.some((call) => call.method === 'POST')).toBe(false);
    expect(box.statuses.some((status) => status.state === 'success')).toBe(true);
  });

  it('rolls back to the previous production deployment when smoke fails and auto-rollback is on', async () => {
    let n = 0;
    const box = harness({
      smoke: async () => {
        n += 1;
        return n === 1
          ? { code: 1, result: { ok: false, checks: [{ name: 'login', ok: false, reason: 'login 500' }] }, log: 'login FAIL' }
          : { code: 0, result: { ok: true }, log: '' };
      },
    });
    box.deps.env.SMOKE_AUTO_ROLLBACK = 'on';
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.rollback).toBe(true);
    expect(result.target).toBe('dpl_old');
    expect(box.calls.some((call) => call.method === 'POST' && call.url.includes('/rollback/dpl_old'))).toBe(true);
    expect(box.logs.join('\n')).not.toContain(TOKEN);
    expect(box.notices[0].title).toContain('rolled back');
  });

  it('prints the rollback target and makes no POST on dry run', async () => {
    const box = harness({
      fetch: async (url, options = {}) => {
        if ((options.method || 'GET') === 'POST') throw new Error('dry run posted');
        if (url.includes('www.fitmunch.com.au')) {
          return json({ id: 'dpl_new', uid: 'dpl_new', created: 300, target: 'production', state: 'READY' });
        }
        if (url.includes('/v6/deployments')) {
          return json({
            deployments: [
              { uid: 'dpl_new', created: 300, target: 'production', state: 'READY' },
              { uid: 'dpl_old', created: 200, target: 'production', state: 'READY', meta: { githubCommitSha: '1111111aaa' } },
              { uid: 'dpl_older', created: 100, target: 'production', state: 'READY', meta: { githubCommitSha: '2222222bbb' } },
            ],
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    const result = await runProdSmokeJob({
      event_name: 'workflow_dispatch',
      inputs: { action: 'rollback-dry-run' },
    }, box.deps);
    expect(result.exitCode).toBe(0);
    expect(result.rollback).toBe(false);
    expect(result.target).toBe('dpl_old');
    expect(box.logs.join('\n')).toContain('Would roll back to dpl_old');
    expect(box.logs.join('\n')).toContain('dpl_older');
  });

  it('rolls back to an older production deployment when one is requested', async () => {
    const box = harness();
    const result = await runProdSmokeJob({
      event_name: 'workflow_dispatch',
      inputs: { action: 'rollback', deployment_id: 'dpl_older' },
    }, box.deps);
    expect(result.rollback).toBe(true);
    expect(result.target).toBe('dpl_older');
    expect(box.calls.some((call) => call.method === 'POST' && call.url.includes('/rollback/dpl_older'))).toBe(true);
  });

  it('does not promote a preview URL when the bypass secret is absent', async () => {
    const box = harness({
      fetch: async (url, options = {}) => {
        if ((options.method || 'GET') === 'POST') throw new Error('promoted without a smoke');
        if (url.includes('dpl_preview_deploy')) {
          return json({ id: 'dpl_preview_deploy', url: 'fit-munch-preview.vercel.app', target: 'preview', state: 'READY' });
        }
        return json({}, 404);
      },
    });
    const result = await runProdSmokeJob({
      event_name: 'workflow_dispatch',
      inputs: { action: 'promote', deployment_id: 'dpl_preview_deploy' },
    }, box.deps);
    expect(result.exitCode).toBe(1);
    expect(result.promoted).toBe(false);
    expect(box.logs.join('\n')).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
  });

  it('ignores other Vercel projects', async () => {
    const box = harness();
    const result = await runProdSmokeJob({
      event_name: 'deployment_status',
      deployment_status: { state: 'success' },
      deployment: { environment: 'Preview – fit-munch', sha: 'abc' },
    }, box.deps);
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it.each([
    'login 401',
    'login 403',
    'smoke-checkout 401',
    'smoke-checkout 403',
    'smoke-checkout 404',
    'smoke-checkout 503 smoke_misconfigured',
  ])('does not roll back when smoke exits 2 (%s)', async (reason) => {
    const box = harness({
      smoke: async () => ({
        code: 2,
        result: { ok: false, checks: [{ name: 'login', ok: false, reason }] },
        log: reason,
      }),
    });
    box.deps.env.SMOKE_AUTO_ROLLBACK = 'on';
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.rollback).toBe(false);
    expect(rollbackPosts(box.calls)).toEqual([]);
    expect(box.notices.length).toBeGreaterThan(0);
    expect(box.notices[0].body).toContain('exited 2');
  });

  it('does not roll back when the failing deployment cannot be resolved', async () => {
    const box = harness({
      smoke: async () => ({ code: 1, result: { ok: false, checks: [{ name: 'health', ok: false, reason: 'health 500' }] }, log: '' }),
      fetch: async (url, options = {}) => {
        const method = options.method || 'GET';
        if (method === 'POST' && String(url).includes('/rollback/')) throw new Error('rollback posted');
        if (String(url).includes('fit-munch-abc.vercel.app')) {
          const error = new Error('not found');
          error.status = 404;
          throw error;
        }
        return json({}, 404);
      },
    });
    box.deps.env.SMOKE_AUTO_ROLLBACK = 'on';
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.rollback).toBe(false);
    expect(result.reason).toBe('unresolved-deployment');
    expect(box.notices.length).toBeGreaterThan(0);
    expect(box.notices[0].title).toContain('unresolved');
  });

  it('does not roll back when the prior deploy is the current alias', async () => {
    let aliasReads = 0;
    const posts = [];
    const box = harness({
      smoke: async () => ({ code: 1, result: { ok: false, checks: [{ name: 'health', ok: false, reason: 'health 500' }] }, log: '' }),
      fetch: async (url, options = {}) => {
        const method = options.method || 'GET';
        const href = String(url);
        if (method === 'POST' && href.includes('/rollback/')) {
          posts.push(href);
          return json({});
        }
        if (href.includes('/api/health')) return json({ success: true });
        if (href.includes('fit-munch-abc.vercel.app')) {
          return json({ id: 'dpl_new', uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fff' } });
        }
        if (href.includes('api.vercel.com') && href.includes('www.fitmunch.com.au')) {
          aliasReads += 1;
          const id = aliasReads === 1 ? 'dpl_new' : 'dpl_old';
          return json({
            id,
            uid: id,
            created: id === 'dpl_new' ? 300 : 200,
            target: 'production',
            state: 'READY',
            meta: { githubCommitSha: id === 'dpl_new' ? 'abcdef0fff' : '1111111aaa' },
          });
        }
        if (href.includes('/v6/deployments')) {
          return json({
            deployments: [
              { uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fff' } },
              { uid: 'dpl_old', created: 200, target: 'production', state: 'READY', meta: { githubCommitSha: '1111111aaa' } },
            ],
          });
        }
        return json({}, 404);
      },
    });
    box.deps.env.SMOKE_AUTO_ROLLBACK = 'on';
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(posts).toEqual([]);
    expect(result.rollback).toBe(false);
    expect(box.notices.length).toBeGreaterThan(0);
    expect(chooseRollbackTarget(ops, [
      { uid: 'dpl_new', created: 300, target: 'production', state: 'READY' },
      { uid: 'dpl_old', created: 200, target: 'production', state: 'READY' },
    ], { uid: 'dpl_new', created: 300, target: 'production', state: 'READY' }, { uid: 'dpl_old', created: 200 }, new Set())).toBeNull();
  });

  it('posts rollback only to the deploy that previously passed smoke', async () => {
    const posts = [];
    let n = 0;
    const box = harness({
      smoke: async () => {
        n += 1;
        return n === 1
          ? { code: 1, result: { ok: false, checks: [{ name: 'health', ok: false, reason: 'health 500' }] }, log: '' }
          : { code: 0, result: { ok: true }, log: '' };
      },
      fetch: async (url, options = {}) => {
        const method = options.method || 'GET';
        const href = String(url);
        if (method === 'POST' && href.includes('/rollback/')) {
          posts.push(href);
          return json({});
        }
        if (href.includes('/api/health')) return json({ success: true });
        if (href.includes('fit-munch-abc.vercel.app')) {
          return json({ id: 'dpl_new', uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fffffffffff' } });
        }
        if (href.includes('www.fitmunch.com.au')) {
          return json({ id: 'dpl_new', uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fffffffffff' } });
        }
        if (href.includes('/v6/deployments')) {
          return json({
            deployments: [
              { uid: 'dpl_new', created: 300, target: 'production', state: 'READY', meta: { githubCommitSha: 'abcdef0fffffffffff' } },
              { uid: 'dpl_recent', created: 200, target: 'production', state: 'READY', meta: { githubCommitSha: '1111111aaaaaaaaaaa' } },
              { uid: 'dpl_good', created: 100, target: 'production', state: 'READY', meta: { githubCommitSha: '2222222bbbbbbbbbbb' } },
            ],
          });
        }
        if (href.includes('/commits/2222222bbbbbbbbbbb/status')) {
          return json({ statuses: [{ context: 'prod-smoke', state: 'success' }] });
        }
        if (href.includes('/commits/1111111aaaaaaaaaaa/status')) {
          return json({ statuses: [{ context: 'prod-smoke', state: 'failure' }] });
        }
        return json({}, 404);
      },
    });
    box.deps.env.SMOKE_AUTO_ROLLBACK = 'on';
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.rollback).toBe(true);
    expect(result.target).toBe('dpl_good');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('/rollback/dpl_good');
    expect(posts[0]).not.toContain('dpl_new');
    expect(posts[0]).not.toContain('dpl_recent');
  });

  it('stays alert-only when SMOKE_AUTO_ROLLBACK is off', async () => {
    const box = harness({
      smoke: async () => ({ code: 1, result: { ok: false, checks: [{ name: 'health', ok: false, reason: 'health 500' }] }, log: '' }),
    });
    expect(autoRollbackEnabled(box.deps.env)).toBe(false);
    const result = await runProdSmokeJob(prodEvent(), box.deps);
    expect(result.reason).toBe('rollback-off');
    expect(result.rollback).toBe(false);
    expect(rollbackPosts(box.calls)).toEqual([]);
    expect(box.notices[0].body).toContain('SMOKE_AUTO_ROLLBACK is off');
  });

  it('refuses a deployment_url outside FitMunch hosts and allows our own', async () => {
    let smoked = false;
    let target = '';
    const blocked = harness({
      smoke: async () => { smoked = true; return { code: 0, result: {}, log: '' }; },
    });
    const refused = await runProdSmokeJob({
      event_name: 'workflow_dispatch',
      inputs: { action: 'smoke', deployment_url: 'https://evil.example/phish' },
    }, blocked.deps);
    expect(smoked).toBe(false);
    expect(refused.reason).toBe('deployment-url-rejected');
    expect(rollbackPosts(blocked.calls)).toEqual([]);
    expect(isAllowlistedDeploymentUrl('https://www.fitmunch.com.au')).toBe(true);
    expect(isAllowlistedDeploymentUrl('https://fitmunch.com.au/pricing')).toBe(true);
    expect(isAllowlistedDeploymentUrl('https://fit-munch-abc-armctay85s-projects.vercel.app')).toBe(true);
    expect(isAllowlistedDeploymentUrl('http://www.fitmunch.com.au')).toBe(false);
    expect(isAllowlistedDeploymentUrl('https://evil.fitmunch.com.au')).toBe(false);
    expect(isAllowlistedDeploymentUrl('https://not-armctay85s-projects.vercel.app.evil.com')).toBe(false);

    const allowed = harness({
      smoke: async (options) => { target = options.target; return { code: 0, result: { ok: true }, log: '' }; },
    });
    const url = 'https://fit-munch-abc123-armctay85s-projects.vercel.app';
    const result = await runProdSmokeJob({
      event_name: 'workflow_dispatch',
      inputs: { action: 'smoke', deployment_url: url },
    }, allowed.deps);
    expect(result.exitCode).toBe(0);
    expect(target).toBe(url);
    expect(fs.readFileSync('.github/workflows/prod-smoke-rollback.yml', 'utf8')).toContain('SMOKE_AUTO_ROLLBACK');
  });
});
