export type TaskRunStatus =
  | 'planned'
  | 'running'
  | 'paused'
  | 'recoverable'
  | 'quality-failed'
  | 'review-ready'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'archived';

export interface TaskRunProviderInfo {
  type: 'bridge' | 'deepseek-api' | 'openai-compat' | 'local-api' | 'vscode-lm';
  model?: string;
}

export interface TaskRunTimelineItem {
  id: string;
  type: string;
  status?: string;
  evidenceRef: string;
  occurredAt: number;
  summary: string;
}

export type TaskHistoryLifecycleAction = 'archive' | 'delete' | 'export' | 'continue';
export type TaskHistoryLifecycleStatus = 'applied' | 'blocked' | 'observed';

export interface TaskHistoryLifecycleReceipt {
  id: string;
  taskId: string;
  action: TaskHistoryLifecycleAction;
  status: TaskHistoryLifecycleStatus;
  reason: string;
  source: 'run-evidence' | 'legacy-store';
  sourceRef?: string;
  evidenceRefs: string[];
  retentionUntil?: number;
  createdAt: number;
  idempotencyKey: string;
  redactionCount?: number;
}

export interface TaskHistoryContinueResult {
  status: 'resumable' | 'blocked';
  task?: TaskRunRecord;
  checkpointRef?: string;
  blockedReason?: string;
  lifecycleReceipt?: TaskHistoryLifecycleReceipt;
}

export interface TaskRunRecord {
  id: string;
  sessionId?: string;
  workspaceId: string;
  repositoryRoot?: string;
  branch?: string;
  title: string;
  userGoal: string;
  provider: TaskRunProviderInfo;
  status: TaskRunStatus;
  workflowMode: 'chat' | 'inspect' | 'plan' | 'edit' | 'run' | 'review';
  todos: Array<{ id?: string | number; title: string; status: string }>;
  changedFiles: string[];
  operationRefs: string[];
  changeSetRefs: string[];
  validationRefs: string[];
  qualityGateRef?: string;
  checkpointRef?: string;
  pauseReason?: string;
  evidenceRefs: string[];
  historySource?: 'run-evidence' | 'legacy-store';
  historySourceRef?: string;
  timeline?: TaskRunTimelineItem[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskHistoryStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void> | void;
}

export const DEFAULT_TASK_HISTORY_KEY = 'devseek.taskHistory';

export class TaskHistoryStore {
  constructor(
    private readonly storage: TaskHistoryStorage,
    private readonly key = DEFAULT_TASK_HISTORY_KEY,
    private readonly maxRecords = 100,
  ) {}

  list(): TaskRunRecord[] {
    return normalizeRecords(this.storage.get<TaskRunRecord[]>(this.key)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): TaskRunRecord | undefined {
    return this.list().find(record => record.id === id);
  }

  async upsert(input: TaskRunRecord): Promise<TaskRunRecord> {
    const now = Date.now();
    const existing = this.get(input.id);
    const record = normalizeRecord({
      ...existing,
      ...input,
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: input.updatedAt || now,
    });
    const next = [record, ...this.list().filter(item => item.id !== record.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxRecords);
    await this.storage.update(this.key, next);
    return record;
  }

  async markPaused(id: string, status: Extract<TaskRunStatus, 'paused' | 'recoverable' | 'quality-failed'>, pauseReason: string, checkpointRef?: string): Promise<TaskRunRecord | undefined> {
    const existing = this.get(id);
    if (!existing) return undefined;
    return this.upsert({
      ...existing,
      status,
      pauseReason,
      checkpointRef: checkpointRef || existing.checkpointRef,
      updatedAt: Date.now(),
    });
  }

  async archive(id: string): Promise<TaskRunRecord | undefined> {
    const existing = this.get(id);
    if (!existing) return undefined;
    return this.upsert({ ...existing, status: 'archived', updatedAt: Date.now() });
  }

  async delete(id: string): Promise<boolean> {
    const before = this.list();
    const next = before.filter(record => record.id !== id);
    await this.storage.update(this.key, next);
    return next.length !== before.length;
  }

  exportRecord(id: string): string | undefined {
    const record = this.get(id);
    return record ? JSON.stringify(record, null, 2) : undefined;
  }
}

function normalizeRecords(records: TaskRunRecord[] | undefined): TaskRunRecord[] {
  return Array.isArray(records) ? records.map(normalizeRecord).filter(record => record.id) : [];
}

function normalizeRecord(record: TaskRunRecord): TaskRunRecord {
  return {
    ...record,
    id: String(record.id || '').trim(),
    workspaceId: String(record.workspaceId || '').trim(),
    title: String(record.title || record.userGoal || 'Untitled task').trim(),
    userGoal: String(record.userGoal || '').trim(),
    provider: record.provider || { type: 'bridge' },
    status: record.status || 'running',
    workflowMode: record.workflowMode || 'chat',
    todos: Array.isArray(record.todos) ? record.todos : [],
    changedFiles: unique(record.changedFiles),
    operationRefs: unique(record.operationRefs),
    changeSetRefs: unique(record.changeSetRefs),
    validationRefs: unique(record.validationRefs),
    evidenceRefs: unique(record.evidenceRefs),
    createdAt: Number(record.createdAt) || Date.now(),
    updatedAt: Number(record.updatedAt) || Date.now(),
  };
}

function unique(values: string[] | undefined): string[] {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}
