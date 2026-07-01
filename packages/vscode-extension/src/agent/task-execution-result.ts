import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';

export interface TaskExecutionResult {
  applied: boolean;
  path?: string;
  raw?: string;
  taskComplete?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  writtenFiles?: WrittenFileEvidence[];
  networkError?: boolean;
  terminalEvidence?: TerminalEvidence[];
}

export function withTaskTerminalEvidence<T extends Omit<TaskExecutionResult, 'terminalEvidence'>>(
  result: T,
  evidence: TerminalEvidence[],
): T & Pick<TaskExecutionResult, 'terminalEvidence'> {
  return evidence.length > 0 ? { ...result, terminalEvidence: evidence } : result;
}

export function buildTaskTerminalFailureDetail(failure: TerminalEvidence): string {
  return [
    '验证命令失败，不能标记完成。',
    `命令: ${failure.command}`,
    `exitCode: ${failure.exitCode ?? 'unknown'}`,
    failure.detail ?? '',
  ].filter(Boolean).join('\n');
}
