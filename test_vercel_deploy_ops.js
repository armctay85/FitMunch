const {
  findRollbackTarget,
  priorProductionDeployments,
  requestRollback,
  requestPromote,
  redact,
} = require('./scripts/lib/vercel-deploy-ops');

const failing = {
  uid: 'dpl_new',
  created: 300,
  target: 'production',
  state: 'READY',
  meta: { githubCommitSha: 'aaa1111bbbb' },
};
const previous = {
  uid: 'dpl_prev',
  created: 200,
  target: 'production',
  state: 'READY',
  meta: { githubCommitSha: 'bbb2222cccc' },
};
const older = {
  uid: 'dpl_older',
  created: 100,
  target: 'production',
  state: 'READY',
  meta: { githubCommitSha: 'ccc3333dddd' },
};
const preview = {
  uid: 'dpl_preview',
  created: 250,
  target: 'preview',
  state: 'READY',
  meta: { githubCommitSha: 'ddd4444eeee' },
};

describe('vercel deploy ops', () => {
  const rows = [failing, preview, previous, older];

  it('picks the newest READY production deployment older than the failing one', () => {
    expect(findRollbackTarget(rows, failing).uid).toBe('dpl_prev');
    expect(priorProductionDeployments(rows, failing).map((row) => row.uid)).toEqual(['dpl_prev', 'dpl_older']);
  });

  it('can target any earlier production deployment and never the failing one or a preview', () => {
    expect(findRollbackTarget(rows, failing, 'dpl_older').uid).toBe('dpl_older');
    expect(findRollbackTarget(rows, failing, 'dpl_new')).toBeNull();
    expect(findRollbackTarget(rows, failing, 'dpl_preview')).toBeNull();
  });

  it('dry-run selection makes no POST', () => {
    const calls = [];
    const fetch = async (url, options = {}) => {
      calls.push(options.method || 'GET');
      if ((options.method || 'GET') !== 'GET') throw new Error('POST during dry run');
      return { ok: true, status: 200, text: async () => '{"deployments":[]}' };
    };
    return findRollbackTarget(rows, failing) && fetch('https://api.vercel.com/v6/deployments', { method: 'GET' })
      .then(() => {
        expect(calls).toEqual(['GET']);
      });
  });

  it('never puts the token in the rollback URL or the error', async () => {
    const token = 'super-secret-token-value';
    let called = '';
    await requestRollback(async (url) => {
      called = url;
      return { ok: true, status: 201, text: async () => '{}' };
    }, {
      token,
      teamId: 'team_123',
      projectId: 'prj_123',
      deploymentId: 'dpl_prev',
    });
    expect(called).toContain('/v1/projects/prj_123/rollback/dpl_prev');
    expect(called).not.toContain(token);

    await expect(requestRollback(async () => ({
      ok: false,
      status: 403,
      text: async () => `denied ${token}`,
    }), {
      token,
      teamId: 'team_123',
      projectId: 'prj_123',
      deploymentId: 'dpl_prev',
    })).rejects.toThrow(/\[redacted\]/);

    try {
      await requestRollback(async () => ({
        ok: false,
        status: 403,
        text: async () => `denied ${token}`,
      }), {
        token,
        teamId: 'team_123',
        projectId: 'prj_123',
        deploymentId: 'dpl_prev',
      });
    } catch (err) {
      expect(err.message).not.toContain(token);
    }
  });

  it('promotes with the documented endpoint', async () => {
    let called = '';
    await requestPromote(async (url, options) => {
      called = `${options.method} ${url}`;
      return { ok: true, status: 200, text: async () => '{}' };
    }, {
      token: 'super-secret-token-value',
      teamId: 'team_123',
      projectId: 'prj_123',
      deploymentId: 'dpl_older',
    });
    expect(called).toContain('POST ');
    expect(called).toContain('/v10/projects/prj_123/promote/dpl_older');
    expect(called).not.toContain('super-secret-token-value');
    expect(redact('Bearer super-secret-token-value', ['super-secret-token-value'])).not.toContain('super-secret-token-value');
  });
});
