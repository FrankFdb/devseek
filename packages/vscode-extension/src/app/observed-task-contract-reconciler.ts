import {
  codingSemanticDigest,
  reconcileSettledCodingModelAction,
  type CodingKernelTaskContract,
  type CodingTaskContractRevisionCandidate,
  type CodingToolExecutionReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import path from 'node:path';
import type {
  ModelToolSemanticEvidenceBinding,
  ModelToolSemanticSettlementFragment,
} from '../agent/model-tool-semantic-proposal';

export interface ObservedTaskContractReconciliationInput {
  readonly current: CodingKernelTaskContract;
  readonly semanticFragments: readonly ModelToolSemanticSettlementFragment[];
  readonly contextFiles: readonly string[];
  readonly workspaceRoot: string;
  readonly toolReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

/**
 * Revises the turn contract from receipt-settled actions. An observation can
 * refine evidence, but it cannot reinterpret an outstanding user deliverable
 * as the goal of the whole turn.
 */
export function reconcileObservedTaskContract(
  input: ObservedTaskContractReconciliationInput,
): CodingTaskContractRevisionCandidate | undefined {
  let current = input.current;
  let revisionId = '';
  const evidenceRefs: string[] = [];
  const contextFiles = normalizeWorkspacePaths(input.contextFiles, input.workspaceRoot);
  const changeReceipts = input.changeReceipts.map(receipt => ({
    ...receipt,
    paths: normalizeWorkspacePaths(receipt.paths, input.workspaceRoot),
  }));

  for (const fragment of input.semanticFragments) {
    for (const binding of fragment.evidenceBindings) {
      const receipts = matchingReceipts(binding, input.toolReceipts);
      for (const receipt of receipts) {
        const candidate = reconcileSettledCodingModelAction({
          current,
          surface: 'vscode',
          action: {
            actionId: receipt.actionId,
            tool: binding.tool,
            purpose: binding.purpose,
            effects: binding.effects,
            inputSha256: binding.inputSha256,
            targetPaths: normalizeWorkspacePaths(
              binding.targetPaths.length > 0 ? binding.targetPaths : fragment.targetPaths,
              input.workspaceRoot,
            ),
          },
          contextFiles,
          toolReceipts: [receipt],
          changeReceipts,
        });
        if (!candidate) continue;
        current = candidate.taskContract;
        revisionId = candidate.revisionId;
        evidenceRefs.push(...candidate.evidenceRefs);
      }
    }
  }

  if (!revisionId || codingSemanticDigest(current) === codingSemanticDigest(input.current)) {
    return undefined;
  }
  return {
    revisionId,
    taskContract: current,
    evidenceRefs: unique(evidenceRefs),
  };
}

function matchingReceipts(
  binding: ModelToolSemanticEvidenceBinding,
  receipts: readonly CodingToolExecutionReceipt<unknown>[],
): CodingToolExecutionReceipt<unknown>[] {
  return receipts.filter(receipt => (
    receipt.tool === binding.tool
      && receipt.purpose === binding.purpose
      && receipt.inputSha256 === binding.inputSha256
      && sameValues(receipt.effects, binding.effects)
  ));
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeWorkspacePaths(values: readonly string[], workspaceRoot: string): string[] {
  const root = path.resolve(workspaceRoot);
  return unique(values.flatMap(value => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
    const relative = path.relative(root, absolute).replace(/\\/gu, '/');
    return relative && relative !== '..' && !relative.startsWith('../') ? [relative] : [];
  }));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
