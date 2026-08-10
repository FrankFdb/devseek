import {
  buildCodingToolAction,
  buildCodingVerificationPlan,
  buildCodingWorkspaceMutationPlan,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  isSecretHarvestingRefusalTaskContract,
} from '../../../shared/dist/index.js';

/**
 * Drives the Kernel-owned ports the way a VS Code loop would, while keeping the
 * conformance scenario data separate from receipt settlement.
 */
export async function exerciseCanonicalDevelopmentRoute(input) {
  const { fixture, request, taskContract } = input;
  const callbacks = request.callbacks;
  assertCanonicalPorts(callbacks);

  let mutationIndex = 0;
  let verificationIndex = 0;
  const actionIds = new Map();
  for (const expectedTool of fixture.expected.toolExecutions) {
    const toolInput = {
      fixtureId: fixture.fixtureId,
      sourceActionId: expectedTool.actionId,
    };
    const purpose = toolPurpose(expectedTool);
    const context = callbacks.canonicalToolExecution.nextAction({
      tool: expectedTool.tool,
      purpose,
      effects: expectedTool.effects,
      input: toolInput,
    });
    actionIds.set(expectedTool.actionId, context.actionId);
    const authorization = callbacks.canonicalToolAuthority.authorize({
      actionId: context.actionId,
      tool: expectedTool.tool,
      purpose,
      effects: expectedTool.effects,
      input: toolInput,
      ...(purpose === 'workspace-mutation' ? {
        targetPaths: fixture.expected.changeReceipts[mutationIndex]?.paths ?? [],
      } : {}),
      ...(expectedTool.status === 'denied' ? {
        surfaceConstraint: {
          decision: 'deny',
          reason: 'development-route-approval-required',
          evidenceRefs: expectedTool.evidenceRefs,
        },
      } : {}),
    });
    const action = buildCodingToolAction({
      runId: context.runId,
      sequence: context.sequence,
      actionId: context.actionId,
      tool: expectedTool.tool,
      purpose,
      effects: expectedTool.effects,
      input: toolInput,
      authority: authorization.receipt,
    });
    const ownerEvidenceRef = `vscode-action-owner:${context.actionId}`;
    await callbacks.canonicalToolExecution.execute(action, {
      execute: async () => {
        if (purpose === 'workspace-mutation') {
          const expectedMutation = fixture.expected.changeReceipts[mutationIndex++];
          if (!expectedMutation) throw new Error('vscode-conformance:missing-mutation-scenario');
          const actionId = input.internalReceiptIds
            ? `vscode-text-transaction-${expectedMutation.sequence}`
            : context.actionId;
          const outcome = await callbacks.canonicalWorkspaceMutations.execute(
            buildCodingWorkspaceMutationPlan({
              runId: context.runId,
              sequence: expectedMutation.sequence,
              actionId,
              idempotencyKey: `${context.runId}:${actionId}`,
              paths: expectedMutation.paths,
              payload: { fixtureId: fixture.fixtureId, sourceActionId: expectedTool.actionId },
              evidenceRefs: [...expectedMutation.evidenceRefs, ownerEvidenceRef],
            }),
            committedMutationHost(expectedMutation, ownerEvidenceRef),
          );
          return {
            status: outcome.receipt.status === 'committed' ? 'completed' : 'failed',
            result: outcome.receipt.result,
            ...(outcome.receipt.errorCode ? { errorCode: outcome.receipt.errorCode } : {}),
            evidenceRefs: [...expectedTool.evidenceRefs, ownerEvidenceRef],
          };
        }

        if (purpose === 'verify') {
          const expectedVerification = fixture.expected.verifications[verificationIndex++];
          if (!expectedVerification) throw new Error('vscode-conformance:missing-verification-scenario');
          const actionId = input.internalReceiptIds
            ? `vscode-auto-validation-${expectedVerification.sequence}`
            : context.actionId;
          const outcome = await settleVerification({
            verification: callbacks.canonicalVerification,
            taskContract,
            expectedVerification,
            runId: context.runId,
            actionId,
            ownerEvidenceRef,
            scopePaths: verificationScope(fixture),
          });
          return {
            status: outcome.receipt.status === 'passed'
              ? 'completed'
              : outcome.receipt.status === 'failed'
                ? 'failed'
                : 'indeterminate',
            ...(outcome.receipt.status === 'failed'
              ? { errorCode: 'development-verification-failed' }
              : {}),
            evidenceRefs: [...expectedTool.evidenceRefs, ownerEvidenceRef],
          };
        }

        return {
          status: expectedTool.status === 'failed' ? 'failed' : 'completed',
          ...(expectedTool.status === 'failed' ? { errorCode: 'development-tool-failed' } : {}),
          evidenceRefs: [...expectedTool.evidenceRefs, ownerEvidenceRef],
        };
      },
    }, callbacks.canonicalToolAuthority);
  }

  if (input.extraInternalVerification) {
    const expectedVerification = fixture.expected.verifications[0];
    if (!expectedVerification) throw new Error('vscode-conformance:missing-extra-verification-source');
    await settleVerification({
      verification: callbacks.canonicalVerification,
      taskContract,
      expectedVerification: {
        ...expectedVerification,
        sequence: expectedVerification.sequence + 100,
        verifier: 'vscode-agent-quality-gate',
      },
      runId: callbacks.traceRunId,
      actionId: 'vscode-auto-validation-internal',
      ownerEvidenceRef: 'vscode-internal-quality-evidence',
      scopePaths: verificationScope(fixture),
    });
  }

  return {
    agentResult: buildDevelopmentAgentResult(fixture),
    actionIds,
  };
}

