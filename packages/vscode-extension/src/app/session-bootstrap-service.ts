import type { ChatMessage } from '../llm/types';
import type { SessionKeyValueStore, SessionService } from './session-service';

export interface SessionBootstrapResult {
  activeSessionId: string;
  files: Record<string, string>;
  history: ChatMessage[];
  analysisText: string;
  restoreAgentPathsForSessionId?: string;
}

export function buildSessionBootstrapState(input: {
  sessionService?: SessionService;
  workspaceState: SessionKeyValueStore;
}): SessionBootstrapResult {
  const { sessionService, workspaceState } = input;
  const savedId = sessionService?.getActiveSessionId() ?? '';
  const sessions = sessionService?.getSessions() ?? [];
  if (savedId && sessions.some(session => session.id === savedId)) {
    return {
      activeSessionId: savedId,
      files: workspaceState.get<Record<string, string>>(`deepseek.session.${savedId}.files`, {}) ?? {},
      history: [],
      analysisText: workspaceState.get<string>(`deepseek.session.${savedId}.analysisText`, '') ?? '',
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
