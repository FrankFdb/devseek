import { createHash } from 'crypto';
import {
  codingAdverseToolExecutionBlocksCompletion,
  codingDeniedToolExecutionIsPolicyNoEffect,
  isSecretHarvestingRefusalTaskContract,
  settledCodingVerificationReceipts,
  type CodingCompletionAcceptanceDecision,
  type CodingKernelCompletionEvidence,
  type CodingKernelTaskContract,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
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
          && codingAdverseToolExecutionBlocksCompletion(
            receipt,
            toolExecutions,
            mutations,
            verifications,
          )
      ))
      .flatMap(receipt => receipt.evidenceRefs));
    const neutralPolicyDeniedRefs = uniqueNonEmpty(toolExecutions
      .filter(codingDeniedToolExecutionIsPolicyNoEffect)
      .flatMap(receipt => receipt.evidenceRefs));
    const recoveredDeniedRefs = uniqueNonEmpty(toolExecutions
      .filter(receipt => (
        receipt.status === 'denied'
          && !codingAdverseToolExecutionBlocksCompletion(
            receipt,
            toolExecutions,
            mutations,
            verifications,
          )
      ))
      .flatMap(receipt => receipt.evidenceRefs));
    const tasksFailed = shouldClearRecoveredTaskFailure({
      tasksFailed: input.result.tasksFailed,
      failedReason: input.result.failedReason,
      deniedEffectRefs,
      neutralPolicyDeniedRefs,
      recoveredDeniedRefs,
      failedArtifactRefs,
      uncoveredChangedPaths,
      changedPaths: input.result.changedPaths,
      toolExecutions,
      mutations,
      verifications,
    })
      ? 0
      : input.result.tasksFailed;
    const acceptanceEvidence = buildDirectAcceptanceEvidence({
      acceptance: input.taskContract.acceptance,
      tasksFailed,
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
      ...(tasksFailed > 0 && deniedEffectRefs.length === 0
        ? { requestedTerminalStatus: 'failed' as const }
        : {}),
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
        ...(tasksFailed > 0 ? [failureRef] : []),
      ],
    };
  }
}

function shouldClearRecoveredTaskFailure(input: {
  readonly tasksFailed: number;
  readonly failedReason?: string;
  readonly deniedEffectRefs: readonly string[];
  readonly neutralPolicyDeniedRefs: readonly string[];
  readonly recoveredDeniedRefs: readonly string[];
  readonly failedArtifactRefs: readonly string[];
  readonly uncoveredChangedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
}): boolean {
  if (input.tasksFailed <= 0) return false;
  if (input.deniedEffectRefs.length > 0) return false;
  if (input.failedArtifactRefs.length > 0 || input.uncoveredChangedPaths.length > 0) return false;
  if (input.changedPaths.length === 0) return false;
  const policyDeniedFailureWasRecovered = input.neutralPolicyDeniedRefs.length > 0
    && (!hasFailureReason(input.failedReason) || isDeniedToolFailure(input.failedReason));
  const deniedToolFailureWasRecovered = isDeniedToolFailure(input.failedReason)
    && input.recoveredDeniedRefs.length > 0;
  const verificationFailureWasRecovered = isVerificationFailure(input.failedReason)
    && hasRecoveredVerificationFailure(input.verifications, input.toolExecutions);
  if (!policyDeniedFailureWasRecovered
    && !deniedToolFailureWasRecovered
    && !verificationFailureWasRecovered) {
    return false;
  }
  return allChangedPathsHaveCommittedReadback(input.changedPaths, input.mutations)
    && hasPassedVerification(input.verifications);
}

function isDeniedToolFailure(reason: string | undefined): boolean {
  return /(?:工具\s+\S+\s+未获授权|tool\b.*\b(?:denied|not authorized)|authorization denied)/iu
    .test(String(reason || ''));
}

function isVerificationFailure(reason: string | undefined): boolean {
  return /(?:\b(?:validation|verification)\b.*\bfailed\b|\bfailed\b.*\b(?:validation|verification)\b|(?:编译|测试|运行|验证)(?:失败|未通过)|(?:失败|未通过).*(?:编译|测试|运行|验证))/iu
    .test(String(reason || ''));
}

function hasFailureReason(reason: string | undefined): boolean {
  return Boolean(reason?.trim());
}

function hasRecoveredVerificationFailure(
  verifications: readonly CodingVerificationReceipt[],
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): boolean {
  if (!verifications.some(receipt => receipt.status === 'failed')) return false;
  const settled = settledCodingVerificationReceipts(verifications, toolExecutions);
  return settled.length > 0 && settled.every(receipt => receipt.status === 'passed');
}

function allChangedPathsHaveCommittedReadback(
  changedPaths: readonly string[],
  mutations: readonly CodingWorkspaceMutationReceipt<unknown>[],
): boolean {
  const committedReadbackPaths = mutations
    .filter(receipt => (
      receipt.status === 'committed'
        && receipt.paths.length > 0
        && Boolean(receipt.baselineRef)
        && Boolean(receipt.readbackRef)
    ))
    .flatMap(receipt => receipt.paths)
    .map(normalizePath);
  if (committedReadbackPaths.length === 0) return false;
  return uniqueNonEmpty(changedPaths.map(normalizePath)).every(
    changedPath => committedReadbackPaths.some(committedPath => sameMutationPath(changedPath, committedPath)),
  );
}

function hasPassedVerification(
  verifications: readonly CodingVerificationReceipt[],
): boolean {
  return verifications.some(receipt => (
    receipt.status === 'passed'
      && receipt.acceptance.length > 0
      && receipt.acceptance.every(result => result.status === 'passed')
  ));
}

function buildDirectAcceptanceEvidence(input: {
  readonly acceptance: CodingKernelTaskContract['acceptance'];
  readonly tasksFailed: number;
  readonly resultEvidenceRefs: readonly string[];
  readonly failedArtifactRefs: readonly string[];
  readonly failureRef: string;
  readonly deniedEffectRefs: readonly string[];
  readonly explicitEvidence: readonly CodingCompletionAcceptanceDecision[];
  readonly requiresDirectEvidence: boolean;
}): CodingCompletionAcceptanceDecision[] {
  if (input.deniedEffectRefs.length > 0) {
    return input.acceptance
      .filter(criterion => criterion.oracle.kind !== 'authority')
      .map(criterion => ({
        criterionId: criterion.id,
        status: 'blocked',
        evidenceRefs: input.deniedEffectRefs,
      }));
  }
  if (input.tasksFailed > 0) {
    return input.acceptance
      .filter(criterion => criterion.oracle.kind !== 'authority')
      .map(criterion => ({
        criterionId: criterion.id,
        status: 'failed',
        evidenceRefs: [input.failureRef],
      }));
  }
  if (input.failedArtifactRefs.length > 0) {
    return input.acceptance
      .filter(criterion => criterion.oracle.kind !== 'authority')
      .map(criterion => ({
        criterionId: criterion.id,
        status: 'failed',
        evidenceRefs: input.failedArtifactRefs,
      }));
  }
  if (input.requiresDirectEvidence) return [...input.explicitEvidence];
  if (input.resultEvidenceRefs.length === 0) return [...input.explicitEvidence];
  const explicitCriterionIds = new Set(input.explicitEvidence.map(result => result.criterionId));
  return [
    ...input.explicitEvidence,
    ...input.acceptance
      .filter(criterion => !explicitCriterionIds.has(criterion.id))
      .filter(criterion => criterion.oracle.kind === 'response-evidence')
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
