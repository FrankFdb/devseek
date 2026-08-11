import {
  buildCodingToolAction,
  buildCodingWorkspaceMutationPlan,
} from '../../dist/index.js';

export async function commitCanonicalWorkspaceChange(request, input) {
  const paths = [...new Set(input.paths)];
  const actionInput = { paths, marker: input.marker };
  const context = request.toolExecution.nextAction({
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: actionInput,
  });
  const authorization = request.toolAuthority.authorize({
    actionId: context.actionId,
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: actionInput,
    targetPaths: paths.map(path => `${request.workspaceRoot}/${path}`),
    risk: 'low',
  });
  const action = buildCodingToolAction({
    runId: context.runId,
    sequence: context.sequence,
    actionId: context.actionId,
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: actionInput,
    authority: authorization.receipt,
  });
  const outcome = await request.toolExecution.execute(action, {
    async execute(settledAction) {
      const mutation = await request.workspaceMutations.execute(
        buildCodingWorkspaceMutationPlan({
          runId: settledAction.runId,
          sequence: settledAction.sequence,
          actionId: settledAction.actionId,
          idempotencyKey: `${settledAction.runId}:${settledAction.actionId}`,
          paths,
          payload: settledAction.input,
          evidenceRefs: [`test-change-plan:${settledAction.actionId}`],
        }),
        committedMutationHost(settledAction.actionId, paths),
      );
      return {
        status: mutation.receipt.status === 'committed'
          ? 'completed'
          : mutation.receipt.status === 'indeterminate'
            ? 'indeterminate'
            : 'failed',
        result: mutation.receipt,
        ...(mutation.receipt.errorCode ? { errorCode: mutation.receipt.errorCode } : {}),
        evidenceRefs: mutation.receipt.evidenceRefs,
      };
    },
  }, request.toolAuthority);
  return { authorization, context, outcome };
}

function committedMutationHost(actionId, paths) {
  return {
    async captureBaseline() {
      return {
        baselineRef: `test-baseline:${actionId}`,
        state: { paths, revision: 'before' },
        evidenceRefs: [`test-baseline:${actionId}:captured`],
      };
    },
    async apply() {
      return {
        status: 'applied',
        applied: {
          state: { paths, revision: 'after' },
          result: paths,
          evidenceRefs: [`test-apply:${actionId}:completed`],
        },
      };
    },
    async readback() {
      return {
        matches: true,
        readbackRef: `test-readback:${actionId}`,
        evidenceRefs: [`test-readback:${actionId}:matched`],
      };
    },
    async rollback() {
      return {
        rolledBack: true,
        rollbackRef: `test-rollback:${actionId}`,
        evidenceRefs: [`test-rollback:${actionId}:completed`],
      };
    },
  };
}
