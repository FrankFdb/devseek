import {
  CanonicalCheckpointService,
  CanonicalTaskContractService,
  codingSemanticDigest,
  type CodingCheckpoint,
  type CodingKernelTaskContract,
} from '@devseek-netai/shared';
import { stableSha256 } from './stable-hash';

export interface TaskCheckpointStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}

export const TASK_CHECKPOINT_RESUME_PROTOCOL = 'devseek.checkpoint-resume/v3';

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
  canonicalCheckpoint: CodingCheckpoint;
  canonicalTaskContract: CodingKernelTaskContract;
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
const CHECKPOINT = new CanonicalCheckpointService();
const TASK_CONTRACT = new CanonicalTaskContractService();

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
    try {
      const checkpoint = normalizeCheckpointRecord(record);
      return checkpointResumeReceiptIsValid(checkpoint, this.loadMeta()) ? checkpoint : undefined;
    } catch {
      return undefined;
    }
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
    let checkpoint: TaskCheckpointRecord<TTask>;
    try {
      checkpoint = normalizeCheckpointRecord(raw);
    } catch {
      await this.clear();
      return undefined;
    }
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
  const allTasks = Array.isArray(record.allTasks) ? record.allTasks : [];
  const total = allTasks.length;
  const startFromIndex = clampInteger(record.startFromIndex, 0, total);
  const completedCount = clampInteger(record.completedCount, 0, startFromIndex);
  const wsRootFsPath = normalizeFsPath(record.wsRootFsPath);
  const canonicalCheckpoint = CHECKPOINT.snapshot(record.canonicalCheckpoint);
  const canonicalTaskContract = TASK_CONTRACT.snapshot(record.canonicalTaskContract);
  if (canonicalCheckpoint.originSurface !== 'vscode') {
    throw new Error('task-checkpoint:surface-mismatch');
  }
  if (normalizeFsPath(canonicalCheckpoint.workspaceRoot) !== wsRootFsPath) {
    throw new Error('task-checkpoint:workspace-binding-mismatch');
  }
  if (codingSemanticDigest(canonicalTaskContract) !== canonicalCheckpoint.taskContractSha256) {
    throw new Error('task-checkpoint:task-contract-binding-mismatch');
  }
  assertPendingTaskBinding(allTasks.slice(startFromIndex), canonicalCheckpoint);
  return {
    ...record,
    allTasks,
    startFromIndex,
    completedCount,
    savedAt: Number(record.savedAt) || Date.now(),
    sessionId: String(record.sessionId || ''),
    wsRootFsPath,
    canonicalCheckpoint,
    canonicalTaskContract,
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

function assertPendingTaskBinding<TTask>(
  pendingTasks: readonly TTask[],
  checkpoint: CodingCheckpoint,
): void {
  if (pendingTasks.length === 0) return;
  const taskIds = pendingTasks.map(readTaskId);
  if (taskIds.some(id => id === undefined)) return;
  const checkpointIds = checkpoint.pendingUnits.map(unit => unit.id);
  if (taskIds.join('\n') !== checkpointIds.join('\n')) {
    throw new Error('task-checkpoint:pending-task-binding-mismatch');
  }
}

function readTaskId(task: unknown): string | undefined {
  if (!task || typeof task !== 'object') return undefined;
  const id = (task as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
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
    canonicalCheckpointSealSha256: checkpoint.canonicalCheckpoint.sealSha256,
    canonicalTaskContractSha256: codingSemanticDigest(checkpoint.canonicalTaskContract),
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
