import { parseFakeToolCalls } from '../agent/fake-tool-parser';
import { normalizeToolCall, type NativeToolCall, type ToolCall } from '../agent/tool-call-normalizer';
import type { LLMProviderType, TokenUsage } from './types';

export type LLMEvent =
  | { type: 'text-delta'; provider: LLMProviderType; text: string; workflowId?: string }
  | { type: 'message'; provider: LLMProviderType; content: string; workflowId?: string }
  | { type: 'tool-call'; provider: LLMProviderType; call: NativeToolCall; workflowId?: string }
  | { type: 'usage'; provider: LLMProviderType; usage: TokenUsage; workflowId?: string }
  | { type: 'error'; provider: LLMProviderType; message: string; recoverable?: boolean; workflowId?: string };

export function llmEventsToToolCalls(events: readonly LLMEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const event of events) {
    if (event.type === 'tool-call') {
      calls.push(normalizeToolCall(event.call, 'native'));
      continue;
    }
    if (event.type === 'message') {
      for (const fakeTool of parseFakeToolCalls(event.content)) {
        calls.push(normalizeToolCall(fakeTool, 'fake-tool'));
      }
    }
  }
  return calls;
}

export function redactProviderSecrets(text: string): string {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\b(api[_-]?key|token|cookie|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=***');
}
