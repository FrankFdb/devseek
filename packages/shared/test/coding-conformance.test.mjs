import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONFORMANCE_BENCHMARK_SOURCE,
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CODING_CONFORMANCE_DIMENSIONS,
  CODING_CONFORMANCE_PREPARATION,
  CODING_COMPLETION_DECISION_VERSION,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  buildCodingKernelTaskContract,
  compareCodingConformanceProjection,
  evaluateCodingConformanceFixture,
  projectSettledCodingConformanceRun,
  validateCodingConformanceProjection,
} from '../dist/index.js';

test('coding conformance catalog freezes five Codex and Claude Code observable behavior fixtures', () => {
  assert.equal(CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.length, 5);
  assert.deepEqual(
    CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.map(fixture => fixture.fixtureId),
    [
      'create-and-verify',
      'modify-and-verify',
      'verify-repair-reverify',
      'permission-denied-no-effect',
      'policy-refusal-no-mutation',
    ],
  );
  assert.deepEqual(CODING_CONFORMANCE_DIMENSIONS, [
    'taskContract',
    'toolExecutions',
    'changeReceipts',
    'verifications',
    'completion',
  ]);
  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    assert.deepEqual(fixture.requiredSurfaces, ['vscode', 'cli', 'headless']);
    assert.deepEqual(fixture.benchmark.competitors, ['Codex', 'Claude Code']);
    assert.equal(fixture.benchmark.sourceRef, CODING_CONFORMANCE_BENCHMARK_SOURCE);
    assert.ok(fixture.benchmark.observableBehaviors.length > 0);
  }
});

test('fixture self-tests prove the adapter contract without claiming product-route evidence or qualification', () => {
  assert.deepEqual(CODING_CONFORMANCE_PREPARATION, {
    implementationState: 'cross-surface-product-projection-wired',
    productWiring: true,
    productAdapterCount: 3,
    qualificationEligible: false,
    claimsPermitted: false,
    requiredSurfaces: ['vscode', 'cli', 'headless'],
  });

  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    const evaluation = evaluateCodingConformanceFixture(
      fixture,
      fixture.requiredSurfaces.map(surface => observation(fixture, surface, 'fixture-self-test')),
    );
    assert.equal(evaluation.contractConformant, true, JSON.stringify(evaluation.violations));
    assert.equal(evaluation.productRouteEvidenceComplete, false);
    assert.equal(evaluation.qualificationEligible, false);
    assert.equal(evaluation.claimsPermitted, false);
  }
});

test('one settled projection owner keeps all five fixtures equivalent across three Surfaces', () => {
  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    const projection = projectSettledCodingConformanceRun(settledRun(fixture));
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      settledObservation(fixture, projection, 'vscode', 'development-route-replay'),
      settledObservation(fixture, projection, 'cli', 'development-route-replay'),
      settledObservation(fixture, projection, 'headless', 'product-route'),
    ]);

    assert.equal(Object.isFrozen(projection), true, fixture.fixtureId);
    assert.equal(evaluation.contractConformant, true, JSON.stringify(evaluation.violations));
    assert.deepEqual(evaluation.surfaceResults.map(result => result.contractConformant), [
      true,
      true,
      true,
    ], fixture.fixtureId);
    assert.equal(evaluation.productRouteEvidenceComplete, false, fixture.fixtureId);
    assert.equal(evaluation.claimsPermitted, false, fixture.fixtureId);
  }
});

test('settled projection owner rejects mutation uncertainty instead of hiding it', () => {
  const run = settledRun(findFixture('create-and-verify'));
  run.changeReceipts[0] = { ...run.changeReceipts[0], status: 'indeterminate' };

  assert.throws(
    () => projectSettledCodingConformanceRun(run),
    /coding-conformance-projection:unsettled-mutation:indeterminate/,
  );
});

