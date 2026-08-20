import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';

export function consumeUserSteerTexts(callbacks: AgentLoopCallbacks): string[] {
  return (callbacks.onUserSteer?.() ?? [])
    .map(input => typeof input === 'string' ? input : input.instruction)
    .map(text => String(text || '').trim())
    .filter(Boolean);
}

export function consumeUserSteerCompletionFenceTexts(callbacks: AgentLoopCallbacks): string[] {
  const inputs = callbacks.onUserSteerCompletionFence?.()
    ?? callbacks.onUserSteer?.()
    ?? [];
  return inputs
    .map(input => typeof input === 'string' ? input : input.instruction)
    .map(text => String(text || '').trim())
    .filter(Boolean);
}

export function buildUserSteerMessage(text: string): ChatMessage {
  return {
    role: 'user' as const,
    content: [
      '【用户实时补充/纠偏】',
      text,
      '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务，先调整 todo/后续步骤再继续。',
    ].join('\n'),
  };
}

/** Converts queued user corrections into provider-visible messages. */
export function consumeUserSteerMessages(
  callbacks: AgentLoopCallbacks,
): ChatMessage[] {
  return consumeUserSteerTexts(callbacks)
    .map(text => buildUserSteerMessage(text));
}
