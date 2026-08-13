const PRIOR_TASK_PROCEED_RE = /^(?:(?:please\s+)?(?:go\s+ahead|proceed|continue|carry\s+on|do\s+it|do\s+this|apply\s+(?:it|that|the\s+plan|the\s+changes)|make\s+the\s+changes|ship\s+it|let'?s\s+do\s+it)|looks\s+good[,，\s]+(?:go\s+ahead|proceed|do\s+it)|继续(?:执行|任务|完成)?|开始吧|执行吧|改吧|做吧|落地吧|可以[,，\s]*(?:开始|改|做|执行|落地)(?:吧|了)?|(?:就)?按(?:这个|上面|刚才|方案|计划|上面的计划|刚才的方案).{0,12}(?:改|做|实现|执行|落地)?|照(?:这个|上面|刚才|方案|计划|上面的计划|刚才的方案).{0,12}(?:改|做|实现|执行|落地)?)$/i;

export function isProceedWithPriorTaskRequest(prompt: string): boolean {
  const raw = String(prompt || '').trim();
  if (!raw || /[?？]\s*$/.test(raw)) return false;
  const normalized = raw
    .replace(/[。.!！\s]+$/g, '')
    .trim();
  return normalized.length > 0
    && normalized.length <= 96
    && PRIOR_TASK_PROCEED_RE.test(normalized);
}
