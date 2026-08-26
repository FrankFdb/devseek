import { bindProviderNormalizationBoundary } from '../llm/provider-events';
import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';
import { chatWithMessages } from './loop-chat';
import {
  IndependentRequirementReviewer,
  type RequirementReviewInvocationResult,
} from './independent-requirement-review';
import { RequirementReviewFindingAdjudicator } from './requirement-review-finding-adjudicator';
import {
  RequirementReviewLedger,
  type RequirementReviewInput,
  type RequirementReviewNoToolRecovery,
} from './requirement-review-ledger';
import {
  RequirementReviewPolicy,
} from './requirement-review-policy';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { CodingKernelTaskContract } from '@devseek-netai/shared';
import { isCodeArtifactPath } from './completion-evidence';

export interface ProviderRequirementReviewInput {
  userPrompt: () => string;
  workspaceRoot: string;
  mode: 'fast' | 'r1' | undefined;
  callbacks: AgentLoopCallbacks;
  onProviderSessionReplaced: () => void;
  semanticContract: () => TaskSemanticContract | undefined;
  canonicalTaskContract: () => CodingKernelTaskContract | undefined;
}

export interface ProviderRequirementReviewService {
  request(input: RequirementReviewInput): Promise<ProviderRequirementReviewOutcome>;
  completionBlocker(): string | undefined;
  recoverNoToolCompletion(consecutiveRound: number): RequirementReviewNoToolRecovery | undefined;
}

export type ProviderRequirementReviewOutcome =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'feedback'; readonly feedback: string }
  | { readonly kind: 'settled' };

/** Composes requirement-review state with a fresh, read-only provider session. */
export function createProviderRequirementReviewService(
  input: ProviderRequirementReviewInput,
): ProviderRequirementReviewService {
  const ledger = new RequirementReviewLedger();
  const policy = new RequirementReviewPolicy();
  const invokeReadOnlyReview = async (
    messages: ChatMessage[],
    activity: string,
  ): Promise<RequirementReviewInvocationResult> => {
    input.onProviderSessionReplaced();
    input.callbacks.onToolActivity?.('label', activity);
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
  };
  const reviewer = new IndependentRequirementReviewer(messages => (
    invokeReadOnlyReview(messages, '使用独立上下文审查最终源码')
  ));
  const adjudicator = new RequirementReviewFindingAdjudicator(messages => (
    invokeReadOnlyReview(messages, '使用独立上下文复核审查 finding')
  ));

  return {
    async request(reviewInput): Promise<ProviderRequirementReviewOutcome> {
      if (!reviewInput.writtenFiles.some(file => isCodeArtifactPath(file.path))) {
        return { kind: 'not-applicable' };
      }
      const policyDecision = policy.evaluate({
        ...reviewInput,
        workspaceRoot: input.workspaceRoot,
        semanticContract: input.semanticContract(),
        canonicalTaskContract: input.canonicalTaskContract(),
      });
      const sourceFeedback = ledger.request(reviewInput, policyDecision);
      const candidate = ledger.takeIndependentReviewCandidate();
      if (!candidate) {
        return sourceFeedback
          ? { kind: 'feedback', feedback: sourceFeedback }
          : { kind: 'settled' };
      }
      const candidateInput = {
        userPrompt: input.userPrompt(),
        workspaceRoot: input.workspaceRoot,
        sourcePaths: candidate.sourcePaths,
        contextPaths: candidate.contextPaths,
        validationSummary: reviewInput.qualityGate?.summary,
      };
      const proposedDecision = await reviewer.review(candidateInput);
      const decision = await adjudicator.adjudicate({
        ...candidateInput,
        decision: proposedDecision,
      });
      const feedback = ledger.settleIndependentReview(decision);
      return feedback
        ? { kind: 'feedback', feedback }
        : { kind: 'settled' };
    },
    completionBlocker: () => ledger.completionBlocker(),
    recoverNoToolCompletion: consecutiveRound => ledger.recoverNoToolCompletion(consecutiveRound),
  };
}
