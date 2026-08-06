import * as nodePath from 'path';
import {
  ProductRunEvidenceWorkspaceReader,
  type ProductRunEvidenceReaderPort,
  type RunEvidenceEvent,
  type RunEvidenceJson,
  type RunEvidenceSnapshot,
  type RunEvidenceVerificationReport,
} from '@devseek-netai/shared';
import {
  DEFAULT_TASK_CHECKPOINT_KEY,
  TASK_CHECKPOINT_RESUME_PROTOCOL,
  TaskCheckpointStore,
  type TaskCheckpointRecord,
  type TaskCheckpointStorage,
} from './task-checkpoint-store';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import { stableSha256 } from './stable-hash';
import type {
  TaskHistoryContinueResult,
  TaskHistoryLifecycleAction,
  TaskHistoryLifecycleReceipt,
  TaskRunRecord,
  TaskRunStatus,
  TaskRunTimelineItem,
} from './task-history-store';

export const TASK_HISTORY_PROJECTION_PROTOCOL = 'devseek.task-history-projection/v1';
export const TASK_HISTORY_LIFECYCLE_PROTOCOL = 'devseek.task-history-lifecycle/v1';
export const TASK_HISTORY_EXPORT_PROTOCOL = 'devseek.task-history-export/v1';
export const DEFAULT_TASK_HISTORY_LIFECYCLE_KEY = 'devseek.taskHistory.lifecycleReceipts.v1';
export const DEFAULT_TASK_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_TASK_HISTORY_CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type JsonObject = { [key: string]: RunEvidenceJson };

export interface TaskHistoryProjectionDetail {
  protocol: typeof TASK_HISTORY_PROJECTION_PROTOCOL;
  source: 'run-evidence';
  verificationStatus: RunEvidenceVerificationReport['status'];
  task: TaskRunRecord;
  timeline: TaskRunTimelineItem[];
  lifecycleReceipts: TaskHistoryLifecycleReceipt[];
}

export interface TaskHistoryProjectionServiceDeps<TTask = unknown> {
  workspaceRoot: string;
  storage?: TaskCheckpointStorage;
  checkpointStore?: TaskCheckpointStore<TTask>;
  evidenceReader?: ProductRunEvidenceReaderPort;
  maxRecords?: number;
  lifecycleKey?: string;
  retentionMs?: number;
  checkpointMaxAgeMs?: number;
  now?: () => number;
  guard?: SensitiveMemoryGuard;
}

export function exportTaskHistoryRecordRedacted(input: {
  source: 'run-evidence' | 'legacy-store';
  verificationStatus?: RunEvidenceVerificationReport['status'];
  task: TaskRunRecord;
  timeline?: TaskRunTimelineItem[];
  lifecycleReceipts?: TaskHistoryLifecycleReceipt[];
  exportedAt?: number;
  guard?: SensitiveMemoryGuard;
}): string {
  const guard = input.guard ?? new SensitiveMemoryGuard();
  const baseEnvelope = {
    protocol: TASK_HISTORY_EXPORT_PROTOCOL,
    lifecycleProtocol: TASK_HISTORY_LIFECYCLE_PROTOCOL,
    exportedAt: input.exportedAt ?? Date.now(),
    source: input.source,
    ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
    task: input.task,
    timeline: input.timeline ?? input.task.timeline ?? [],
    lifecycleReceipts: input.lifecycleReceipts ?? [],
    retention: {
      evidenceRetained: input.source === 'run-evidence',
      retentionUntil: maxRetentionUntil(input.lifecycleReceipts ?? []) || undefined,
    },
    redaction: {
      protocol: 'SensitiveMemoryGuard',
      redacted: false,
      redactionCount: 0,
      matches: [] as string[],
    },
  };
  const redaction = guard.redact(JSON.stringify(baseEnvelope, null, 2));
  return guard.redact(JSON.stringify({
    ...baseEnvelope,
    redaction: {
      protocol: 'SensitiveMemoryGuard',
      redacted: redaction.redacted,
      redactionCount: redaction.redactionCount,
      matches: redaction.matches,
    },
  }, null, 2)).text;
}

