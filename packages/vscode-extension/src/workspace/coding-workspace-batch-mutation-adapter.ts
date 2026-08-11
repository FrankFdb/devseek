import * as fs from 'fs';
import * as nodePath from 'path';
import {
  buildCodingWorkspaceMutationPlan,
  type CodingWorkspaceMutationOutcome,
  type WorkspaceMutationPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import {
  WorkspaceEditService,
  type WorkspaceCommittedEdit,
  type WorkspaceTextFileBaseline,
  type WorkspaceTextFileCommitToken,
} from './edit-service';
import { describeWorkspaceMutationError } from './workspace-mutation-error';

export interface VsCodeWorkspaceBatchMutationItem {
  readonly absPath: string;
  readonly relPath: string;
  readonly content: string;
  readonly baseline: WorkspaceTextFileBaseline;
}

export interface VsCodeWorkspaceBatchReadbackVerification {
  readonly matches: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface VsCodeWorkspaceBatchMutationInput {
  readonly transaction: WorkspaceMutationTransactionPort;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly items: readonly VsCodeWorkspaceBatchMutationItem[];
  readonly evidenceRefs: readonly string[];
  readonly verifyReadback?: (input: {
    readonly committed: readonly WorkspaceCommittedEdit[];
  }) => Promise<VsCodeWorkspaceBatchReadbackVerification> | VsCodeWorkspaceBatchReadbackVerification;
}

interface BatchPayload {
  readonly workspaceRoot: string;
  readonly items: readonly {
    readonly absPath: string;
    readonly relPath: string;
    readonly content: string;
  }[];
}

interface BatchAppliedState {
  readonly commitTokens: readonly WorkspaceTextFileCommitToken[];
  readonly createdDirs: readonly string[];
}

/** Adapts one all-or-rollback VS Code file batch to the shared mutation owner. */
export class VsCodeWorkspaceBatchMutationAdapter {
  constructor(
    private readonly edits: Pick<
      WorkspaceEditService,
      | 'captureTextFileBaseline'
      | 'isTextFileBaselineCurrent'
      | 'proposeTextFileWrite'
      | 'prepareTextFileProposal'
      | 'commitTextFileProposal'
      | 'rollbackTextFileCommit'
    > = new WorkspaceEditService(),
  ) {}

  execute(
    input: VsCodeWorkspaceBatchMutationInput,
  ): Promise<CodingWorkspaceMutationOutcome<readonly WorkspaceCommittedEdit[]>> {
    const payload: BatchPayload = {
      workspaceRoot: input.workspaceRoot,
      items: input.items.map(item => ({
        absPath: item.absPath,
        relPath: item.relPath,
        content: item.content,
      })),
    };
    const plan = buildCodingWorkspaceMutationPlan({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      idempotencyKey: `${input.runId}:${input.actionId}`,
      paths: input.items.map(item => item.relPath),
      payload,
      evidenceRefs: input.evidenceRefs,
    });
    return input.transaction.execute(
      plan,
      this.createHost(input.items.map(item => item.baseline), input.verifyReadback),
    );
  }

  private createHost(
    authorizedBaselines: readonly WorkspaceTextFileBaseline[],
    verifyReadback: VsCodeWorkspaceBatchMutationInput['verifyReadback'],
  ): WorkspaceMutationPort<
    BatchPayload,
    readonly WorkspaceTextFileBaseline[],
    BatchAppliedState,
    readonly WorkspaceCommittedEdit[]
  > {
    return {
      reconcile: async (plan, baseline) => {
        const current = plan.payload.items.map(item => this.edits.captureTextFileBaseline(
          item.absPath,
          plan.payload.workspaceRoot,
        ));
        const prepared = plan.payload.items.map(item => this.edits.prepareTextFileProposal(
          this.edits.proposeTextFileWrite(item.absPath, item.content),
          { validateSourceSanity: true, repairSourceTransportEscapes: true },
        ));
        const allCommitted = current.every((item, index) => (
          item.snapshot.existed && item.snapshot.content === prepared[index].proposal.content
        ));
        if (allCommitted) {
          const committed = current.map((item, index): WorkspaceCommittedEdit => ({
            proposal: prepared[index].proposal,
            snapshot: baseline.state[index].snapshot,
            result: {
              existed: baseline.state[index].snapshot.existed,
              oldContent: baseline.state[index].snapshot.content,
              newContent: prepared[index].proposal.content,
              ...(prepared[index].normalization
                ? { normalization: prepared[index].normalization }
                : {}),
            },
            commitToken: {
              absPath: baseline.state[index].absPath,
              workspaceRoot: baseline.state[index].workspaceRoot,
              before: baseline.state[index],
              after: item,
            },
          }));
          return {
            status: 'committed',
            result: committed,
            readbackRef: `vscode-batch-reconcile:${plan.actionId}`,
            evidenceRefs: [`workspace-batch-reconcile:${plan.actionId}:committed`],
          };
        }
        if (baseline.state.every(item => this.edits.isTextFileBaselineCurrent(item))) {
          return {
            status: 'not-started',
            evidenceRefs: [`workspace-batch-reconcile:${plan.actionId}:not-started`],
          };
        }
        return {
          status: 'indeterminate',
          readbackRef: `vscode-batch-reconcile:${plan.actionId}`,
          evidenceRefs: [`workspace-batch-reconcile:${plan.actionId}:indeterminate`],
        };
      },
      captureBaseline: async plan => {
        assertBatchMatchesBaselines(plan.payload, authorizedBaselines);
        return {
          baselineRef: `vscode-batch-baseline:${plan.actionId}`,
          state: authorizedBaselines,
          evidenceRefs: [`workspace-batch-baseline:${plan.actionId}`],
        };
      },
      apply: async (plan, baseline) => {
        if (baseline.state.some(item => !this.edits.isTextFileBaselineCurrent(item))) {
          return {
            status: 'rejected',
            mutationState: 'unchanged',
            errorCode: 'workspace-batch-baseline-conflict',
            evidenceRefs: [`workspace-batch-apply:${plan.actionId}:baseline-conflict`],
          };
        }
        const commitTokens: WorkspaceTextFileCommitToken[] = [];
        const committed: WorkspaceCommittedEdit[] = [];
        const createdDirs = new Set<string>();
        try {
          for (let index = 0; index < plan.payload.items.length; index += 1) {
            const item = plan.payload.items[index];
            for (const dir of collectMissingParentDirs(nodePath.dirname(item.absPath), plan.payload.workspaceRoot)) {
              createdDirs.add(dir);
            }
            const edit = this.edits.commitTextFileProposal(
              this.edits.proposeTextFileWrite(item.absPath, item.content),
              baseline.state[index],
              { validateSourceSanity: true, repairSourceTransportEscapes: true },
            );
            committed.push(edit);
            commitTokens.push(edit.commitToken);
          }
          return {
            status: 'applied',
            applied: {
              state: { commitTokens, createdDirs: [...createdDirs] },
              result: committed,
              evidenceRefs: [`workspace-batch-apply:${plan.actionId}:committed`],
            },
          };
        } catch (error) {
          const possiblyChanged = commitTokens.length > 0 || createdDirs.size > 0;
          const failure = describeWorkspaceMutationError(error, 'batch');
          return {
            status: 'rejected',
            mutationState: possiblyChanged ? 'possibly-changed' : 'unchanged',
            errorCode: failure.code,
            ...(failure.detail ? { errorDetail: failure.detail } : {}),
            ...(possiblyChanged ? {
              applied: {
                state: { commitTokens, createdDirs: [...createdDirs] },
                result: committed,
                evidenceRefs: [`workspace-batch-apply:${plan.actionId}:partial`],
              },
            } : {}),
            evidenceRefs: [`workspace-batch-apply:${plan.actionId}:rejected`],
          };
        }
      },
      readback: async (plan, _baseline, applied) => {
        const identityMatches = applied.state.commitTokens.length === plan.payload.items.length
          && applied.state.commitTokens.every(token => this.edits.isTextFileBaselineCurrent(token.after));
        if (!identityMatches || !verifyReadback) {
          return {
            matches: identityMatches,
            readbackRef: `vscode-batch-readback:${plan.actionId}`,
            evidenceRefs: [`workspace-batch-readback:${plan.actionId}:${identityMatches ? 'matched' : 'mismatched'}`],
          };
        }
        const verification = await verifyReadback({ committed: applied.result ?? [] });
        return {
          matches: verification.matches,
          readbackRef: `vscode-batch-readback:${plan.actionId}`,
          evidenceRefs: [
            `workspace-batch-readback:${plan.actionId}:${verification.matches ? 'matched' : 'mismatched'}`,
            ...verification.evidenceRefs,
          ],
        };
      },
      rollback: async (plan, _baseline, applied) => {
        if (!applied) {
          return {
            rolledBack: false,
            evidenceRefs: [`workspace-batch-rollback:${plan.actionId}:missing-commit-state`],
          };
        }
        const failures: string[] = [];
        for (const token of [...applied.state.commitTokens].reverse()) {
          const rollback = this.edits.rollbackTextFileCommit(token);
          if (!rollback.rolledBack) failures.push(token.absPath);
        }
        cleanupCreatedEmptyDirs(applied.state.createdDirs);
        return {
          rolledBack: failures.length === 0,
          ...(failures.length === 0 ? { rollbackRef: `vscode-batch-rollback:${plan.actionId}` } : {}),
          evidenceRefs: [
            `workspace-batch-rollback:${plan.actionId}:${failures.length === 0 ? 'completed' : 'failed'}`,
          ],
        };
      },
    };
  }
}

function assertBatchMatchesBaselines(
  payload: BatchPayload,
  baselines: readonly WorkspaceTextFileBaseline[],
): void {
  if (payload.items.length === 0 || payload.items.length !== baselines.length) {
    throw new Error('vscode-workspace-batch:baseline-count-mismatch');
  }
  payload.items.forEach((item, index) => {
    const baseline = baselines[index];
    if (item.absPath !== baseline.absPath || payload.workspaceRoot !== baseline.workspaceRoot) {
      throw new Error('vscode-workspace-batch:baseline-scope-mismatch');
    }
  });
}

function collectMissingParentDirs(parentFsPath: string, rootFsPath: string): string[] {
  const root = nodePath.resolve(rootFsPath);
  let current = nodePath.resolve(parentFsPath);
  const dirs: string[] = [];
  while (current !== root && current.startsWith(root + nodePath.sep)) {
    if (!fs.existsSync(current)) dirs.push(current);
    const next = nodePath.dirname(current);
    if (next === current) break;
    current = next;
  }
  return dirs.reverse();
}

function cleanupCreatedEmptyDirs(createdDirs: readonly string[]): void {
  for (const dir of [...createdDirs].sort((left, right) => right.length - left.length)) {
    try {
      if (!fs.existsSync(dir)) continue;
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(dir).length > 0) continue;
      fs.rmdirSync(dir);
    } catch {
      // File rollback is authoritative; directory cleanup is best effort.
    }
  }
}
