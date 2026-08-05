import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const evidenceBundlePath = path.join(rootDir, 'test/unit/agent-loop-execution-evidence.bundle.cjs');
const resultBundlePath = path.join(rootDir, 'test/unit/agent-loop-result.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-loop-execution-evidence.ts --bundle ` +
  `--outfile=${evidenceBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/agent-loop-result.ts --bundle ` +
  `--outfile=${resultBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  appendTaskExecutionEvidence,
  appendVerificationReceipt,
  createAgentLoopExecutionEvidence,
} = req(evidenceBundlePath);
const { buildAgentLoopResult } = req(resultBundlePath);

test('non-agentic evidence collector retains task and later validation receipts in execution order', () => {
  const terminal = { command: 'npm test', kind: 'test', ok: true, exitCode: 0 };
  const taskVerification = { actionId: 'verify-task' };
  const finalVerification = { actionId: 'verify-final' };
  const toolExecution = { actionId: 'tool-write' };
  const change = { actionId: 'change-write' };
  const evidence = createAgentLoopExecutionEvidence();

  appendTaskExecutionEvidence(evidence, {
    applied: true,
    terminalEvidence: [terminal],
    verificationReceipts: [taskVerification],
    toolExecutionReceipts: [toolExecution],
    changeReceipts: [change],
  });
  appendVerificationReceipt(evidence, finalVerification);

  assert.deepEqual(evidence.terminalEvidence, [terminal]);
  assert.deepEqual(evidence.verificationReceipts, [taskVerification, finalVerification]);
  assert.deepEqual(evidence.toolExecutionReceipts, [toolExecution]);
  assert.deepEqual(evidence.changeReceipts, [change]);
});

test('non-agentic result builder projects canonical receipts without recomputing them', () => {
  const verificationReceipts = [{ actionId: 'verify-final', status: 'passed' }];
  const toolExecutionReceipts = [{ actionId: 'tool-write', status: 'completed' }];
  const changeReceipts = [{ actionId: 'change-write', status: 'committed' }];
  const result = buildAgentLoopResult({
    tasks: [{ id: 'task-1', file: 'src/main.ts', action: 'modify', desc: 'update main' }],
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: ['src/main.ts'],
    userPrompt: 'Update src/main.ts',
    todos: [{ id: 1, title: 'update main', status: 'completed' }],
    editedFileRecords: [{
      path: 'src/main.ts',
      basename: 'main.ts',
      linesAdded: 1,
      linesRemoved: 1,
      action: 'modify',
    }],
    terminalEvidence: [],
    workspaceRoot: '/workspace',
    verificationReceipts,
    toolExecutionReceipts,
    changeReceipts,
  });

  assert.deepEqual(result.verificationReceipts, verificationReceipts);
  assert.deepEqual(result.toolExecutionReceipts, toolExecutionReceipts);
  assert.deepEqual(result.changeReceipts, changeReceipts);
});
