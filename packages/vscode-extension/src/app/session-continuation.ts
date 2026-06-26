const SESSION_CONTINUATION_RE = /(?:^\s*(?:再|继续|接着|然后|另外|顺便|也|把它|这个|上个|上次|刚才|刚刚|添加|加一个|改|改成|优化|修复))|(?:\b(?:continue|also|then|next|add|change|modify|update|fix)\b)|(?:\b(?:it|that|this|previous|last one)\b)|(?:原来|原有|已有|现有|之前|前面|上一轮|上轮|同一(?:个)?\s*session|同一(?:个)?\s*(?:会话|对话)|在.+基础上|基于.+(?:原来|原有|已有|现有|之前|上次|刚才)|不要.+(?:重写|重新写|另写)|(?:单独)?重新写|重写了一个|另写了一个|为什么不.+(?:原来|原有|已有|现有|之前|上次|刚才))/i;

export interface SessionContinuationIntent {
  mode?: string;
  signals?: readonly string[];
}

export interface CheckpointResumePromptInput {
  userDisplay: string;
  prompt: string;
  newSession?: boolean;
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
    && isExplicitCheckpointResumeRequest(input.userDisplay || input.prompt);
}

export function isRunContinuationIntent(intent?: SessionContinuationIntent): boolean {
  const signals = intent?.signals ?? [];
  return intent?.mode === 'run'
    && signals.includes('follow-up-run-request')
    && !signals.includes('explicit-file-path');
}

function isIndependentNewTaskPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return /(?:从零|全新|新的|新建|创建|生成|写一个|写个|另写|单独写|独立).{0,18}(?:项目|程序|脚本|文件|应用|页面|demo|示例|project|program|script|file|app)/i.test(text);
}

function isCodeWorkContinuationIntent(intent?: SessionContinuationIntent, hasSessionCodeFiles = false): boolean {
  if (!hasSessionCodeFiles) return false;
  const signals = intent?.signals ?? [];
  if (signals.includes('explicit-file-path') || signals.includes('artifact-path-query')) return false;
  return intent?.mode === 'edit' || intent?.mode === 'run';
}

export function shouldRestoreSessionFiles(
  prompt: string,
  intent?: SessionContinuationIntent,
  hasSessionCodeFiles = false,
): boolean {
  if (isLikelySessionContinuation(prompt) || isRunContinuationIntent(intent)) return true;
  if (isIndependentNewTaskPrompt(prompt)) return false;
  return isCodeWorkContinuationIntent(intent, hasSessionCodeFiles);
}

export function shouldInjectSessionContinuation(prompt: string, context: string): boolean {
  return Boolean(context.trim()) && isLikelySessionContinuation(prompt);
}

export function shouldInjectSessionContinuationForIntent(
  prompt: string,
  context: string,
  intent?: SessionContinuationIntent,
  hasSessionCodeFiles = Boolean(context.trim()),
): boolean {
  return Boolean(context.trim()) && shouldRestoreSessionFiles(prompt, intent, hasSessionCodeFiles);
}

export function appendSessionContinuationContext(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `${prompt}\n\n【同一会话续作上下文】\n${trimmedContext}`;
}