export class TaskHistoryProjectionService<TTask = unknown> {
  private readonly workspaceRoot: string;
  private readonly evidenceReader: ProductRunEvidenceReaderPort;
  private readonly checkpointStore?: TaskCheckpointStore<TTask>;
  private readonly storage?: TaskCheckpointStorage;
  private readonly maxRecords: number;
  private readonly lifecycleKey: string;
  private readonly retentionMs: number;
  private readonly checkpointMaxAgeMs: number;
  private readonly now: () => number;
  private readonly guard: SensitiveMemoryGuard;

  constructor(deps: TaskHistoryProjectionServiceDeps<TTask>) {
    this.workspaceRoot = nodePath.resolve(String(deps.workspaceRoot || process.cwd()));
    this.evidenceReader = deps.evidenceReader ?? ProductRunEvidenceWorkspaceReader.forWorkspace({
      workspaceRoot: this.workspaceRoot,
    });
    this.storage = deps.storage;
    this.checkpointStore = deps.checkpointStore ?? (
      deps.storage ? new TaskCheckpointStore<TTask>(deps.storage) : undefined
    );
    this.maxRecords = Math.max(1, Math.floor(deps.maxRecords ?? 100));
    this.lifecycleKey = deps.lifecycleKey || DEFAULT_TASK_HISTORY_LIFECYCLE_KEY;
    this.retentionMs = Math.max(0, Math.floor(deps.retentionMs ?? DEFAULT_TASK_HISTORY_RETENTION_MS));
    this.checkpointMaxAgeMs = Math.max(1, Math.floor(deps.checkpointMaxAgeMs ?? DEFAULT_TASK_HISTORY_CHECKPOINT_MAX_AGE_MS));
    this.now = deps.now ?? Date.now;
    this.guard = deps.guard ?? new SensitiveMemoryGuard();
  }

