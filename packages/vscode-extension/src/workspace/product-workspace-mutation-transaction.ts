import {
  CanonicalWorkspaceMutationTransaction,
  CanonicalDirtyWorktreePolicyService,
  FileSystemCodingOperationJournal,
  codingSemanticDigest,
  observeGitWorktreeSync,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import * as nodePath from 'path';

export interface ProductWorkspaceMutationSessionInput {
  readonly workspaceRoot: string;
  readonly canonicalTransaction?: WorkspaceMutationTransactionPort;
  readonly canonicalRunId?: string;
  readonly owner: string;
  readonly operationIdentity: unknown;
}

export interface ProductWorkspaceMutationSession {
  readonly transaction: WorkspaceMutationTransactionPort;
  readonly runId: string;
}

/** Product composition boundary for non-kernel workspace mutation entry points. */
export function resolveProductWorkspaceMutationTransaction(
  workspaceRoot: string,
  canonical?: WorkspaceMutationTransactionPort,
  runId = `vscode-product-workspace-${codingSemanticDigest({ workspaceRoot: nodePath.resolve(workspaceRoot) }).slice(0, 24)}`,
): WorkspaceMutationTransactionPort {
  if (canonical) return canonical;
  const dirtyWorktree = new CanonicalDirtyWorktreePolicyService().bind({
    runId,
    snapshot: observeGitWorktreeSync({ workspaceRoot }),
  });
  return new CanonicalWorkspaceMutationTransaction(
    FileSystemCodingOperationJournal.forWorkspace(workspaceRoot),
    undefined,
    dirtyWorktree,
  );
}

/** Gives non-Kernel product paths a durable, semantic run identity and journal owner. */
export function resolveProductWorkspaceMutationSession(
  input: ProductWorkspaceMutationSessionInput,
): ProductWorkspaceMutationSession {
  const canonicalRunId = input.canonicalRunId?.trim();
  const owner = input.owner.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
  if (!owner) throw new Error('vscode-product-workspace-mutation:missing-owner');
  const runId = canonicalRunId || `vscode-${owner}-${codingSemanticDigest({
    protocol: 'devseek.vscode-product-workspace-mutation/v1',
    workspaceRoot: nodePath.resolve(input.workspaceRoot),
    owner,
    operationIdentity: input.operationIdentity,
  }).slice(0, 24)}`;
  return Object.freeze({
    transaction: resolveProductWorkspaceMutationTransaction(
      input.workspaceRoot,
      input.canonicalTransaction,
      runId,
    ),
    runId,
  });
}
