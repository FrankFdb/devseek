import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  codingSemanticDigest,
  projectCodingModelActionTaskContract,
  reconcileSettledCodingModelAction,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

const action = Object.freeze({
  actionId: 'write-value',
  tool: 'write_file',
  purpose: 'workspace-mutation',
  effects: ['workspace-mutation'],
  input: Object.freeze({ path: 'src/value.ts', content: 'export const value = 2;\n' }),
  targetPaths: ['src/value.ts'],
});

test('I20-ACT-01 user journey: a settled structural model action creates scoped change obligations', () => {
  const current = defaultContract('请吧 src/value.ts 里的值改一下并测式');
  const revision = reconcileSettledCodingModelAction({
    current,
    surface: 'cli',
    action,
    contextFiles: ['src/value.ts'],
    toolReceipts: [toolReceipt()],
    changeReceipts: [changeReceipt()],
  });

  assert.ok(revision);
  assert.equal(current.mode, 'explain');
  assert.equal(revision.taskContract.mode, 'change');
  assert.deepEqual(revision.taskContract.scope.include, ['src/value.ts']);
  assert.ok(revision.taskContract.deliverables.some(deliverable => (
    deliverable.kind === 'source-change' && deliverable.path === 'src/value.ts'
  )));
  assert.ok(revision.taskContract.acceptance.some(criterion => criterion.oracle.kind === 'verification'));
});

test('model action semantics cannot revise completion authority without an exact canonical receipt', () => {
  const current = defaultContract('Update src/value.ts');

  assert.equal(reconcileSettledCodingModelAction({
    current,
    surface: 'cli',
    action,
    toolReceipts: [],
    changeReceipts: [],
  }), undefined);
  assert.equal(reconcileSettledCodingModelAction({
    current,
    surface: 'cli',
    action,
    toolReceipts: [toolReceipt({ inputSha256: codingSemanticDigest({ path: 'other.ts' }) })],
    changeReceipts: [changeReceipt()],
  }), undefined);
});

test('an explicit review contract cannot be widened by a model workspace proposal', () => {
  const current = resolveCodingKernelTaskContract({
    prompt: 'Review src/value.ts and report findings only.',
    surface: 'cli',
    modeHint: 'review',
    targetPaths: ['src/value.ts'],
    targetPathsAuthoritative: true,
    confirmedWorkspaceMutation: false,
    verificationRequired: false,
    verificationRequirementAuthoritative: true,
  });
  const projected = projectCodingModelActionTaskContract({
    current,
    surface: 'cli',
    action,
    committedTargetPaths: ['src/value.ts'],
  });

  assert.strictEqual(projected, current);
  assert.equal(projected.mode, 'review');
});

test('unsettled action projection is descriptive and does not alter the current contract', () => {
  const current = defaultContract('MODEL_LATEST_OK CONTEST_RESULT TEST_RE latestReleaseValue');
  const projected = projectCodingModelActionTaskContract({
    current,
    surface: 'cli',
    action,
    committedTargetPaths: [],
  });

  assert.equal(current.mode, 'explain');
  assert.equal(projected.mode, 'change');
  assert.deepEqual(current.scope.include, []);
  assert.equal(Object.isFrozen(current), true);
});

function defaultContract(prompt) {
  return resolveCodingKernelTaskContract({ prompt, surface: 'cli' });
}

function toolReceipt(overrides = {}) {
  const permission = authorityReceipt();
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'run-1',
    sequence: 1,
    actionId: action.actionId,
    tool: action.tool,
    purpose: action.purpose,
    effects: action.effects,
    inputSha256: codingSemanticDigest(action.input),
    permission,
    status: 'completed',
    evidenceRefs: ['tool:write-value:completed'],
    ...overrides,
  };
}

function authorityReceipt() {
  return {
    version: CODING_TOOL_AUTHORITY_RECEIPT_VERSION,
    runId: 'run-1',
    actionId: action.actionId,
    tool: action.tool,
    purpose: action.purpose,
    effects: action.effects,
    inputSha256: codingSemanticDigest(action.input),
    requestSha256: 'authority-request-sha',
    sandboxPolicySha256: 'sandbox-policy-sha',
    decision: 'allow',
    status: 'authorized',
    reason: 'workspace-write-authorized',
    evidenceRefs: ['authority:write-value:allow'],
  };
}

function changeReceipt() {
  return {
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: 'run-1',
    sequence: 1,
    actionId: action.actionId,
    idempotencyKey: 'run-1:write-value',
    status: 'committed',
    paths: ['src/value.ts'],
    baselineRef: 'baseline:src/value.ts',
    readbackRef: 'readback:src/value.ts',
    evidenceRefs: ['mutation:src/value.ts:committed'],
  };
}
