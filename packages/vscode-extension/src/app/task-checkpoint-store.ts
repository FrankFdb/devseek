import { stableSha256 } from './stable-hash';

export interface TaskCheckpointStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}

export const TASK_CHECKPOINT_RESUME_PROTOCOL = 'devseek.checkpoint-resume/v1';

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
  checkpointProtocol?: typeof TASK_CHECKPOINT_RESUME_PROTOCOL;
  checkpointEpoch?: number;
  taskFingerprint?: string;
  resumeReceipt?: string;
}

interface SealedTaskCheckpointRecord<TTask = unknown> extends TaskCheckpointRecord<TTask> {
  checkpointProtocol: typeof TASK_CHECKPOINT_RESUME_PROTOCOL;
  checkpointEpoch: number;
  taskFingerprint: string;
  resumeReceipt: string;
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

export interface ScopedTaskCheckpointServiceOptions {
  readonly storage: TaskCheckpointStorage;
  readonly getScope: () => TaskCheckpointScope;
  readonly key?: string;
  readonly now?: () => number;
}

interface TaskCheckpointMeta {
  checkpointProtocol: typeof TASK_CHECKPOINT_RESUME_PROTOCOL;
  checkpointEpoch: number;
  activeResumeReceipt: string | null;
  clearedAt?: number;
}

export class TaskCheckpointStore<TTask = unknown> {
  private readonly metaKey: string;

  constructor(
    private readonly storage: TaskCheckpointStorage,
    private readonly key = DEFAULT_TASK_CHECKPOINT_KEY,
  ) {
    this.metaKey = `${key}.meta`;
  }

  load(): TaskCheckpointRecord<TTask> | undefined {
    const record = this.storage.get<TaskCheckpointRecord<TTask>>(this.key);
    if (!record) return undefined;
    const checkpoint = normalizeCheckpointRecord(record);
    return checkpointResumeReceiptIsValid(checkpoint, this.loadMeta()) ? checkpoint : undefined;
  }

  loadScoped(scope?: TaskCheckpointScope): TaskCheckpointRecord<TTask> | undefined {
    const checkpoint = this.load();
    if (!checkpoint) return undefined;
    return checkpointMatchesScope(checkpoint, scope) ? checkpoint : undefined;
  }

  async save(record: TaskCheckpointRecord<TTask>): Promise<void> {
    const checkpointEpoch = this.nextCheckpointEpoch();
    const checkpoint = sealCheckpointRecord(normalizeCheckpointRecord(record), checkpointEpoch);
    await this.storage.update(this.key, checkpoint);
    await this.storage.update(this.metaKey, {
      checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL,
      checkpointEpoch,
      activeResumeReceipt: checkpoint.resumeReceipt,
    } satisfies TaskCheckpointMeta);
  }

  async clear(): Promise<void> {
    await this.storage.update(this.metaKey, {
      checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL,
      checkpointEpoch: this.nextCheckpointEpoch(),
      activeResumeReceipt: null,
      clearedAt: Date.now(),
    } satisfies TaskCheckpointMeta);
    await this.storage.update(this.key, undefined);
  }

  async loadFresh(
    maxAgeMs: number,
    now = Date.now(),
    scope?: TaskCheckpointScope,
  ): Promise<FreshCheckpointResult<TTask> | undefined> {
    const raw = this.storage.get<TaskCheckpointRecord<TTask>>(this.key);
    if (!raw) return undefined;
    const checkpoint = normalizeCheckpointRecord(raw);
    if (!checkpointResumeReceiptIsValid(checkpoint, this.loadMeta())) {
      await this.clear();
      return undefined;
    }
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

  private loadMeta(): TaskCheckpointMeta | undefined {
    const meta = this.storage.get<TaskCheckpointMeta>(this.metaKey);
    if (!meta || meta.checkpointProtocol !== TASK_CHECKPOINT_RESUME_PROTOCOL) return undefined;
    return {
      checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL,
      checkpointEpoch: normalizeCheckpointEpoch(meta.checkpointEpoch),
      activeResumeReceipt: typeof meta.activeResumeReceipt === 'string' && meta.activeResumeReceipt
        ? meta.activeResumeReceipt
        : null,
      ...(Number.isFinite(meta.clearedAt) ? { clearedAt: Number(meta.clearedAt) } : {}),
    };
  }

  private nextCheckpointEpoch(): number {
    return normalizeCheckpointEpoch(this.storage.get<TaskCheckpointMeta>(this.metaKey)?.checkpointEpoch) + 1;
  }
}

export class ScopedTaskCheckpointService<TTask = unknown> {
  private readonly store: TaskCheckpointStore<TTask>;
  private readonly getScope: () => TaskCheckpointScope;
  private readonly now: () => number;

  constructor(options: ScopedTaskCheckpointServiceOptions) {
    this.store = new TaskCheckpointStore<TTask>(options.storage, options.key);
    this.getScope = options.getScope;
    this.now = options.now ?? Date.now;
  }

