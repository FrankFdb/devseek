import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalBuildOrchestrationService,
  CanonicalEngineeringOrientationService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  buildCodingKernelTaskContract,
  buildCodingVerificationPlan,
  projectBuildOrchestrationHostResult,
} from '../dist/index.js';

function taskContract(verifier = 'project-verification') {
  return buildCodingKernelTaskContract({
    goal: 'Update src/value.ts and verify the result',
    mode: 'change',
    include: ['src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'Applicable verification passes.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier,
        scope: ['src/value.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
}

function orientation() {
  return new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: '/repo',
    files: [{ path: 'package.json' }, { path: 'src/value.ts' }],
    manifests: { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) },
  });
}

function candidate(overrides = {}) {
  return {
    id: 'package-test',
    source: 'package.json#scripts.test',
    verifierIds: ['project-verification'],
    strength: 'test',
    priority: 10,
    scopePaths: ['workspace'],
    workspaceAccess: 'read-only',
    steps: [{
      id: 'package-test:1',
      role: 'test',
      invocation: { kind: 'process', command: 'npm', args: ['test', '--silent'] },
      cwd: '/repo',
      timeoutMs: 30_000,
      outputPolicy: 'ephemeral',
      evidenceRefs: ['manifest:package.json#scripts.test'],
    }],
    evidenceRefs: ['config:package.json'],
    ...overrides,
  };
}

function selectionSession(verifier) {
  return new CanonicalVerifierSelectionService().bind({
    runId: 'run-1',
    workspaceRoot: '/repo',
    taskContract: taskContract(verifier),
    orientation: orientation(),
  });
}

test('I18-SEL-01 user journey: acceptance selects the strongest scoped read-only verifier', () => {
  const session = selectionSession();
  const decision = session.select({
    sequence: 4,
    actionId: 'verify-4',
    scopePaths: ['src/value.ts'],
    candidates: [
      candidate({
        id: 'syntax-only',
        strength: 'static',
        priority: 1,
        steps: [{
          ...candidate().steps[0],
          id: 'syntax-only:1',
          role: 'syntax',
          invocation: { kind: 'process', command: 'node', args: ['--check', 'src/value.js'] },
        }],
      }),
      candidate(),
    ],
    evidenceRefs: ['mutation:committed'],
  });

  assert.equal(decision.status, 'selected');
  assert.equal(decision.acceptance[0].candidateId, 'package-test');
  assert.deepEqual(decision.steps[0].acceptanceIds, ['verified']);
  assert.equal(decision.steps[0].workspaceAccess, 'read-only');
  assert.equal(session.select({
    sequence: 4,
    actionId: 'verify-4',
    scopePaths: ['src/value.ts'],
    candidates: [candidate({ id: 'syntax-only', strength: 'static', priority: 1, steps: [{
      ...candidate().steps[0],
      id: 'syntax-only:1',
      role: 'syntax',
      invocation: { kind: 'process', command: 'node', args: ['--check', 'src/value.js'] },
    }] }), candidate()],
    evidenceRefs: ['mutation:committed'],
  }), decision);
});

test('verifier selection fails closed for missing, mutable, drifted, or out-of-scope capabilities', () => {
  const unavailable = selectionSession('required-specialist').select({
    sequence: 1,
    actionId: 'missing',
    scopePaths: ['src/value.ts'],
    candidates: [candidate()],
    evidenceRefs: [],
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.steps, []);

  assert.throws(() => selectionSession().select({
    sequence: 1,
    actionId: 'mutable',
    scopePaths: ['src/value.ts'],
    candidates: [candidate({ workspaceAccess: 'read-write' })],
    evidenceRefs: [],
  }), /candidate-not-read-only/);

  const session = selectionSession();
  session.select({
    sequence: 1,
    actionId: 'stable',
    scopePaths: ['src/value.ts'],
    candidates: [candidate()],
    evidenceRefs: [],
  });
  assert.throws(() => session.select({
    sequence: 1,
    actionId: 'stable',
    scopePaths: ['src/other.ts'],
    candidates: [candidate()],
    evidenceRefs: [],
  }), /conflicting-action-identity/);
});

test('verifier selection admits only managed workspace-local process references', () => {
  const managed = candidate({
    steps: [{
      ...candidate().steps[0],
      invocation: { kind: 'process', command: './.devseek/bin/check', args: [] },
    }],
  });
  assert.equal(selectionSession().select({
    sequence: 1,
    actionId: 'managed-local',
    scopePaths: ['src/value.ts'],
    candidates: [managed],
    evidenceRefs: [],
  }).status, 'selected');

  for (const command of ['./scripts/check', './.devseek/bin/../check', '.devseek/bin//check', '.devseek\\bin\\check']) {
    assert.throws(() => selectionSession().select({
      sequence: 1,
      actionId: `rejected-${command}`,
      scopePaths: ['src/value.ts'],
      candidates: [candidate({
        steps: [{ ...candidate().steps[0], invocation: { kind: 'process', command, args: [] } }],
      })],
      evidenceRefs: [],
    }), /invalid-verifier-command/);
  }
});

test('verifier selection keeps POSIX workspace containment case-sensitive', () => {
  assert.throws(() => selectionSession().select({
    sequence: 1,
    actionId: 'case-distinct-sibling',
    scopePaths: ['src/value.ts'],
    candidates: [candidate({
      steps: [{ ...candidate().steps[0], cwd: '/Repo' }],
    })],
    evidenceRefs: [],
  }), /candidate-step-cwd-outside-workspace/);
});

test('build orchestration executes in order, fails fast, and projects independent checks', async () => {
  const selected = selectionSession().select({
    sequence: 2,
    actionId: 'verify-2',
    scopePaths: ['src/value.ts'],
    candidates: [candidate({
      steps: [
        { ...candidate().steps[0], id: 'build', role: 'build' },
        { ...candidate().steps[0], id: 'test', role: 'test' },
      ],
    })],
    evidenceRefs: ['mutation:committed'],
  });
  const calls = [];
  const receipt = await new CanonicalBuildOrchestrationService().bind({ runId: 'run-1' }).execute(selected, {
    async execute(step) {
      calls.push(step.id);
      return {
        stepId: step.id,
        status: step.id === 'build' ? 'failed' : 'passed',
        summary: `${step.id} settled`,
        exitCode: step.id === 'build' ? 1 : 0,
        workspaceMutationPaths: [],
        evidenceRefs: [`process:${step.id}`],
      };
    },
  });

  assert.equal(receipt.status, 'failed');
  assert.deepEqual(calls, ['build']);
  const hostResult = projectBuildOrchestrationHostResult(receipt);
  assert.equal(hostResult.checks[0].status, 'failed');
  assert.deepEqual(hostResult.checks[0].acceptanceIds, ['verified']);
});

test('I18-BLD-01 user journey: source-mutating verifier cannot produce a passing receipt', async () => {
  const selected = selectionSession().select({
    sequence: 3,
    actionId: 'verify-3',
    scopePaths: ['src/value.ts'],
    candidates: [candidate()],
    evidenceRefs: [],
  });
  const receipt = await new CanonicalBuildOrchestrationService().bind({ runId: 'run-1' }).execute(selected, {
    async execute(step) {
      return {
        stepId: step.id,
        status: 'passed',
        summary: 'command exited zero after rewriting source',
        exitCode: 0,
        workspaceMutationPaths: ['src/value.ts'],
        evidenceRefs: ['process:exit-0'],
      };
    },
  });
  assert.equal(receipt.status, 'indeterminate');
  assert.equal(receipt.errorCode, 'verification-mutated-user-workspace');

  const verification = new CanonicalVerificationService();
  const plan = buildCodingVerificationPlan({
    runId: 'run-1',
    sequence: 3,
    actionId: 'verify-3',
    idempotencyKey: 'run-1:verify-3',
    scopePaths: ['src/value.ts'],
    acceptance: [{ id: 'verified', statement: 'Applicable verification passes.' }],
    payload: { selection: selected },
    evidenceRefs: receipt.evidenceRefs,
  });
  const outcome = await verification.verify(plan, {
    async verify() { return projectBuildOrchestrationHostResult(receipt); },
  });
  assert.equal(outcome.receipt.status, 'indeterminate');
});
