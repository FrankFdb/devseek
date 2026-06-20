import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/resume-context-builder.bundle.cjs');

execSync(
  `npx esbuild src/app/resume-context-builder.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ResumeContextBuilder } = req(bundlePath);

function task(overrides = {}) {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    repositoryRoot: '/repo',
    branch: 'main',
    title: 'Recover interrupted task',
    userGoal: '继续修复 bridge，token=supersecretvalue',
    provider: { type: 'bridge', model: 'deepseek' },
    status: 'recoverable',
    workflowMode: 'edit',
    todos: [
      { id: 'todo-1', title: '保存 checkpoint', status: 'completed' },
      { id: 'todo-2', title: '重新运行验证', status: 'pending' },
    ],
    changedFiles: ['src/app/task-checkpoint-store.ts'],
    operationRefs: ['op-edit'],
    changeSetRefs: ['change-1'],
    validationRefs: ['validation-1'],
    qualityGateRef: 'qg-1',
    checkpointRef: 'cp-1',
    pauseReason: 'Bridge restarted',
    evidenceRefs: ['provider:BridgeRestarted'],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

test('ResumeContextBuilder: builds minimal task facts instead of raw chat history', () => {
  const context = new ResumeContextBuilder().build({
    task: task(),
    checkpoint: {
      userPrompt: 'please continue',
      displayPrompt: 'please continue',
      wsRootFsPath: '/repo',
      allTasks: [{ title: '保存 checkpoint' }, { title: '重新运行验证' }],
      startFromIndex: 1,
      completedCount: 1,
      savedAt: 1_000,
      sessionId: 'session-1',
    },
    operations: [
      { operationId: 'op-edit', kind: 'edit', status: 'committed', replayPolicy: 'never', resultRef: 'change-1' },
      { operationId: 'op-read', kind: 'terminal', status: 'committed', replayPolicy: 'read-only', resultRef: 'terminal-1' },
    ],
  });

  assert.equal(context.taskId, 'task-1');
  assert.match(context.prompt, /只使用下面的本地任务事实恢复/);
  assert.match(context.prompt, /pendingTodos: 重新运行验证 \[pending\]/);
  assert.match(context.prompt, /changedFiles: src\/app\/task-checkpoint-store\.ts/);
  assert.deepEqual(context.blockedReplayOperationIds, ['op-edit']);
  assert.doesNotMatch(context.prompt, /supersecretvalue/);
  assert.doesNotMatch(context.prompt, /raw chat/i);
});

console.log('\nResume context builder tests passed.\n');
