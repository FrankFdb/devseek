import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/run-context-settlement.bundle.cjs');

execSync(
  `npx esbuild src/app/run-context.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { createDevSeekRunContext } = createRequire(import.meta.url)(bundlePath);

function withContext(testName, fn) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), `devseek-${testName}-`));
  try {
    return fn(createDevSeekRunContext({
      workspaceRoot,
      source: 'vscode-extension.agent',
      userPrompt: '创建 src/a.ts 并验证',
      runId: `run-${testName}`,
      traceLevel: 'debug',
    }));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function recordCommittedWrite(context) {
  const status = {
    type: 'agentStatus',
    phase: 'execute',
    taskId: 'task-1',
    taskAction: 'create',
    taskFile: 'src/a.ts',
    taskIndex: 1,
    taskTotal: 1,
    title: '创建 src/a.ts',
  };
  context.recordAgentStatus({ ...status, state: 'started' });
  context.recordAgentStatus({ ...status, state: 'completed' });
}

function recordPassedVerificationAndGate(context, operationId = 'validation-1') {
  context.recordAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'started',
    evidenceOperationId: operationId,
    title: '自动验证写入结果',
  });
  context.recordAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'completed',
    evidenceOperationId: operationId,
    title: '自动验证通过',
  });
  context.recordAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: 'started',
    evidenceOperationId: operationId,
    title: '评估自动验证 QualityGate',
  });
  context.recordAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: 'completed',
    evidenceOperationId: operationId,
    title: '自动验证 QualityGate 通过',
  });
}

test('RunContext settlement: committed side effects cannot complete without a passed QualityGate', () => withContext('missing-quality-gate', (context) => {
  recordCommittedWrite(context);

  assert.equal(context.complete('completed', { tasksApplied: 1 }), 'failed');
}));

test('RunContext settlement: committed side effects complete only after verification and QualityGate pass', () => withContext('quality-gate-pass', (context) => {
  recordCommittedWrite(context);
  recordPassedVerificationAndGate(context);

  assert.equal(context.complete('completed', { tasksApplied: 1 }), 'completed');
}));

test('RunContext settlement: read-only provider completion does not require a QualityGate', () => withContext('read-only-complete', (context) => {
  assert.equal(context.complete('completed', { reason: 'standalone-provider-completed' }), 'completed');
}));