test('public projection validation fails closed on incomplete and malformed runtime evidence', () => {
  const fixture = findFixture('create-and-verify');
  const incomplete = structuredClone(fixture.expected);
  delete incomplete.changeReceipts;
  const malformed = structuredClone(fixture.expected);
  malformed.toolExecutions = 'terminal prose';

  assert.ok(validateCodingConformanceProjection(incomplete, 'headless').some(violation => (
    violation.dimension === 'changeReceipts' && violation.code === 'missing-dimension'
  )));
  assert.ok(validateCodingConformanceProjection(malformed, 'headless').some(violation => (
    violation.dimension === 'observation' && violation.code === 'invalid-projection-shape'
  )));
});

test('projection comparison rejects stale changes and missing verification instead of accepting terminal prose', () => {
  const fixture = findFixture('modify-and-verify');
  const staleChange = structuredClone(fixture.expected);
  staleChange.changeReceipts.push({
    sequence: 2,
    actionId: 'prior-run-write',
    status: 'committed',
    paths: ['src/prior-run.js'],
    baselineRef: 'baseline:src/prior-run.js',
    readbackRef: 'readback:src/prior-run.js',
    evidenceRefs: ['mutation:prior-run-write'],
  });
  const missingVerification = structuredClone(fixture.expected);
  missingVerification.verifications = [];

  const staleViolations = compareCodingConformanceProjection(fixture.expected, staleChange, 'vscode');
  const verificationViolations = compareCodingConformanceProjection(fixture.expected, missingVerification, 'cli');

  assert.ok(staleViolations.some(violation => violation.dimension === 'changeReceipts'));
  assert.ok(verificationViolations.some(violation => violation.dimension === 'verifications'));
});

test('projection comparison treats Surface-local identities as evidence refs, not business semantics', () => {
  const fixture = findFixture('verify-repair-reverify');
  const projection = structuredClone(fixture.expected);
  const actionIds = new Map();
  projection.taskContract.provenanceRefs = ['surface:vscode:task-contract'];
  projection.toolExecutions.forEach((receipt, index) => {
    const actionId = `vscode-action-${index + 11}`;
    actionIds.set(receipt.actionId, actionId);
    receipt.sequence = (index + 1) * 10;
    receipt.actionId = actionId;
    receipt.tool = receipt.effects.includes('workspace-mutation') ? 'vscode-edit-host' : 'vscode-terminal-host';
    receipt.evidenceRefs = [`vscode-tool-evidence-${index + 1}`];
  });
  projection.changeReceipts.forEach((receipt, index) => {
    receipt.sequence = (index + 1) * 7;
    receipt.actionId = actionIds.get(receipt.actionId);
    receipt.baselineRef = `vscode-baseline-${index + 1}`;
    receipt.readbackRef = `vscode-readback-${index + 1}`;
    receipt.rollbackRef = `vscode-rollback-${index + 1}`;
    receipt.evidenceRefs = [`vscode-mutation-evidence-${index + 1}`];
  });
  projection.verifications.forEach((verification, index) => {
    verification.sequence = (index + 1) * 9;
    verification.actionId = actionIds.get(verification.actionId);
    verification.verifier = `vscode-verifier-${index + 1}`;
    verification.evidenceRefs = [`vscode-verification-evidence-${index + 1}`];
  });
  projection.completion.acceptance.forEach(criterion => {
    criterion.evidenceRefs = [`vscode-acceptance-${criterion.criterionId}`];
  });
  projection.completion.evidenceRefs = ['vscode-completion-evidence'];

  const violations = compareCodingConformanceProjection(fixture.expected, projection, 'vscode');
  assert.deepEqual(violations, []);
});

