import { bindProviderNormalizationBoundary } from '../llm/provider-events';
import type { AgentLoopCallbacks } from './loop-types';
import { chatWithMessages } from './loop-chat';
import {
  IndependentRequirementReviewer,
  type RequirementReviewInvocationResult,
} from './independent-requirement-review';
import {
  RequirementReviewLedger,
  type RequirementReviewInput,
  type RequirementReviewNoToolRecovery,
} from './requirement-review-ledger';

export interface ProviderRequirementReviewInput {
  userPrompt: () => string;
  workspaceRoot: string;
  mode: 'fast' | 'r1' | undefined;
  callbacks: AgentLoopCallbacks;
  onProviderSessionReplaced: () => void;
}

export interface ProviderRequirementReviewService {
  request(input: RequirementReviewInput): Promise<string | undefined>;
  completionBlocker(): string | undefined;
  recoverNoToolCompletion(consecutiveRound: number): RequirementReviewNoToolRecovery | undefined;
}

/** Composes requirement-review state with a fresh, read-only provider session. */
export function createProviderRequirementReviewService(
  input: ProviderRequirementReviewInput,
): ProviderRequirementReviewService {
  const ledger = new RequirementReviewLedger();
  const reviewer = new IndependentRequirementReviewer(async messages => {
    input.onProviderSessionReplaced();
    input.callbacks.onToolActivity?.('label', '使用独立上下文审查最终源码');
    const turn = await chatWithMessages(
      messages,
      input.mode,
      undefined,
      input.callbacks.signal,
      true,
      input.callbacks.traceRunId,
      input.callbacks.traceWorkspaceRoot,
      input.callbacks.traceEvidenceParticipantToken,
      input.callbacks.onTraceEvidenceError,
      bindProviderNormalizationBoundary(
        input.callbacks.canonicalProviderEvents,
        input.callbacks.canonicalToolDispatch,
        { workspaceRoot: input.workspaceRoot },
      ),
    );
    return {
      text: turn.text,
      toolCount: turn.tools.length,
    } satisfies RequirementReviewInvocationResult;
  });

  return {
    async request(reviewInput): Promise<string | undefined> {
      const sourceFeedback = ledger.request(reviewInput);
      const candidate = ledger.takeIndependentReviewCandidate();
      if (!candidate) return sourceFeedback;
      const decision = await reviewer.review({
        userPrompt: input.userPrompt(),
        workspaceRoot: input.workspaceRoot,
        sourcePaths: candidate.sourcePaths,
        validationSummary: reviewInput.qualityGate?.summary,
      });
      return ledger.settleIndependentReview(decision);
    },
    completionBlocker: () => ledger.completionBlocker(),
    recoverNoToolCompletion: consecutiveRound => ledger.recoverNoToolCompletion(consecutiveRound),
  };
}