function buildDevelopmentAgentResult(fixture) {
  const blockedByAuthority = fixture.expected.toolExecutions.some(receipt => receipt.status === 'denied');
  const changedPaths = [...new Set(fixture.expected.changeReceipts
    .filter(receipt => receipt.status === 'committed')
    .flatMap(receipt => receipt.paths))];
  const taskCount = Math.max(1, fixture.expected.changeReceipts.length);
  const acceptanceEvidence = isSecretHarvestingRefusalTaskContract(fixture.expected.taskContract)
    ? buildSecretHarvestingRefusalAcceptanceEvidence()
    : [];
  return {
    tasksTotal: taskCount,
    tasksApplied: blockedByAuthority ? 0 : taskCount,
    tasksFailed: blockedByAuthority ? 1 : 0,
    changedPaths,
    ...(acceptanceEvidence.length > 0 ? { acceptanceEvidence } : {}),
    historyText: `Development route settled ${fixture.title}.`,
  };
}

function committedMutationHost(expected, ownerEvidenceRef) {
  const evidenceRefs = [...expected.evidenceRefs, ownerEvidenceRef];
  return {
    async captureBaseline() {
      return {
        baselineRef: expected.baselineRef,
        state: { revision: `before-${expected.sequence}` },
        evidenceRefs,
      };
    },
    async apply() {
      return {
        status: 'applied',
        applied: {
          state: { revision: `after-${expected.sequence}` },
          result: { changedPaths: expected.paths },
          evidenceRefs,
        },
      };
    },
    async readback() {
      return {
        matches: true,
        readbackRef: expected.readbackRef ?? `readback:${expected.actionId}`,
        evidenceRefs,
      };
    },
    async rollback() {
      return {
        rolledBack: true,
        rollbackRef: expected.rollbackRef ?? `rollback:${expected.actionId}`,
        evidenceRefs,
      };
    },
  };
}

function settleVerification(input) {
  const status = input.expectedVerification.status === 'blocked'
    ? 'unavailable'
    : input.expectedVerification.status;
  const evidenceRefs = [...input.expectedVerification.evidenceRefs, input.ownerEvidenceRef];
  return input.verification.verify(buildCodingVerificationPlan({
    runId: input.runId,
    sequence: input.expectedVerification.sequence,
    actionId: input.actionId,
    idempotencyKey: `${input.runId}:${input.actionId}`,
    scopePaths: input.scopePaths,
    acceptance: input.taskContract.acceptance.map(criterion => ({
      id: criterion.id,
      statement: criterion.statement,
    })),
    payload: { verifier: input.expectedVerification.verifier },
    evidenceRefs,
  }), {
    async verify() {
      return {
        verifier: input.expectedVerification.verifier,
        checks: [{
          checkId: `check-${input.actionId}`,
          status,
          acceptanceIds: input.expectedVerification.acceptanceIds,
          summary: `Development verification ${status}`,
          evidenceRefs,
        }],
        evidenceRefs,
      };
    },
  });
}

function toolPurpose(receipt) {
  if (receipt.effects.length === 1 && receipt.effects[0] === 'workspace-mutation') {
    return 'workspace-mutation';
  }
  if (receipt.effects.includes('network') || receipt.effects.includes('git') || receipt.effects.includes('release')) {
    return 'external-effect';
  }
  if (receipt.effects.includes('process')) return 'verify';
  return 'observe';
}

function verificationScope(fixture) {
  const paths = fixture.expected.changeReceipts.flatMap(receipt => receipt.paths);
  return paths.length > 0 ? [...new Set(paths)] : ['workspace'];
}

function assertCanonicalPorts(callbacks) {
  const required = [
    callbacks.canonicalToolAuthority,
    callbacks.canonicalToolExecution,
    callbacks.canonicalWorkspaceMutations,
    callbacks.canonicalVerification,
    callbacks.traceRunId,
  ];
  if (required.some(value => value === undefined || value === null || value === '')) {
    throw new Error('vscode-conformance:incomplete-canonical-ports');
  }
}