test('projection validation rejects ambiguous actions and mutation receipts without a valid owner', () => {
  const fixture = findFixture('modify-and-verify');
  const duplicateAction = structuredClone(fixture.expected);
  duplicateAction.toolExecutions[2].actionId = duplicateAction.toolExecutions[1].actionId;

  const nonMutationOwner = structuredClone(fixture.expected);
  nonMutationOwner.changeReceipts[0].actionId = 'read-source';

  const incompleteRollback = structuredClone(fixture.expected);
  incompleteRollback.changeReceipts[0].status = 'rolled-back';
  delete incompleteRollback.changeReceipts[0].rollbackRef;

  const invalidEffectState = structuredClone(fixture.expected);
  invalidEffectState.toolExecutions.find(receipt => receipt.status === 'completed').effectStarted = false;

  assert.ok(compareCodingConformanceProjection(fixture.expected, duplicateAction).some(
    violation => violation.code === 'duplicate-action-id',
  ));
  assert.ok(compareCodingConformanceProjection(fixture.expected, nonMutationOwner).some(
    violation => violation.code === 'change-action-not-mutation',
  ));
  assert.ok(compareCodingConformanceProjection(fixture.expected, incompleteRollback).some(
    violation => violation.code === 'incomplete-change-receipt',
  ));
  assert.ok(compareCodingConformanceProjection(fixture.expected, invalidEffectState).some(
    violation => violation.code === 'invalid-tool-effect-state',
  ));
});

test('cross-Surface evaluation fails closed on missing, duplicate, or semantically divergent observations', () => {
  const fixture = findFixture('create-and-verify');
  const missing = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    observation(fixture, 'cli', 'fixture-self-test'),
  ]);
  assert.equal(missing.contractConformant, false);
  assert.ok(missing.violations.some(violation => violation.code === 'missing-surface'));

  const duplicate = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    observation(fixture, 'vscode', 'fixture-self-test'),
    observation(fixture, 'cli', 'fixture-self-test'),
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.equal(duplicate.contractConformant, false);
  assert.ok(duplicate.violations.some(violation => violation.code === 'duplicate-surface'));

  const divergentCli = observation(fixture, 'cli', 'fixture-self-test');
  divergentCli.projection.completion.status = 'failed';
  const divergent = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    divergentCli,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.equal(divergent.contractConformant, false);
  assert.ok(divergent.violations.some(violation => (
    violation.surface === 'cli' && violation.dimension === 'completion'
  )));
});

test('development route observations expose partial facts without fabricating missing dimensions', () => {
  const fixture = findFixture('modify-and-verify');
  const cliObservation = observation(fixture, 'cli', 'development-route-replay');
  cliObservation.projection = {
    schemaVersion: fixture.schemaVersion,
    fixtureId: fixture.fixtureId,
    toolExecutions: structuredClone(fixture.expected.toolExecutions),
  };
  cliObservation.unavailableDimensions = [
    unavailable('taskContract'),
    unavailable('changeReceipts'),
    unavailable('verifications'),
    unavailable('completion'),
  ];

  const evaluation = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    cliObservation,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  const cliResult = evaluation.surfaceResults.find(result => result.surface === 'cli');

  assert.equal(evaluation.contractConformant, false);
  assert.deepEqual(cliResult.observedDimensions, ['toolExecutions']);
  assert.deepEqual(cliResult.missingDimensions, [
    'taskContract',
    'changeReceipts',
    'verifications',
    'completion',
  ]);
  assert.equal(cliResult.violations.filter(violation => violation.code === 'missing-dimension').length, 4);
  assert.equal(cliResult.violations.some(violation => violation.code === 'unexplained-missing-dimension'), false);
  assert.equal(evaluation.productRouteEvidenceComplete, false);
  assert.equal(evaluation.qualificationEligible, false);
});