  list(): TaskRunRecord[] {
    return this.projectDetails()
      .map(detail => detail.task)
      .filter(task => !this.hasAppliedLifecycleAction(task.id, 'delete'))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxRecords);
  }

  get(id: string): TaskHistoryProjectionDetail | undefined {
    const target = String(id || '').trim();
    if (!target) return undefined;
    return this.projectDetails().find(detail => detail.task.id === target);
  }

  async archive(id: string): Promise<{ task?: TaskRunRecord; lifecycleReceipt: TaskHistoryLifecycleReceipt }> {
    const detail = this.get(id);
    const lifecycleReceipt = await this.recordLifecycleReceipt('archive', detail?.task, {
      status: detail ? 'applied' : 'blocked',
      reason: detail ? 'ui-archive-projection' : 'task-not-found',
    });
    return { task: detail ? this.applyLifecycleReceipts(detail.task, [lifecycleReceipt]) : undefined, lifecycleReceipt };
  }

  async delete(id: string): Promise<{ task?: TaskRunRecord; lifecycleReceipt: TaskHistoryLifecycleReceipt }> {
    const detail = this.get(id);
    const lifecycleReceipt = await this.recordLifecycleReceipt('delete', detail?.task, {
      status: detail ? 'applied' : 'blocked',
      reason: detail ? 'ui-delete-tombstone-evidence-retained' : 'task-not-found',
    });
    return { task: detail?.task, lifecycleReceipt };
  }

  async exportRecord(id: string): Promise<string | undefined> {
    const detail = this.get(id);
    if (!detail) return undefined;
    const lifecycleReceipt = await this.recordLifecycleReceipt('export', detail.task, {
      status: 'observed',
      reason: 'redacted-export',
      redactionCount: 0,
    });
    return exportTaskHistoryRecordRedacted({
      source: detail.source,
      verificationStatus: detail.verificationStatus,
      task: detail.task,
      timeline: detail.timeline,
      lifecycleReceipts: uniqueLifecycleReceipts([...detail.lifecycleReceipts, lifecycleReceipt]),
      exportedAt: this.now(),
      guard: this.guard,
    });
  }

  async requestContinue(id: string, options: { now?: number } = {}): Promise<TaskHistoryContinueResult> {
    const detail = this.get(id);
    if (!detail) {
      const lifecycleReceipt = await this.recordLifecycleReceipt('continue', undefined, {
        status: 'blocked',
        reason: 'task-not-found',
        now: options.now,
      });
      return { status: 'blocked', blockedReason: 'task-not-found', lifecycleReceipt };
    }

    const fresh = await this.loadFreshCheckpoint(detail.task, options.now);
    if (!fresh) {
      const blockedReason = this.checkpointBlockedReason(detail.task, options.now);
      const lifecycleReceipt = await this.recordLifecycleReceipt('continue', detail.task, {
        status: 'blocked',
        reason: blockedReason,
        now: options.now,
      });
      return { status: 'blocked', task: detail.task, blockedReason, lifecycleReceipt };
    }

    const checkpointRef = projectCheckpointRef(detail.task.id, undefined, fresh.checkpoint);
    const task = { ...detail.task, status: 'recoverable' as TaskRunStatus, checkpointRef };
    const lifecycleReceipt = await this.recordLifecycleReceipt('continue', task, {
      status: 'applied',
      reason: 'cross-window-checkpoint-resume',
      now: options.now,
    });
    return { status: 'resumable', task, checkpointRef, lifecycleReceipt };
  }

  private projectDetails(): TaskHistoryProjectionDetail[] {
    const details: TaskHistoryProjectionDetail[] = [];
    for (const runId of this.discoverRunIds()) {
      try {
        const verification = this.evidenceReader.verify(runId);
        if (!verification.valid) continue;
        const snapshot = this.evidenceReader.readSnapshot(runId);
        details.push(this.projectSnapshot(snapshot, verification));
      } catch {
        // Invalid or torn evidence is not silently converted into history UI facts.
      }
    }
    return details.sort((a, b) => b.task.updatedAt - a.task.updatedAt);
  }

  private discoverRunIds(): string[] {
    return [...this.evidenceReader.discoverRunIds()];
  }

  private projectSnapshot(
    snapshot: RunEvidenceSnapshot,
    verification: RunEvidenceVerificationReport,
  ): TaskHistoryProjectionDetail {
    const events = snapshot.records.map(record => record.event);
    const openEvent = events[0];
    const openPayload = payloadObject(openEvent);
    const commandEvent = events.find(event => event.type === 'command.accepted');
    const commandPayload = payloadObject(commandEvent);
    const settlementEvent = findLastEvent(events, 'run.settled');
    const checkpointEvent = findLastEvent(events, 'checkpoint.created');
    const activeCheckpoint = this.loadActiveCheckpoint(stringValue(openPayload.session_id));
    const timeline = events.map(projectTimelineItem);
    const createdAt = eventTimeMs(openEvent);
    const updatedAt = Math.max(
      ...events.map(eventTimeMs),
      snapshot.seal ? Date.parse(snapshot.seal.seal.sealed_at) : 0,
      createdAt,
    );
    const baseTask: TaskRunRecord = {
      id: snapshot.runId,
      ...(stringValue(openPayload.session_id) ? { sessionId: stringValue(openPayload.session_id) } : {}),
      workspaceId: this.workspaceRoot,
      repositoryRoot: this.workspaceRoot,
      title: buildTaskHistoryTitle(snapshot.runId, settlementEvent),
      userGoal: buildEvidenceBoundUserGoal(snapshot.runId, commandPayload),
      provider: { type: 'bridge' },
      status: projectTaskRunStatus(events, settlementEvent, checkpointEvent, activeCheckpoint),
      workflowMode: projectWorkflowMode(openPayload.mode),
      todos: projectTodos(events),
      changedFiles: [],
      operationRefs: collectOperationRefs(events),
      changeSetRefs: [],
      validationRefs: collectOperationRefs(events.filter(event => event.type.startsWith('verification.'))),
      qualityGateRef: collectOperationRefs(events.filter(event => event.type.startsWith('quality_gate.'))).at(-1),
      checkpointRef: projectCheckpointRef(snapshot.runId, checkpointEvent, activeCheckpoint),
      pauseReason: projectPauseReason(checkpointEvent, activeCheckpoint),
      evidenceRefs: events.map(evidenceRef),
      historySource: 'run-evidence',
      historySourceRef: `run-evidence:${snapshot.runId}:${verification.head?.eventSha256 ?? 'open'}`,
      timeline,
      createdAt,
      updatedAt,
    };
    const lifecycleReceipts = this.loadLifecycleReceiptsForTask(baseTask.id);
    const task = this.applyLifecycleReceipts(baseTask, lifecycleReceipts);
    return {
      protocol: TASK_HISTORY_PROJECTION_PROTOCOL,
      source: 'run-evidence',
      verificationStatus: verification.status,
      task,
      timeline,
      lifecycleReceipts,
    };
  }

  private loadActiveCheckpoint(sessionId?: string): TaskCheckpointRecord<TTask> | undefined {
    if (!this.checkpointStore) return undefined;
    return this.checkpointStore.loadScoped({
      wsRootFsPath: this.workspaceRoot,
      ...(sessionId ? { sessionId } : {}),
    });
  }

  private async loadFreshCheckpoint(
    task: TaskRunRecord,
    now = this.now(),
  ): Promise<{ checkpoint: TaskCheckpointRecord<TTask>; stale: false } | undefined> {
    if (!this.checkpointStore) return undefined;
    const loader = this.checkpointStore as TaskCheckpointStore<TTask> & {
      loadFresh?: (
        maxAgeMs: number,
        now?: number,
        scope?: { wsRootFsPath?: string; sessionId?: string },
      ) => Promise<{ checkpoint: TaskCheckpointRecord<TTask>; stale: false } | undefined>;
    };
    if (typeof loader.loadFresh !== 'function') return undefined;
    return loader.loadFresh(this.checkpointMaxAgeMs, now, {
      wsRootFsPath: this.workspaceRoot,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    });
  }

  private checkpointBlockedReason(task: TaskRunRecord, now = this.now()): string {
    const raw = this.storage?.get<TaskCheckpointRecord<TTask>>(DEFAULT_TASK_CHECKPOINT_KEY);
    if (!raw) return 'checkpoint-unavailable-or-expired';
    if (raw.checkpointProtocol && raw.checkpointProtocol !== TASK_CHECKPOINT_RESUME_PROTOCOL) {
      return 'checkpoint-version-incompatible';
    }
    if (raw.sessionId && task.sessionId && raw.sessionId !== task.sessionId) return 'checkpoint-scope-mismatch';
    if (raw.wsRootFsPath && normalizeFsPath(raw.wsRootFsPath) !== normalizeFsPath(this.workspaceRoot)) {
      return 'checkpoint-scope-mismatch';
    }
    if (!Number.isFinite(raw.savedAt) || Number(raw.savedAt) <= now - this.checkpointMaxAgeMs) {
      return 'checkpoint-unavailable-or-expired';
    }
    return 'checkpoint-unavailable-or-expired';
  }

  private async recordLifecycleReceipt(
    action: TaskHistoryLifecycleAction,
    task: TaskRunRecord | undefined,
    input: {
      status: TaskHistoryLifecycleReceipt['status'];
      reason: string;
      now?: number;
      redactionCount?: number;
    },
  ): Promise<TaskHistoryLifecycleReceipt> {
    const createdAt = input.now ?? this.now();
    const taskId = task?.id ?? '';
    const sourceRef = task?.historySourceRef ?? (taskId ? `run-evidence:${taskId}:unknown` : undefined);
    const idempotencyKey = [
      TASK_HISTORY_LIFECYCLE_PROTOCOL,
      action,
      taskId || 'missing-task',
      sourceRef || 'missing-source',
    ].join(':');
    const existing = this.loadLifecycleReceipts()
      .find(receipt => receipt.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const lifecycleReceipt: TaskHistoryLifecycleReceipt = {
      id: stableLifecycleReceiptId(idempotencyKey),
      taskId,
      action,
      status: input.status,
      reason: input.reason,
      source: task?.historySource === 'legacy-store' ? 'legacy-store' : 'run-evidence',
      ...(sourceRef ? { sourceRef } : {}),
      evidenceRefs: task?.evidenceRefs ?? [],
      retentionUntil: createdAt + this.retentionMs,
      createdAt,
      idempotencyKey,
      ...(Number.isFinite(input.redactionCount) ? { redactionCount: Number(input.redactionCount) } : {}),
    };
    await this.writeLifecycleReceipt(lifecycleReceipt);
    return lifecycleReceipt;
  }

  private loadLifecycleReceiptsForTask(taskId: string): TaskHistoryLifecycleReceipt[] {
    const target = String(taskId || '').trim();
    return this.loadLifecycleReceipts()
      .filter(receipt => receipt.taskId === target)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private loadLifecycleReceipts(): TaskHistoryLifecycleReceipt[] {
    const raw = this.storage?.get<TaskHistoryLifecycleReceipt[]>(this.lifecycleKey);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeLifecycleReceipt).filter(receipt => receipt.taskId && receipt.action);
  }

  private async writeLifecycleReceipt(receipt: TaskHistoryLifecycleReceipt): Promise<void> {
    if (!this.storage) return;
    const next = uniqueLifecycleReceipts([...this.loadLifecycleReceipts(), receipt])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(this.maxRecords * 4, this.maxRecords));
    await this.storage.update(this.lifecycleKey, next);
  }

  private hasAppliedLifecycleAction(taskId: string, action: TaskHistoryLifecycleAction): boolean {
    return this.loadLifecycleReceiptsForTask(taskId)
      .some(receipt => receipt.action === action && receipt.status === 'applied');
  }

  private applyLifecycleReceipts(
    task: TaskRunRecord,
    lifecycleReceipts: readonly TaskHistoryLifecycleReceipt[],
  ): TaskRunRecord {
    if (lifecycleReceipts.some(receipt => receipt.action === 'archive' && receipt.status === 'applied')) {
      return { ...task, status: 'archived', updatedAt: Math.max(task.updatedAt, maxReceiptTime(lifecycleReceipts)) };
    }
    return task;
  }
}

