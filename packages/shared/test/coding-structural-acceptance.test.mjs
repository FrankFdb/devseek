import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  CanonicalStructuralAcceptanceEvidenceService,
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

test('I18-ACC-01 user journey: committed readback satisfies structural acceptance without claiming verification', () => {
  const evidence = new CanonicalStructuralAcceptanceEvidenceService().project({
    taskContract: contract(),
    mutations: [receipt()],
  });

  assert.deepEqual(evidence.map(item => [item.criterionId, item.status]), [['readback', 'passed']]);
  assert.ok(evidence[0].evidenceRefs.includes('readback:value'));
  assert.ok(Object.isFrozen(evidence));
});

test('structural acceptance requires committed readback covering every concrete deliverable', () => {
  const service = new CanonicalStructuralAcceptanceEvidenceService();
  assert.deepEqual(service.project({
    taskContract: contract(),
    mutations: [receipt({ status: 'failed', readbackRef: undefined })],
  }), []);
  assert.deepEqual(service.project({
    taskContract: contract(),
    mutations: [receipt({ paths: ['src/other.ts'] })],
  }), []);
  assert.deepEqual(service.project({
    taskContract: contract(),
    mutations: [receipt({ paths: ['value.ts'] })],
  }), []);
  assert.equal(service.project({
    taskContract: contract(),
    mutations: [receipt({ paths: ['/workspace/src/value.ts'] })],
  }).length, 1);
});

test('structural acceptance does not fabricate required external source evidence', () => {
  const evidence = new CanonicalStructuralAcceptanceEvidenceService().project({
    taskContract: contract({ external: true }),
    mutations: [receipt()],
  });
  assert.deepEqual(evidence, []);
});