test('partial observations fail closed on missing, duplicate, or contradictory unavailability receipts', () => {
  const fixture = findFixture('create-and-verify');
  const incomplete = observation(fixture, 'cli', 'development-route-replay');
  incomplete.projection = {
    schemaVersion: fixture.schemaVersion,
    fixtureId: fixture.fixtureId,
  };
  incomplete.unavailableDimensions = [
    unavailable('taskContract'),
    unavailable('toolExecutions'),
    unavailable('changeReceipts'),
    unavailable('verifications'),
  ];
  const incompleteEvaluation = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    incomplete,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.ok(incompleteEvaluation.violations.some(violation => (
    violation.surface === 'cli'
      && violation.dimension === 'completion'
      && violation.code === 'unexplained-missing-dimension'
  )));

  const duplicate = observation(fixture, 'cli', 'development-route-replay');
  duplicate.projection = {
    schemaVersion: fixture.schemaVersion,
    fixtureId: fixture.fixtureId,
  };
  duplicate.unavailableDimensions = [
    unavailable('taskContract'),
    unavailable('toolExecutions'),
    unavailable('changeReceipts'),
    unavailable('verifications'),
    unavailable('completion'),
    unavailable('completion'),
  ];
  const duplicateEvaluation = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    duplicate,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.ok(duplicateEvaluation.violations.some(violation => (
    violation.surface === 'cli'
      && violation.dimension === 'completion'
      && violation.code === 'duplicate-unavailability-receipt'
  )));

  const contradictory = observation(fixture, 'cli', 'development-route-replay');
  contradictory.unavailableDimensions = [unavailable('toolExecutions')];
  const contradictoryEvaluation = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    contradictory,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.ok(contradictoryEvaluation.violations.some(violation => (
    violation.surface === 'cli'
      && violation.dimension === 'toolExecutions'
      && violation.code === 'unavailability-for-observed-dimension'
  )));

  const invalid = observation(fixture, 'cli', 'development-route-replay');
  invalid.projection = {
    schemaVersion: fixture.schemaVersion,
    fixtureId: fixture.fixtureId,
  };
  invalid.unavailableDimensions = [
    { ...unavailable('taskContract'), reason: 'guess-from-terminal-prose' },
    { ...unavailable('toolExecutions'), evidenceRefs: [] },
    unavailable('changeReceipts'),
    unavailable('verifications'),
    unavailable('completion'),
  ];
  const invalidEvaluation = evaluateCodingConformanceFixture(fixture, [
    observation(fixture, 'vscode', 'fixture-self-test'),
    invalid,
    observation(fixture, 'headless', 'fixture-self-test'),
  ]);
  assert.ok(invalidEvaluation.violations.some(violation => violation.code === 'invalid-unavailability-reason'));
  assert.ok(invalidEvaluation.violations.some(violation => violation.code === 'missing-unavailability-evidence'));
});

test('product-route completion requires product evidence from every configured Surface', () => {
  const fixture = findFixture('verify-repair-reverify');
  const incomplete = fixture.requiredSurfaces.map((surface, index) => observation(
    fixture,
    surface,
    index === 0 ? 'development-route-replay' : 'product-route',
  ));
  const complete = fixture.requiredSurfaces.map(surface => observation(fixture, surface, 'product-route'));

  assert.equal(evaluateCodingConformanceFixture(fixture, incomplete).productRouteEvidenceComplete, false);
  const evaluation = evaluateCodingConformanceFixture(fixture, complete);
  assert.equal(evaluation.contractConformant, true);
  assert.equal(evaluation.productRouteEvidenceComplete, true);
  assert.equal(evaluation.qualificationEligible, false);
  assert.equal(evaluation.claimsPermitted, false);
});

test('policy refusal fixture requires explicit completion evidence and zero work side effects', () => {
  const fixture = findFixture('policy-refusal-no-mutation');
  assert.deepEqual(fixture.expected.toolExecutions, []);
  assert.deepEqual(fixture.expected.changeReceipts, []);
  assert.deepEqual(fixture.expected.verifications, []);
  assert.equal(fixture.expected.completion.status, 'completed');
  assert.deepEqual(
    fixture.expected.completion.acceptance.map(criterion => criterion.status),
    ['passed', 'passed', 'passed'],
  );
});

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}

function observation(fixture, surface, evidenceClass) {
  return {
    surface,
    adapterId: `${surface}-projection-adapter`,
    evidenceClass,
    sourceRefs: [`fixture:${fixture.fixtureId}:${surface}`],
    projection: structuredClone(fixture.expected),
    unavailableDimensions: [],
  };
}

function settledObservation(fixture, projection, surface, evidenceClass) {
  return {
    surface,
    adapterId: `${surface}-settled-run-projection`,
    evidenceClass,
    sourceRefs: [`settled-run:${fixture.fixtureId}:${surface}`],
    projection,
    unavailableDimensions: [],
  };
}

