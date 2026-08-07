import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import {
  CanonicalContextGraphService,
  CanonicalRequirementDecisionService,
  buildCodingKernelTaskContract,
} from '../dist/index.js';

test('I15-REQ-01 keeps explicit non-goals out of functional deliverables', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-REQ-01');
  const contract = changeContract({
    goal: scenario.input.prompt,
    nonGoals: scenario.input.non_goals,
  });
  const decision = decide(contract, contextGraph(contract));

  assert.equal(decision.status, 'ready');
  assert.deepEqual(
    decision.requirements.filter(item => item.kind === 'non-goal').map(item => item.statement),
    scenario.input.non_goals,
  );
  assert.deepEqual(
    decision.requirements.filter(item => item.kind === 'functional').map(item => item.statement),
    [scenario.input.prompt, `source-change:${scenario.input.target_path}`],
  );
  assert.equal(Object.isFrozen(decision.requirements), true);
  assert.throws(() => decision.requirements.push({}), TypeError);
});

test('I15-EXT-01 requires exact external-source attribution and preserves effect receipts', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-EXT-01');
  const contract = externalApiContract(scenario.input);
  const unresolved = decide(contract, contextGraph(contract));

  assert.equal(unresolved.status, 'exploration-required');
  assert.equal(unresolved.externalBoundaries.boundaries[0].status, 'attributed');
  assert.equal(unresolved.sourceGrounding.sources[0].status, 'unresolved');
  assert.match(unresolved.reasonCodes.join(','), new RegExp(`external-source-unresolved:${scenario.input.boundary_id}`, 'u'));

  const wrongBoundaryGraph = contextGraph(contract, [externalSource(
    scenario.input,
    [scenario.input.wrong_boundary_id],
  )]);
  assert.equal(decide(contract, wrongBoundaryGraph).status, 'exploration-required');

  const groundedGraph = contextGraph(contract, [externalSource(
    scenario.input,
    [scenario.input.boundary_id],
  )]);
  const grounded = decide(contract, groundedGraph);
  const source = grounded.sourceGrounding.sources[0];

  assert.equal(grounded.status, 'ready');
  assert.equal(source.status, 'grounded');
  assert.deepEqual(source.evidenceRefs, [
    scenario.input.source_id,
    scenario.input.tool_execution_ref,
    scenario.input.external_effect_ref,
  ]);
  assert.equal(grounded.acceptance.criteria[0].status, 'executable');
});

test('I15-ACC-01 blocks subjective completion while executable oracles remain ready', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-ACC-01');
  const subjective = changeContract({
    goal: scenario.input.prompt,
    acceptance: [{
      id: scenario.input.acceptance_id,
      statement: scenario.input.acceptance_statement,
      deliverableIds: ['source'],
      oracle: {
        kind: 'subjective',
        verifier: scenario.input.verifier,
        scope: [],
        evidenceKinds: [],
      },
      externalBoundaryRefs: [],
    }],
  });
  const weak = decide(subjective, contextGraph(subjective));

  assert.equal(weak.status, 'clarification-required');
  assert.equal(weak.acceptance.criteria[0].status, 'weak-oracle');
  assert.match(
    weak.reasonCodes.join(','),
    new RegExp(`acceptance-weak-oracle:${scenario.input.acceptance_id}`, 'u'),
  );

  const executable = changeContract();
  assert.equal(decide(executable, contextGraph(executable)).acceptance.status, 'ready');
});

test('I15-REV-01 requirement revisions require bound evidence and retain parent lineage', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-REV-01');
  const externalScenario = loadUserSimulationCase('I15', 'I15-EXT-01');
  const contract = externalApiContract(externalScenario.input);
  const initial = decide(contract, contextGraph(contract));
  const groundedGraph = contextGraph(contract, [externalSource(
    externalScenario.input,
    [externalScenario.input.boundary_id],
  )]);
  const service = new CanonicalRequirementDecisionService();
  const revised = service.decide({
    taskContract: contract,
    contextGraph: groundedGraph,
    previousDecision: initial,
    revisionReason: scenario.input.revision_reason,
    newEvidenceRefs: [scenario.input.grounding_evidence_ref],
  });

  assert.equal(revised.parentRevisionId, initial.revisionId);
  assert.equal(revised.revisionReason, scenario.input.revision_reason);
  assert.equal(revised.status, 'ready');
  assert.strictEqual(service.decide({
    taskContract: contract,
    contextGraph: groundedGraph,
    previousDecision: revised,
    revisionReason: 'No semantic change.',
    newEvidenceRefs: [scenario.input.grounding_evidence_ref],
  }), revised);
  assert.throws(() => service.decide({
    taskContract: contract,
    contextGraph: groundedGraph,
    previousDecision: initial,
    revisionReason: 'Use an unobserved claim.',
    newEvidenceRefs: [scenario.input.unbound_evidence_ref],
  }), /coding-requirements:unbound-revision-evidence/u);
});

function decide(taskContract, graph) {
  return new CanonicalRequirementDecisionService().decide({ taskContract, contextGraph: graph });
}

function contextGraph(taskContract, externalSources = []) {
  return new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
    seed: {
      files: [{ path: '/repo/src/value.ts', contentSample: 'export const value = 1;' }],
      externalSources,
    },
  });
}

function changeContract(overrides = {}) {
  return buildCodingKernelTaskContract({
    goal: 'Change src/value.ts and verify the result.',
    mode: 'change',
    include: ['src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'Focused verification passes.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'focused-test-suite',
        scope: ['src/value.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
    ...overrides,
  });
}

function externalApiContract(input) {
  return buildCodingKernelTaskContract({
    goal: input.prompt,
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    externalBoundaries: [{
      id: input.boundary_id,
      kind: 'api-version',
      subject: 'Current service API version',
      sourceRef: input.source_id,
    }],
    acceptance: [{
      id: 'grounded-version',
      statement: 'The reported API version is grounded in the official source.',
      deliverableIds: ['report'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'source-grounded-review',
        scope: ['response'],
        evidenceKinds: ['response-evidence', 'source-citation'],
      },
      externalBoundaryRefs: [input.boundary_id],
    }],
    provenanceRefs: ['user:current'],
  });
}

function externalSource(input, boundaryIds) {
  return {
    sourceId: input.source_id,
    boundaryIds,
    locator: input.source_locator,
    accessedAt: input.accessed_at,
    contentSha256: input.content_sha256,
    toolExecutionRef: input.tool_execution_ref,
    externalEffectRef: input.external_effect_ref,
  };
}
