import { getActiveProvider } from '../llm/provider-router';
import { type ChatMessage } from '../llm/types';
import { parseFakeToolCalls, type FakeTool } from './fake-tool-parser';
import type { AgentLoopCallbacks } from './loop-types';

export function consumeUserSteerMessages(callbacks: AgentLoopCallbacks): ChatMessage[] {
  const items = callbacks.onUserSteer?.() ?? [];
  return items
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

export async function chatWithMessages(
  messages: ChatMessage[],
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession = false,
  traceRunId?: string,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession, traceRunId });
  return { text, tools: parseFakeToolCalls(text) };
}

export async function chatViaProvider(
  prompt: string,
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  history?: ChatMessage[],
  signal?: AbortSignal,
  newSession = false,
  traceRunId?: string,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession, traceRunId });
  return { text, tools: parseFakeToolCalls(text) };
}
