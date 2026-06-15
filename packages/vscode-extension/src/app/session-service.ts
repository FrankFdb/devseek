export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  messageCount?: number;
  fileCount?: number;
  changedFiles?: string[];
  digest?: string;
}

export interface SessionKeyValueStore {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}

const SESSIONS_KEY = 'devseek.sessions';
const ACTIVE_SESSION_KEY = 'devseek.activeSessionId';

export class SessionService {
  constructor(
    private readonly store: SessionKeyValueStore,
    private readonly maxSessions = 100,
  ) {}

  generateSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  getActiveSessionId(): string {
    return this.store.get<string>(ACTIVE_SESSION_KEY, '') ?? '';
  }

  setActiveSessionId(id: string): void {
    void this.store.update(ACTIVE_SESSION_KEY, id);
  }

  getSessions(): SessionMeta[] {
    return this.store.get<SessionMeta[]>(SESSIONS_KEY, []) ?? [];
  }

  saveSessionMeta(meta: SessionMeta): void {
    const sessions = this.getSessions().filter(s => s.id !== meta.id);
    sessions.unshift(meta);
    void this.store.update(SESSIONS_KEY, sessions.slice(0, this.maxSessions));
  }

  updateSessionMeta(id: string, patch: Partial<SessionMeta>): void {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) return;
    sessions[idx] = { ...sessions[idx], ...patch };
    void this.store.update(SESSIONS_KEY, sessions);
  }

  deleteSession(id: string): void {
    const sessions = this.getSessions().filter(s => s.id !== id);
    void this.store.update(SESSIONS_KEY, sessions);
    for (const suffix of ['history', 'files', 'summary', 'analysisText', 'agentState']) {
      void this.store.update(`deepseek.session.${id}.${suffix}`, undefined);
    }
  }
}