function projectTimelineItem(event: RunEvidenceEvent): TaskRunTimelineItem {
  const payload = payloadObject(event);
  const status = stringValue(payload.status);
  return {
    id: `run-evidence:${event.sequence}:${event.event_sha256}`,
    type: event.type,
    ...(status ? { status } : {}),
    evidenceRef: evidenceRef(event),
    occurredAt: eventTimeMs(event),
    summary: summarizeTimelineEvent(event, payload),
  };
}

function projectTaskRunStatus(
  events: RunEvidenceEvent[],
  settlementEvent: RunEvidenceEvent | undefined,
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): TaskRunStatus {
  const settlementStatus = stringValue(payloadObject(settlementEvent).status);
  if (
    settlementStatus === 'completed'
    || settlementStatus === 'failed'
    || settlementStatus === 'blocked'
    || settlementStatus === 'cancelled'
  ) {
    return settlementStatus;
  }
  if (events.some(event => event.type === 'quality_gate.failed' || event.type === 'quality_gate.vetoed')) {
    return 'quality-failed';
  }
  if (checkpointEvent || activeCheckpoint) return 'recoverable';
  return 'running';
}

function projectCheckpointRef(
  runId: string,
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): string | undefined {
  if (activeCheckpoint) {
    return `checkpoint:${activeCheckpoint.sessionId}:${activeCheckpoint.startFromIndex}:${activeCheckpoint.savedAt}`;
  }
  if (!checkpointEvent) return undefined;
  return `run-evidence-checkpoint:${runId}:${checkpointEvent.sequence}`;
}

