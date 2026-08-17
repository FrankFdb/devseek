const INTERNAL_ERROR_PREFIXES = [
  'coding-conformance-projection:',
  'vscode-coding-kernel:',
  'coding-kernel:',
  'workspace-proposal-',
  'run-context:',
] as const;

export interface AgentExecutionErrorPresentation {
  readonly title: string;
  readonly text: string;
  readonly historyText: string;
}

/** Separates product diagnostics from the stable, user-facing failure contract. */
export function presentAgentExecutionError(error: unknown): AgentExecutionErrorPresentation {
  const raw = error instanceof Error ? error.message : String(error);
  if (INTERNAL_ERROR_PREFIXES.some(prefix => raw.toLowerCase().startsWith(prefix))) {
    return {
      title: '任务未完成：执行证据结算失败',
      text: '文件和命令结果已保留，但本轮执行证据未能一致结算，因此不会把任务标记为完成。请重试本任务；若问题持续出现，可查看 DevSeek 运行日志。',
      historyText: '[Agentic] 未完成：执行证据未能一致结算。',
    };
  }

  const safeMessage = compactUserFacingError(raw);
  return {
    title: 'Agent 执行未完成',
    text: safeMessage,
    historyText: `[Agentic] 未完成：${safeMessage}`,
  };
}

function compactUserFacingError(raw: string): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '执行过程中发生未知错误，请重试并查看 DevSeek 运行日志。';
  return normalized.slice(0, 300);
}
