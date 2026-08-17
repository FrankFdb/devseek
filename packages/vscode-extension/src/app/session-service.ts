import type { ChatMessage } from '../llm/types';

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
const SESSION_STATE_SUFFIXES = ['history', 'files', 'summary', 'analysisText', 'agentState'] as const;
type SessionStateSuffix = (typeof SESSION_STATE_SUFFIXES)[number];

export interface PersistedSessionState<TAgentState = unknown> {
  history: ChatMessage[];
  files: Record<string, string>;
  summary: string;
  analysisText: string;
  agentState?: TAgentState;
}

export class SessionService {
  private readonly agentStateCache = new Map<string, unknown>();
  private readonly writeThroughCache = new Map<string, unknown>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writeError: unknown;

  constructor(
    private readonly store: SessionKeyValueStore,
    private readonly maxSessions = 100,
  ) {}

  generateSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  getActiveSessionId(): string {
    return this.read<string>(ACTIVE_SESSION_KEY, '') ?? '';
  }

  setActiveSessionId(id: string): void {
    this.enqueueUpdate(ACTIVE_SESSION_KEY, id);
  }

  getSessions(): SessionMeta[] {
    return this.read<SessionMeta[]>(SESSIONS_KEY, []) ?? [];
  }

  saveSessionMeta(meta: SessionMeta): void {
    const sessions = this.getSessions().filter(s => s.id !== meta.id);
    sessions.unshift(meta);
    this.enqueueUpdate(SESSIONS_KEY, sessions.slice(0, this.maxSessions));
  }

  updateSessionMeta(id: string, patch: Partial<SessionMeta>): void {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) return;
    sessions[idx] = { ...sessions[idx], ...patch };
    this.enqueueUpdate(SESSIONS_KEY, sessions);
  }

  loadSessionState<TAgentState = unknown>(id: string): PersistedSessionState<TAgentState> {
    if (!id) return { history: [], files: {}, summary: '', analysisText: '' };
    return {
      history: cloneChatHistory(this.read<ChatMessage[]>(this.sessionStateKey(id, 'history'), []) ?? []),
      files: { ...(this.read<Record<string, string>>(this.sessionStateKey(id, 'files'), {}) ?? {}) },
      summary: this.read<string>(this.sessionStateKey(id, 'summary'), '') ?? '',
      analysisText: this.read<string>(this.sessionStateKey(id, 'analysisText'), '') ?? '',
      agentState: this.getSessionAgentState<TAgentState>(id),
    };
  }

  getSessionSummary(id: string): string {
    if (!id) return '';
    return this.read<string>(this.sessionStateKey(id, 'summary'), '') ?? '';
  }

  getSessionAgentState<TAgentState>(id: string): TAgentState | undefined {
    if (!id) return undefined;
    if (this.agentStateCache.has(id)) {
      return clonePersistedValue(this.agentStateCache.get(id) as TAgentState | undefined);
    }
    return clonePersistedValue(this.read<TAgentState>(this.sessionStateKey(id, 'agentState')));
  }

  saveSessionHistory(id: string, history: readonly ChatMessage[]): void {
    this.updateSessionState(id, 'history', cloneChatHistory(history));
  }

  saveSessionFiles(id: string, files: Readonly<Record<string, string>>): void {
    this.updateSessionState(id, 'files', { ...files });
  }

  saveSessionSummary(id: string, summary: string): void {
    this.updateSessionState(id, 'summary', summary);
  }

  saveSessionAnalysisText(id: string, analysisText: string): void {
    this.updateSessionState(id, 'analysisText', analysisText);
  }

  saveSessionAgentState<TAgentState>(id: string, state: TAgentState | null): void {
    if (!id) return;
    const snapshot = clonePersistedValue(state ?? undefined);
    this.agentStateCache.set(id, snapshot);
    this.updateSessionState(id, 'agentState', snapshot);
  }

  deleteSession(id: string): void {
    if (!id) return;
    this.agentStateCache.set(id, undefined);
    const sessions = this.getSessions().filter(s => s.id !== id);
    this.enqueueUpdate(SESSIONS_KEY, sessions);
    for (const suffix of SESSION_STATE_SUFFIXES) {
      this.enqueueUpdate(this.sessionStateKey(id, suffix), undefined);
    }
  }

  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.writeError !== undefined) {
      const failure = new Error('session-service:persist-failed') as Error & { cause?: unknown };
      failure.cause = this.writeError;
      throw failure;
    }
  }

  private updateSessionState(id: string, suffix: SessionStateSuffix, value: unknown): void {
    if (!id) return;
    this.enqueueUpdate(this.sessionStateKey(id, suffix), value);
  }

  private sessionStateKey(id: string, suffix: SessionStateSuffix): string {
    return `deepseek.session.${id}.${suffix}`;
  }

  private read<T>(key: string, defaultValue?: T): T | undefined {
    if (this.writeThroughCache.has(key)) {
      return clonePersistedValue(this.writeThroughCache.get(key) as T | undefined) ?? defaultValue;
    }
    return clonePersistedValue(this.store.get<T>(key, defaultValue));
  }

  private enqueueUpdate(key: string, value: unknown): void {
    const snapshot = clonePersistedValue(value);
    this.writeThroughCache.set(key, snapshot);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.store.update(key, clonePersistedValue(snapshot));
      })
      .catch((error: unknown) => {
        this.writeError ??= error;
      });
  }
}

function cloneChatHistory(history: readonly ChatMessage[]): ChatMessage[] {
  return history.map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.map(part => ({
        ...part,
        ...(part.image_url ? { image_url: { ...part.image_url } } : {}),
      })),
  }));
}

function clonePersistedValue<T>(value: T | undefined): T | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
