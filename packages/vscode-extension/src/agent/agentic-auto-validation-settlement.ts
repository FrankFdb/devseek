import type { AgenticHistoryQualityGate } from './agentic-history';
import type { AgentAutoValidationResult } from './auto-validation';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { classifyAgenticManualReviewEvidence } from './terminal-evidence-settlement';

export function normalizeAgenticAutoValidation(input: {
  autoValidation: AgentAutoValidationResult;
  userPrompt: string;
  writtenFiles: WrittenFileEvidence[];
}): {
  evidence: TerminalEvidence[];
  feedbackForAI: string;
  qualityGate?: AgenticHistoryQualityGate;
  manualReviewEvidence?: TerminalEvidence;
} {
  const evidence = classifyAgenticManualReviewEvidence({
    evidence: input.autoValidation.evidence ? [input.autoValidation.evidence] : [],
    feedbackForAI: input.autoValidation.feedbackForAI || '',
    userPrompt: input.userPrompt,
    writtenFiles: input.writtenFiles,
  });
  const manualReviewEvidence = evidence.find(item => item.reviewRequired);
  if (manualReviewEvidence) {
    return {
      evidence,
      feedbackForAI: `【系统反馈】运行验证需要人工确认：${manualReviewEvidence.detail || '图形或交互式程序已启动，需人工确认窗口和交互效果。'}`,
      manualReviewEvidence,
    };
  }
  return {
    evidence,
    feedbackForAI: input.autoValidation.feedbackForAI ?? '',
    qualityGate: input.autoValidation.qualityGate,
  };
}
