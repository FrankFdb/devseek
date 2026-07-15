import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-run-settlement.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-run-settlement.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { settleAgentLoopResult } = req(bundlePath);

test('agent run settlement omits undefined verification fields for strict JSON completion data', () => {
  let completionData;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionData = data;
      assert.doesNotThrow(() => assertStrictJsonData(data));
      return requestedStatus;
    },
  };

  const settlement = settleAgentLoopResult(terminalPermissions, { runId: 'run-1' }, {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
  });

  assert.equal(settlement.status, 'failed');
  assert.deepEqual(completionData, {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
    verificationIds: [],
  });
  assert.equal(Object.hasOwn(completionData, 'artifactVerificationOk'), false);
});

test('agent run settlement keeps explicit artifact verification verdicts', () => {
  let completionData;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionData = data;
      assert.doesNotThrow(() => assertStrictJsonData(data));
      return requestedStatus;
    },
  };

  settleAgentLoopResult(terminalPermissions, { runId: 'run-2' }, {
    tasksTotal: 1,
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: ['report.md'],
    verificationResults: [
      { verificationId: 'vr-1', ok: true, claims: [] },
    ],
  });

  assert.deepEqual(completionData.verificationIds, ['vr-1']);
  assert.equal(completionData.artifactVerificationOk, true);
});

function assertStrictJsonData(value, seen = new Set()) {
  assert.notEqual(value, undefined, 'strict JSON data must not contain undefined');
  assert.notEqual(typeof value, 'function', 'strict JSON data must not contain functions');
  assert.notEqual(typeof value, 'symbol', 'strict JSON data must not contain symbols');
  if (value === null || typeof value !== 'object') return;
  assert.equal(seen.has(value), false, 'strict JSON data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => assertStrictJsonData(item, seen));
  } else {
    Object.values(value).forEach(item => assertStrictJsonData(item, seen));
  }
  seen.delete(value);
}
