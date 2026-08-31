import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_VERIFIER_SELECTION_VERSION,
  CanonicalRegressionSelectionService,
} from '../dist/index.js';

function verifierSelection() {
  const steps = ['readback', 'build', 'test', 'runtime'].map((id, index) => ({
    id,
    candidateId: 'project',
    role: id === 'readback' ? 'file-readback' : id,
    invocation: id === 'readback'
      ? { kind: 'file-readback', paths: ['src/value.ts'] }
      : { kind: 'process', command: 'npm', args: ['run', id] },
    cwd: '/repo',
    timeoutMs: 30_000,
    outputPolicy: 'ephemeral',
    evidenceRefs: [`candidate:${id}`],
    acceptanceIds: ['verified'],
    scopePaths: ['src/value.ts'],
    workspaceAccess: 'read-only',
    index,
  }));
  return {
    version: CODING_VERIFIER_SELECTION_VERSION,
    runId: 'run-regression',
    sequence: 2,
    actionId: 'verify-2',
    status: 'selected',
    workspaceRoot: '/repo',
    scopePaths: ['src/value.ts'],
    acceptance: [{
      criterionId: 'verified',
      verifierId: 'project-verification',
      candidateId: 'project',
      status: 'selected',
    }],
    steps,
    reasonCodes: ['verifier-selected'],
    evidenceRefs: ['selection:project'],
  };
}

function failedTestReceipt() {
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: 'run-regression',
    sequence: 1,
    actionId: 'verify-1',
    idempotencyKey: 'run-regression:verify-1',
    verifier: 'project',
    status: 'failed',
    scopePaths: ['src/value.ts'],
    checks: [{
      checkId: 'test',
      status: 'failed',
      acceptanceIds: ['verified'],
      summary: 'test failed',
      command: 'npm test',
      exitCode: 1,
      evidenceRefs: ['process:test:exit-1'],
    }],
    acceptance: [{
      criterionId: 'verified',
      status: 'failed',
      evidenceRefs: ['process:test:exit-1'],
    }],
    evidenceRefs: ['process:test:exit-1'],
  };
}

test('I19-REG-01 user journey: repair reruns failed verification with ordered prerequisites', () => {
  const port = new CanonicalRegressionSelectionService().bind({ runId: 'run-regression' });
  const decision = port.select({
    sequence: 2,
    actionId: 'regression-2',
    changedPaths: ['src/value.ts'],
    verifierSelection: verifierSelection(),
    previousVerifications: [failedTestReceipt()],
    evidenceRefs: ['mutation:repair-1'],
  });

  assert.equal(decision.strategy, 'dependent');
  assert.deepEqual(decision.selectedStepIds, ['readback', 'build', 'test']);
  assert.deepEqual(decision.omittedStepIds, ['runtime']);
  assert.deepEqual(decision.verificationSelection.steps.map(step => step.id), [
    'readback',
    'build',
    'test',
  ]);
});

test('I19-REG-02 user journey: infrastructure changes expand to full risk verification', () => {
  const decision = new CanonicalRegressionSelectionService().bind({ runId: 'run-regression' }).select({
    sequence: 2,
    actionId: 'regression-2',
    changedPaths: ['package.json'],
    verifierSelection: verifierSelection(),
    previousVerifications: [failedTestReceipt()],
    evidenceRefs: [],
  });

  assert.equal(decision.strategy, 'full-risk');
  assert.deepEqual(decision.selectedStepIds, ['readback', 'build', 'test', 'runtime']);
  assert.deepEqual(decision.omittedStepIds, []);
});

test('C9 regression selection rejects action identity drift', () => {
  const port = new CanonicalRegressionSelectionService().bind({ runId: 'run-regression' });
  const input = {
    sequence: 2,
    actionId: 'regression-2',
    changedPaths: ['src/value.ts'],
    verifierSelection: verifierSelection(),
    previousVerifications: [],
    evidenceRefs: [],
  };
  port.select(input);
  assert.throws(() => port.select({ ...input, changedPaths: ['src/other.ts'] }), /conflicting-action-identity/);
});

test('I19-REG-03 path-triggered verification selects only the dependency closure', () => {
  const selection = verifierSelection();
  const [readback, build, testStep, runtime] = selection.steps;
  const decision = new CanonicalRegressionSelectionService().bind({ runId: 'run-regression' }).select({
    sequence: 2,
    actionId: 'regression-targeted-x11',
    changedPaths: ['src/x11_app.cpp'],
    verifierSelection: {
      ...selection,
      scopePaths: ['src/x11_app.cpp'],
      steps: [
        { ...readback, triggerPaths: ['README.md'] },
        { ...build, triggerPaths: ['src', 'include'] },
        {
          ...testStep,
          id: 'wide-render',
          triggerPaths: ['src/raster_canvas.cpp', 'src/lesson_controller.cpp'],
          dependsOnStepIds: ['build'],
        },
        {
          ...runtime,
          id: 'x11-smoke',
          triggerPaths: ['src/x11_app.cpp', 'include/x11_app.hpp'],
          dependsOnStepIds: ['build'],
        },
      ],
    },
    previousVerifications: [],
    evidenceRefs: ['mutation:x11-repair'],
  });

  assert.equal(decision.strategy, 'targeted');
  assert.deepEqual(decision.selectedStepIds, ['build', 'x11-smoke']);
  assert.deepEqual(decision.omittedStepIds, ['readback', 'wide-render']);
});

test('I19-REG-04 a prior failed check remains selected with its declared prerequisites', () => {
  const selection = verifierSelection();
  const decision = new CanonicalRegressionSelectionService().bind({ runId: 'run-regression' }).select({
    sequence: 2,
    actionId: 'regression-failed-only',
    changedPaths: ['README.md'],
    verifierSelection: {
      ...selection,
      scopePaths: ['README.md'],
      steps: selection.steps.map(step => ({
        ...step,
        triggerPaths: step.id === 'readback' ? ['README.md'] : ['src'],
        ...(step.id === 'test' ? { dependsOnStepIds: ['build'] } : {}),
      })),
    },
    previousVerifications: [failedTestReceipt()],
    evidenceRefs: ['mutation:readme'],
  });

  assert.equal(decision.strategy, 'dependent');
  assert.deepEqual(decision.selectedStepIds, ['readback', 'build', 'test']);
  assert.deepEqual(decision.omittedStepIds, ['runtime']);
});
