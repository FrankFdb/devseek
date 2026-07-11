import type { ChatMessage } from '../llm/types';
import type { AgentLoopCallbacks } from './loop-types';

/** Converts queued user corrections into provider-visible messages. */
export function consumeUserSteerMessages(callbacks: AgentLoopCallbacks): ChatMessage[] {
  return (callbacks.onUserSteer?.() ?? [])
    .map(text => String(text || '').trim())
    .filter(Boolean)
    .map(text => ({
      role: 'user' as const,
      content: [
        '【用户实时补充/纠偏】',
        text,
        '',
        '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务，先调整 todo/后续步骤再继续。',
      ].join('\n'),
    }));
}
