import { createHash } from 'crypto';
import {
  CanonicalCompletionDecisionService,
  type CodingCompletionAcceptanceDecision,
  type CodingCompletionDecision,
  type CodingKernelTaskContract,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
  type CompletionDecisionPort,
} from '@devseek-netai/shared';
import type { EvidenceRef } from '../agent/evidence-grounding';
import type { AgentLoopResult } from '../agent/loop-types';

export interface VsCodeCompletionInput {
  readonly runId: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly result: AgentLoopResult;
  readonly cancelled?: boolean;
}

/** Projects VS Code run evidence into the shared terminal-decision authority. */
export class VsCodeCompletionAdapter {
  constructor(
    private readonly completion: CompletionDecisionPort = new CanonicalCompletionDecisionService(),
  ) {}

  decide(input: VsCodeCompletionInput): CodingCompletionDecision {
    const verificationRequired = input.taskContract.mode === 'change'
      || input.taskContract.mode === 'release';
    const resultEvidenceRefs = collectResultEvidenceRefs(input.runId, input.result);
    const failedArtifactRefs = collectFailedArtifactRefs(input.result);
    const uncoveredChangedPaths = findUncoveredChangedPaths(
      input.result.changedPaths,
      input.result.changeReceipts ?? [],
    );
    const failureRef = `vscode-agent-result:${input.runId}:tasks-failed`;
    const deniedEffectRefs = uniqueNonEmpty((input.result.toolExecutionReceipts ?? [])
      .filter(receipt => receipt.status === 'denied')
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
    });
    const pendingRefs = uncoveredChangedPaths.map(
      path => `vscode-mutation-receipt-missing:${normalizePath(path)}`,
    );
    const reviewRequired = input.result.manualReviewRequired === true;
    const verifications = input.result.verificationReceipts ?? [];

    return this.completion.decide({
      runId: input.runId,
      decisionId: 'vscode-completion',
      idempotencyKey: `${input.runId}:vscode-completion`,
      acceptance: input.taskContract.acceptance,
      verificationRequired,
      reviewRequired,
      ...(input.cancelled ? { requestedTerminalStatus: 'cancelled' as const } : {}),
      toolExecutions: input.result.toolExecutionReceipts ?? [],
      mutations: input.result.changeReceipts ?? [],
      verifications,
      resolvedVerificationActionIds: findSupersededVerificationActionIds(verifications),
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
    });
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

function findSupersededVerificationActionIds(
  receipts: readonly CodingVerificationReceipt[],
): string[] {
  return receipts
    .filter(receipt => receipt.status !== 'passed')
    .filter(receipt => receipts.some(candidate => verificationSupersedes(candidate, receipt)))
    .map(receipt => receipt.actionId);
}

function verificationSupersedes(
  candidate: CodingVerificationReceipt,
  previous: CodingVerificationReceipt,
): boolean {
  if (candidate.status !== 'passed'
    || candidate.runId !== previous.runId
    || candidate.sequence <= previous.sequence) {
    return false;
  }
  const candidatePaths = new Set(candidate.scopePaths.map(normalizePath));
  if (!previous.scopePaths.every(path => candidatePaths.has(normalizePath(path)))) return false;
  const passedAcceptance = new Set(
    candidate.acceptance
      .filter(item => item.status === 'passed')
      .map(item => item.criterionId),
  );
  return previous.acceptance.length > 0
    && previous.acceptance.every(item => passedAcceptance.has(item.criterionId));
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
