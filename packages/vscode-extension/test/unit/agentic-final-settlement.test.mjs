import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-final-settlement.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-final-settlement.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { settleAgenticLoopFinal } = createRequire(import.meta.url)(bundlePath);

test('failed model-led work persists one paused continuation checkpoint', async () => {
  const checkpoints = [];
  const result = await settleAgenticLoopFinal({
    userPrompt: 'Continue repairing the existing project.',
    workspaceRoot: '/workspace',
    roundCount: 3,
    failedReason: 'X11 smoke test failed.',
    completeSummary: '',
    currentTodos: [{ id: 1, title: 'Repair the X11 smoke test', status: 'in-progress' }],
    writtenFiles: [{
      path: 'src/x11_app.cpp',
      basename: 'x11_app.cpp',
      linesAdded: 2,
      linesRemoved: 1,
      action: 'modify',
    }],
    terminalEvidence: [{
      command: './build/math_visual_lab --smoke-frames 3',
      kind: 'test',
      ok: false,
      exitCode: 1,
      detail: 'Cannot create XImage',
    }],
    verificationReceipts: [],
    toolExecutionReceipts: [],
    changeReceipts: [],
    policyRefusalEvidenceSatisfied: false,
    callbacks: {
      onDelta() {},
      async onAgentStatus() {},
      async onAppliedChange() {},
      async onResponseMeta() {},
      async onValidationCommand() {
        throw new Error('validation is not part of final settlement');
      },
      async onTaskCheckpoint(...checkpoint) {
        checkpoints.push(checkpoint);
      },
    },
  });

  assert.equal(result.tasksFailed, 1);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0][0], 0);
  assert.equal(checkpoints[0][2], 'paused');
  assert.equal(checkpoints[0][1].length, 1);
  assert.equal(checkpoints[0][1][0].file, 'src/x11_app.cpp');
  assert.match(checkpoints[0][1][0].desc, /run only affected verification/);
});

test('successful work clears the continuation checkpoint', async () => {
  const checkpoints = [];
  await settleAgenticLoopFinal({
    userPrompt: 'Complete the existing project.',
    workspaceRoot: '/workspace',
    roundCount: 1,
    failedReason: '',
    completeSummary: 'Complete.',
    currentTodos: [],
    writtenFiles: [],
    terminalEvidence: [],
    verificationReceipts: [],
    toolExecutionReceipts: [],
    changeReceipts: [],
    policyRefusalEvidenceSatisfied: false,
    callbacks: {
      onDelta() {},
      async onAgentStatus() {},
      async onAppliedChange() {},
      async onResponseMeta() {},
      async onValidationCommand() {
        throw new Error('validation is not part of final settlement');
      },
      async onTaskCheckpoint(...checkpoint) {
        checkpoints.push(checkpoint);
      },
    },
  });

  assert.deepEqual(checkpoints, [[null, [], 'completed']]);
});
