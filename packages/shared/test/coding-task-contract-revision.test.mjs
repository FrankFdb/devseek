import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  CanonicalTaskContractRevisionService,
  CanonicalTaskContractService,
  CanonicalToolAuthorityService,
  InMemoryCodingOperationJournal,
  buildCodingVerificationPlan,
  createFixtureCodingKernelEnvironment,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';
import { commitCanonicalWorkspaceChange } from './support/canonical-code-change-fixture.mjs';

function scopedContract(target) {
  return new CanonicalTaskContractService().build({
    goal: `Create only ${target}`,
    mode: 'change',
    include: [target],
    constraints: ['no-other-files'],
    deliverables: [{ id: 'source', kind: 'source-change', path: target }],
    acceptance: [{
      id: 'readback',
      statement: `The requested ${target} content is read back.`,
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'project-test-runner',
        scope: [target],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
}

async function passVerification(input, taskContract, actionId, sequence) {
  const acceptance = taskContract.acceptance
    .filter(criterion => criterion.oracle.kind === 'verification')
    .map(({ id, statement }) => ({ id, statement }));
  return input.verification.verify(buildCodingVerificationPlan({
    runId: input.runId,
    sequence,
    actionId,
    idempotencyKey: `${input.runId}:${actionId}`,
    scopePaths: [...taskContract.scope.include],
    acceptance,
    payload: { command: 'npm test' },
    evidenceRefs: [`verification-contract:${actionId}`],
  }), {
    async verify() {
      return {
        verifier: 'project-test-runner',
        checks: [{
          checkId: actionId,
          status: 'passed',
          acceptanceIds: acceptance.map(criterion => criterion.id),
          summary: `${actionId} passed`,
          exitCode: 0,
          evidenceRefs: [`verification:${actionId}:passed`],
        }],
        evidenceRefs: [],
      };
    },
  });
}

function completionEvidence() {
  return {
    reviewRequired: false,
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: [],
  };
}

test('TaskContractRevision: revisions are ordered, immutable, and idempotent', () => {
  const initial = scopedContract('src/alpha.ts');
  const latest = scopedContract('src/beta.ts');
  const session = new CanonicalTaskContractRevisionService().bind({ taskContract: initial });

  const receipt = session.revise({
    revisionId: 'rev-2',
    taskContract: latest,
    evidenceRefs: ['intent-revision:rev-2'],
  });
  const duplicate = session.revise({
    revisionId: 'rev-2',
    taskContract: latest,
    evidenceRefs: ['intent-revision:rev-2'],
  });

  assert.equal(receipt.sequence, 1);
  assert.equal(duplicate.receiptSha256, receipt.receiptSha256);
  assert.deepEqual(session.current().scope.include, ['src/beta.ts']);
  assert.deepEqual(session.revisions(), [receipt]);
  assert.throws(() => session.current().scope.include.push('src/other.ts'), TypeError);
  assert.throws(() => session.revise({
    revisionId: 'rev-2',
    taskContract: scopedContract('src/conflict.ts'),
    evidenceRefs: ['intent-revision:rev-2'],
  }), /conflicting-revision-id/u);
});

test('TaskContractRevision: structured latest targets cannot resurrect superseded prompt paths', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: '更正，不再创建 alpha.txt，改为只创建 beta.txt。',
    surface: 'vscode',
    modeHint: 'change',
    confirmedWorkspaceMutation: true,
    targetPaths: ['beta.txt'],
    targetPathsAuthoritative: true,
    excludedTargetPaths: ['alpha.txt'],
    strictTargetScope: true,
  });

  assert.deepEqual(contract.scope.include, ['beta.txt']);
  assert.deepEqual(contract.scope.exclude, ['alpha.txt']);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change').map(item => item.path),
    ['beta.txt'],
  );
});

test('TaskContractRevision: a queued steer invalidates unexecuted authority from the old contract', () => {
  const taskContractRevision = new CanonicalTaskContractRevisionService().bind({
    taskContract: scopedContract('src/alpha.ts'),
  });
  const authority = new CanonicalToolAuthorityService().bind({
    runId: 'stale-authority-after-steer',
    surface: 'headless',
    workspaceRoot: '/workspace',
    taskContract: taskContractRevision.current(),
    taskContractSource: taskContractRevision,
    authorityStrategy: 'model-led',
  });
  const request = {
    actionId: 'write-alpha-before-steer',
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: { path: 'src/alpha.ts', content: 'alpha' },
    targetPaths: ['src/alpha.ts'],
    risk: 'low',
  };
  const issued = authority.authorize(request);
  assert.equal(issued.receipt.status, 'authorized');

  taskContractRevision.revise({
    revisionId: 'rev-2',
    taskContract: scopedContract('src/beta.ts'),
    evidenceRefs: ['intent-revision:rev-2'],
  });

  assert.throws(() => authority.verifyReceipt(issued.receipt, {
    runId: 'stale-authority-after-steer',
    actionId: request.actionId,
    tool: request.tool,
    purpose: request.purpose,
    effects: request.effects,
    input: request.input,
  }), /stale-task-contract-receipt/u);
  assert.throws(() => authority.authorize(request), /stale-task-contract-action/u);
});

test('TaskContractRevision: model-led Kernel authorizes and settles against the latest steer scope', async () => {
  const initial = scopedContract('src/alpha.ts');
  const latest = scopedContract('src/beta.ts');
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      await passVerification(input, initial, 'verify-alpha-before-steer', 1);
      input.taskContractRevision.revise({
        revisionId: 'rev-2',
        taskContract: latest,
        evidenceRefs: ['intent-revision:rev-2'],
      });
      const stale = input.toolAuthority.authorize({
        actionId: 'stale-alpha-after-steer',
        tool: 'write_file',
        purpose: 'workspace-mutation',
        effects: ['workspace-mutation'],
        input: { path: 'src/alpha.ts', content: 'STALE' },
        targetPaths: ['src/alpha.ts'],
        risk: 'low',
      });
      assert.equal(stale.receipt.status, 'denied');
      assert.equal(stale.permission.reason, 'model-led-target-outside-explicit-scope:src/alpha.ts');

      const committed = await commitCanonicalWorkspaceChange(input, {
        paths: ['src/beta.ts'],
        marker: 'latest-steer-target',
      });
      assert.equal(committed.authorization.receipt.status, 'authorized');
      await passVerification(input, latest, 'verify-beta-after-steer', 2);
      return {
        result: { changedPaths: ['src/beta.ts'] },
        completionEvidence: completionEvidence(),
      };
    },
  });

  const output = await kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'vscode',
    runId: 'task-contract-steer-latest-scope',
    userPrompt: 'Create only src/alpha.ts',
    workspaceRoot: '/workspace',
    taskContract: initial,
    toolAuthorityStrategy: 'model-led',
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment('/workspace'),
    runtimeContext: {},
  });

  assert.equal(output.status, 'completed');
  assert.deepEqual(output.taskContract.scope.include, ['src/beta.ts']);
  assert.equal(output.taskContractRevisions.length, 1);
  assert.equal(output.taskContractRevisions[0].revisionId, 'rev-2');
  assert.equal(output.changePlanRevisionDecisions.some(item => item.status === 'revised'), true);
  assert.deepEqual(output.verificationReceipts.map(item => item.actionId), ['verify-beta-after-steer']);
  assert.deepEqual(output.result.changedPaths, ['src/beta.ts']);
});
