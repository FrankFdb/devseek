import {
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
import { describeWorkspaceMutationError } from './workspace-mutation-error';

interface VsCodeTextFileMutationPayload {
  readonly absPath: string;
  readonly workspaceRoot: string;
  readonly content: string;
  readonly applyOptions: WorkspaceEditApplyOptions;
}

export interface VsCodeTextFileMutationInput extends VsCodeTextFileMutationPayload {
  readonly baseline: WorkspaceTextFileBaseline;
  readonly transaction: WorkspaceMutationTransactionPort;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
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
  readonly transaction: WorkspaceMutationTransactionPort;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly evidenceRefs: readonly string[];
}

/** VS Code host adapter for the shared text-file mutation transaction. */
export class VsCodeWorkspaceMutationAdapter {
  constructor(
    private readonly edits: Pick<
      WorkspaceEditService,
      | 'captureTextFileBaseline'
      | 'isTextFileBaselineCurrent'
      | 'proposeTextFileWrite'
      | 'prepareTextFileProposal'
      | 'commitTextFileProposal'
      | 'deleteTextFile'
      | 'rollbackTextFileCommit'
    > = new WorkspaceEditService(),
  ) {}

  executeTextFileWrite(
    input: VsCodeTextFileMutationInput,
  ): Promise<CodingWorkspaceMutationOutcome<WorkspaceCommittedEdit>> {
    const sequence = input.sequence;
    const runId = input.runId.trim();
    const actionId = input.actionId.trim();
    assertMutationIdentity(runId, sequence, actionId);
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
    return input.transaction.execute(plan, this.createHost(input.baseline, input.verifyReadback));
  }

  executeTextFileDelete(
    input: VsCodeTextFileDeleteInput,
  ): Promise<CodingWorkspaceMutationOutcome<WorkspaceDeleteResult>> {
    const sequence = input.sequence;
    const runId = input.runId.trim();
    const actionId = input.actionId.trim();
    assertMutationIdentity(runId, sequence, actionId);
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
    return input.transaction.execute(plan, this.createDeleteHost(input.baseline));
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
      reconcile: async (plan, baseline) => {
        const prepared = this.edits.prepareTextFileProposal(
          this.edits.proposeTextFileWrite(plan.payload.absPath, plan.payload.content),
          plan.payload.applyOptions,
        );
        const current = this.edits.captureTextFileBaseline(
          plan.payload.absPath,
          plan.payload.workspaceRoot,
        );
        if (current.snapshot.existed && current.snapshot.content === prepared.proposal.content) {
          const committed: WorkspaceCommittedEdit = {
            proposal: prepared.proposal,
            snapshot: baseline.state.snapshot,
            result: {
              existed: baseline.state.snapshot.existed,
              oldContent: baseline.state.snapshot.content,
              newContent: prepared.proposal.content,
              ...(prepared.normalization ? { normalization: prepared.normalization } : {}),
            },
            commitToken: {
              absPath: baseline.state.absPath,
              workspaceRoot: baseline.state.workspaceRoot,
              before: baseline.state,
              after: current,
            },
          };
          return {
            status: 'committed',
            result: committed,
            readbackRef: `vscode-text-reconcile:${plan.actionId}`,
            evidenceRefs: [`workspace-reconcile:${plan.actionId}:committed`],
          };
        }
        if (this.edits.isTextFileBaselineCurrent(baseline.state)) {
          return {
            status: 'not-started',
            evidenceRefs: [`workspace-reconcile:${plan.actionId}:not-started`],
          };
        }
        return {
          status: 'indeterminate',
          readbackRef: `vscode-text-reconcile:${plan.actionId}`,
          evidenceRefs: [`workspace-reconcile:${plan.actionId}:indeterminate`],
        };
      },
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
          const failure = describeWorkspaceMutationError(error, 'single');
          return {
            status: 'rejected',
            mutationState: this.edits.isTextFileBaselineCurrent(baseline.state)
              ? 'unchanged'
              : 'possibly-changed',
            errorCode: failure.code,
            ...(failure.detail ? { errorDetail: failure.detail } : {}),
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
      reconcile: async (plan, baseline) => {
        const current = this.edits.captureTextFileBaseline(
          plan.payload.absPath,
          plan.payload.workspaceRoot,
        );
        if (baseline.state.snapshot.existed && !current.snapshot.existed) {
          const result: WorkspaceDeleteResult = {
            deleted: true,
            commitToken: {
              absPath: baseline.state.absPath,
              workspaceRoot: baseline.state.workspaceRoot,
              before: baseline.state,
              after: current,
            },
          };
          return {
            status: 'committed',
            result,
            readbackRef: `vscode-delete-reconcile:${plan.actionId}`,
            evidenceRefs: [`workspace-delete-reconcile:${plan.actionId}:committed`],
          };
        }
        if (this.edits.isTextFileBaselineCurrent(baseline.state)) {
          return {
            status: 'not-started',
            evidenceRefs: [`workspace-delete-reconcile:${plan.actionId}:not-started`],
          };
        }
        return {
          status: 'indeterminate',
          readbackRef: `vscode-delete-reconcile:${plan.actionId}`,
          evidenceRefs: [`workspace-delete-reconcile:${plan.actionId}:indeterminate`],
        };
      },
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
          const failure = describeWorkspaceMutationError(error, 'single');
          return {
            status: 'rejected',
            mutationState: this.edits.isTextFileBaselineCurrent(baseline.state)
              ? 'unchanged'
              : 'possibly-changed',
            errorCode: failure.code,
            ...(failure.detail ? { errorDetail: failure.detail } : {}),
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

function assertMutationIdentity(runId: string, sequence: number, actionId: string): void {
  if (!runId || !actionId || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error('vscode-workspace-mutation:invalid-operation-identity');
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