  readonly load = (): TaskCheckpointRecord<TTask> | undefined => (
    this.store.loadScoped(this.getScope())
  );

  readonly loadFresh = async (maxAgeMs: number): Promise<TaskCheckpointRecord<TTask> | undefined> => (
    (await this.store.loadFresh(maxAgeMs, this.now(), this.getScope()))?.checkpoint
  );

  readonly save = async (record: TaskCheckpointRecord<TTask> | null): Promise<void> => {
    await (record ? this.store.save(record) : this.store.clear());
  };
}

function normalizeCheckpointRecord<TTask>(record: TaskCheckpointRecord<TTask>): TaskCheckpointRecord<TTask> {
  const total = Array.isArray(record.allTasks) ? record.allTasks.length : 0;
  const startFromIndex = clampInteger(record.startFromIndex, 0, total);
  const completedCount = clampInteger(record.completedCount, 0, startFromIndex);
  return {
    ...record,
    allTasks: Array.isArray(record.allTasks) ? record.allTasks : [],
    startFromIndex,
    completedCount,
    savedAt: Number(record.savedAt) || Date.now(),
    sessionId: String(record.sessionId || ''),
    wsRootFsPath: normalizeFsPath(record.wsRootFsPath),
    ...(record.checkpointProtocol === TASK_CHECKPOINT_RESUME_PROTOCOL
      ? { checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL }
      : {}),
    ...(Number.isFinite(record.checkpointEpoch)
      ? { checkpointEpoch: normalizeCheckpointEpoch(record.checkpointEpoch) }
      : {}),
    ...(typeof record.taskFingerprint === 'string' && record.taskFingerprint
      ? { taskFingerprint: record.taskFingerprint }
      : {}),
    ...(typeof record.resumeReceipt === 'string' && record.resumeReceipt
      ? { resumeReceipt: record.resumeReceipt }
      : {}),
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

function sealCheckpointRecord<TTask>(
  record: TaskCheckpointRecord<TTask>,
  checkpointEpoch: number,
): SealedTaskCheckpointRecord<TTask> {
  const epoch = normalizeCheckpointEpoch(checkpointEpoch);
  const taskFingerprint = buildCheckpointTaskFingerprint(record);
  return {
    ...record,
    checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL,
    checkpointEpoch: epoch,
    taskFingerprint,
    resumeReceipt: buildCheckpointResumeReceipt(epoch, taskFingerprint),
  };
}

function checkpointResumeReceiptIsValid<TTask>(
  checkpoint: TaskCheckpointRecord<TTask>,
  meta: TaskCheckpointMeta | undefined,
): boolean {
  if (!meta || meta.checkpointProtocol !== TASK_CHECKPOINT_RESUME_PROTOCOL) return false;
  if (checkpoint.checkpointProtocol !== TASK_CHECKPOINT_RESUME_PROTOCOL) return false;
  const checkpointEpoch = normalizeCheckpointEpoch(checkpoint.checkpointEpoch);
  if (checkpointEpoch <= 0 || checkpointEpoch !== meta.checkpointEpoch) return false;
  const activeResumeReceipt = String(meta.activeResumeReceipt || '').trim();
  if (!activeResumeReceipt || checkpoint.resumeReceipt !== activeResumeReceipt) return false;
  const taskFingerprint = buildCheckpointTaskFingerprint(checkpoint);
  if (checkpoint.taskFingerprint !== taskFingerprint) return false;
  return checkpoint.resumeReceipt === buildCheckpointResumeReceipt(checkpointEpoch, taskFingerprint);
}

function buildCheckpointTaskFingerprint<TTask>(checkpoint: TaskCheckpointRecord<TTask>): string {
  return stableSha256({
    allTasks: checkpoint.allTasks,
    completedCount: checkpoint.completedCount,
    displayPrompt: checkpoint.displayPrompt,
    mode: checkpoint.mode ?? null,
    pauseReason: checkpoint.pauseReason ?? null,
    recoveryKind: checkpoint.recoveryKind ?? null,
    savedAt: checkpoint.savedAt,
    sessionId: checkpoint.sessionId,
    startFromIndex: checkpoint.startFromIndex,
    userPrompt: checkpoint.userPrompt,
    wsRootFsPath: normalizeFsPath(checkpoint.wsRootFsPath),
  });
}

function buildCheckpointResumeReceipt(checkpointEpoch: number, taskFingerprint: string): string {
  return stableSha256({
    checkpointEpoch: normalizeCheckpointEpoch(checkpointEpoch),
    checkpointProtocol: TASK_CHECKPOINT_RESUME_PROTOCOL,
    taskFingerprint,
  });
}

function normalizeCheckpointEpoch(value: unknown): number {
  return clampInteger(Number(value), 0, Number.MAX_SAFE_INTEGER - 1);
}
