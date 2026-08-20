import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  CanonicalReceiptAcceptanceEvidenceService,
  buildCodingKernelTaskContract,
} from '../dist/index.js';

function contract({ external = false } = {}) {
  return buildCodingKernelTaskContract({
    goal: 'Update src/value.ts and verify it',
    mode: 'change',
    include: ['src/value.ts'],
    deliverables: [
      { id: 'source', kind: 'source-change', path: 'src/value.ts' },
      { id: 'verification', kind: 'verification-result' },
    ],
    externalBoundaries: external
      ? [{ id: 'api', kind: 'api-version', subject: 'Current API', sourceRef: 'docs:api' }]
      : [],
    acceptance: [{
      id: 'readback',
      statement: 'The requested file is committed and read back.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'workspace-readback',
        verifier: 'workspace-mutation-readback',
        scope: ['workspace'],
        evidenceKinds: [
          'workspace-mutation-receipt',
          'workspace-readback',
          ...(external ? ['source-citation'] : []),
        ],
      },
      externalBoundaryRefs: external ? ['api'] : [],
    }, {
      id: 'verified',
      statement: 'Project verification passes.',
      deliverableIds: ['source', 'verification'],
      oracle: {
        kind: 'verification',
        verifier: 'project-verification',
        scope: ['workspace'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['test:user-prompt'],
  });
}

function receipt(overrides = {}) {
  return {
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: 'run-1',
    sequence: 1,
    actionId: 'write-1',
    idempotencyKey: 'run-1:write-1',
    status: 'committed',
    paths: ['src/value.ts'],
    baselineRef: 'baseline:value',
    readbackRef: 'readback:value',
    evidenceRefs: ['mutation:value'],
    ...overrides,
  };
}

test('I18-ACC-01 user journey: committed readback satisfies receipt acceptance without claiming verification', () => {
  const evidence = new CanonicalReceiptAcceptanceEvidenceService().project({
    taskContract: contract(),
    toolExecutions: [],
    mutations: [receipt()],
  });

  assert.deepEqual(evidence.map(item => [item.criterionId, item.status]), [['readback', 'passed']]);
  assert.ok(evidence[0].evidenceRefs.includes('readback:value'));
  assert.ok(Object.isFrozen(evidence));
});

test('receipt acceptance requires committed readback covering every concrete deliverable', () => {
  const service = new CanonicalReceiptAcceptanceEvidenceService();
  assert.deepEqual(service.project({
    taskContract: contract(),
    toolExecutions: [],
    mutations: [receipt({ status: 'failed', readbackRef: undefined })],
  }), []);
  assert.deepEqual(service.project({
    taskContract: contract(),
    toolExecutions: [],
    mutations: [receipt({ paths: ['src/other.ts'] })],
  }), []);
  assert.deepEqual(service.project({
    taskContract: contract(),
    toolExecutions: [],
    mutations: [receipt({ paths: ['value.ts'] })],
  }), []);
  assert.equal(service.project({
    taskContract: contract(),
    toolExecutions: [],
    mutations: [receipt({ paths: ['/workspace/src/value.ts'] })],
  }).length, 1);
});

test('receipt acceptance does not fabricate required external source evidence', () => {
  const evidence = new CanonicalReceiptAcceptanceEvidenceService().project({
    taskContract: contract({ external: true }),
    toolExecutions: [],
    mutations: [receipt()],
  });
  assert.deepEqual(evidence, []);
});

test('an exact denied external action proves authority and evidences the blocked outcome', () => {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Install a dependency',
    mode: 'change',
    deliverables: [{ id: 'dependency', kind: 'source-change', path: 'package.json' }],
    acceptance: [{
      id: 'requested-outcome',
      statement: 'The dependency is installed.',
      deliverableIds: ['dependency'],
      oracle: {
        kind: 'workspace-readback',
        verifier: 'workspace-mutation-readback',
        scope: ['workspace'],
        evidenceKinds: ['workspace-mutation-receipt', 'workspace-readback'],
      },
      externalBoundaryRefs: [],
    }, {
      id: 'authority',
      statement: 'The external effect is locally authorized.',
      deliverableIds: ['dependency'],
      oracle: {
        kind: 'authority',
        verifier: 'kernel-tool-authority',
        scope: ['external-effect'],
        evidenceKinds: ['authority-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['test:user-prompt'],
  });
  const evidence = new CanonicalReceiptAcceptanceEvidenceService().project({
    taskContract,
    toolExecutions: [externalToolReceipt()],
    mutations: [],
  });

  assert.deepEqual(evidence.map(item => [item.criterionId, item.status]), [
    ['requested-outcome', 'blocked'],
    ['authority', 'passed'],
  ]);
  assert.ok(evidence.every(item => item.evidenceRefs.includes('authority-policy:run-1:install-1:deny')));
});

test('a later committed readback takes precedence over an earlier denied workspace action', () => {
  const taskContract = contract();
  const evidence = new CanonicalReceiptAcceptanceEvidenceService().project({
    taskContract,
    toolExecutions: [externalToolReceipt()],
    mutations: [receipt()],
  });

  assert.deepEqual(evidence.map(item => [item.criterionId, item.status]), [['readback', 'passed']]);
  assert.ok(evidence[0].evidenceRefs.includes('readback:value'));
});

test('authority acceptance requires an action-bound authority receipt', () => {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Use the package registry',
    mode: 'change',
    deliverables: [{ id: 'dependency', kind: 'source-change', path: 'package.json' }],
    acceptance: [{
      id: 'authority',
      statement: 'The external effect is locally authorized.',
      deliverableIds: ['dependency'],
      oracle: {
        kind: 'authority',
        verifier: 'kernel-tool-authority',
        scope: ['external-effect'],
        evidenceKinds: ['authority-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['test:user-prompt'],
  });
  const service = new CanonicalReceiptAcceptanceEvidenceService();
  assert.deepEqual(service.project({ taskContract, toolExecutions: [], mutations: [] }), []);
  assert.deepEqual(service.project({
    taskContract,
    toolExecutions: [externalToolReceipt({
      permission: { ...externalToolReceipt().permission, actionId: 'different-action' },
    })],
    mutations: [],
  }), []);
});

function externalToolReceipt(overrides = {}) {
  const permission = {
    version: CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
    runId: 'run-1',
    actionId: 'install-1',
    tool: 'run_terminal',
    purpose: 'external-effect',
    effects: ['process', 'network', 'workspace-mutation'],
    inputSha256: 'input-sha',
    requestSha256: 'request-sha',
    sandboxPolicySha256: 'sandbox-sha',
    decision: 'deny',
    status: 'denied',
    reason: 'approval-required',
    evidenceRefs: ['authority-policy:run-1:install-1:deny'],
  };
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'run-1',
    sequence: 1,
    actionId: 'install-1',
    tool: 'run_terminal',
    purpose: 'external-effect',
    effects: ['process', 'network', 'workspace-mutation'],
    inputSha256: 'input-sha',
    permission,
    status: 'denied',
    errorCode: 'tool-authority-denied',
    evidenceRefs: permission.evidenceRefs,
    ...overrides,
  };
}
