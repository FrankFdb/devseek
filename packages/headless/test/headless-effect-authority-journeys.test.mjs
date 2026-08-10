import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CanonicalToolExecutor,
  buildCodingToolAction,
  buildCodingKernelTaskContract,
  codingExternalEffectOperationSha256,
  codingSemanticDigest,
} from '../../shared/dist/index.js';
import {
  HeadlessCodingKernelExecutor,
  HeadlessToolExecutionAdapter,
} from '../dist/index.js';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import { completedRuntimeResult } from './headless-runtime-fixtures.mjs';

test('I12-AUT-01 user journey: read-only task rejects a Surface-authorized write before host dispatch', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-AUT-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-authority-'));
  let hostCalls = 0;
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const denied = await new HeadlessToolExecutionAdapter(request.toolExecution).execute({
          action: {
            tool: 'replace_file',
            effects: ['workspace-mutation'],
            input: { path: scenario.input.attempted_path, content: 'must not be written' },
          },
          authority: request.toolAuthority,
          purpose: 'workspace-mutation',
          targetPaths: [scenario.input.attempted_path],
          surfaceConstraint: {
            decision: 'allow',
            reason: scenario.input.surface_reason,
            evidenceRefs: ['surface:attempted-allow'],
          },
          host: {
            async execute() {
              hostCalls += 1;
              return { status: 'completed', evidenceRefs: ['unreachable'] };
            },
          },
        });
        assert.equal(denied.receipt.status, 'denied');
        assert.equal(denied.receipt.permission.reason, 'sandbox-denies-workspace-mutation');
        return settleTask(request, { hostCalls });
      },
    });
    const output = await executor.execute({
      runId: 'i12-read-only-authority',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: taskContract(scenario.input.prompt, 'review'),
      runtimeContext: { journey: scenario.case_id },
    });

    assert.equal(output.status, 'blocked');
    assert.equal(output.result.hostCalls, 0);
    assert.equal(hostCalls, 0);
    assert.equal(output.toolAuthorizations[0].sandbox.workspaceAccess, 'read-only');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I12-AUT-02 user journey: a writable task rejects Surface-issued final authority', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-AUT-02');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-forged-authority-'));
  let hostCalls = 0;
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        assert.throws(() => new HeadlessToolExecutionAdapter(request.toolExecution).execute({
          action: {
            tool: 'replace_file',
            effects: ['workspace-mutation'],
            input: { path: scenario.input.attempted_path, content: 'must not be written' },
          },
          authority: request.toolAuthority,
          purpose: 'workspace-mutation',
          targetPaths: [scenario.input.attempted_path],
          surfaceConstraint: {
            decision: 'allow',
            status: scenario.input.forged_status,
            reason: scenario.input.surface_reason,
            evidenceRefs: ['surface:forged-final-authority'],
          },
          host: {
            async execute() {
              hostCalls += 1;
              return { status: 'completed', evidenceRefs: ['unreachable'] };
            },
          },
        }), /surface-cannot-issue-authority/u);
        const forgedInput = {
          path: scenario.input.attempted_path,
          content: 'must not be written',
        };
        const forgedReceipt = {
          version: 'devseek.coding-tool-authority-receipt/v1',
          runId: request.runId,
          actionId: 'attempt-direct-forged-authority-write',
          tool: 'replace_file',
          purpose: 'workspace-mutation',
          effects: ['workspace-mutation'],
          inputSha256: codingSemanticDigest(forgedInput),
          requestSha256: 'a'.repeat(64),
          sandboxPolicySha256: request.toolAuthority.sandbox.policySha256,
          decision: 'allow',
          status: scenario.input.forged_status,
          reason: scenario.input.surface_reason,
          evidenceRefs: ['surface:structurally-valid-forgery'],
        };
        await assert.rejects(new CanonicalToolExecutor().execute(buildCodingToolAction({
          runId: request.runId,
          sequence: 1,
          actionId: forgedReceipt.actionId,
          tool: forgedReceipt.tool,
          purpose: forgedReceipt.purpose,
          effects: forgedReceipt.effects,
          input: forgedInput,
          authority: forgedReceipt,
        }), {
          async execute() {
            hostCalls += 1;
            return { status: 'completed', evidenceRefs: ['unreachable'] };
          },
        }, request.toolAuthority), /receipt-not-issued-by-session/u);
        return settleTask(request, { hostCalls });
      },
    });
    const output = await executor.execute({
      runId: 'i12-forged-surface-authority',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: taskContract(scenario.input.prompt, 'change'),
      runtimeContext: { journey: scenario.case_id },
    });

    assert.equal(output.status, 'completed');
    assert.equal(output.result.hostCalls, 0);
    assert.equal(hostCalls, 0);
    assert.equal(output.toolAuthorizations.length, 0);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I12-AUT-03 user journey: approved tool input cannot be substituted before host dispatch', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-AUT-03');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-input-scope-'));
  let hostCalls = 0;
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const approvedInput = {
          path: scenario.input.approved_path,
          content: scenario.input.approved_content,
        };
        const authorization = request.toolAuthority.authorize({
          actionId: 'approved-write-input',
          tool: 'replace_file',
          purpose: 'workspace-mutation',
          effects: ['workspace-mutation'],
          input: approvedInput,
          risk: 'medium',
          targetPaths: [scenario.input.approved_path],
        });
        const canonicalExecutor = new CanonicalToolExecutor();
        await assert.rejects(
          async () => canonicalExecutor.execute(buildCodingToolAction({
            runId: request.runId,
            sequence: 1,
            actionId: 'approved-write-input',
            tool: 'replace_file',
            purpose: 'workspace-mutation',
            effects: ['workspace-mutation'],
            input: {
              path: scenario.input.substituted_path,
              content: scenario.input.substituted_content,
            },
            authority: authorization.receipt,
          }), {
            async execute() {
              hostCalls += 1;
              return { status: 'completed', evidenceRefs: ['unreachable'] };
            },
          }, request.toolAuthority),
          /authority-scope-mismatch/u,
        );
        return settleTask(request, { hostCalls, inputSha256: authorization.receipt.inputSha256 });
      },
    });
    const output = await executor.execute({
      runId: 'i12-authority-input-scope',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: taskContract(scenario.input.prompt, 'change'),
      runtimeContext: { journey: scenario.case_id },
    });

    assert.equal(output.status, 'completed');
    assert.equal(output.result.hostCalls, 0);
    assert.equal(output.result.inputSha256.length, 64);
    assert.equal(hostCalls, 0);
    assert.equal(output.toolAuthorizations.length, 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I12-EFX-01 user journey: confirmed remote mutation reconciles and executes only once', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-EFX-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-effect-'));
  let reconcileCalls = 0;
  let hostCalls = 0;
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const effectInput = externalEffectInput(request.runId, scenario);
        const issuedEffect = issueExternalEffect(request, effectInput);
        const host = {
          async reconcile() {
            reconcileCalls += 1;
            return { status: 'not-started', evidenceRefs: ['remote:comment-not-found'] };
          },
          async execute() {
            hostCalls += 1;
            return {
              status: 'committed',
              result: { commentId: 'comment-i12-1' },
              evidenceRefs: ['remote:comment-i12-1'],
            };
          },
        };
        const first = await request.externalEffects.execute(issuedEffect, host);
        const replay = await request.externalEffects.execute(issuedEffect, host);
        assert.equal(first.replayed, false);
        assert.equal(replay.replayed, true);
        assert.ok(first.receipt.toolReceipt);
        return settleTask(request, {
          reconcileCalls,
          hostCalls,
          result: first.receipt.result,
        }, [first.receipt.toolReceipt]);
      },
    });
    const output = await executor.execute({
      runId: 'i12-reconciled-effect',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: taskContract(scenario.input.prompt, 'change'),
      runtimeContext: { journey: scenario.case_id },
    });

    assert.equal(output.status, 'completed');
    assert.deepEqual(output.result, {
      reconcileCalls: 1,
      hostCalls: 1,
      result: { commentId: 'comment-i12-1' },
    });
    assert.equal(output.externalEffectReceipts.length, 1);
    assert.equal(output.externalEffectReceipts[0].status, 'committed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I12-RSM-01 user journey: external effect receipt settles resume and skips the second host call', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-RSM-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-resume-'));
  const contract = taskContract(scenario.input.prompt, 'change');
  let hostCalls = 0;
  let reconcileCalls = 0;
  try {
    const checkpoint = await interruptedCheckpoint({ scenario, workspaceRoot, contract });
    const effectInput = () => resumeEffectInput(scenario, scenario.input.body);
    const host = {
      async reconcile() {
        reconcileCalls += 1;
        return { status: 'not-started', evidenceRefs: ['remote:resume-comment-not-found'] };
      },
      async execute() {
        hostCalls += 1;
        return {
          status: 'committed',
          result: { commentId: 'comment-i12-resume' },
          evidenceRefs: ['remote:comment-i12-resume'],
        };
      },
    };
    const firstExecutor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const outcome = await request.externalEffects.execute(
          issueExternalEffect(request, effectInput()),
          host,
        );
        assert.equal(outcome.replayed, false);
        assert.ok(outcome.receipt.toolReceipt);
        return settleTask(request, { hostCalls, replayed: outcome.replayed });
      },
    });
    const first = await firstExecutor.execute({
      runId: 'i12-resume-effect-first',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: contract,
      resumeCheckpoint: checkpoint,
      runtimeContext: { journey: `${scenario.case_id}:first` },
    });

    const secondExecutor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const unit = request.resumeIdempotency.plan.units.find(item => item.id === scenario.input.pending_unit.id);
        assert.equal(unit.disposition, 'skip-completed');
        const outcome = await request.externalEffects.execute(
          issueExternalEffect(request, effectInput()),
          host,
        );
        assert.equal(outcome.replayed, true);
        assert.equal(outcome.receipt.toolReceipt, undefined);
        return settleTask(request, { hostCalls, replayed: outcome.replayed });
      },
    });
    const second = await secondExecutor.execute({
      runId: 'i12-resume-effect-second',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: contract,
      resumeCheckpoint: checkpoint,
      resumeReceipts: first.resumeReceipts,
      runtimeContext: { journey: `${scenario.case_id}:second` },
    });

    assert.equal(first.resumeReceipts[0].status, 'completed');
    assert.equal(second.result.replayed, true);
    assert.equal(hostCalls, 1);
    assert.equal(reconcileCalls, 1);
    assert.equal(second.externalEffectReceipts[0].status, 'committed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I12-RSM-02 user journey: completed resume receipt cannot authorize substituted effect input', async () => {
  const scenario = loadUserSimulationCase('I12', 'I12-RSM-02');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i12-resume-binding-'));
  const contract = taskContract(scenario.input.prompt, 'change');
  let hostCalls = 0;
  try {
    const checkpoint = await interruptedCheckpoint({ scenario, workspaceRoot, contract });
    const host = {
      async reconcile() {
        return { status: 'not-started', evidenceRefs: ['remote:bound-comment-not-found'] };
      },
      async execute() {
        hostCalls += 1;
        return { status: 'committed', evidenceRefs: ['remote:bound-comment-created'] };
      },
    };
    const firstExecutor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        const outcome = await request.externalEffects.execute(
          issueExternalEffect(request, resumeEffectInput(scenario, scenario.input.approved_body)),
          host,
        );
        return settleTask(request, { hostCalls });
      },
    });
    const first = await firstExecutor.execute({
      runId: 'i12-resume-binding-first',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: contract,
      resumeCheckpoint: checkpoint,
      runtimeContext: { journey: `${scenario.case_id}:first` },
    });

    const secondExecutor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        await request.externalEffects.execute(
          issueExternalEffect(request, resumeEffectInput(scenario, scenario.input.substituted_body)),
          host,
        );
        throw new Error('substituted resume input must not settle');
      },
    });
    await assert.rejects(secondExecutor.execute({
      runId: 'i12-resume-binding-second',
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract: contract,
      resumeCheckpoint: checkpoint,
      resumeReceipts: first.resumeReceipts,
      runtimeContext: { journey: `${scenario.case_id}:second` },
    }), /resume-operation-mismatch/u);

    assert.equal(first.resumeReceipts[0].status, 'completed');
    assert.equal(hostCalls, 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function externalEffectInput(_runId, scenario) {
  return {
    sequence: 1,
    actionId: scenario.input.action_id,
    tool: scenario.input.tool,
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['network'],
    input: {
      issueId: scenario.input.issue_id,
      body: scenario.input.body,
    },
    surfaceConstraint: confirmedConstraint(scenario.input.confirmation_ref),
  };
}

function confirmedConstraint(confirmationRef) {
  return {
    decision: 'require-confirmation',
    reason: 'user-confirmed-external-effect',
    confirmationRef,
    evidenceRefs: [`surface:${confirmationRef}`],
  };
}

async function interruptedCheckpoint(input) {
  let checkpoint;
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical(request) {
      const pending = input.scenario.input.pending_unit;
      checkpoint = request.checkpoint.create({
        epoch: 1,
        completedUnitCount: 0,
        pendingUnits: [{
          id: pending.id,
          description: pending.description,
          action: pending.action,
          target: pending.target,
          effectClass: pending.effect_class,
          operationSha256: codingExternalEffectOperationSha256(
            resumeEffectInput(
              input.scenario,
              input.scenario.input.body ?? input.scenario.input.approved_body,
            ),
          ),
        }],
        reason: 'paused',
        evidenceRefs: ['user:interrupted-before-external-effect'],
        createdAt: 100,
      });
      throw new Error('simulated interruption before external effect');
    },
  });
  await assert.rejects(executor.execute({
    runId: 'i12-resume-effect-origin',
    userPrompt: input.scenario.input.prompt,
    workspaceRoot: input.workspaceRoot,
    taskContract: input.contract,
    runtimeContext: { journey: `${input.scenario.case_id}:origin` },
  }), /simulated interruption/u);
  return checkpoint;
}

function resumeEffectInput(scenario, body) {
  return {
    sequence: 1,
    actionId: scenario.input.pending_unit.id,
    tool: scenario.input.tool,
    purpose: 'external-effect',
    nature: 'mutating',
    effects: ['network'],
    input: { target: scenario.input.pending_unit.target, body },
    surfaceConstraint: confirmedConstraint(scenario.input.confirmation_ref),
    resumeUnitId: scenario.input.pending_unit.id,
  };
}

function issueExternalEffect(request, input) {
  const context = request.toolExecution.nextAction({
    tool: input.tool,
    purpose: input.purpose,
    effects: input.effects,
    input: input.input,
  });
  return {
    ...input,
    sequence: context.sequence,
    actionId: context.actionId,
  };
}

function taskContract(goal, mode) {
  return buildCodingKernelTaskContract({
    goal,
    mode,
    deliverables: [{ id: 'result', kind: 'report' }],
    acceptance: [{
      id: 'settled',
      statement: 'The requested operation is settled safely.',
      deliverableIds: ['result'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'headless-effect-adapter',
        scope: ['response'],
        evidenceKinds: ['response-evidence'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
}

function settleTask(request, value) {
  return completedRuntimeResult(request, value, { evidencePrefix: 'i12' });
}