function projectPauseReason(
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): string | undefined {
  return activeCheckpoint?.pauseReason || stringValue(payloadObject(checkpointEvent).reason);
}

function projectTodos(events: RunEvidenceEvent[]): TaskRunRecord['todos'] {
  const todos = new Map<string, { id?: string | number; title: string; status: string }>();
  for (const event of events.filter(candidate => candidate.type === 'agent.status')) {
    const payload = payloadObject(event);
    const rawId = stringValue(payload.task_id) ?? numberValue(payload.task_index)?.toString();
    if (!rawId) continue;
    todos.set(rawId, {
      id: rawId,
      title: `Task ${rawId}`,
      status: stringValue(payload.status) ?? 'observed',
    });
  }
  return [...todos.values()];
}

function collectOperationRefs(events: readonly RunEvidenceEvent[]): string[] {
  return unique(events.map(event => stringValue(payloadObject(event).operation_id)));
}

function normalizeLifecycleReceipt(receipt: TaskHistoryLifecycleReceipt): TaskHistoryLifecycleReceipt {
  const action = normalizeLifecycleAction(receipt.action);
  return {
    id: String(receipt.id || stableLifecycleReceiptId(receipt.idempotencyKey || `${receipt.taskId}:${action}`)).trim(),
    taskId: String(receipt.taskId || '').trim(),
    action,
    status: normalizeLifecycleStatus(receipt.status),
    reason: String(receipt.reason || '').trim() || 'observed',
    source: receipt.source === 'legacy-store' ? 'legacy-store' : 'run-evidence',
    ...(receipt.sourceRef ? { sourceRef: String(receipt.sourceRef).trim() } : {}),
    evidenceRefs: unique(receipt.evidenceRefs),
    ...(Number.isFinite(receipt.retentionUntil) ? { retentionUntil: Number(receipt.retentionUntil) } : {}),
    createdAt: Number(receipt.createdAt) || Date.now(),
    idempotencyKey: String(receipt.idempotencyKey || `${receipt.taskId}:${action}`).trim(),
    ...(Number.isFinite(receipt.redactionCount) ? { redactionCount: Number(receipt.redactionCount) } : {}),
  };
}

