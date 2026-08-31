import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-final-decision.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-final-decision.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { settleAgenticFinalDecision } = createRequire(import.meta.url)(bundlePath);

test('terminal validation failure settles todos and persists one continuation', async () => {
  const todoUpdates = [];
  const checkpoints = [];
  const failure = {
    command: 'npm test',
    kind: 'test',
    ok: false,
    exitCode: 1,
    detail: 'one assertion failed',
  };
  const result = await settleAgenticFinalDecision({
    userPrompt: 'Repair the current project.',
    currentPrompt: 'Repair the current project.',
    workspaceRoot: '/workspace',
    roundCount: 3,
    routeChatKind: 'code-change',
    hadTaskComplete: false,
    completeSummary: '',
    existingFailure: '',
    lastProviderText: 'I ran the test.',
    lastRoundToolRequestCount: 1,
    lastRoundToolExecutionCount: 1,
    sawWorkTool: true,
    currentTodos: [{ id: 1, title: 'Repair test', status: 'in-progress' }],
    lastMissingEvidence: [],
    finalEvidence: { required: true, missingEvidence: [], blockingTerminalFailure: failure },
    requirementReviewBlocker: undefined,
    recoveryBlocker: undefined,
    textToolProtocol: {
      version: 'devseek.text-tools/v1',
      channelId: 'abcdefghijklmnop',
    },
    evidenceRefs: ['terminal:test'],
    readEvidenceCount: 1,
    writtenFiles: [],
    terminalEvidence: [failure],
    verificationReceipts: [],
    toolExecutionReceipts: [],
    changeReceipts: [],
    callbacks: {
      onDelta() {},
      async onAgentStatus() {},
      async onAppliedChange() {},
      async onResponseMeta() {},
      async onValidationCommand() {
        throw new Error('validation is not part of final decision');
      },
      async onTodoUpdate(todos) {
        todoUpdates.push(todos);
      },
      async onTaskCheckpoint(...checkpoint) {
        checkpoints.push(checkpoint);
      },
    },
  });

  assert.equal(result.tasksFailed, 1);
  assert.match(result.failedReason, /npm test/);
  assert.equal(todoUpdates.length, 1);
  assert.equal(todoUpdates[0].some(todo => todo.status === 'failed'), true);
  assert.equal(checkpoints[0][2], 'paused');
});
