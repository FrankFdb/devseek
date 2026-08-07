import type { CodingContextGraph } from './coding-context-graph';
import type { CodingKernelSurface } from './coding-kernel';
import { codingSemanticDigest } from './coding-semantic-digest';
import type { CodingKernelTaskContract } from './coding-task-contract';

export const CODING_CHECKPOINT_VERSION = 'devseek.coding-checkpoint/v1' as const;

export type CodingCheckpointReason = 'progress' | 'paused' | 'failed' | 'cancelled' | 'compaction';
export type CodingCheckpointEffectClass = 'read' | 'workspace-mutation' | 'external-effect' | 'verification';

export interface CodingCheckpointPendingUnitInput {
  readonly id: string;
  readonly description: string;
  readonly action?: string;
  readonly target?: string;
  /** Structured effect semantics. Omitted only by legacy v1 checkpoints. */
  readonly effectClass?: CodingCheckpointEffectClass;
  /** Exact logical operation identity required for effect-aware replay. */
  readonly operationSha256?: string;
}

export interface CodingCheckpointPendingUnit extends CodingCheckpointPendingUnitInput {
  readonly fingerprint: string;
}

export interface CodingCheckpoint {
  readonly version: typeof CODING_CHECKPOINT_VERSION;
  readonly checkpointId: string;
  readonly epoch: number;
  readonly originRunId: string;
  readonly originSurface: CodingKernelSurface;
  readonly workspaceRoot: string;
  readonly taskContractSha256: string;
  readonly contextGraphSha256: string;
  readonly memoryPolicySha256?: string;
  readonly completedUnitCount: number;
  readonly pendingUnits: readonly CodingCheckpointPendingUnit[];
  readonly evidenceRefs: readonly string[];
  readonly reason: CodingCheckpointReason;
  readonly createdAt: number;
  readonly parentCheckpointId?: string;
  readonly stateSha256: string;
  readonly sealSha256: string;
}

export interface CodingCheckpointRestoreDecision {
  readonly version: typeof CODING_CHECKPOINT_VERSION;
  readonly checkpointId: string;
  readonly originRunId: string;
  readonly completedUnitCount: number;
  readonly pendingUnits: readonly CodingCheckpointPendingUnit[];
  readonly evidenceRefs: readonly string[];
  readonly contextChanged: boolean;
  readonly memoryPolicyChanged: boolean;
  readonly requiresRevalidation: true;
}

export interface CodingCheckpointSessionPort {
  create(input: {
    readonly epoch: number;
    readonly completedUnitCount: number;
    readonly pendingUnits: readonly CodingCheckpointPendingUnitInput[];
    readonly reason: CodingCheckpointReason;
    readonly evidenceRefs?: readonly string[];
    readonly createdAt?: number;
    readonly parentCheckpointId?: string;
  }): CodingCheckpoint;
}

export interface CheckpointPort {
  bind(input: {
    readonly runId: string;
    readonly surface: CodingKernelSurface;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly memoryPolicySha256?: string;
  }): CodingCheckpointSessionPort;
  snapshot(checkpoint: CodingCheckpoint): CodingCheckpoint;
  restore(checkpoint: CodingCheckpoint, input: {
    readonly surface: CodingKernelSurface;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly memoryPolicySha256?: string;
  }): CodingCheckpointRestoreDecision;
}

/** Owns immutable checkpoint identity and resume binding; hosts only persist its receipt. */
export class CanonicalCheckpointService implements CheckpointPort {
  bind(input: {
    readonly runId: string;
    readonly surface: CodingKernelSurface;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly memoryPolicySha256?: string;
  }): CodingCheckpointSessionPort {
    const binding = snapshotBinding(input);
    return Object.freeze({
      create: (progress: Parameters<CodingCheckpointSessionPort['create']>[0]) => (
        createCheckpoint(binding, progress)
      ),
    });
  }

