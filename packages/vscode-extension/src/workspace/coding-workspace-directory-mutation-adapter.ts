import {
  buildCodingWorkspaceMutationPlan,
  type CodingWorkspaceMutationOutcome,
  type WorkspaceMutationPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import * as nodePath from 'path';
import {
  WorkspaceEditService,
  type WorkspaceDirectoryBaseline,
  type WorkspaceDirectoryCommitToken,
  type WorkspaceDirectoryCreateResult,
} from './edit-service';

interface VsCodeDirectoryMutationPayload {
  readonly absPath: string;
  readonly workspaceRoot: string;
}

export interface VsCodeDirectoryReadbackVerification {
  readonly matches: boolean;
  readonly evidenceRefs: readonly string[];
}

export type VsCodeDirectoryReadbackVerifier = (input: {
  readonly result: WorkspaceDirectoryCreateResult;
}) => Promise<VsCodeDirectoryReadbackVerification> | VsCodeDirectoryReadbackVerification;

export interface VsCodeDirectoryMutationInput extends VsCodeDirectoryMutationPayload {
  readonly baseline: WorkspaceDirectoryBaseline;
  readonly transaction: WorkspaceMutationTransactionPort;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly evidenceRefs: readonly string[];
  readonly verifyReadback?: VsCodeDirectoryReadbackVerifier;
}

/** VS Code host adapter for the shared directory mutation transaction. */
export class VsCodeWorkspaceDirectoryMutationAdapter {
  constructor(
    private readonly edits: Pick<
      WorkspaceEditService,
      | 'captureWorkspaceDirectoryBaseline'
      | 'isWorkspaceDirectoryBaselineCurrent'
      | 'createWorkspaceDirectory'
      | 'rollbackWorkspaceDirectoryCommit'
    > = new WorkspaceEditService(),
  ) {}

  execute(
    input: VsCodeDirectoryMutationInput,
  ): Promise<CodingWorkspaceMutationOutcome<WorkspaceDirectoryCreateResult>> {
    const sequence = input.sequence;
    const runId = input.runId.trim();
    const actionId = input.actionId.trim();
    assertMutationIdentity(runId, sequence, actionId);
    assertDirectoryBaselineScope(input, input.baseline);
    const relativePath = nodePath.relative(input.workspaceRoot, input.absPath).replace(/\\/g, '/');
    const plan = buildCodingWorkspaceMutationPlan({
      runId,
      sequence,
      actionId,
      idempotencyKey: `${runId}:${actionId}`,
      paths: [relativePath],
      payload: {
        absPath: input.absPath,
        workspaceRoot: input.workspaceRoot,
      },
      evidenceRefs: input.evidenceRefs,
    });
    return input.transaction.execute(plan, this.createHost(input.baseline, input.verifyReadback));
  }

  private createHost(
    authorizedBaseline: WorkspaceDirectoryBaseline,
    verifyReadback?: VsCodeDirectoryReadbackVerifier,
  ): WorkspaceMutationPort<
    VsCodeDirectoryMutationPayload,
    WorkspaceDirectoryBaseline,
    WorkspaceDirectoryCommitToken,
    WorkspaceDirectoryCreateResult
  > {
    return {
      reconcile: async (plan, baseline) => {
        const current = this.edits.captureWorkspaceDirectoryBaseline(
          plan.payload.absPath,
          plan.payload.workspaceRoot,
        );
        if (current.snapshot.existed) {
          const result: WorkspaceDirectoryCreateResult = {
            created: !baseline.state.snapshot.existed,
            canonicalPath: current.snapshot.canonicalPath!,
            commitToken: {
              absPath: baseline.state.absPath,
              workspaceRoot: baseline.state.workspaceRoot,
              before: baseline.state,
              after: current,
              createdDirectories: [],
            },
          };
          return {
            status: 'committed',
            result,
            readbackRef: `vscode-directory-reconcile:${plan.actionId}`,
            evidenceRefs: [`workspace-directory-reconcile:${plan.actionId}:committed`],
          };
        }
        if (this.edits.isWorkspaceDirectoryBaselineCurrent(baseline.state)) {
          return {
            status: 'not-started',
            evidenceRefs: [`workspace-directory-reconcile:${plan.actionId}:not-started`],
          };
        }
        return {
          status: 'indeterminate',
          readbackRef: `vscode-directory-reconcile:${plan.actionId}`,
          evidenceRefs: [`workspace-directory-reconcile:${plan.actionId}:indeterminate`],
        };
      },
      captureBaseline: async plan => {
        assertDirectoryBaselineScope(plan.payload, authorizedBaseline);
        return {
          baselineRef: `vscode-directory-baseline:${plan.actionId}`,
          state: authorizedBaseline,
          evidenceRefs: [`workspace-directory-baseline:${plan.actionId}`],
        };
      },
      apply: async (plan, baseline) => {
        if (!this.edits.isWorkspaceDirectoryBaselineCurrent(baseline.state)) {
          return {
            status: 'rejected',
            mutationState: 'unchanged',
            errorCode: 'workspace-directory-baseline-conflict',
            evidenceRefs: [`workspace-directory-apply:${plan.actionId}:baseline-conflict`],
          };
        }
        try {
          const result = this.edits.createWorkspaceDirectory(
            plan.payload.absPath,
            plan.payload.workspaceRoot,
            baseline.state,
          );
          return {
            status: 'applied',
            applied: {
              state: result.commitToken,
              result,
              evidenceRefs: [`workspace-directory-apply:${plan.actionId}:committed`],
            },
          };
        } catch (error) {
          return {
            status: 'rejected',
            mutationState: this.edits.isWorkspaceDirectoryBaselineCurrent(baseline.state)
              ? 'unchanged'
              : 'possibly-changed',
            errorCode: directoryMutationErrorCode(error),
            evidenceRefs: [`workspace-directory-apply:${plan.actionId}:rejected`],
          };
        }
      },
      readback: async (plan, _baseline, applied) => {
        const identityMatches = this.edits.isWorkspaceDirectoryBaselineCurrent(applied.state.after);
        if (!identityMatches || !verifyReadback) {
          return {
            matches: identityMatches,
            readbackRef: `vscode-directory-readback:${plan.actionId}`,
            evidenceRefs: [
              `workspace-directory-readback:${plan.actionId}:${identityMatches ? 'matched' : 'mismatched'}`,
            ],
          };
        }
        if (!applied.result) {
          return {
            matches: false,
            readbackRef: `vscode-directory-readback:${plan.actionId}`,
            evidenceRefs: [`workspace-directory-readback:${plan.actionId}:missing-commit-result`],
          };
        }
        const verification = await verifyReadback({ result: applied.result });
        return {
          matches: verification.matches,
          readbackRef: `vscode-directory-readback:${plan.actionId}`,
          evidenceRefs: [
            `workspace-directory-readback:${plan.actionId}:${verification.matches ? 'matched' : 'mismatched'}`,
            ...verification.evidenceRefs,
          ],
        };
      },
      rollback: async (plan, _baseline, applied) => {
        if (!applied) {
          return {
            rolledBack: false,
            evidenceRefs: [`workspace-directory-rollback:${plan.actionId}:missing-commit-token`],
          };
        }
        const rollback = this.edits.rollbackWorkspaceDirectoryCommit(applied.state);
        return {
          rolledBack: rollback.rolledBack,
          ...(rollback.rolledBack ? { rollbackRef: `vscode-directory-rollback:${plan.actionId}` } : {}),
          evidenceRefs: [
            `workspace-directory-rollback:${plan.actionId}:${rollback.rolledBack ? 'completed' : 'failed'}`,
          ],
        };
      },
    };
  }
}

function assertMutationIdentity(runId: string, sequence: number, actionId: string): void {
  if (!runId || !actionId || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error('vscode-workspace-directory-mutation:invalid-operation-identity');
  }
}

function assertDirectoryBaselineScope(
  payload: VsCodeDirectoryMutationPayload,
  baseline: WorkspaceDirectoryBaseline,
): void {
  if (nodePath.resolve(payload.absPath) !== baseline.absPath
    || nodePath.resolve(payload.workspaceRoot) !== baseline.workspaceRoot) {
    throw new Error('vscode-workspace-directory-mutation:baseline-scope-mismatch');
  }
}

function directoryMutationErrorCode(error: unknown): string {
  return error instanceof Error && error.name === 'WorkspaceEditConflictError'
    ? 'workspace-directory-commit-conflict'
    : 'workspace-directory-commit-failed';
}
