const SESSION_CONTINUATION_RE = /(?:^\s*(?:再|继续|接着|然后|另外|顺便|也|把它|这个|上个|上次|刚才|刚刚|添加|加一个|改|改成|优化|修复|运行|编译|测试|验证))|(?:\b(?:continue|also|then|next|add|change|modify|update|fix|run|compile|test|verify)\b)|(?:\b(?:it|that|this|previous|last one)\b)|(?:原来|原有|已有|现有|之前|前面|上一轮|上轮|同一(?:个)?\s*session|同一(?:个)?\s*(?:会话|对话)|在.+基础上|基于.+(?:原来|原有|已有|现有|之前|上次|刚才)|不要.+(?:重写|重新写|另写)|(?:单独)?重新写|重写了一个|另写了一个|为什么不.+(?:原来|原有|已有|现有|之前|上次|刚才))/i;

export function isLikelySessionContinuation(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (SESSION_CONTINUATION_RE.test(text)) return true;
  return text.length <= 40 && /(?:吧|一下|一点|一个|几个|些|more|again)$/i.test(text);
}

export function shouldInjectSessionContinuation(prompt: string, context: string): boolean {
  return Boolean(context.trim()) && isLikelySessionContinuation(prompt);
}

export function appendSessionContinuationContext(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `${prompt}\n\n【同一会话续作上下文】\n${trimmedContext}`;
}
