export type OperationKind = 'edit' | 'terminal' | 'mcp' | 'memory' | 'vscode';
export type OperationStatus = 'planned' | 'started' | 'committed' | 'failed' | 'cancelled';
export type OperationReplayPolicy = 'never' | 'read-only' | 'requires-confirmation';

export interface OperationRecord {
  operationId: string;
  workflowId: string;
  kind: OperationKind;
  inputHash: string;
  status: OperationStatus;
  replayPolicy: OperationReplayPolicy;
  resultRef?: string;
  updatedAt?: number;
}

export interface OperationRequest {
  operationId: string;
  workflowId: string;
  kind: OperationKind;
  inputHash: string;
  replayPolicy?: OperationReplayPolicy;
  readOnly?: boolean;
}

export type ReplayDecisionAction = 'execute' | 'cached' | 'requires-confirmation' | 'blocked';

export interface ReplayDecision {
  action: ReplayDecisionAction;
  reason: string;
  record: OperationRecord;
  resultRef?: string;
}

export class IdempotencyGuard {
  private readonly records = new Map<string, OperationRecord>();

  constructor(initialRecords: OperationRecord[] = []) {
    for (const record of initialRecords) {
      this.record(record);
    }
  }

  record(input: OperationRecord): OperationRecord {
    const record = normalizeOperationRecord(input);
    this.records.set(record.operationId, record);
    return record;
  }

  decideReplay(request: OperationRequest): ReplayDecision {
    const normalized = normalizeOperationRequest(request);
    const existing = this.records.get(normalized.operationId);
    if (!existing) {
      const record = this.record({ ...normalized, status: 'planned' });
      return { action: 'execute', reason: 'new-operation', record };
    }

    if (existing.workflowId !== normalized.workflowId) {
      return { action: 'blocked', reason: 'operation-id-workflow-mismatch', record: existing };
    }

    if (existing.inputHash !== normalized.inputHash) {
      return { action: 'blocked', reason: 'operation-id-input-mismatch', record: existing };
    }

    if (existing.status === 'committed') {
      if (existing.replayPolicy === 'read-only') {
        return { action: 'execute', reason: 'read-only-replay-allowed', record: existing, resultRef: existing.resultRef };
      }
      if (existing.replayPolicy === 'never') {
        return { action: 'cached', reason: 'committed-operation-never-replay', record: existing, resultRef: existing.resultRef };
      }
      return { action: 'requires-confirmation', reason: 'committed-operation-requires-confirmation', record: existing, resultRef: existing.resultRef };
    }

    if (existing.status === 'started') {
      return { action: 'blocked', reason: 'operation-already-started', record: existing };
    }

    if (existing.status === 'planned' || existing.status === 'failed' || existing.status === 'cancelled') {
      if (existing.replayPolicy === 'requires-confirmation' && isSideEffectKind(existing.kind)) {
        return { action: 'requires-confirmation', reason: `${existing.status}-side-effect-retry-requires-confirmation`, record: existing };
      }
      return { action: 'execute', reason: `${existing.status}-operation-can-run`, record: existing };
    }

    return { action: 'blocked', reason: 'unknown-operation-state', record: existing };
  }

  markStarted(request: OperationRequest): OperationRecord {
    const decision = this.decideReplay(request);
    return this.record({ ...decision.record, status: 'started' });
  }

  markCommitted(request: OperationRequest, resultRef?: string): OperationRecord {
    const record = normalizeOperationRequest(request);
    return this.record({ ...record, status: 'committed', resultRef });
  }

  markFailed(request: OperationRequest, resultRef?: string): OperationRecord {
    const record = normalizeOperationRequest(request);
    return this.record({ ...record, status: 'failed', resultRef });
  }

  list(): OperationRecord[] {
    return [...this.records.values()].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0) || a.operationId.localeCompare(b.operationId));
  }
}

export function defaultReplayPolicy(kind: OperationKind, readOnly = false): OperationReplayPolicy {
  if (readOnly) return 'read-only';
  if (kind === 'edit') return 'never';
  if (kind === 'memory' || kind === 'mcp' || kind === 'terminal' || kind === 'vscode') return 'requires-confirmation';
  return 'requires-confirmation';
}

function normalizeOperationRequest(request: OperationRequest): OperationRecord {
  const kind = request.kind || 'vscode';
  const replayPolicy = request.replayPolicy || defaultReplayPolicy(kind, request.readOnly === true);
  return {
    operationId: String(request.operationId || '').trim(),
    workflowId: String(request.workflowId || '').trim(),
    kind,
    inputHash: String(request.inputHash || '').trim(),
    status: 'planned',
    replayPolicy,
    updatedAt: Date.now(),
  };
}

function normalizeOperationRecord(record: OperationRecord): OperationRecord {
  const base = normalizeOperationRequest(record);
  return {
    ...base,
    status: record.status || 'planned',
    replayPolicy: record.replayPolicy || base.replayPolicy,
    resultRef: record.resultRef,
    updatedAt: Number(record.updatedAt) || Date.now(),
  };
}

function isSideEffectKind(kind: OperationKind): boolean {
  return ['edit', 'terminal', 'mcp', 'memory', 'vscode'].includes(kind);
}