  snapshot(checkpoint: CodingCheckpoint): CodingCheckpoint {
    if (!checkpoint || typeof checkpoint !== 'object') checkpointFailure('invalid-checkpoint');
    if (checkpoint.version !== CODING_CHECKPOINT_VERSION) checkpointFailure('unsupported-version');
    const pendingUnits = checkpoint.pendingUnits?.map(snapshotPendingUnit) ?? checkpointFailure('invalid-pending-units');
    if (pendingUnits.length === 0) checkpointFailure('missing-pending-units');
    if (new Set(pendingUnits.map(unit => unit.id)).size !== pendingUnits.length) {
      checkpointFailure('duplicate-pending-unit');
    }
    const snapshot = checkpointPayload({
      checkpointId: requireText(checkpoint.checkpointId, 'missing-checkpoint-id'),
      epoch: positiveSafeInteger(checkpoint.epoch, 'invalid-epoch'),
      originRunId: requireText(checkpoint.originRunId, 'missing-origin-run-id'),
      originSurface: requireSurface(checkpoint.originSurface),
      workspaceRoot: normalizeRoot(requireText(checkpoint.workspaceRoot, 'missing-workspace-root')),
      taskContractSha256: requireSha256(checkpoint.taskContractSha256, 'invalid-task-contract-sha256'),
      contextGraphSha256: requireSha256(checkpoint.contextGraphSha256, 'invalid-context-graph-sha256'),
      ...(checkpoint.memoryPolicySha256
        ? { memoryPolicySha256: requireSha256(checkpoint.memoryPolicySha256, 'invalid-memory-policy-sha256') }
        : {}),
      completedUnitCount: nonNegativeSafeInteger(checkpoint.completedUnitCount, 'invalid-completed-unit-count'),
      pendingUnits,
      evidenceRefs: canonicalTextArray(checkpoint.evidenceRefs ?? [], 'invalid-evidence-ref'),
      reason: requireReason(checkpoint.reason),
      createdAt: nonNegativeSafeInteger(checkpoint.createdAt, 'invalid-created-at'),
      ...(checkpoint.parentCheckpointId?.trim()
        ? { parentCheckpointId: checkpoint.parentCheckpointId.trim() }
        : {}),
    });
    if (snapshot.checkpointId !== expectedCheckpointId(snapshot)) checkpointFailure('checkpoint-id-mismatch');
    const stateSha256 = codingSemanticDigest(snapshot);
    if (checkpoint.stateSha256 !== stateSha256) checkpointFailure('state-sha256-mismatch');
    const sealSha256 = checkpointSeal(stateSha256);
    if (checkpoint.sealSha256 !== sealSha256) checkpointFailure('seal-sha256-mismatch');
    return freezeCheckpoint({
      version: CODING_CHECKPOINT_VERSION,
      ...snapshot,
      stateSha256,
      sealSha256,
    });
  }

  restore(checkpoint: CodingCheckpoint, input: {
    readonly surface: CodingKernelSurface;
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly memoryPolicySha256?: string;
  }): CodingCheckpointRestoreDecision {
    const snapshot = this.snapshot(checkpoint);
    if (snapshot.originSurface !== requireSurface(input.surface)) checkpointFailure('surface-mismatch');
    if (snapshot.workspaceRoot !== normalizeRoot(requireText(input.workspaceRoot, 'missing-workspace-root'))) {
      checkpointFailure('workspace-mismatch');
    }
    if (snapshot.taskContractSha256 !== codingSemanticDigest(input.taskContract)) {
      checkpointFailure('task-contract-mismatch');
    }
    const contextChanged = snapshot.contextGraphSha256 !== codingSemanticDigest(input.contextGraph);
    const memoryPolicyChanged = (snapshot.memoryPolicySha256 ?? '') !== (input.memoryPolicySha256 ?? '');
    return Object.freeze({
      version: CODING_CHECKPOINT_VERSION,
      checkpointId: snapshot.checkpointId,
      originRunId: snapshot.originRunId,
      completedUnitCount: snapshot.completedUnitCount,
      pendingUnits: snapshot.pendingUnits,
      evidenceRefs: snapshot.evidenceRefs,
      contextChanged,
      memoryPolicyChanged,
      requiresRevalidation: true,
    });
  }
}

interface CheckpointBinding {
  readonly runId: string;
  readonly surface: CodingKernelSurface;
  readonly workspaceRoot: string;
  readonly taskContractSha256: string;
  readonly contextGraphSha256: string;
  readonly memoryPolicySha256?: string;
}

type CheckpointPayload = Omit<CodingCheckpoint, 'version' | 'stateSha256' | 'sealSha256'>;

function snapshotBinding(input: Parameters<CheckpointPort['bind']>[0]): CheckpointBinding {
  if (!input || typeof input !== 'object') checkpointFailure('invalid-binding');
  return Object.freeze({
    runId: requireText(input.runId, 'missing-origin-run-id'),
    surface: requireSurface(input.surface),
    workspaceRoot: normalizeRoot(requireText(input.workspaceRoot, 'missing-workspace-root')),
    taskContractSha256: codingSemanticDigest(input.taskContract),
    contextGraphSha256: codingSemanticDigest(input.contextGraph),
    ...(input.memoryPolicySha256
      ? { memoryPolicySha256: requireSha256(input.memoryPolicySha256, 'invalid-memory-policy-sha256') }
      : {}),
  });
}

