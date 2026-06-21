import type { ChatMessage } from '../llm/types';
import type { SessionMeta } from './session-service';

const SESSION_CONTEXT_PREFIX = '[上次会话背景';
const SESSION_CONTEXT_ACK = '好的，我已了解上次的工作进展，可以继续。';
const LEGACY_SUMMARY_PREFIXES = ['【上次 session 摘要】\n', '【历史摘要】\n'];

export interface SessionLoadedPayloadInput {
  id: string;
  history: ChatMessage[];
  summary: string;
  meta?: SessionMeta;
}

export function buildSessionLoadedPayload(input: SessionLoadedPayloadInput) {
  const extracted = extractLegacySummary(input.history);
  const summary = input.summary || extracted.summary;
  const history = stripSessionContextPrefix(input.history);
  return {
    type: 'sessionLoaded' as const,
    id: input.id,
    history,
    summary,
    changedFiles: input.meta?.changedFiles ?? [],
    messageCount: input.meta?.messageCount ?? history.filter(message => message.role === 'user').length,
    createdAt: input.meta?.createdAt ?? 0,
  };
}

export function buildRestoredSessionLlmHistory(
  history: ChatMessage[],
  summary: string,
  maxMessages = 20,
): ChatMessage[] {
  const baseHistory = stripSessionContextPrefix(history).slice(-maxMessages);
  if (!summary) return baseHistory;
  return [
    { role: 'user', content: `[上次会话背景，请基于此继续工作]\n${summary}` },
    { role: 'assistant', content: SESSION_CONTEXT_ACK },
    ...baseHistory,
  ];
}

export function stripSessionContextPrefix(history: ChatMessage[]): ChatMessage[] {
  if (
    history[0]?.role === 'user'
    && chatContentText(history[0].content).startsWith(SESSION_CONTEXT_PREFIX)
    && history[1]?.role === 'assistant'
    && chatContentText(history[1].content) === SESSION_CONTEXT_ACK
  ) {
    return history.slice(2);
  }
  const first = history[0];
  if (first?.role === 'assistant' && LEGACY_SUMMARY_PREFIXES.some(prefix => chatContentText(first.content).startsWith(prefix))) {
    return history.slice(1);
  }
  return history;
}

function extractLegacySummary(history: ChatMessage[]): { summary: string } {
  const first = history[0];
  if (first?.role !== 'assistant') return { summary: '' };
  const content = chatContentText(first.content);
  const prefix = LEGACY_SUMMARY_PREFIXES.find(item => content.startsWith(item));
  return { summary: prefix ? content.slice(prefix.length) : '' };
}

function chatContentText(content: ChatMessage['content'] | undefined): string {
  return typeof content === 'string' ? content : '';
}
