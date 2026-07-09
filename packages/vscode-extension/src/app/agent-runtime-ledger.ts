import * as crypto from 'crypto';
import {
  IdempotencyGuard,
  type OperationRecord,
  type OperationRequest,
  type ReplayDecision,
} from '../agent/idempotency-guard';
import {
  TaskCheckpointStore,
  type TaskCheckpointRecord,
} from './task-checkpoint-store';
import {
  TaskHistoryStore,
  type TaskRunRecord,
  type TaskRunStatus,
} from './task-history-store';

export { TaskCheckpointStore, TaskHistoryStore };

export interface AgentRuntimeLedgerDeps<TTask = unknown> {
  historyStore: TaskHistoryStore;
  checkpointStore: TaskCheckpointStore<TTask>;
  idempotencyGuard?: IdempotencyGuard;
}

export interface TaskSettlementAuditInput {
  id: string;
  status: TaskRunStatus;
  changedFiles?: readonly string[];
  evidenceRefs?: readonly string[];
  operationRefs?: readonly string[];
  validationRefs?: readonly string[];
  qualityGateRef?: string;
  checkpointRef?: string;
  pauseReason?: string;
}

export class AgentRuntimeLedger<TTask = unknown> {
  private readonly idempotencyGuard: IdempotencyGuard;

  constructor(private readonly deps: AgentRuntimeLedgerDeps<TTask>) {
    this.idempotencyGuard = deps.idempotencyGuard ?? new IdempotencyGuard();
  }

  async recordTaskStarted(record: TaskRunRecord): Promise<TaskRunRecord> {
    return this.deps.historyStore.upsert({
      ...record,
      status: record.status === 'planned' ? 'running' : record.status,
      evidenceRefs: unique(record.evidenceRefs),
      operationRefs: unique(record.operationRefs),
      validationRefs: unique(record.validationRefs),
      changedFiles: unique(record.changedFiles),
    });
  }

  async recordSettlement(input: TaskSettlementAuditInput): Promise<TaskRunRecord | undefined> {
    const existing = this.deps.historyStore.get(input.id);
    if (!existing) return undefined;
    return this.deps.historyStore.upsert({
      ...existing,
      status: input.status,
      changedFiles: unique([...(existing.changedFiles ?? []), ...(input.changedFiles ?? [])]),
      evidenceRefs: unique([...(existing.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])]),
      operationRefs: unique([...(existing.operationRefs ?? []), ...(input.operationRefs ?? [])]),
      validationRefs: unique([...(existing.validationRefs ?? []), ...(input.validationRefs ?? [])]),
      qualityGateRef: input.qualityGateRef ?? existing.qualityGateRef,
      checkpointRef: input.checkpointRef ?? existing.checkpointRef,
      pauseReason: input.pauseReason,
    });
  }

  async saveCheckpoint(record: TaskCheckpointRecord<TTask>): Promise<string> {
    const normalized = {
      ...record,
      savedAt: record.savedAt || Date.now(),
      sessionId: record.sessionId || stableHash([record.userPrompt, record.wsRootFsPath]),
    };
    await this.deps.checkpointStore.save(normalized);
    return checkpointRef(normalized.sessionId, normalized.startFromIndex, normalized.savedAt);
  }

  async clearCheckpoint(): Promise<void> {
    await this.deps.checkpointStore.clear();
  }

  decideOperationReplay(request: OperationRequest): ReplayDecision {
    return this.idempotencyGuard.decideReplay(request);
  }

  markOperationStarted(request: OperationRequest): OperationRecord {
    return this.idempotencyGuard.markStarted(request);
  }

  markOperationCommitted(request: OperationRequest, resultRef?: string): OperationRecord {
    return this.idempotencyGuard.markCommitted(request, resultRef);
  }

  markOperationFailed(request: OperationRequest, resultRef?: string): OperationRecord {
    return this.idempotencyGuard.markFailed(request, resultRef);
  }

  listOperations(): OperationRecord[] {
    return this.idempotencyGuard.list();
  }
}

export function makeOperationId(workflowId: string, kind: string, input: unknown): string {
  return `${workflowId}:${kind}:${stableHash(input)}`;
}

export function stableHash(input: unknown): string {
  return crypto.createHash('sha256')
    .update(stableStringify(input))
    .digest('hex')
    .slice(0, 16);
}

function checkpointRef(sessionId: string, startFromIndex: number, savedAt: number): string {
  return `checkpoint:${sessionId}:${startFromIndex}:${savedAt}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => String(value || '').trim()).filter(Boolean))];
}
