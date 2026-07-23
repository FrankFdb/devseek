import type { AgentTask } from '../agent-task-decomposer';
import {
  coalesceWrittenFileEvidence,
  requiresFileChangeEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import { selectTaskScopedWrittenFileEvidence } from './task-write-evidence';

export interface AnalyzeToolWriteSettlement {
  evidence: WrittenFileEvidence;
  writtenFiles: WrittenFileEvidence[];
  raw: string;
}

export function buildAnalyzeToolWriteSettlement(input: {
  task: Pick<AgentTask, 'file' | 'absPath' | 'visibleTarget' | 'desc'>;
  promptText: string;
  writtenFiles: WrittenFileEvidence[];
  workspaceRoot: string;
  rawText?: string;
  reason?: string;
}): AnalyzeToolWriteSettlement | undefined {
  const intentText = analyzeTaskWriteIntentText(input.promptText, input.task);
  if (!requiresFileChangeEvidence(intentText)) return undefined;

  const scoped = selectTaskScopedWrittenFileEvidence(
    { ...input.task, desc: intentText },
    input.writtenFiles,
    input.workspaceRoot,
  );
  const writtenFiles = scoped.length > 0
    ? scoped
    : coalesceWrittenFileEvidence(input.writtenFiles, input.workspaceRoot);
  const evidence = writtenFiles[0];
  if (!evidence) return undefined;

  return {
    evidence,
    writtenFiles,
    raw: buildSettlementRaw(writtenFiles, input.rawText, input.reason),
  };
}

function analyzeTaskWriteIntentText(
  promptText: string,
  task: Pick<AgentTask, 'file' | 'visibleTarget' | 'desc'>,
): string {
  return [
    promptText,
    task.desc,
    task.file,
    task.visibleTarget,
  ].filter(Boolean).join('\n');
}

function buildSettlementRaw(
  writtenFiles: WrittenFileEvidence[],
  rawText?: string,
  reason?: string,
): string {
  const names = summarizeWrittenFileBasenames(writtenFiles);
  const prior = String(rawText || '').trim();
  const note = [
    '结论：已根据本地工具写盘与读回证据完成当前文件交付。',
    names ? `写入文件：${names}。` : '',
    reason ? `后续 Provider 确认请求失败：${reason}；本地结算将继续执行自动验证和 QualityGate。` : '',
  ].filter(Boolean).join('\n');
  return prior ? `${prior}\n\n${note}` : note;
}

function summarizeWrittenFileBasenames(writtenFiles: WrittenFileEvidence[]): string {
  return [...new Set(writtenFiles.map(file => file.basename || file.path.split(/[\\/]/).pop()).filter(Boolean))]
    .join('、');
}
