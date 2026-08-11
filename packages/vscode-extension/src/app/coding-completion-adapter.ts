import { createHash } from 'crypto';
import {
  codingAdverseToolExecutionWasRecovered,
  codingTaskContractRequiresVerification,
  isSecretHarvestingRefusalTaskContract,
  type CodingCompletionAcceptanceDecision,
  type CodingKernelCompletionEvidence,
  type CodingKernelTaskContract,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import type { EvidenceRef } from '../agent/evidence-grounding';
import type { AgentLoopResult } from '../agent/loop-types';

export interface VsCodeCompletionInput {
  readonly runId: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly result: AgentLoopResult;
}

/** Projects VS Code observations without owning or predicting terminal state. */
export class VsCodeCompletionEvidenceAdapter {
  project(input: VsCodeCompletionInput): CodingKernelCompletionEvidence {
    const verificationRequired = codingTaskContractRequiresVerification(input.taskContract);
    const resultEvidenceRefs = collectResultEvidenceRefs(input.runId, input.result);
    const failedArtifactRefs = collectFailedArtifactRefs(input.result);
    const uncoveredChangedPaths = findUncoveredChangedPaths(
      input.result.changedPaths,
      input.result.changeReceipts ?? [],
    );
    const failureRef = `vscode-agent-result:${input.runId}:tasks-failed`;
    const toolExecutions = input.result.toolExecutionReceipts ?? [];
    const mutations = input.result.changeReceipts ?? [];
    const verifications = input.result.verificationReceipts ?? [];
    const deniedEffectRefs = uniqueNonEmpty(toolExecutions
      .filter(receipt => (
        receipt.status === 'denied'
          && !codingAdverseToolExecutionWasRecovered(
            receipt,
            toolExecutions,
            mutations,
            verifications,
          )
      ))
      .flatMap(receipt => receipt.evidenceRefs));
    const acceptanceEvidence = buildDirectAcceptanceEvidence({
      acceptance: input.taskContract.acceptance,
      verificationRequired,
      tasksFailed: input.result.tasksFailed,
      resultEvidenceRefs,
      failedArtifactRefs,
      failureRef,
      deniedEffectRefs,
      explicitEvidence: input.result.acceptanceEvidence ?? [],
      requiresDirectEvidence: isSecretHarvestingRefusalTaskContract(input.taskContract),
    });
    const pendingRefs = uncoveredChangedPaths.map(
      path => `vscode-mutation-receipt-missing:${normalizePath(path)}`,
    );
    const reviewRequired = input.result.manualReviewRequired === true;
    return {
      reviewRequired,
      acceptanceEvidence,
      ...(reviewRequired ? {
        review: { status: 'not-run' as const, evidenceRefs: [] },
      } : {}),
      pendingRefs,
      adverseEvidenceRefs: failedArtifactRefs,
      residualRisks: uniqueNonEmpty([
        ...(input.result.manualReviewReason ? [input.result.manualReviewReason] : []),
        ...(deniedEffectRefs.length > 0 ? ['requested-change-not-applied'] : []),
      ]),
      evidenceRefs: [
        ...input.taskContract.provenanceRefs,
        ...resultEvidenceRefs,
        ...(input.result.tasksFailed > 0 ? [failureRef] : []),
      ],
    };
  }
}

function buildDirectAcceptanceEvidence(input: {
  readonly acceptance: CodingKernelTaskContract['acceptance'];
  readonly verificationRequired: boolean;
  readonly tasksFailed: number;
  readonly resultEvidenceRefs: readonly string[];
  readonly failedArtifactRefs: readonly string[];
  readonly failureRef: string;
  readonly deniedEffectRefs: readonly string[];
  readonly explicitEvidence: readonly CodingCompletionAcceptanceDecision[];
  readonly requiresDirectEvidence: boolean;
}): CodingCompletionAcceptanceDecision[] {
  if (input.deniedEffectRefs.length > 0) {
    return input.acceptance.map(criterion => ({
      criterionId: criterion.id,
      status: 'blocked',
      evidenceRefs: input.deniedEffectRefs,
    }));
  }
  if (input.tasksFailed > 0) {
    return input.acceptance.map(criterion => ({
      criterionId: criterion.id,
      status: 'failed',
      evidenceRefs: [input.failureRef],
    }));
  }
  if (input.failedArtifactRefs.length > 0) {
    return input.acceptance.map(criterion => ({
      criterionId: criterion.id,
      status: 'failed',
      evidenceRefs: input.failedArtifactRefs,
    }));
  }
  if (input.requiresDirectEvidence) return [...input.explicitEvidence];
  if (input.verificationRequired || input.resultEvidenceRefs.length === 0) {
    return [...input.explicitEvidence];
  }
  const explicitCriterionIds = new Set(input.explicitEvidence.map(result => result.criterionId));
  return [
    ...input.explicitEvidence,
    ...input.acceptance
      .filter(criterion => !explicitCriterionIds.has(criterion.id))
      .map(criterion => ({
        criterionId: criterion.id,
        status: 'passed' as const,
        evidenceRefs: input.resultEvidenceRefs,
      })),
  ];
}

function collectResultEvidenceRefs(runId: string, result: AgentLoopResult): string[] {
  const refs = [
    ...(result.verificationIds ?? []).map(id => `vscode-verification:${id.trim()}`),
    ...(result.verificationResults ?? [])
      .filter(item => item.ok)
      .map(item => `vscode-artifact-verification:${item.verificationId.trim()}`),
    ...(result.evidenceRefs ?? []).map(projectEvidenceRef).filter((value): value is string => Boolean(value)),
    ...(result.analysisText?.trim()
      ? [`vscode-analysis:${runId}:${contentDigest(result.analysisText)}`]
      : []),
    ...(result.historyText?.trim()
      ? [`vscode-history:${runId}:${contentDigest(result.historyText)}`]
      : []),
  ];
  return uniqueNonEmpty(refs);
}

function collectFailedArtifactRefs(result: AgentLoopResult): string[] {
  return uniqueNonEmpty((result.verificationResults ?? [])
    .filter(item => !item.ok)
    .map(item => `vscode-artifact-verification:${item.verificationId.trim()}:failed`));
}

function projectEvidenceRef(ref: EvidenceRef): string | undefined {
  const evidenceId = ref.evidenceId?.trim();
  if (evidenceId) return `vscode-evidence:${evidenceId}`;
  const opaqueRef = ref.ref?.trim();
  if (opaqueRef) return `vscode-evidence-ref:${opaqueRef}`;
  const operationId = ref.operationId?.trim();
  if (operationId) return `vscode-operation:${operationId}`;
  const contentHash = ref.contentHash?.trim();
  if (contentHash) {
    return `vscode-content:${normalizePath(ref.sourcePath ?? ref.label)}:${contentHash}`;
  }
  return undefined;
}

function findUncoveredChangedPaths(
  changedPaths: readonly string[],
  receipts: readonly CodingWorkspaceMutationReceipt<unknown>[],
): string[] {
  const committedPaths = receipts
    .filter(receipt => receipt.status === 'committed')
    .flatMap(receipt => receipt.paths)
    .map(normalizePath);
  return uniqueNonEmpty(changedPaths.map(normalizePath)).filter(
    changedPath => !committedPaths.some(committedPath => sameMutationPath(changedPath, committedPath)),
  );
}

function sameMutationPath(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function contentDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
