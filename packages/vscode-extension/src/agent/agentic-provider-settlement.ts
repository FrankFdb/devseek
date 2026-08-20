import {
  coalesceWrittenFileEvidence,
  assessMissingCompletionEvidence,
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { CodingKernelTaskContract } from '@devseek-netai/shared';

export interface ProviderFailureSettlementInput {
  promptRequiresTools: boolean;
  sawWorkTool: boolean;
  aborted: boolean | undefined;
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  readEvidencePaths: string[];
  workspaceRoot?: string;
  semanticContract: TaskSemanticContract;
  canonicalTaskContract?: CodingKernelTaskContract;
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
  const missingEvidence = assessMissingCompletionEvidence({
    writtenFiles: input.writtenFiles,
    terminalEvidence: input.terminalEvidence,
    readEvidencePaths: input.readEvidencePaths,
    workspaceRoot: input.workspaceRoot,
    semanticContract: input.semanticContract,
    canonicalTaskContract: input.canonicalTaskContract,
  });
  const blockingFailure = getBlockingTerminalFailure(
    input.terminalEvidence,
    input.semanticContract,
  ) ?? findBlockingTerminalFailureEvidence(input.terminalEvidence);

  if (missingEvidence.length > 0 || blockingFailure) {
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
