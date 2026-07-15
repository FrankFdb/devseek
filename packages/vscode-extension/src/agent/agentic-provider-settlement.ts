import {
  coalesceWrittenFileEvidence,
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  getMissingCompletionEvidence,
  getUnsupportedSummaryFileClaims,
  type CompletionTodo,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';

export interface ProviderFailureSettlementInput {
  promptRequiresTools: boolean;
  sawWorkTool: boolean;
  aborted: boolean | undefined;
  userPrompt: string;
  todos: CompletionTodo[];
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  readEvidencePaths: string[];
  workspaceRoot?: string;
  completeSummary?: string;
}

export type ProviderFailureSettlement =
  | { completed: false }
  | { completed: true; summary: string };

export function settleProviderFailureFromCompletedEvidence(
  input: ProviderFailureSettlementInput,
): ProviderFailureSettlement {
  if (input.aborted || !input.promptRequiresTools || !input.sawWorkTool) {
    return { completed: false };
  }
  const missingEvidence = getMissingCompletionEvidence(
    input.userPrompt,
    input.todos,
    input.writtenFiles,
    input.terminalEvidence,
    input.readEvidencePaths,
    input.workspaceRoot,
  );
  const blockingFailure = getBlockingTerminalFailure(
    input.userPrompt,
    input.todos,
    input.writtenFiles,
    input.terminalEvidence,
  ) ?? findBlockingTerminalFailureEvidence(input.terminalEvidence);
  const summaryFactFailures = input.completeSummary
    ? getUnsupportedSummaryFileClaims(input.completeSummary, input.writtenFiles, input.workspaceRoot)
    : [];

  if (missingEvidence.length > 0 || blockingFailure || summaryFactFailures.length > 0) {
    return { completed: false };
  }
  return {
    completed: true,
    summary: buildCompletedEvidenceSummary(input.writtenFiles, input.terminalEvidence, input.workspaceRoot),
  };
}

function buildCompletedEvidenceSummary(
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
  workspaceRoot?: string,
): string {
  const finalWrittenFiles = coalesceWrittenFileEvidence(writtenFiles, workspaceRoot);
  const filePart = finalWrittenFiles.length > 0
    ? `已完成，处理 ${finalWrittenFiles.length} 个文件：${finalWrittenFiles.map(f => `${f.basename} (+${f.linesAdded} -${f.linesRemoved})`).join('、')}。`
    : '任务已完成。';
  const validationPart = terminalEvidence.some(e => e.ok) ? '验证证据已通过。' : '';
  return `${filePart}${validationPart}`;
}