function settledRun(fixture) {
  const runId = fixture.fixtureId;
  const taskContract = buildCodingKernelTaskContract({
    goal: fixture.expected.taskContract.goal,
    mode: fixture.expected.taskContract.mode,
    include: fixture.expected.taskContract.scope.include,
    exclude: fixture.expected.taskContract.scope.exclude,
    deliverables: fixture.expected.taskContract.deliverables,
    constraints: fixture.expected.taskContract.constraints,
    acceptance: executableAcceptance(fixture),
    provenanceRefs: fixture.expected.taskContract.provenanceRefs,
  });
  const toolExecutions = fixture.expected.toolExecutions.map(receipt => ({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId,
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    tool: receipt.tool,
    effects: receipt.effects,
    permission: {
      decision: receipt.status === 'denied' ? 'deny' : 'allow',
      status: receipt.status === 'denied' ? 'denied' : 'authorized',
      reason: 'settled-conformance-fixture',
      evidenceRefs: receipt.evidenceRefs,
    },
    status: receipt.status,
    evidenceRefs: receipt.evidenceRefs,
  }));
  const changeReceipts = fixture.expected.changeReceipts.map(receipt => ({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId,
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    idempotencyKey: `${runId}:${receipt.actionId}`,
    status: receipt.status,
    paths: receipt.paths,
    baselineRef: receipt.baselineRef,
    ...(receipt.readbackRef ? { readbackRef: receipt.readbackRef } : {}),
    ...(receipt.rollbackRef ? { rollbackRef: receipt.rollbackRef } : {}),
    evidenceRefs: receipt.evidenceRefs,
  }));
  const verifications = fixture.expected.verifications.map(receipt => ({
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId,
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    idempotencyKey: `${runId}:${receipt.actionId}`,
    verifier: receipt.verifier,
    status: receipt.status === 'blocked' ? 'unverified' : receipt.status,
    scopePaths: [...new Set(changeReceipts.flatMap(change => change.paths))],
    checks: [],
    acceptance: receipt.acceptanceIds.map(criterionId => ({
      criterionId,
      status: receipt.status === 'passed' ? 'passed' : receipt.status === 'failed' ? 'failed' : 'unverified',
      evidenceRefs: receipt.evidenceRefs,
    })),
    evidenceRefs: receipt.evidenceRefs,
  }));
  const completion = {
    version: CODING_COMPLETION_DECISION_VERSION,
    runId,
    decisionId: 'settled-completion',
    idempotencyKey: `${runId}:settled-completion`,
    status: fixture.expected.completion.status,
    acceptance: fixture.expected.completion.acceptance,
    reasonCodes: [],
    residualRisks: fixture.expected.completion.residualRisks,
    evidenceRefs: fixture.expected.completion.evidenceRefs,
  };
  return { fixtureId: fixture.fixtureId, taskContract, toolExecutions, changeReceipts, verifications, completion };
}

function executableAcceptance(fixture) {
  const deliverableIds = fixture.expected.taskContract.deliverables.map(deliverable => deliverable.id);
  const responseOnly = fixture.expected.taskContract.mode === 'review'
    || fixture.expected.taskContract.mode === 'explain';
  return fixture.expected.taskContract.acceptance.map(criterion => ({
    ...criterion,
    deliverableIds,
    oracle: {
      kind: responseOnly ? 'response-evidence' : 'verification',
      verifier: 'conformance-fixture-adapter',
      scope: fixture.expected.taskContract.scope.include.length > 0
        ? fixture.expected.taskContract.scope.include
        : ['workspace'],
      evidenceKinds: [responseOnly ? 'response-evidence' : 'verification-receipt'],
    },
    externalBoundaryRefs: [],
  }));
}

function unavailable(dimension) {
  return {
    dimension,
    reason: 'route-output-not-exposed',
    evidenceRefs: [`route-output:${dimension}:absent`],
  };
}
