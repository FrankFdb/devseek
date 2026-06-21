import type { ChatMessage } from '../llm/types';
import type { SessionMeta } from './session-service';
import { chatContentStartsWith } from './chat-prompt-formatting';

export interface TrackableChatRouteOptions {
  prompt: string;
  displayPrompt?: string;
  trackHistory?: boolean;
}

export interface RecordTrackedChatHistoryInput {
  opts: TrackableChatRouteOptions;
  response: string;
  activeSessionId: string;
  getHistory: () => ChatMessage[];
  setHistory: (history: ChatMessage[]) => void;
  compactAndSaveHistory: (history: ChatMessage[], sessionId: string) => Promise<void>;
  getFreshSummary: (sessionId: string) => string | undefined;
  getSessions: () => SessionMeta[];
  saveSessionMeta: (meta: SessionMeta) => void;
  saveCurrentSession: () => void;
}

export function recordTrackedChatHistory(input: RecordTrackedChatHistoryInput): void {
  if (!input.opts.trackHistory) return;

  const displayText = input.opts.displayPrompt ?? input.opts.prompt;
  const updatedHistory = [
    ...input.getHistory(),
    { role: 'user' as const, content: displayText },
    { role: 'assistant' as const, content: input.response },
  ];
  input.setHistory(updatedHistory);

  compactHistoryIfNeeded(input);

  if (input.activeSessionId) {
    const existing = input.getSessions().find(session => session.id === input.activeSessionId);
    if (existing) {
      input.saveSessionMeta({ ...existing, updatedAt: Date.now() });
    }
  }
  input.saveCurrentSession();

  if (input.getHistory().length === 2 && input.activeSessionId) {
    const sessions = input.getSessions();
    if (!sessions.some(session => session.id === input.activeSessionId)) {
      input.saveSessionMeta({
        id: input.activeSessionId,
        title: displayText.slice(0, 50),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }
}

function compactHistoryIfNeeded(input: RecordTrackedChatHistoryInput): void {
  const history = input.getHistory();
  if (history.length >= 40 && input.activeSessionId) {
    const toCompact = history.slice(0, 20);
    input.setHistory(history.slice(20));
    const compactId = input.activeSessionId;
    void (async () => {
      await input.compactAndSaveHistory(toCompact, compactId);
      const freshSummary = input.getFreshSummary(compactId);
      if (freshSummary && compactId === input.activeSessionId) {
        input.setHistory(mergeFreshSummaryIntoHistory(input.getHistory(), freshSummary));
      }
    })();
  } else if (history.length > 40) {
    input.setHistory(history.slice(-40));
  }
}

function mergeFreshSummaryIntoHistory(history: ChatMessage[], freshSummary: string): ChatMessage[] {
  const hasPair = history[0]?.role === 'user' && chatContentStartsWith(history[0]?.content, '[上次会话背景');
  const hasLegacy = history[0]?.role === 'assistant'
    && (chatContentStartsWith(history[0]?.content, '【历史摘要】\n') || chatContentStartsWith(history[0]?.content, '【上次 session 摘要】\n'));
  const background = { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${freshSummary}` };
  if (hasPair) {
    return [background, ...history.slice(1)];
  }
  if (hasLegacy) {
    return [
      background,
      { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' },
      ...history.slice(1),
    ];
  }
  return [
    background,
    { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' },
    ...history,
  ];
}
