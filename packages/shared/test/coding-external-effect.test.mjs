import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalExternalEffectService,
  CanonicalTaskContractService,
  CanonicalToolAuthorityService,
  codingExternalEffectOperationSha256,
} from '../dist/index.js';

function contract(mode = 'change') {
  return new CanonicalTaskContractService().build({
    goal: `${mode} the project`,
    mode,
    deliverables: [{
      id: mode === 'explain' || mode === 'review' ? 'report' : 'change',
      kind: mode === 'explain' || mode === 'review' ? 'report' : 'source-change',
    }],
    acceptance: [{ id: 'done', statement: 'The operation is settled.' }],
    provenanceRefs: ['test:user'],
  });
}

function authority(runId, mode = 'change') {
  return new CanonicalToolAuthorityService().bind({
    runId,
    surface: 'headless',
    workspaceRoot: '/workspace',
    taskContract: contract(mode),
  });
}

test('external effect service executes observational verification once with a canonical receipt', async () => {
  let calls = 0;
  const effects = new CanonicalExternalEffectService().bind({
    runId: 'run-verify',
    authority: authority('run-verify'),
  });
  const input = {
    sequence: 1,
    actionId: 'verify-1',
    tool: 'run_terminal',
    purpose: 'verify',
    nature: 'observational',
    effects: ['process'],
    input: { command: 'npm test' },
    risk: 'medium',
  };
  const host = {
    async execute() {
      calls++;
      return { status: 'committed', result: 'ok', evidenceRefs: ['terminal:exit-0'] };
    },
  };
  const first = await effects.execute(input, host);
  const replay = await effects.execute(input, host);

  assert.equal(calls, 1);
  assert.equal(first.receipt.status, 'committed');
  assert.equal(first.receipt.toolReceipt.status, 'completed');
  assert.equal(first.receipt.result, 'ok');
  assert.equal(replay.replayed, true);
  assert.equal(effects.receipts().length, 1);
});

test('external effect service never executes an unconfirmed release', async () => {
  let calls = 0;
  const effects = new CanonicalExternalEffectService().bind({
    runId: 'run-release-denied',
    authority: authority('run-release-denied', 'release'),
  });
  const outcome = await effects.execute({
    sequence: 1,
    actionId: 'release-1',
    tool: 'publish',
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['release'],
    input: { channel: 'stable' },
    risk: 'high',
  }, {
    async reconcile() {
      return { status: 'not-started', evidenceRefs: ['release:not-started'] };
    },
    async execute() {
      calls++;
      return { status: 'committed', evidenceRefs: ['release:committed'] };
    },
  });

  assert.equal(calls, 0);
  assert.equal(outcome.receipt.status, 'denied');
  assert.equal(outcome.receipt.permission.decision, 'require-confirmation');
});

test('mutating external effects require reconciliation and reuse a proven commit', async () => {
  let missingReconciliationCalls = 0;
  const session = new CanonicalExternalEffectService().bind({
    runId: 'run-release-confirmed',
    authority: authority('run-release-confirmed', 'release'),
  });
  const confirmed = {
    decision: 'require-confirmation',
    reason: 'user-confirmed',
    confirmationRef: 'confirm-release',
    evidenceRefs: ['ui:confirmed'],
  };
  const indeterminate = await session.execute({
    sequence: 1,
    actionId: 'release-no-reconcile',
    tool: 'publish',
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['release'],
    input: { channel: 'stable' },
    surfaceConstraint: confirmed,
  }, {
    async execute() {
      missingReconciliationCalls++;
      return { status: 'committed', evidenceRefs: ['must-not-run'] };
    },
  });
  let executeCalls = 0;
  const reconciled = await session.execute({
    sequence: 2,
    actionId: 'release-reconciled',
    tool: 'publish',
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['release'],
    input: { channel: 'stable' },
    surfaceConstraint: confirmed,
  }, {
    async reconcile() {
      return {
        status: 'committed',
        result: { releaseId: 'r-42' },
        evidenceRefs: ['release:r-42:exists'],
      };
    },
    async execute() {
      executeCalls++;
      return { status: 'committed', evidenceRefs: ['must-not-run'] };
    },
  });

  assert.equal(missingReconciliationCalls, 0);
  assert.equal(indeterminate.receipt.status, 'indeterminate');
  assert.equal(indeterminate.receipt.errorCode, 'external-effect-reconciliation-unavailable');
  assert.equal(executeCalls, 0);
  assert.equal(reconciled.receipt.status, 'committed');
  assert.deepEqual(reconciled.receipt.result, { releaseId: 'r-42' });
});

