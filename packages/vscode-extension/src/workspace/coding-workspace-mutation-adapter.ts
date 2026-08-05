import {
  CanonicalWorkspaceMutationTransaction,
  buildCodingWorkspaceMutationPlan,
  type CodingWorkspaceMutationOutcome,
  type WorkspaceMutationPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import * as nodePath from 'path';
import {
  WorkspaceEditService,
  type WorkspaceCommittedEdit,
  type WorkspaceDeleteResult,
  type WorkspaceEditApplyOptions,
  type WorkspaceTextFileBaseline,
  type WorkspaceTextFileCommitToken,
  type WorkspaceTextFileDeleteCommitToken,
} from './edit-service';

interface VsCodeTextFileMutationPayload {
  readonly absPath: string;
  readonly workspaceRoot: string;
  readonly content: string;
  readonly applyOptions: WorkspaceEditApplyOptions;
}

export interface VsCodeTextFileMutationInput extends VsCodeTextFileMutationPayload {
  readonly baseline: WorkspaceTextFileBaseline;
  readonly runId?: string;
  readonly sequence?: number;
  readonly actionId?: string;
  readonly evidenceRefs: readonly string[];
  readonly verifyReadback?: VsCodeTextFileReadbackVerifier;
}

export interface VsCodeTextFileReadbackVerification {
  readonly matches: boolean;
  readonly evidenceRefs: readonly string[];
}

export type VsCodeTextFileReadbackVerifier = (input: {
  readonly content: string;
  readonly committed: WorkspaceCommittedEdit;
}) => Promise<VsCodeTextFileReadbackVerification> | VsCodeTextFileReadbackVerification;

interface VsCodeTextFileDeletePayload {
  readonly absPath: string;
  readonly workspaceRoot: string;
}

export interface VsCodeTextFileDeleteInput extends VsCodeTextFileDeletePayload {
  readonly baseline: WorkspaceTextFileBaseline;
  readonly runId?: string;
  readonly sequence?: number;
  readonly actionId?: string;
  readonly evidenceRefs: readonly string[];
}

/** VS Code host adapter for the shared text-file mutation transaction. */
export class VsCodeWorkspaceMutationAdapter {
  private sequence = 0;

  constructor(
    private readonly edits: Pick<
      WorkspaceEditService,
      | 'captureTextFileBaseline'
      | 'isTextFileBaselineCurrent'
      | 'proposeTextFileWrite'
      | 'commitTextFileProposal'
      | 'deleteTextFile'
      | 'rollbackTextFileCommit'
    > = new WorkspaceEditService(),
    private readonly transaction: WorkspaceMutationTransactionPort = new CanonicalWorkspaceMutationTransaction(),
  ) {}

  executeTextFileWrite(
    input: VsCodeTextFileMutationInput,
  ): Promise<CodingWorkspaceMutationOutcome<WorkspaceCommittedEdit>> {
    this.sequence += 1;
    const sequence = input.sequence ?? this.sequence;
    const runId = input.runId?.trim() || 'vscode-workspace-mutation';
    const actionId = input.actionId?.trim() || `text-file-write-${sequence}`;
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
        content: input.content,
        applyOptions: input.applyOptions,
      },
      evidenceRefs: input.evidenceRefs,
    });
    return this.transaction.execute(plan, this.createHost(input.baseline, input.verifyReadback));
  }

  executeTextFileDelete(
    input: VsCodeTextFileDeleteInput,
  ): Promise<CodingWorkspaceMutationOutcome<WorkspaceDeleteResult>> {
    this.sequence += 1;
    const sequence = input.sequence ?? this.sequence;
    const runId = input.runId?.trim() || 'vscode-workspace-mutation';
    const actionId = input.actionId?.trim() || `text-file-delete-${sequence}`;
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
    return this.transaction.execute(plan, this.createDeleteHost(input.baseline));
  }

  private createHost(
    authorizedBaseline: WorkspaceTextFileBaseline,
    verifyReadback?: VsCodeTextFileReadbackVerifier,
  ): WorkspaceMutationPort<
    VsCodeTextFileMutationPayload,
    WorkspaceTextFileBaseline,
    WorkspaceTextFileCommitToken,
    WorkspaceCommittedEdit
  > {
    return {
      captureBaseline: async plan => {
        assertPlanMatchesBaseline(plan.payload, authorizedBaseline);
        return {
          baselineRef: `vscode-text-baseline:${plan.actionId}`,
          state: authorizedBaseline,
          evidenceRefs: [`workspace-baseline:${plan.actionId}`],
        };
      },
      apply: async (plan, baseline) => {
        if (!this.edits.isTextFileBaselineCurrent(baseline.state)) {
          return {
            status: 'rejected',
            mutationState: 'unchanged',
            errorCode: 'workspace-baseline-conflict',
            evidenceRefs: [`workspace-apply:${plan.actionId}:baseline-conflict`],
          };
        }
        try {
          const committed = this.edits.commitTextFileProposal(
            this.edits.proposeTextFileWrite(plan.payload.absPath, plan.payload.content),
            baseline.state,
            plan.payload.applyOptions,
          );
          return {
            status: 'applied',
            applied: {
              state: committed.commitToken,
              result: committed,
              evidenceRefs: [`workspace-apply:${plan.actionId}:committed`],
            },
          };
        } catch (error) {
          return {
            status: 'rejected',
            mutationState: this.edits.isTextFileBaselineCurrent(baseline.state)
              ? 'unchanged'
              : 'possibly-changed',
            errorCode: workspaceMutationErrorCode(error),
            evidenceRefs: [`workspace-apply:${plan.actionId}:rejected`],
          };
        }
      },
      readback: async (plan, _baseline, applied) => {
        const identityMatches = this.edits.isTextFileBaselineCurrent(applied.state.after);
        if (!identityMatches || !verifyReadback) {
          return {
            matches: identityMatches,
            readbackRef: `vscode-text-readback:${plan.actionId}`,
            evidenceRefs: [`workspace-readback:${plan.actionId}:${identityMatches ? 'matched' : 'mismatched'}`],
          };
        }
        if (!applied.result) {
          return {
            matches: false,
            readbackRef: `vscode-text-readback:${plan.actionId}`,
            evidenceRefs: [`workspace-readback:${plan.actionId}:missing-commit-result`],
          };
        }
        const verification = await verifyReadback({
          content: applied.state.after.snapshot.content,
          committed: applied.result,
        });
        return {
          matches: verification.matches,
          readbackRef: `vscode-text-readback:${plan.actionId}`,
          evidenceRefs: [
            `workspace-readback:${plan.actionId}:${verification.matches ? 'matched' : 'mismatched'}`,
            ...verification.evidenceRefs,
          ],
        };
      },
      rollback: async (plan, _baseline, applied) => {
        if (!applied) {
          return {
            rolledBack: false,
            evidenceRefs: [`workspace-rollback:${plan.actionId}:missing-commit-token`],
          };
        }
        const rollback = this.edits.rollbackTextFileCommit(applied.state);
        return {
          rolledBack: rollback.rolledBack,
          ...(rollback.rolledBack ? { rollbackRef: `vscode-text-rollback:${plan.actionId}` } : {}),
          evidenceRefs: [
            `workspace-rollback:${plan.actionId}:${rollback.rolledBack ? 'completed' : 'failed'}`,
          ],
        };
      },
    };
  }

  private createDeleteHost(
    authorizedBaseline: WorkspaceTextFileBaseline,
  ): WorkspaceMutationPort<
    VsCodeTextFileDeletePayload,
    WorkspaceTextFileBaseline,
    WorkspaceTextFileDeleteCommitToken,
    WorkspaceDeleteResult
  > {
    return {
      captureBaseline: async plan => {
        assertPlanMatchesBaseline(plan.payload, authorizedBaseline);
        return {
          baselineRef: `vscode-delete-baseline:${plan.actionId}`,
          state: authorizedBaseline,
          evidenceRefs: [`workspace-delete-baseline:${plan.actionId}`],
        };
      },
      apply: async (plan, baseline) => {
        if (!baseline.state.snapshot.existed) {
          return {
            status: 'rejected',
            mutationState: 'unchanged',
            errorCode: 'workspace-delete-target-missing',
            evidenceRefs: [`workspace-delete-apply:${plan.actionId}:target-missing`],
          };
        }
        if (!this.edits.isTextFileBaselineCurrent(baseline.state)) {
          return {
            status: 'rejected',
            mutationState: 'unchanged',
            errorCode: 'workspace-baseline-conflict',
            evidenceRefs: [`workspace-delete-apply:${plan.actionId}:baseline-conflict`],
          };
        }
        try {
          const deleted = this.edits.deleteTextFile(plan.payload.absPath, plan.payload.workspaceRoot);
          if (!deleted.deleted) {
            return {
              status: 'rejected',
              mutationState: 'unchanged',
              errorCode: 'workspace-delete-target-missing',
              evidenceRefs: [`workspace-delete-apply:${plan.actionId}:target-missing`],
            };
          }
          return {
            status: 'applied',
            applied: {
              state: deleted.commitToken,
              result: deleted,
              evidenceRefs: [`workspace-delete-apply:${plan.actionId}:committed`],
            },
          };
        } catch (error) {
          return {
            status: 'rejected',
            mutationState: this.edits.isTextFileBaselineCurrent(baseline.state)
              ? 'unchanged'
              : 'possibly-changed',
            errorCode: workspaceMutationErrorCode(error),
            evidenceRefs: [`workspace-delete-apply:${plan.actionId}:rejected`],
          };
        }
      },
      readback: async (plan, _baseline, applied) => ({
        matches: !applied.state.after.snapshot.existed
          && this.edits.isTextFileBaselineCurrent(applied.state.after),
        readbackRef: `vscode-delete-readback:${plan.actionId}`,
        evidenceRefs: [`workspace-delete-readback:${plan.actionId}`],
      }),
      rollback: async (plan, _baseline, applied) => {
        if (!applied) {
          return {
            rolledBack: false,
            evidenceRefs: [`workspace-delete-rollback:${plan.actionId}:missing-commit-token`],
          };
        }
        const rollback = this.edits.rollbackTextFileCommit(applied.state);
        return {
          rolledBack: rollback.rolledBack,
          ...(rollback.rolledBack ? { rollbackRef: `vscode-delete-rollback:${plan.actionId}` } : {}),
          evidenceRefs: [
            `workspace-delete-rollback:${plan.actionId}:${rollback.rolledBack ? 'completed' : 'failed'}`,
          ],
        };
      },
    };
  }
}

function assertPlanMatchesBaseline(
  payload: { readonly absPath: string; readonly workspaceRoot: string },
  baseline: WorkspaceTextFileBaseline,
): void {
  if (payload.absPath !== baseline.absPath || payload.workspaceRoot !== baseline.workspaceRoot) {
    throw new Error('vscode-workspace-mutation:baseline-scope-mismatch');
  }
}

function workspaceMutationErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'WorkspaceEditValidationError') return 'workspace-proposal-invalid';
  if (name === 'WorkspaceEditConflictError') return 'workspace-commit-conflict';
  return 'workspace-commit-failed';
}
