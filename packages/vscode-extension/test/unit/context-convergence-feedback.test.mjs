import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-context-convergence-'));
const bundlePath = path.join(tempRoot, 'context-convergence-feedback.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/context-convergence-feedback.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const {
  DeliveryConvergenceLedger,
  resolveDeliveryConvergenceExpectation,
  resolveDeliveryRoundActivity,
  resolveDeliveryConvergencePending,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const unresolvedMutation = Object.freeze({
  expectation: 'mutation',
  deliveryProgressEpoch: 0,
  deliveryPending: true,
  gatheredEvidenceCount: 8,
  investigationActivity: true,
  cohortBoundaryActivity: false,
});

test('delivery expectation keeps unclassified model guidance separate from mutation authority', () => {
  assert.equal(resolveDeliveryConvergenceExpectation({
    mutationRequired: true,
    modelLedUnclassified: true,
  }), 'mutation');
  assert.equal(resolveDeliveryConvergenceExpectation({
    mutationRequired: false,
    modelLedUnclassified: true,
  }), 'unclassified');
  assert.equal(resolveDeliveryConvergenceExpectation({
    mutationRequired: false,
    modelLedUnclassified: false,
  }), 'none');
});

test('mutation delivery remains pending until the current turn establishes write progress', () => {
  const retainedWorkspace = {
    expectation: 'mutation',
    deliveryProgressEstablished: false,
    completionSignaled: true,
    unresolvedExecution: false,
    actionableRepairPending: false,
  };

  assert.equal(resolveDeliveryConvergencePending(retainedWorkspace), true);
  assert.equal(resolveDeliveryConvergencePending({
    ...retainedWorkspace,
    deliveryProgressEstablished: true,
  }), false);
  assert.equal(resolveDeliveryConvergencePending({
    ...retainedWorkspace,
    deliveryProgressEstablished: true,
    unresolvedExecution: true,
  }), true);
});

test('delivery pending resolution preserves read-only and review-repair boundaries', () => {
  const base = {
    deliveryProgressEstablished: false,
    completionSignaled: true,
    unresolvedExecution: true,
    actionableRepairPending: false,
  };

  assert.equal(resolveDeliveryConvergencePending({ ...base, expectation: 'none' }), false);
  assert.equal(resolveDeliveryConvergencePending({ ...base, expectation: 'unclassified' }), false);
  assert.equal(resolveDeliveryConvergencePending({
    ...base,
    expectation: 'unclassified',
    completionSignaled: false,
  }), true);
  assert.equal(resolveDeliveryConvergencePending({
    ...base,
    expectation: 'mutation',
    deliveryProgressEstablished: true,
    unresolvedExecution: false,
    actionableRepairPending: true,
  }), true);
});

test('delivery activity separates pure context drift from locally accepted progress boundaries', () => {
  const pureContext = {
    hasContextInvestigationActivity: true,
    hasAcceptedWorkspaceMutation: false,
    acceptedRecoveryContextRefresh: false,
    expectation: 'mutation',
    hasNovelValidationTerminalProgress: false,
  };

  assert.deepEqual(resolveDeliveryRoundActivity(pureContext), {
    investigationActivity: true,
    cohortBoundaryActivity: false,
  });
  assert.deepEqual(resolveDeliveryRoundActivity({
    ...pureContext,
    hasAcceptedWorkspaceMutation: true,
  }), { investigationActivity: false, cohortBoundaryActivity: true });
  assert.deepEqual(resolveDeliveryRoundActivity({
    ...pureContext,
    acceptedRecoveryContextRefresh: true,
  }), { investigationActivity: false, cohortBoundaryActivity: true });
  assert.deepEqual(resolveDeliveryRoundActivity({
    ...pureContext,
    expectation: 'unclassified',
    hasNovelValidationTerminalProgress: true,
  }), { investigationActivity: false, cohortBoundaryActivity: false });
  assert.deepEqual(resolveDeliveryRoundActivity({
    ...pureContext,
    hasContextInvestigationActivity: false,
  }), { investigationActivity: false, cohortBoundaryActivity: false });
});

test('delivery convergence corrects twice and then stops a mutation cohort without progress', () => {
  const ledger = new DeliveryConvergenceLedger();

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  const firstCorrection = ledger.observe(unresolvedMutation);
  assert.equal(firstCorrection.kind, 'correct');
  assert.match(firstCorrection.feedback, /replace_in_file/u);

  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
  const stopped = ledger.observe(unresolvedMutation);
  assert.equal(stopped.kind, 'stop');
  assert.match(stopped.reason, /避免自主模式继续无界调查/u);
});

test('delivery convergence ignores non-investigation turns and opens a new cohort after progress', () => {
  const ledger = new DeliveryConvergenceLedger();
  const idle = { ...unresolvedMutation, investigationActivity: false };
  assert.equal(ledger.observe(idle).kind, 'continue');
  assert.equal(ledger.observe(idle).kind, 'continue');

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
  assert.equal(ledger.observe({
    ...unresolvedMutation,
    deliveryProgressEpoch: 1,
  }).kind, 'continue');

  assert.equal(ledger.observe({
    ...unresolvedMutation,
    deliveryProgressEpoch: 1,
  }).kind, 'continue');
  assert.equal(ledger.observe({
    ...unresolvedMutation,
    deliveryProgressEpoch: 1,
  }).kind, 'correct');
});

test('only accepted progress starts a fresh pure-investigation cohort', () => {
  const ledger = new DeliveryConvergenceLedger();
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');

  assert.equal(ledger.observe({
    ...unresolvedMutation,
    investigationActivity: false,
    cohortBoundaryActivity: true,
  }).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');

  ledger.reset();
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
});

test('actionable review repair corrects read-only drift without requiring broad evidence', () => {
  const ledger = new DeliveryConvergenceLedger();
  const reviewRepair = {
    ...unresolvedMutation,
    gatheredEvidenceCount: 1,
    actionableRepairPending: true,
  };

  assert.equal(ledger.observe(reviewRepair).kind, 'continue');
  assert.equal(ledger.observe(reviewRepair).kind, 'continue');
  const correction = ledger.observe(reviewRepair);
  assert.equal(correction.kind, 'correct');
  assert.match(correction.feedback, /独立审查已经给出可执行反例/u);

  assert.equal(ledger.observe({
    ...reviewRepair,
    deliveryProgressEpoch: 1,
  }).kind, 'continue');
});

test('actionable review repair gets one final bounded correction after dependency reads', () => {
  const ledger = new DeliveryConvergenceLedger();
  const reviewRepair = {
    ...unresolvedMutation,
    gatheredEvidenceCount: 1,
    actionableRepairPending: true,
  };

  assert.equal(ledger.observe(reviewRepair).kind, 'continue');
  assert.equal(ledger.observe(reviewRepair).kind, 'continue');
  assert.equal(ledger.observe(reviewRepair).kind, 'correct');
  assert.equal(ledger.observe(reviewRepair).kind, 'correct');
  assert.equal(ledger.observe(reviewRepair).kind, 'correct');

  const stopped = ledger.observe(reviewRepair);
  assert.equal(stopped.kind, 'stop');
  assert.match(stopped.reason, /3 次交付纠正/u);
});

test('explicit read-only work and insufficient evidence never acquire delivery pressure', () => {
  const ledger = new DeliveryConvergenceLedger();
  for (let round = 0; round < 6; round++) {
    assert.equal(ledger.observe({
      ...unresolvedMutation,
      expectation: 'none',
    }).kind, 'continue');
    assert.equal(ledger.observe({
      ...unresolvedMutation,
      gatheredEvidenceCount: 2,
    }).kind, 'continue');
  }
});

test('unclassified model-led investigation receives neutral pressure before it can run unbounded', () => {
  const ledger = new DeliveryConvergenceLedger();
  const observation = {
    ...unresolvedMutation,
    expectation: 'unclassified',
    gatheredEvidenceCount: 16,
  };

  for (let round = 0; round < 6; round++) {
    assert.equal(ledger.observe(observation).kind, 'continue');
  }
  const firstCorrection = ledger.observe(observation);
  assert.equal(firstCorrection.kind, 'correct');
  assert.match(firstCorrection.feedback, /如果原始需求要求实现或修复/u);
  assert.doesNotMatch(firstCorrection.feedback, /replace_in_file/u);
  assert.match(firstCorrection.feedback, /不授权任何副作用/u);

  assert.equal(ledger.observe(observation).kind, 'correct');
  assert.equal(ledger.observe(observation).kind, 'correct');
  const stopped = ledger.observe(observation);
  assert.equal(stopped.kind, 'stop');
  assert.match(stopped.reason, /3 次交付纠正/u);
});

test('unclassified delivery gets one bounded choice round beyond a known mutation cohort', () => {
  const mutationLedger = new DeliveryConvergenceLedger();
  const unclassifiedLedger = new DeliveryConvergenceLedger();
  const unclassified = {
    ...unresolvedMutation,
    expectation: 'unclassified',
    gatheredEvidenceCount: 16,
  };

  assert.equal(mutationLedger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(mutationLedger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(mutationLedger.observe(unresolvedMutation).kind, 'correct');
  assert.equal(mutationLedger.observe(unresolvedMutation).kind, 'correct');
  assert.equal(mutationLedger.observe(unresolvedMutation).kind, 'stop');

  for (let round = 0; round < 6; round++) {
    assert.equal(unclassifiedLedger.observe(unclassified).kind, 'continue');
  }
  assert.equal(unclassifiedLedger.observe(unclassified).kind, 'correct');
  assert.equal(unclassifiedLedger.observe(unclassified).kind, 'correct');
  assert.equal(unclassifiedLedger.observe(unclassified).kind, 'correct');
  assert.equal(unclassifiedLedger.observe(unclassified).kind, 'stop');
});

test('delivery convergence owns one final precise read and bounds suppressed investigation', () => {
  const ledger = new DeliveryConvergenceLedger();
  assert.equal(ledger.contextToolAdmission(), 'open');

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
  assert.equal(ledger.contextToolAdmission(), 'one-precise-read');

  ledger.closeFinalContextAllowance();
  assert.equal(ledger.contextToolAdmission(), 'closed');
  assert.equal(ledger.recordSuppressedContextRound(18), undefined);
  assert.match(
    ledger.recordSuppressedContextRound(19),
    /最终精确读取额度也已用尽/u,
  );

  ledger.observe({
    ...unresolvedMutation,
    deliveryProgressEpoch: 1,
    cohortBoundaryActivity: true,
  });
  assert.equal(ledger.contextToolAdmission(), 'open');
});
