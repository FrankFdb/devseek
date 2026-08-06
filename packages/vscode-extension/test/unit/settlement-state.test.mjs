import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/settlement-state.bundle.cjs');

execSync(
  `npx esbuild src/app/settlement-state.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideSettlementState } = req(bundlePath);

test('SettlementState: plain terminal requests pass through unchanged', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    data: { tasksApplied: 1 },
  }), {
    status: 'completed',
    terminal: true,
    requestedStatus: 'completed',
    data: { tasksApplied: 1 },
  });

  assert.deepEqual(decideSettlementState({
    requestedStatus: 'cancelled',
    data: { reason: 'user-stop' },
  }), {
    status: 'cancelled',
    terminal: true,
    requestedStatus: 'cancelled',
    reason: 'user-stop',
    data: { reason: 'user-stop' },
  });

  assert.deepEqual(decideSettlementState({
    requestedStatus: 'blocked',
    data: { reason: 'permission-denied' },
  }), {
    status: 'blocked',
    terminal: true,
    requestedStatus: 'blocked',
    reason: 'permission-denied',
    data: { reason: 'permission-denied' },
  });
});

test('SettlementState: pending adverse evidence cannot settle as completed', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    pendingAdverseOperationCount: 2,
    data: { tasksApplied: 1 },
  }), {
    status: 'failed',
    terminal: true,
    requestedStatus: 'completed',
    reason: 'unresolved-run-context-adverse-evidence',
    data: {
      tasksApplied: 1,
      reason: 'unresolved-run-context-adverse-evidence',
      requestedStatus: 'completed',
      unresolvedOperationCount: 2,
    },
  });
});

test('SettlementState: degraded evidence cannot settle as completed', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    evidenceDegraded: true,
  }), {
    status: 'failed',
    terminal: true,
    requestedStatus: 'completed',
    reason: 'evidence-degraded',
    data: {
      reason: 'evidence-degraded',
      requestedStatus: 'completed',
    },
  });
});

test('SettlementState: side-effect completion requires a passed QualityGate', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    qualityGateRequired: true,
    passedQualityGateCount: 0,
    data: { tasksApplied: 1 },
  }), {
    status: 'failed',
    terminal: true,
    requestedStatus: 'completed',
    reason: 'missing-quality-gate-verdict',
    data: {
      tasksApplied: 1,
      reason: 'missing-quality-gate-verdict',
      requestedStatus: 'completed',
      passedQualityGateCount: 0,
    },
  });

  assert.equal(decideSettlementState({
    requestedStatus: 'completed',
    qualityGateRequired: true,
    passedQualityGateCount: 1,
    data: { tasksApplied: 1 },
  }).status, 'completed');
});

test('SettlementState: pending recovery or QualityGate vetoes completion', () => {
  assert.equal(decideSettlementState({
    requestedStatus: 'completed',
    pendingRecoveryCount: 1,
  }).reason, 'pending-recovery-settlement');
  assert.equal(decideSettlementState({
    requestedStatus: 'completed',
    pendingQualityGateCount: 1,
  }).reason, 'pending-quality-gate-settlement');
});

test('SettlementState: settlement append failure fails closed', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    settlementAppendFailed: true,
    data: { tasksApplied: 1 },
  }), {
    status: 'failed',
    terminal: true,
    requestedStatus: 'completed',
    reason: 'settlement-failed',
    data: {
      tasksApplied: 1,
      reason: 'settlement-failed',
      requestedStatus: 'completed',
    },
  });
});

test('SettlementState: an existing terminal state is immutable and exactly once', () => {
  assert.deepEqual(decideSettlementState({
    requestedStatus: 'completed',
    existingTerminalStatus: 'failed',
    data: { tasksApplied: 2 },
  }), {
    status: 'failed',
    terminal: true,
    requestedStatus: 'completed',
    reason: 'existing-terminal-status',
    data: {
      tasksApplied: 2,
      requestedStatus: 'completed',
      existingTerminalStatus: 'failed',
    },
  });
});

console.log('\nSettlement state tests passed.\n');
