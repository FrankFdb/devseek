import { getActiveProvider } from '../llm/provider-router';
import { type ChatMessage } from '../llm/types';
import { parseFakeToolCalls, type FakeTool } from './fake-tool-parser';
export { consumeUserSteerMessages } from './user-steer';

export async function chatWithMessages(
  messages: ChatMessage[],
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession = false,
  traceRunId?: string,
  traceWorkspaceRoot?: string,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession, traceRunId, traceWorkspaceRoot });
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
  traceWorkspaceRoot?: string,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession, traceRunId, traceWorkspaceRoot });
  return { text, tools: parseFakeToolCalls(text) };
}
