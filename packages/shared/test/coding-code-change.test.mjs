import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_CHANGE_PLAN_VERSION,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  CanonicalCodeChangeService,
  CanonicalIntegrationConformanceService,
} from '../dist/index.js';

function changePlan(target = 'src/value.ts') {
  return {
    version: CODING_CHANGE_PLAN_VERSION,
    status: 'ready',
    planId: 'plan-1',
    revisionReason: 'initial-plan',
    requirementRevisionId: 'requirements-1',
    designDecisionSha256: 'design-sha',
    steps: [{
      id: 'change:1',
      action: 'modify',
      target,
      dependsOn: [],
      effects: ['workspace-mutation'],
      acceptanceIds: ['verified'],
      evidenceRequirements: ['workspace-mutation-receipt', 'workspace-readback'],
    }],
    requiredTargets: [target],
    authorizedTargets: [target],
    reasonCodes: [],
    evidenceRefs: ['plan:evidence'],
    planSha256: 'plan-sha',
  };
}

function mutation(overrides = {}) {
  return {
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: 'run-change',
    sequence: 1,
    actionId: 'write-1',
    idempotencyKey: 'run-change:write-1',
    status: 'committed',
    paths: ['src/value.ts'],
    baselineRef: 'baseline:write-1',
    readbackRef: 'readback:write-1',
    evidenceRefs: ['mutation:write-1:committed'],
    ...overrides,
  };
}

function tool(overrides = {}) {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'run-change',
    sequence: 1,
    actionId: 'write-1',
    tool: 'replace_file',
    purpose: 'modify',
    effects: ['workspace-mutation'],
    inputSha256: 'input-sha',
    permission: { decision: 'allow' },
    status: 'completed',
    evidenceRefs: ['tool:write-1:completed'],
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: 'run-change',
    sequence: 2,
    actionId: 'verify-2',
    idempotencyKey: 'run-change:verify-2',
    verifier: 'project',
    status: 'passed',
    scopePaths: ['src/value.ts'],
    checks: [],
    acceptance: [],
    evidenceRefs: ['verification:passed'],
    ...overrides,
  };
}

function codeChangeInput(overrides = {}) {
  return {
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan(),
    toolExecutions: [],
    mutations: [mutation()],
    verifications: [],
    evidenceRefs: [],
    ...overrides,
  };
}

test('I19-CHG-01 user journey: planned code change requires committed readback evidence', () => {
  const port = new CanonicalCodeChangeService().bind({ runId: 'run-change' });
  const decision = port.assess(codeChangeInput());

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.changedPaths, ['src/value.ts']);
  assert.deepEqual(decision.uncoveredTargets, []);
});

test('I19-CHG-02 user journey: committed unplanned paths fail code change conformance', () => {
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    mutations: [mutation({ paths: ['src/value.ts', 'src/hidden.ts'] })],
  }));

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.unplannedPaths, ['src/hidden.ts']);
  assert.ok(decision.reasonCodes.includes('unplanned-path-mutated'));
});

test('I19-CHG-05 user journey: model-selected authorized file satisfies a pathless source change', () => {
  const plan = {
    ...changePlan(),
    requiredTargets: [],
    authorizedTargets: ['include/value.hpp', 'src/value.cpp'],
  };
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    plan,
    mutations: [mutation({ paths: ['src/value.cpp'] })],
  }));

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.plannedTargets, []);
  assert.deepEqual(decision.changedPaths, ['src/value.cpp']);
  assert.deepEqual(decision.unplannedPaths, []);
  assert.deepEqual(decision.reasonCodes, ['authorized-change-committed-and-read-back']);
});

test('I19-CHG-06 user journey: pathless source change still rejects a mutation outside authorized scope', () => {
  const plan = {
    ...changePlan(),
    requiredTargets: [],
    authorizedTargets: ['src/value.cpp'],
  };
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    plan,
    mutations: [mutation({ paths: ['src/hidden.cpp'] })],
  }));

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.unplannedPaths, ['src/hidden.cpp']);
});

test('I19-INT-01 user journey: tool mutation and verification form one causal chain', () => {
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput());
  const integration = new CanonicalIntegrationConformanceService().bind({ runId: 'run-change' });
  const decision = integration.assess({
    sequence: 4,
    actionId: 'integration-final',
    codeChange,
    toolExecutions: [tool()],
    mutations: [mutation()],
    verifications: [verification()],
    verificationRequired: true,
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.bypassedMutationActionIds, []);
  assert.deepEqual(decision.orphanMutationToolActionIds, []);
  assert.deepEqual(decision.unverifiedPaths, []);
});

test('I19-INT-02 user journey: direct mutation bypass cannot authorize completion', () => {
  const mutations = [mutation()];
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    mutations,
  }));
  const decision = new CanonicalIntegrationConformanceService().bind({ runId: 'run-change' }).assess({
    sequence: 4,
    actionId: 'integration-final',
    codeChange,
    toolExecutions: [],
    mutations,
    verifications: [verification()],
    verificationRequired: true,
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.bypassedMutationActionIds, ['write-1']);
});

test('I19-INT-03 user journey: readback-only artifact does not invent a verification requirement', () => {
  const artifactMutation = mutation({ paths: ['notes/ready.txt'] });
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    plan: changePlan('notes/ready.txt'),
    mutations: [artifactMutation],
  }));
  const decision = new CanonicalIntegrationConformanceService().bind({ runId: 'run-change' }).assess({
    sequence: 4,
    actionId: 'integration-final',
    codeChange,
    toolExecutions: [tool()],
    mutations: [artifactMutation],
    verifications: [],
    verificationRequired: false,
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.unverifiedPaths, []);
});

test('I19-CHG-03 user journey: a rejected mutation is historical after a verified replacement', () => {
  const failedMutation = mutation({
    sequence: 1,
    actionId: 'write-rejected',
    idempotencyKey: 'run-change:write-rejected',
    status: 'failed',
    readbackRef: undefined,
    evidenceRefs: ['mutation:write-rejected:failed'],
  });
  const committedMutation = mutation({
    sequence: 2,
    actionId: 'write-recovered',
    idempotencyKey: 'run-change:write-recovered',
  });
  const verifyTool = tool({
    sequence: 3,
    actionId: 'verify-recovered',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    status: 'completed',
  });
  const passedVerification = verification({
    sequence: 3,
    actionId: 'verify-recovered',
    idempotencyKey: 'run-change:verify-recovered',
    acceptance: [{ criterionId: 'verified', status: 'passed', evidenceRefs: ['verification:passed'] }],
  });
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    sequence: 4,
    toolExecutions: [
      tool({ sequence: 1, actionId: 'write-rejected', status: 'failed' }),
      tool({ sequence: 2, actionId: 'write-recovered' }),
      verifyTool,
    ],
    mutations: [failedMutation, committedMutation],
    verifications: [passedVerification],
  }));

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.failedActionIds, []);
  assert.ok(decision.evidenceRefs.includes('mutation:write-rejected:failed'));
});

test('I19-CHG-04 user journey: an unrecovered rejected mutation still vetoes conformance', () => {
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess(codeChangeInput({
    mutations: [mutation({ status: 'failed', readbackRef: undefined })],
  }));

  assert.equal(decision.status, 'failed');
  assert.ok(decision.reasonCodes.includes('mutation-failed'));
});
