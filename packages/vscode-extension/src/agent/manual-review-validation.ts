import type { TerminalEvidence } from './completion-evidence';
import {
  hasHardExecutionFailureEvidence,
  isIndeterminateExecutionEvidence,
  isVisualOrInteractiveContext,
  visualSourcePathsLookInteractive,
} from '../execution-outcome-classifier';

export interface ManualReviewRunInput {
  userPrompt: string;
  command: string;
  output: string;
  changedPaths: string[];
  terminalEvidence: TerminalEvidence;
}

export interface ManualReviewDecision {
  reason: 'manual-visual-confirmation-required';
  detail: string;
}

export function shouldRequestManualReviewForRun(input: ManualReviewRunInput): ManualReviewDecision | undefined {
  if (!isRuntimeEvidence(input.terminalEvidence)) return undefined;
  if (input.terminalEvidence.ok) return undefined;

  const context = buildManualReviewContext(input);
  if (!isVisualOrInteractiveContext(context) && !visualSourcePathsLookInteractive(input.changedPaths)) {
    return undefined;
  }
  if (!isIndeterminateRun(input)) return undefined;
  if (hasHardExecutionFailureEvidence(input.output || '')) return undefined;

  return {
    reason: 'manual-visual-confirmation-required',
    detail: '图形或交互式程序已尝试启动，但自动验证无法仅凭退出码判断窗口内容是否符合要求。请按窗口或控制台提示确认画面和关键交互（例如键盘、鼠标或按钮切换）是否符合需求；DevSeek 会保留待确认文件，不会把该结果伪装成全自动通过。',
  };
}

export function isManualReviewTerminalEvidence(evidence: TerminalEvidence | undefined): boolean {
  return evidence?.reviewRequired === true;
}

function isRuntimeEvidence(evidence: TerminalEvidence): boolean {
  return evidence.kind === 'run' || evidence.kind === 'compile-run' || evidence.kind === 'test';
}

function isIndeterminateRun(input: ManualReviewRunInput): boolean {
  return isIndeterminateExecutionEvidence(
    input.terminalEvidence.exitCode,
    input.output || input.terminalEvidence.detail || '',
  );
}

function buildManualReviewContext(input: ManualReviewRunInput): string {
  return [
    input.userPrompt,
    input.command,
    input.changedPaths.join('\n'),
  ].filter(Boolean).join('\n');
}
