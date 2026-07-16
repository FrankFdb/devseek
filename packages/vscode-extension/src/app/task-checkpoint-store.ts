export interface TaskCheckpointStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}

export interface TaskCheckpointRecord<TTask = unknown> {
  userPrompt: string;
  displayPrompt: string;
  mode?: 'fast' | 'r1';
  wsRootFsPath: string;
  allTasks: TTask[];
  startFromIndex: number;
  completedCount: number;
  savedAt: number;
  sessionId: string;
  recoveryKind?: string;
  pauseReason?: string;
}

export interface FreshCheckpointResult<TTask = unknown> {
  checkpoint: TaskCheckpointRecord<TTask>;
  stale: false;
}

export interface TaskCheckpointScope {
  wsRootFsPath?: string;
  sessionId?: string;
}

export const DEFAULT_TASK_CHECKPOINT_KEY = 'devseek.agentTaskCheckpoint';

export class TaskCheckpointStore<TTask = unknown> {
  constructor(
    private readonly storage: TaskCheckpointStorage,
    private readonly key = DEFAULT_TASK_CHECKPOINT_KEY,
  ) {}

  load(): TaskCheckpointRecord<TTask> | undefined {
    const record = this.storage.get<TaskCheckpointRecord<TTask>>(this.key);
    return record ? normalizeCheckpointRecord(record) : undefined;
  }

  loadScoped(scope?: TaskCheckpointScope): TaskCheckpointRecord<TTask> | undefined {
    const checkpoint = this.load();
    if (!checkpoint) return undefined;
    return checkpointMatchesScope(checkpoint, scope) ? checkpoint : undefined;
  }

  async save(record: TaskCheckpointRecord<TTask>): Promise<void> {
    await this.storage.update(this.key, normalizeCheckpointRecord(record));
  }

  async clear(): Promise<void> {
    await this.storage.update(this.key, undefined);
  }

  async loadFresh(
    maxAgeMs: number,
    now = Date.now(),
    scope?: TaskCheckpointScope,
  ): Promise<FreshCheckpointResult<TTask> | undefined> {
    const checkpoint = this.load();
    if (!checkpoint) return undefined;
    if (!checkpoint.savedAt || checkpoint.savedAt <= now - maxAgeMs) {
      await this.clear();
      return undefined;
    }
    if (checkpoint.allTasks.length <= 0 || checkpoint.startFromIndex >= checkpoint.allTasks.length) {
      await this.clear();
      return undefined;
    }
    if (!checkpointMatchesScope(checkpoint, scope)) {
      await this.clear();
      return undefined;
    }
    return { checkpoint, stale: false };
  }
}

function normalizeCheckpointRecord<TTask>(record: TaskCheckpointRecord<TTask>): TaskCheckpointRecord<TTask> {
  const total = Array.isArray(record.allTasks) ? record.allTasks.length : 0;
  const startFromIndex = clampInteger(record.startFromIndex, 0, total);
  const completedCount = clampInteger(record.completedCount, 0, total);
  return {
    ...record,
    allTasks: Array.isArray(record.allTasks) ? record.allTasks : [],
    startFromIndex,
    completedCount,
    savedAt: Number(record.savedAt) || Date.now(),
    sessionId: String(record.sessionId || ''),
    wsRootFsPath: normalizeFsPath(record.wsRootFsPath),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.max(min, Math.min(max, integer));
}

function checkpointMatchesScope<TTask>(checkpoint: TaskCheckpointRecord<TTask>, scope?: TaskCheckpointScope): boolean {
  if (!scope) return true;
  const expectedWorkspace = normalizeFsPath(scope.wsRootFsPath);
  if (expectedWorkspace && normalizeFsPath(checkpoint.wsRootFsPath) !== expectedWorkspace) return false;
  const expectedSession = String(scope.sessionId || '').trim();
  if (expectedSession && String(checkpoint.sessionId || '').trim() !== expectedSession) return false;
  return true;
}

function normalizeFsPath(value: string | undefined): string {
  return String(value || '').trim().replace(/[/\\]+$/g, '');
}
