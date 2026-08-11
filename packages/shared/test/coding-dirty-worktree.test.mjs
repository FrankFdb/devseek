import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalDirtyWorktreePolicyService,
  CanonicalWorkspaceMutationTransaction,
  buildCodingWorkspaceMutationPlan,
  createCodingWorktreeSnapshot,
  parseGitPorcelainV1Z,
} from '../dist/index.js';

function mutationPlan(paths = ['src/value.ts']) {
  return buildCodingWorkspaceMutationPlan({
    runId: 'dirty-worktree-run',
    sequence: 1,
    actionId: 'write-value',
    idempotencyKey: 'dirty-worktree-run:write-value',
    paths,
    payload: { value: 2 },
    evidenceRefs: ['proposal:write-value'],
  });
}

test('I21-DTY-01 user journey: dirty worktree policy preserves disjoint changes and blocks overlap', () => {
  const entries = parseGitPorcelainV1Z([
    ' M src/user.ts',
    'R  src/new-name.ts',
    'src/old-name.ts',
    '?? notes/local.md',
    '',
  ].join('\0'));
  assert.deepEqual(entries, [
    { path: 'src/user.ts', status: 'modified' },
    { path: 'src/new-name.ts', status: 'renamed', sourcePath: 'src/old-name.ts' },
    { path: 'notes/local.md', status: 'untracked' },
  ]);
  const snapshot = createCodingWorktreeSnapshot({
    workspaceRoot: '/repo',
    repositoryState: 'git',
    entries,
  });
  const session = new CanonicalDirtyWorktreePolicyService().bind({
    runId: 'dirty-worktree-run',
    snapshot,
  });

  const disjoint = session.authorize({ actionId: 'write-other', paths: ['src/other.ts'] });
  assert.equal(disjoint.decision, 'allow');
  assert.equal(disjoint.reason, 'disjoint-user-changes');

  const direct = session.authorize({ actionId: 'write-user', paths: ['src/user.ts'] });
  assert.equal(direct.decision, 'deny');
  assert.equal(direct.reason, 'overlapping-user-changes');
  assert.deepEqual(direct.conflictingEntries.map(entry => entry.path), ['src/user.ts']);

  const directory = session.authorize({ actionId: 'replace-src', paths: ['src'] });
  assert.equal(directory.decision, 'deny');
  assert.deepEqual(directory.conflictingEntries.map(entry => entry.path), [
    'src/new-name.ts',
    'src/user.ts',
  ]);
  assert.equal(session.decisions().length, 3);
});

test('workspace mutation transaction rejects dirty overlap before baseline or host effects', async () => {
  const snapshot = createCodingWorktreeSnapshot({
    workspaceRoot: '/repo',
    repositoryState: 'git',
    entries: [{ path: 'src/value.ts', status: 'modified' }],
  });
  const policy = new CanonicalDirtyWorktreePolicyService().bind({
    runId: 'dirty-worktree-run',
    snapshot,
  });
  const calls = [];
  const host = {
    async captureBaseline() {
      calls.push('baseline');
      return { baselineRef: 'baseline', state: {}, evidenceRefs: ['baseline'] };
    },
    async apply() {
      calls.push('apply');
      throw new Error('must not run');
    },
    async readback() {
      calls.push('readback');
      throw new Error('must not run');
    },
    async rollback() {
      calls.push('rollback');
      throw new Error('must not run');
    },
  };
  const outcome = await new CanonicalWorkspaceMutationTransaction(undefined, undefined, policy)
    .execute(mutationPlan(), host);

  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.receipt.errorCode, 'dirty-worktree-conflict');
  assert.deepEqual(calls, []);
  assert.equal(policy.decisions()[0].decision, 'deny');
});

test('DirtyWorktreePolicyPort fails closed when observation is unavailable but supports non-Git baselines', () => {
  const service = new CanonicalDirtyWorktreePolicyService();
  const unavailable = service.bind({
    runId: 'unavailable-run',
    snapshot: createCodingWorktreeSnapshot({
      workspaceRoot: '/repo',
      repositoryState: 'unavailable',
      entries: [],
      reason: 'git-status-observation-failed',
    }),
  }).authorize({ actionId: 'write', paths: ['src/value.ts'] });
  assert.equal(unavailable.decision, 'deny');
  assert.equal(unavailable.reason, 'worktree-unavailable');

  const notGit = service.bind({
    runId: 'not-git-run',
    snapshot: createCodingWorktreeSnapshot({
      workspaceRoot: '/tmp/not-git',
      repositoryState: 'not-git',
      entries: [],
    }),
  }).authorize({ actionId: 'write', paths: ['src/value.ts'] });
  assert.equal(notGit.decision, 'allow');
  assert.equal(notGit.reason, 'not-git');
});
