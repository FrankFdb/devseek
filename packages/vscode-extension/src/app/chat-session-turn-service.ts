import type { ChatMessage } from '../llm/types';
import type { SessionMeta } from './session-service';

export interface ChatSessionTurnInput {
  newSession: boolean;
  userDisplay: string;
  userExplicitlyAttachedFiles: boolean;
}

export interface ChatSessionTurnResult {
  newSessionStarted: boolean;
  contextFilesCleared: boolean;
}

export interface ChatSessionTurnServiceDeps {
  getHistory: () => ChatMessage[];
  setHistory: (history: ChatMessage[]) => void;
  getActiveSessionId: () => string;
  setActiveSessionId: (sessionId: string) => void;
  generateSessionId: () => string;
  saveCurrentSession: () => void;
  compactAndSaveHistory: (history: ChatMessage[], sessionId: string) => Promise<void>;
  setSessionServiceActiveId: (sessionId: string) => void;
  saveSessionMeta: (meta: SessionMeta) => void;
  clearSessionRecentFiles: () => void;
  saveCurrentSessionFiles: () => void;
  setLastConversationFiles: (files: string[]) => void;
  setLastAnalysisText: (text: string) => void;
  setLastAgentChangedPaths: (paths: string[]) => void;
  clearLearnerSession: () => void;
  emitContextFiles: (files: string[]) => void;
  now?: () => number;
}

export class ChatSessionTurnService {
  constructor(private readonly deps: ChatSessionTurnServiceDeps) {}

  async beginTurn(input: ChatSessionTurnInput): Promise<ChatSessionTurnResult> {
    if (input.newSession) {
      this.startNewSession(input.userDisplay);
      return { newSessionStarted: true, contextFilesCleared: true };
    }

    if (!input.userExplicitlyAttachedFiles) {
      this.clearContextFiles();
      return { newSessionStarted: false, contextFilesCleared: true };
    }

    return { newSessionStarted: false, contextFilesCleared: false };
  }

  private startNewSession(userDisplay: string): void {
    const historySnapshot = [...this.deps.getHistory()];
    const previousSessionId = this.deps.getActiveSessionId();
    this.deps.saveCurrentSession();
    if (historySnapshot.length >= 4 && previousSessionId) {
      void this.deps.compactAndSaveHistory(historySnapshot, previousSessionId);
    }

    const sessionId = this.deps.generateSessionId();
    const now = this.deps.now?.() ?? Date.now();
    this.deps.setActiveSessionId(sessionId);
    this.deps.setSessionServiceActiveId(sessionId);
    this.deps.saveSessionMeta({
      id: sessionId,
      title: userDisplay.slice(0, 50),
      createdAt: now,
      updatedAt: now,
    });

    this.deps.clearSessionRecentFiles();
    this.deps.saveCurrentSessionFiles();
    this.deps.setLastConversationFiles([]);
    this.deps.setLastAnalysisText('');
    this.deps.setLastAgentChangedPaths([]);
    this.deps.setHistory([]);
    this.deps.clearLearnerSession();
    this.deps.emitContextFiles([]);
  }

  private clearContextFiles(): void {
    this.deps.setLastConversationFiles([]);
    this.deps.emitContextFiles([]);
  }
}
