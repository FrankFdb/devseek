const SESSION_CONTINUATION_RE = /(?:^\s*(?:再|继续|接着|然后|另外|顺便|也|把它|这个|上个|上次|刚才|刚刚|添加|加一个|改|改成|优化|修复))|(?:\b(?:continue|also|then|next|add|change|modify|update|fix)\b)|(?:\b(?:it|that|this|previous|last one)\b)|(?:原来|原有|已有|现有|之前|前面|上一轮|上轮|同一(?:个)?\s*session|同一(?:个)?\s*(?:会话|对话)|在.+基础上|基于.+(?:原来|原有|已有|现有|之前|上次|刚才)|不要.+(?:重写|重新写|另写)|(?:单独)?重新写|重写了一个|另写了一个|为什么不.+(?:原来|原有|已有|现有|之前|上次|刚才))/i;

export interface SessionContinuationIntent {
  mode?: string;
  signals?: readonly string[];
}

export interface CheckpointResumePromptInput {
  userDisplay: string;
  prompt: string;
  newSession?: boolean;
  forceNoAgent?: boolean;
  files?: readonly string[];
  images?: readonly string[];
  resumeFromIndex?: number;
}

export function isLikelySessionContinuation(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (SESSION_CONTINUATION_RE.test(text)) return true;
  return text.length <= 40 && /(?:吧|一下|一点|一个|几个|些|more|again)$/i.test(text);
}

export function isExplicitCheckpointResumeRequest(prompt: string): boolean {
  const text = prompt
    .trim()
    .replace(/[。.!！\s]+$/g, '')
    .toLowerCase();
  if (!text || text.length > 30) return false;
  return /^(继续|继续执行|继续任务|继续完成|从断点继续|恢复|恢复任务|恢复执行|resume|continue|continue task|resume task)$/.test(text);
}

export function shouldResumeCheckpointFromPrompt(input: CheckpointResumePromptInput): boolean {
  return input.resumeFromIndex === undefined
    && !input.newSession
    && !input.forceNoAgent
    && (!input.files || input.files.length === 0)
    && (!input.images || input.images.length === 0)
    && isExplicitCheckpointResumeRequest(input.userDisplay || input.prompt);
}

export function isRunContinuationIntent(intent?: SessionContinuationIntent): boolean {
  const signals = intent?.signals ?? [];
  return intent?.mode === 'run'
    && signals.includes('follow-up-run-request')
    && !signals.includes('explicit-file-path');
}

export function shouldRestoreSessionFiles(prompt: string, intent?: SessionContinuationIntent): boolean {
  return isLikelySessionContinuation(prompt) || isRunContinuationIntent(intent);
}

export function shouldInjectSessionContinuation(prompt: string, context: string): boolean {
  return Boolean(context.trim()) && isLikelySessionContinuation(prompt);
}

export function shouldInjectSessionContinuationForIntent(
  prompt: string,
  context: string,
  intent?: SessionContinuationIntent,
): boolean {
  return Boolean(context.trim()) && shouldRestoreSessionFiles(prompt, intent);
}

export function appendSessionContinuationContext(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `${prompt}\n\n【同一会话续作上下文】\n${trimmedContext}`;
}