function normalizeLifecycleAction(action: string): TaskHistoryLifecycleAction {
  return action === 'archive' || action === 'delete' || action === 'export' || action === 'continue'
    ? action
    : 'export';
}

function normalizeLifecycleStatus(status: string): TaskHistoryLifecycleReceipt['status'] {
  return status === 'applied' || status === 'blocked' || status === 'observed' ? status : 'observed';
}

function uniqueLifecycleReceipts(receipts: readonly TaskHistoryLifecycleReceipt[]): TaskHistoryLifecycleReceipt[] {
  const byKey = new Map<string, TaskHistoryLifecycleReceipt>();
  for (const receipt of receipts.map(normalizeLifecycleReceipt)) {
    byKey.set(receipt.idempotencyKey || receipt.id, receipt);
  }
  return [...byKey.values()];
}

function maxReceiptTime(receipts: readonly TaskHistoryLifecycleReceipt[]): number {
  return Math.max(0, ...receipts.map(receipt => Number(receipt.createdAt) || 0));
}

function maxRetentionUntil(receipts: readonly TaskHistoryLifecycleReceipt[]): number {
  return Math.max(0, ...receipts.map(receipt => Number(receipt.retentionUntil) || 0));
}

function stableLifecycleReceiptId(idempotencyKey: string): string {
  return `task-history-lifecycle:${stableSha256({
    protocol: TASK_HISTORY_LIFECYCLE_PROTOCOL,
    idempotencyKey,
  })}`;
}

function buildTaskHistoryTitle(runId: string, settlementEvent: RunEvidenceEvent | undefined): string {
  const status = stringValue(payloadObject(settlementEvent).status);
  return status ? `Run ${runId} (${status})` : `Run ${runId}`;
}

function buildEvidenceBoundUserGoal(runId: string, commandPayload: JsonObject): string {
  const promptHash = stringValue(commandPayload.prompt_sha256);
  return promptHash ? `prompt_sha256:${promptHash}` : `run_id:${runId}`;
}

function projectWorkflowMode(value: RunEvidenceJson): TaskRunRecord['workflowMode'] {
  const mode = stringValue(value);
  if (mode === 'chat' || mode === 'inspect' || mode === 'plan' || mode === 'edit' || mode === 'run' || mode === 'review') {
    return mode;
  }
  return 'chat';
}

function summarizeTimelineEvent(event: RunEvidenceEvent, payload: JsonObject): string {
  const status = stringValue(payload.status);
  const operationId = stringValue(payload.operation_id);
  const reason = stringValue(payload.reason);
  return [event.type, status, operationId, reason].filter(Boolean).join(' | ');
}

function findLastEvent(events: readonly RunEvidenceEvent[], type: RunEvidenceEvent['type']): RunEvidenceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return undefined;
}

function eventTimeMs(event: RunEvidenceEvent | undefined): number {
  const parsed = Date.parse(String(event?.occurred_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function evidenceRef(event: RunEvidenceEvent): string {
  return `run-evidence:${event.sequence}:${event.event_sha256}`;
}

function payloadObject(event: RunEvidenceEvent | undefined): JsonObject {
  return objectValue(event?.payload);
}

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function stringValue(value: RunEvidenceJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: RunEvidenceJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeFsPath(value: string | undefined): string {
  return String(value || '').trim().replace(/[/\\]+$/g, '');
}
