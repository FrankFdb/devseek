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
  pauseReason?: string;
}

export interface FreshCheckpointResult<TTask = unknown> {
  checkpoint: TaskCheckpointRecord<TTask>;
  stale: false;
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

  async save(record: TaskCheckpointRecord<TTask>): Promise<void> {
    await this.storage.update(this.key, normalizeCheckpointRecord(record));
  }

  async clear(): Promise<void> {
    await this.storage.update(this.key, undefined);
  }

  async loadFresh(maxAgeMs: number, now = Date.now()): Promise<FreshCheckpointResult<TTask> | undefined> {
    const checkpoint = this.load();
    if (!checkpoint) return undefined;
    if (!checkpoint.savedAt || checkpoint.savedAt <= now - maxAgeMs) {
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
  };
}

function clampInteger(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.max(min, Math.min(max, integer));
}
