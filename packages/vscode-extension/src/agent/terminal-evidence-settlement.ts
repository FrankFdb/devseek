import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { shouldRequestManualReviewForRun } from './manual-review-validation';

export function classifyAgenticManualReviewEvidence(input: {
  readonly evidence: readonly TerminalEvidence[] | undefined;
  readonly feedbackForAI: string;
  readonly userPrompt: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
}): TerminalEvidence[] {
  if (!input.evidence?.length) return [];
  const changedPaths = input.writtenFiles.map(file => file.path).filter(Boolean);
  return input.evidence.map((evidence) => {
    if (evidence.reviewRequired || evidence.ok) return evidence;
    const review = shouldRequestManualReviewForRun({
      userPrompt: input.userPrompt,
      command: evidence.command,
      output: input.feedbackForAI || evidence.detail || '',
      changedPaths,
      terminalEvidence: evidence,
    });
    return review
      ? {
          ...evidence,
          ok: true,
          reviewRequired: true,
          detail: review.detail,
        }
      : evidence;
  });
}