test('external effect receipts settle resume units and completed units skip the host', async () => {
  const settled = [];
  const operation = {
    tool: 'run_terminal',
    purpose: 'verify',
    nature: 'observational',
    effects: ['process'],
    input: { command: 'npm test' },
  };
  const executableUnit = {
    id: 'verify-unit',
    effectClass: 'verification',
    operationSha256: codingExternalEffectOperationSha256(operation),
    idempotencyKey: 'resume-key',
    disposition: 'execute',
  };
  const resume = {
    plan: { units: [executableUnit] },
    settle(input) {
      settled.push(input);
      return input;
    },
    receipts() { return []; },
  };
  const effects = new CanonicalExternalEffectService().bind({
    runId: 'run-resume-effect',
    authority: authority('run-resume-effect'),
    resume,
  });
  await effects.execute({
    sequence: 1,
    actionId: 'verify-resumed',
    ...operation,
    resumeUnitId: 'verify-unit',
  }, {
    async execute() {
      return { status: 'committed', evidenceRefs: ['verification:passed'] };
    },
  });
  assert.equal(settled.length, 1);
  assert.equal(settled[0].unitId, 'verify-unit');
  assert.equal(settled[0].status, 'completed');
  assert.equal(settled[0].evidenceRefs.includes('verification:passed'), true);

  let skippedHostCalls = 0;
  const skippedResume = {
    plan: { units: [{ ...executableUnit, disposition: 'skip-completed' }] },
    settle() { throw new Error('skipped unit must not settle again'); },
    receipts() {
      return [{
        idempotencyKey: 'resume-key',
        status: 'completed',
        receiptSha256: 'a'.repeat(64),
        evidenceRefs: ['prior:completed'],
      }];
    },
  };
  const skippedAuthority = authority('run-resume-skip');
  const skippedEffects = new CanonicalExternalEffectService().bind({
    runId: 'run-resume-skip',
    authority: skippedAuthority,
    resume: skippedResume,
  });
  const skipped = await skippedEffects.execute({
    sequence: 1,
    actionId: 'verify-skip',
    ...operation,
    resumeUnitId: 'verify-unit',
  }, {
    async execute() {
      skippedHostCalls++;
      return { status: 'committed', evidenceRefs: ['must-not-run'] };
    },
  });
  assert.equal(skippedHostCalls, 0);
  assert.equal(skipped.replayed, true);
  assert.equal(skipped.receipt.settlement, 'resume-replay');
  assert.equal(skipped.receipt.resumeReceiptSha256, 'a'.repeat(64));
  assert.equal(skipped.receipt.evidenceRefs.includes('prior:completed'), true);
  assert.equal(skippedAuthority.authorizations().length, 0);
  assert.equal('permission' in skipped.receipt, false);
  assert.equal('toolReceipt' in skipped.receipt, false);
});

test('external effect resume rejects a completed receipt for substituted tool input', async () => {
  const original = {
    tool: 'mcp__issues__comment',
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['network'],
    input: { issueId: 'DEVSEEK-12', body: 'approved body' },
  };
  const resume = {
    plan: {
      units: [{
        id: 'remote-comment',
        effectClass: 'external-effect',
        operationSha256: codingExternalEffectOperationSha256(original),
        idempotencyKey: 'resume-key',
        disposition: 'skip-completed',
      }],
    },
    settle() { throw new Error('substituted unit must not settle'); },
    receipts() {
      return [{
        idempotencyKey: 'resume-key',
        status: 'completed',
        receiptSha256: 'b'.repeat(64),
        evidenceRefs: ['prior:approved-comment'],
      }];
    },
  };
  const effects = new CanonicalExternalEffectService().bind({
    runId: 'run-resume-substitution',
    authority: authority('run-resume-substitution'),
    resume,
  });
  let hostCalls = 0;

  await assert.rejects(effects.execute({
    sequence: 1,
    actionId: 'remote-comment',
    ...original,
    input: { ...original.input, body: 'substituted body' },
    resumeUnitId: 'remote-comment',
  }, {
    async reconcile() {
      hostCalls++;
      return { status: 'not-started', evidenceRefs: ['unreachable'] };
    },
    async execute() {
      hostCalls++;
      return { status: 'committed', evidenceRefs: ['unreachable'] };
    },
  }), /resume-operation-mismatch/u);
  assert.equal(hostCalls, 0);
});

test('external effect service rejects purpose and mutation-nature disguises', () => {
  const effects = new CanonicalExternalEffectService().bind({
    runId: 'run-purpose-nature',
    authority: authority('run-purpose-nature'),
  });
  const host = {
    async execute() {
      throw new Error('mismatched effect must not execute');
    },
  };

  assert.throws(() => effects.execute({
    sequence: 1,
    actionId: 'observe-disguised-mutation',
    tool: 'mcp__issues__comment',
    purpose: 'observe',
    nature: 'mutating',
    effects: ['network'],
    input: { body: 'unexpected' },
  }, host), /purpose-nature-mismatch/u);
  assert.throws(() => effects.execute({
    sequence: 2,
    actionId: 'external-disguised-observation',
    tool: 'mcp__issues__comment',
    purpose: 'external-effect',
    nature: 'observational',
    effects: ['network'],
    input: { body: 'unexpected' },
  }, host), /purpose-nature-mismatch/u);
});
