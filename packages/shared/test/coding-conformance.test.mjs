import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONFORMANCE_BENCHMARK_SOURCE,
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CODING_CONFORMANCE_DIMENSIONS,
  CODING_CONFORMANCE_PREPARATION,
  compareCodingConformanceProjection,
  evaluateCodingConformanceFixture,
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

test('fixture self-tests prove the adapter contract without claiming product wiring or qualification', () => {
  assert.deepEqual(CODING_CONFORMANCE_PREPARATION, {
    implementationState: 'contract-and-development-fixtures-only',
    productWiring: false,
    productAdapterCount: 0,
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

test('projection validation rejects ambiguous actions and mutation receipts without a valid owner', () => {
  const fixture = findFixture('modify-and-verify');
  const duplicateAction = structuredClone(fixture.expected);
  duplicateAction.toolExecutions[2].actionId = duplicateAction.toolExecutions[1].actionId;

  const nonMutationOwner = structuredClone(fixture.expected);
  nonMutationOwner.changeReceipts[0].actionId = 'read-source';

  const incompleteRollback = structuredClone(fixture.expected);
  incompleteRollback.changeReceipts[0].status = 'rolled-back';
  delete incompleteRollback.changeReceipts[0].rollbackRef;

  assert.ok(compareCodingConformanceProjection(fixture.expected, duplicateAction).some(
    violation => violation.code === 'duplicate-action-id',
  ));
  assert.ok(compareCodingConformanceProjection(fixture.expected, nonMutationOwner).some(
    violation => violation.code === 'change-action-not-mutation',
  ));
  assert.ok(compareCodingConformanceProjection(fixture.expected, incompleteRollback).some(
    violation => violation.code === 'incomplete-change-receipt',
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

test('self-declared product-route observations cannot bypass the zero-adapter preparation boundary', () => {
  const fixture = findFixture('verify-repair-reverify');
  const evaluation = evaluateCodingConformanceFixture(
    fixture,
    fixture.requiredSurfaces.map(surface => observation(fixture, surface, 'product-route')),
  );

  assert.equal(evaluation.contractConformant, true);
  assert.equal(evaluation.productRouteEvidenceComplete, false);
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

function unavailable(dimension) {
  return {
    dimension,
    reason: 'route-output-not-exposed',
    evidenceRefs: [`route-output:${dimension}:absent`],
  };
}
