import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-unexecuted-action-recovery-'));
const bundlePath = path.join(tempRoot, 'unexecuted-action-recovery.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/unexecuted-action-recovery.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { UnexecutedActionRecoveryLifecycle } = createRequire(import.meta.url)(bundlePath);
const textToolProtocol = {
  version: 'devseek.text-tools/v1',
  channelId: 'unexecuted-action-recovery-test',
};

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function codeRecovery(useFreshProviderSession = false) {
  return {
    kind: 'retry',
    recoveryClass: 'code-action',
    statusTitle: '',
    statusDetail: '',
    activityLabel: '',
    feedback: '',
    useFreshProviderSession,
  };
}

test('UnexecutedActionRecovery: one context refresh cannot erase a pending source write', () => {
  const lifecycle = new UnexecutedActionRecoveryLifecycle();
  lifecycle.begin(codeRecovery());

  const firstScreen = lifecycle.screenToolProposals([
    { name: 'read_file' },
    { name: 'grep_search' },
  ]);
  assert.equal(firstScreen.contextRefreshToolIndex, 0);
  assert.deepEqual([...firstScreen.blockedToolIndexes], [1]);
  const firstFeedback = lifecycle.projectExecutionFeedback(firstScreen, {
    readFiles: ['src/render.cpp'],
  }, textToolProtocol).join('\n');
  assert.match(firstFeedback, /不再接受额外读取或搜索/u);
  assert.match(firstFeedback, /<apply_patch>/u);
  assert.equal(lifecycle.hasPendingAction(), true);

  const driftScreen = lifecycle.screenToolProposals([
    { name: 'read_file' },
    { name: 'grep_search' },
  ]);
  assert.equal(driftScreen.admittedToolIndex, undefined);
  assert.deepEqual([...driftScreen.blockedToolIndexes], [0, 1]);
  const driftFeedback = lifecycle.projectExecutionFeedback(driftScreen, {}, textToolProtocol).join('\n');
  assert.match(driftFeedback, /仍未形成真实执行回执/u);
  assert.match(driftFeedback, /跳过 2 个/u);

  lifecycle.onProviderSessionRebuilt();
  const rebuiltScreen = lifecycle.screenToolProposals([{ name: 'read_file' }]);
  assert.equal(rebuiltScreen.contextRefreshToolIndex, 0);
});

test('UnexecutedActionRecovery: a matching write wins over extra tools and settles on receipt', () => {
  const lifecycle = new UnexecutedActionRecoveryLifecycle();
  lifecycle.begin(codeRecovery(true));
  const screen = lifecycle.screenToolProposals([
    { name: 'read_file' },
    { name: 'replace_in_file' },
    { name: 'run_terminal' },
  ]);

  assert.equal(screen.admittedToolIndex, 1);
  assert.deepEqual([...screen.blockedToolIndexes], [0, 2]);
  const feedback = lifecycle.projectExecutionFeedback(screen, {
    writtenFiles: [{
      path: 'src/render.cpp',
      basename: 'render.cpp',
      linesAdded: 1,
      linesRemoved: 1,
      action: 'replace',
    }],
  }, textToolProtocol).join('\n');
  assert.match(feedback, /真实写盘回执/u);
  assert.match(feedback, /下一轮只需读回或原样重跑/u);
  assert.equal(lifecycle.hasPendingAction(), false);
});
