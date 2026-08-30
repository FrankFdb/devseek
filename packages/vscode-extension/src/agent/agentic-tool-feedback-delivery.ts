import type { ToolLoopResult } from './tool-loop-result';
import { projectAgenticToolFeedback } from './agentic-context-compaction';
import type { ContextInvestigationLedger } from './context-investigation-ledger';

interface AgenticToolFeedbackDeliveryInput {
  readonly round: number;
  readonly result: ToolLoopResult;
  readonly additionalSegments?: readonly string[];
  readonly contextInvestigation: ContextInvestigationLedger;
  readonly appendUserFeedback: (feedback: string) => void;
}

export interface AgenticToolFeedbackDeliveryResult {
  readonly novelReadExposureCount: number;
}

/** Delivers bounded tool output and binds read authority to the visible projection. */
export function deliverAgenticToolFeedback(
  input: AgenticToolFeedbackDeliveryInput,
): AgenticToolFeedbackDeliveryResult {
  const projection = projectAgenticToolFeedback(input.round, [
    ...(input.result.feedbackSegmentsForAI?.length
      ? input.result.feedbackSegmentsForAI
      : [input.result.feedbackForAI]),
    ...(input.additionalSegments ?? []),
  ]);
  const coverageUpdate = input.contextInvestigation.recordVisibleReadExposures(
    projection.readExposures,
    input.result.fileAccessEvents ?? [],
  );
  input.appendUserFeedback(projection.message);
  return Object.freeze({ novelReadExposureCount: coverageUpdate.novelExposureCount });
}
