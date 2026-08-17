import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/vscode-coding-kernel-output.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/vscode-coding-kernel-output.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const { reconcileAgentResultWithCompletion } = req(bundlePath);

test('canonical failure overrides a model-loop success summary before session persistence', () => {
  const result = reconcileAgentResultWithCompletion({
    tasksTotal: 2,
    tasksApplied: 2,
    tasksFailed: 0,
    changedPaths: ['offwork.cpp'],
    historyText: '**[Agentic] 已完成** 编译验证通过。',
  }, {
    status: 'failed',
  });

  assert.equal(result.tasksFailed, 1);
  assert.match(result.historyText, /^\*\*\[Agentic\] 未完成/u);
  assert.match(result.failedReason, /验证|证据/);
});

test('canonical completion preserves the successful model-loop projection', () => {
  const original = {
    tasksTotal: 2,
    tasksApplied: 2,
    tasksFailed: 0,
    changedPaths: ['offwork.cpp'],
    historyText: '**[Agentic] 已完成** 编译验证通过。',
  };

  assert.equal(reconcileAgentResultWithCompletion(original, { status: 'completed' }), original);
});
