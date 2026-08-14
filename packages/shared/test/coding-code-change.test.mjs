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

function verification() {
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
  };
}

test('I19-CHG-01 user journey: planned code change requires committed readback evidence', () => {
  const port = new CanonicalCodeChangeService().bind({ runId: 'run-change' });
  const decision = port.assess({
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan(),
    mutations: [mutation()],
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.changedPaths, ['src/value.ts']);
  assert.deepEqual(decision.uncoveredTargets, []);
});

test('I19-CHG-02 user journey: committed unplanned paths fail code change conformance', () => {
  const decision = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess({
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan(),
    mutations: [mutation({ paths: ['src/value.ts', 'src/hidden.ts'] })],
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'failed');
  assert.deepEqual(decision.unplannedPaths, ['src/hidden.ts']);
  assert.ok(decision.reasonCodes.includes('unplanned-path-mutated'));
});

test('I19-INT-01 user journey: tool mutation and verification form one causal chain', () => {
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess({
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan(),
    mutations: [mutation()],
    evidenceRefs: [],
  });
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
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess({
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan(),
    mutations,
    evidenceRefs: [],
  });
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
  const codeChange = new CanonicalCodeChangeService().bind({ runId: 'run-change' }).assess({
    sequence: 3,
    actionId: 'code-change-final',
    plan: changePlan('notes/ready.txt'),
    mutations: [artifactMutation],
    evidenceRefs: [],
  });
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