function createCheckpoint(
  binding: CheckpointBinding,
  input: Parameters<CodingCheckpointSessionPort['create']>[0],
): CodingCheckpoint {
  if (!input || typeof input !== 'object') checkpointFailure('invalid-progress');
  const pendingUnits = input.pendingUnits?.map(createPendingUnit) ?? checkpointFailure('invalid-pending-units');
  if (pendingUnits.length === 0) checkpointFailure('missing-pending-units');
  if (new Set(pendingUnits.map(unit => unit.id)).size !== pendingUnits.length) {
    checkpointFailure('duplicate-pending-unit');
  }
  const base = {
    epoch: positiveSafeInteger(input.epoch, 'invalid-epoch'),
    originRunId: binding.runId,
    originSurface: binding.surface,
    workspaceRoot: binding.workspaceRoot,
    taskContractSha256: binding.taskContractSha256,
    contextGraphSha256: binding.contextGraphSha256,
    ...(binding.memoryPolicySha256 ? { memoryPolicySha256: binding.memoryPolicySha256 } : {}),
    completedUnitCount: nonNegativeSafeInteger(input.completedUnitCount, 'invalid-completed-unit-count'),
    pendingUnits,
    evidenceRefs: canonicalTextArray(input.evidenceRefs ?? [], 'invalid-evidence-ref'),
    reason: requireReason(input.reason),
    createdAt: nonNegativeSafeInteger(input.createdAt ?? Date.now(), 'invalid-created-at'),
    ...(input.parentCheckpointId?.trim() ? { parentCheckpointId: input.parentCheckpointId.trim() } : {}),
  };
  const checkpointId = `checkpoint-${codingSemanticDigest(base).slice(0, 24)}`;
  const payload = checkpointPayload({ checkpointId, ...base });
  const stateSha256 = codingSemanticDigest(payload);
  return freezeCheckpoint({
    version: CODING_CHECKPOINT_VERSION,
    ...payload,
    stateSha256,
    sealSha256: checkpointSeal(stateSha256),
  });
}

function checkpointPayload(payload: CheckpointPayload): CheckpointPayload {
  return Object.freeze({ ...payload });
}

function expectedCheckpointId(payload: CheckpointPayload): string {
  const { checkpointId: _checkpointId, ...base } = payload;
  return `checkpoint-${codingSemanticDigest(base).slice(0, 24)}`;
}

function createPendingUnit(input: CodingCheckpointPendingUnitInput): CodingCheckpointPendingUnit {
  if (!input || typeof input !== 'object') checkpointFailure('invalid-pending-unit');
  const unit = {
    id: requireText(input.id, 'missing-pending-unit-id'),
    description: requireText(input.description, 'missing-pending-unit-description'),
    ...(input.action?.trim() ? { action: input.action.trim() } : {}),
    ...(input.target?.trim() ? { target: input.target.trim() } : {}),
    ...(input.effectClass ? { effectClass: requireEffectClass(input.effectClass) } : {}),
    ...(input.operationSha256 ? {
      operationSha256: requireSha256(input.operationSha256, 'invalid-operation-sha256'),
    } : {}),
  };
  return Object.freeze({ ...unit, fingerprint: codingSemanticDigest(unit) });
}

function snapshotPendingUnit(input: CodingCheckpointPendingUnit): CodingCheckpointPendingUnit {
  const unit = createPendingUnit(input);
  if (input.fingerprint !== unit.fingerprint) checkpointFailure('pending-unit-fingerprint-mismatch');
  return unit;
}

function freezeCheckpoint(checkpoint: CodingCheckpoint): CodingCheckpoint {
  return Object.freeze({
    ...checkpoint,
    pendingUnits: Object.freeze([...checkpoint.pendingUnits]),
    evidenceRefs: Object.freeze([...checkpoint.evidenceRefs]),
  });
}

function checkpointSeal(stateSha256: string): string {
  return codingSemanticDigest({ protocol: CODING_CHECKPOINT_VERSION, stateSha256 });
}

function canonicalTextArray(value: unknown, reason: string): readonly string[] {
  if (!Array.isArray(value)) checkpointFailure(reason);
  return Object.freeze([...new Set(value.map(item => requireText(item, reason)))]);
}

function requireSurface(value: unknown): CodingKernelSurface {
  if (value !== 'vscode' && value !== 'cli' && value !== 'headless') checkpointFailure('invalid-surface');
  return value;
}

function requireReason(value: unknown): CodingCheckpointReason {
  if (!['progress', 'paused', 'failed', 'cancelled', 'compaction'].includes(String(value))) {
    checkpointFailure('invalid-reason');
  }
  return value as CodingCheckpointReason;
}

function requireEffectClass(value: unknown): CodingCheckpointEffectClass {
  if (value !== 'read' && value !== 'workspace-mutation' && value !== 'external-effect' && value !== 'verification') {
    checkpointFailure('invalid-effect-class');
  }
  return value;
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) checkpointFailure(reason);
  return value.trim();
}

function requireSha256(value: unknown, reason: string): string {
  const digest = requireText(value, reason);
  if (!/^[a-f0-9]{64}$/u.test(digest)) checkpointFailure(reason);
  return digest;
}

function positiveSafeInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) checkpointFailure(reason);
  return Number(value);
}

function nonNegativeSafeInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) checkpointFailure(reason);
  return Number(value);
}

function normalizeRoot(value: string): string { return value.trim().replace(/[/\\]+$/gu, ''); }
function checkpointFailure(reason: string): never { throw new Error(`coding-checkpoint:${reason}`); }
