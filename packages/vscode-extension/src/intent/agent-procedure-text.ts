const AGENT_PROCEDURAL_EXECUTION_RE = /(?:(?:恢复|继续|重新|再次)?\s*(?:执行|运行)\s*(?:原始请求|原请求|用户请求|本次请求|当前请求|原始任务|原任务|本次任务|当前任务|任务|流程|计划|步骤|工作流)|(?:resume|continue|restart|retry)\s+(?:the\s+)?(?:(?:execution|running|executing)\s+of\s+)?(?:the\s+)?(?:(?:original|current|user)\s+)?(?:request|task|workflow|plan|steps?))/gi;

export function stripAgentProceduralExecutionPhrases(text: string | undefined): string {
  return String(text || '').replace(AGENT_PROCEDURAL_EXECUTION_RE, ' ');
}
