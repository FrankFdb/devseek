import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CHECKPOINT_VERSION,
  CODING_MEMORY_POLICY_VERSION,
  CanonicalCheckpointService,
  CanonicalContextGraphService,
  CanonicalMemoryPolicyService,
  CanonicalTaskContractService,
  codingSemanticDigest,
  renderCodingMemoryContext,
} from '../dist/index.js';

function taskContract(goal = 'Implement durable resume') {
  return new CanonicalTaskContractService().build({
    goal,
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/resume.ts' }],
    acceptance: [{
      id: 'tests',
      statement: 'Interrupted work resumes without replay.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'resume-test-suite',
        scope: ['src/resume.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
}

function contextGraph(contract = taskContract(), files = [{ path: 'src/resume.ts', contentSample: 'export {};' }]) {
  return new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: contract.goal,
    taskContract: contract,
    seed: { files },
  });
}

function memory(overrides = {}) {
  return {
    memoryId: 'memory-1',
    content: 'The test command is npm test.',
    scope: 'repository',
    classification: 'workspace',
    sourceKind: 'agent',
    status: 'active',
    approvalState: 'approved',
    externalContent: false,
    trusted: true,
    workspaceRoot: '/repo',
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

test('memory policy keeps memory below instruction authority and blocks external elevation', () => {
  const policy = new CanonicalMemoryPolicyService();
  const decision = policy.assessWrite({
    workspaceRoot: '/repo',
    now: 300,
    candidate: memory({
      classification: 'instruction',
      sourceKind: 'external',
      externalContent: true,
      trusted: false,
    }),
  });

  assert.equal(decision.version, CODING_MEMORY_POLICY_VERSION);
  assert.equal(decision.allowed, false);
  assert.equal(decision.effectiveAuthority, 'memory');
  assert.deepEqual(decision.reasonCodes, ['external-authority-elevation']);

  const sensitive = policy.assessWrite({
    workspaceRoot: '/repo',
    now: 300,
    candidate: memory(),
    sensitiveMatches: ['github-token'],
  });
  assert.equal(sensitive.allowed, false);
  assert.deepEqual(sensitive.reasonCodes, ['sensitive-content']);
});

test('memory context selection rejects stale scope and approval state under a bounded budget', () => {
  const decision = new CanonicalMemoryPolicyService().selectContext({
    workspaceRoot: '/repo',
    now: 500,
    maxEntries: 2,
    maxChars: 60,
    candidates: [
      memory({ memoryId: 'user', sourceKind: 'user', scope: 'user', approvalState: 'not-required' }),
      memory({ memoryId: 'expired', expiresAt: 400 }),
      memory({ memoryId: 'wrong-workspace', workspaceRoot: '/other' }),
      memory({ memoryId: 'unapproved', approvalState: 'required' }),
      memory({ memoryId: 'budget', content: 'x'.repeat(61) }),
    ],
  });

  assert.deepEqual(decision.selected.map(entry => entry.memoryId), ['user']);
  assert.equal(decision.selected[0].effectiveAuthority, 'memory');
  assert.deepEqual(
    Object.fromEntries(decision.rejected.map(item => [item.memoryId, item.reasonCodes])),
    {
      expired: ['expired'],
      'wrong-workspace': ['workspace-mismatch'],
      unapproved: ['approval-required'],
      budget: ['budget-exhausted'],
    },
  );
  assert.match(decision.decisionSha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify({ digest: decision.decisionSha256 }).includes('npm test'), false);
});

test('memory prompt projection consumes the sealed decision and rejects content substitution', () => {
  const decision = new CanonicalMemoryPolicyService().selectContext({
    workspaceRoot: '/repo',
    now: 500,
    candidates: [memory({ memoryId: 'selected', sourceKind: 'user', scope: 'user', approvalState: 'not-required' })],
  });

  const context = renderCodingMemoryContext(decision);
  assert.match(context, new RegExp(`decision=${decision.decisionSha256}`, 'u'));
  assert.match(context, /"effectiveAuthority":"memory"/u);
  assert.match(context, /"content":"The test command is npm test\."/u);
  assert.throws(
    () => renderCodingMemoryContext({
      ...decision,
      selected: [{ ...decision.selected[0], content: decision.selected[0].content.replace('npm test', 'rm -rf /') }],
    }),
    /coding-memory-policy:invalid-context-entry/u,
  );
  assert.throws(
    () => renderCodingMemoryContext({ ...decision, selected: [null] }),
    /coding-memory-policy:invalid-context-entry/u,
  );
});

test('checkpoint seals task, context, pending work, and restore revalidation facts', () => {
  const contract = taskContract();
  const graph = contextGraph(contract);
  const service = new CanonicalCheckpointService();
  const session = service.bind({
    runId: 'run-1',
    surface: 'headless',
    workspaceRoot: '/repo/',
    taskContract: contract,
    contextGraph: graph,
    memoryPolicySha256: '1'.repeat(64),
  });
  const checkpoint = session.create({
    epoch: 1,
    completedUnitCount: 2,
    pendingUnits: [
      { id: 'verify', description: 'Run focused verification', action: 'verify', target: 'npm test' },
    ],
    evidenceRefs: ['mutation:1'],
    reason: 'paused',
    createdAt: 1_000,
  });

  assert.equal(checkpoint.version, CODING_CHECKPOINT_VERSION);
  assert.equal(checkpoint.completedUnitCount, 2);
  assert.match(checkpoint.sealSha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => checkpoint.pendingUnits.push({}), TypeError);

  const changedGraph = contextGraph(contract, [{
    path: 'src/resume.ts', contentSample: 'export const resumed = true;',
  }]);
  const restored = service.restore(checkpoint, {
    surface: 'headless',
    workspaceRoot: '/repo',
    taskContract: contract,
    contextGraph: changedGraph,
    memoryPolicySha256: '2'.repeat(64),
  });
  assert.equal(restored.contextChanged, true);
  assert.equal(restored.memoryPolicyChanged, true);
  assert.equal(restored.requiresRevalidation, true);
  assert.deepEqual(restored.pendingUnits.map(unit => unit.id), ['verify']);
});

test('checkpoint rejects tampering, surface or workspace drift, and task substitution', () => {
  const contract = taskContract();
  const graph = contextGraph(contract);
  const service = new CanonicalCheckpointService();
  const checkpoint = service.bind({
    runId: 'run-1', surface: 'vscode', workspaceRoot: '/repo', taskContract: contract, contextGraph: graph,
  }).create({
    epoch: 1,
    completedUnitCount: 0,
    pendingUnits: [{ id: 'edit', description: 'Apply the requested edit' }],
    reason: 'progress',
    createdAt: 1_000,
  });

  assert.throws(
    () => service.snapshot({ ...checkpoint, completedUnitCount: 1 }),
    /coding-checkpoint:(?:checkpoint-id|state-sha256)-mismatch/u,
  );
  assert.throws(
    () => service.restore(checkpoint, {
      surface: 'vscode', workspaceRoot: '/other', taskContract: contract, contextGraph: graph,
    }),
    /coding-checkpoint:workspace-mismatch/u,
  );
  assert.throws(
    () => service.restore(checkpoint, {
      surface: 'headless', workspaceRoot: '/repo', taskContract: contract, contextGraph: graph,
    }),
    /coding-checkpoint:surface-mismatch/u,
  );
  assert.throws(
    () => service.restore(checkpoint, {
      surface: 'vscode', workspaceRoot: '/repo',
      taskContract: taskContract('Delete the repository'), contextGraph: graph,
    }),
    /coding-checkpoint:task-contract-mismatch/u,
  );
  assert.equal(codingSemanticDigest({ b: 2, a: 1 }), codingSemanticDigest({ a: 1, b: 2 }));
});
