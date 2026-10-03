const { runProdSmokeJob } = require('./scripts/prod-smoke-job');

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

  it('rolls back to the previous production deployment when smoke fails', async () => {
    let n = 0;
    const box = harness({
      smoke: async () => {
        n += 1;
        return n === 1
          ? { code: 1, result: { ok: false, checks: [{ name: 'login', ok: false, reason: 'login 500' }] }, log: 'login FAIL' }
          : { code: 0, result: { ok: true }, log: '' };
      },
    });
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
});
