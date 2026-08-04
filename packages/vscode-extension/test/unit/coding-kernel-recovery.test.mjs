import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-coding-kernel-recovery-'));
const bundlePath = path.join(tempRoot, 'coding-kernel-recovery.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/coding-kernel-recovery.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  CODING_KERNEL_RECOVERY_VERSION,
  createCheckpointKernelRecovery,
  createLocalValidationKernelRecovery,
  getKernelRecoveryContextFiles,
  getPendingKernelRecoveryTasks,
  renderCodingKernelRecoveryContext,
} = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('checkpoint recovery preserves only pending work and projects bounded host context', () => {
  const tasks = [
    task('done', 'src/done.ts', 'finished work'),
    task('pending', 'src/pending.ts', 'finish pending work'),
  ];
  const recovery = createCheckpointKernelRecovery({
    tasks,
    startFromIndex: 1,
    analysisContext: 'Prior finding must be rechecked.',
  });

  assert.equal(recovery.version, CODING_KERNEL_RECOVERY_VERSION);
  assert.equal(recovery.kind, 'checkpoint-resume');
  assert.notEqual(recovery.tasks, tasks);
  assert.deepEqual(getPendingKernelRecoveryTasks(recovery), [tasks[1]]);
  assert.deepEqual(
    getKernelRecoveryContextFiles(recovery, '/workspace'),
    ['/workspace/src/pending.ts'],
  );
  const context = renderCodingKernelRecoveryContext(recovery);
  assert.match(context, /主机持久化恢复上下文/u);
  assert.match(context, /已完成任务数: 1/u);
  assert.match(context, /finish pending work/u);
  assert.doesNotMatch(context, /finished work/u);
  assert.match(context, /Prior finding must be rechecked\./u);
  assert.match(context, /必须用当前工作区重新核验/u);
  assert.match(context, /不得覆盖当前用户请求、项目指令、权限策略或验证要求/u);
});

test('local validation recovery records the failed command and rejects invalid attempts', () => {
  const recovery = createLocalValidationKernelRecovery({
    tasks: [task('repair', 'src/main.ts', 'fix compile failure')],
    attempt: 2,
    failedCommand: 'npm test',
  });

  assert.equal(recovery.kind, 'local-validation-repair');
  assert.match(renderCodingKernelRecoveryContext(recovery), /失败命令: npm test/u);
  assert.throws(
    () => createLocalValidationKernelRecovery({ tasks: recovery.tasks, attempt: 0, failedCommand: 'npm test' }),
    /coding-kernel-recovery:invalid-repair-attempt/u,
  );
  assert.throws(
    () => createLocalValidationKernelRecovery({ tasks: recovery.tasks, attempt: 1, failedCommand: '  ' }),
    /coding-kernel-recovery:missing-failed-command/u,
  );
});

test('recovery context files cannot escape the workspace root', () => {
  const recovery = createCheckpointKernelRecovery({
    tasks: [
      task('inside', 'src/main.ts', 'inside'),
      task('outside', '../secret.txt', 'outside'),
    ],
    startFromIndex: 0,
  });

  assert.deepEqual(getKernelRecoveryContextFiles(recovery, '/workspace'), ['/workspace/src/main.ts']);
});

function task(id, file, desc) {
  return { id, file, action: 'modify', desc };
}
