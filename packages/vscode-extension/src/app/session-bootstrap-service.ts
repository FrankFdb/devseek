import type { ChatMessage } from '../llm/types';
import type { SessionService } from './session-service';

export interface SessionBootstrapResult {
  activeSessionId: string;
  files: Record<string, string>;
  history: ChatMessage[];
  analysisText: string;
  restoreAgentPathsForSessionId?: string;
}

export function buildSessionBootstrapState(input: {
  sessionService?: SessionService;
}): SessionBootstrapResult {
  const { sessionService } = input;
  const savedId = sessionService?.getActiveSessionId() ?? '';
  const sessions = sessionService?.getSessions() ?? [];
  if (savedId && sessions.some(session => session.id === savedId)) {
    const state = sessionService?.loadSessionState(savedId);
    return {
      activeSessionId: savedId,
      files: state?.files ?? {},
      history: [],
      analysisText: state?.analysisText ?? '',
      restoreAgentPathsForSessionId: savedId,
    };
  }

  const activeSessionId = sessionService?.generateSessionId()
    ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  sessionService?.setActiveSessionId(activeSessionId);
  return {
    activeSessionId,
    files: {},
    history: [],
    analysisText: '',
  };
}
