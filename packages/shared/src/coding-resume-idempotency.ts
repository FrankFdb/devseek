import type {
  CodingCheckpointEffectClass,
  CodingCheckpointPendingUnit,
  CodingCheckpointRestoreDecision,
} from './coding-checkpoint';
import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_RESUME_IDEMPOTENCY_VERSION = 'devseek.coding-resume-idempotency/v1' as const;

export type CodingResumeEffectClass = CodingCheckpointEffectClass;
export type CodingResumeReceiptStatus = 'completed' | 'failed-no-effect' | 'indeterminate';
export type CodingResumeUnitDisposition = 'execute' | 'skip-completed' | 'block-indeterminate';

export interface CodingResumeOperationReceipt {
  readonly version: typeof CODING_RESUME_IDEMPOTENCY_VERSION;
  readonly checkpointId: string;
  readonly unitId: string;
  readonly unitFingerprint: string;
  readonly idempotencyKey: string;
  readonly effectClass: CodingResumeEffectClass;
  readonly status: CodingResumeReceiptStatus;
  readonly evidenceRefs: readonly string[];
  readonly receiptSha256: string;
}

export interface CodingResumeExecutionUnit extends CodingCheckpointPendingUnit {
  readonly effectClass: CodingResumeEffectClass;
  readonly idempotencyKey: string;
  readonly disposition: CodingResumeUnitDisposition;
}

export interface CodingResumeIdempotencyPlan {
  readonly version: typeof CODING_RESUME_IDEMPOTENCY_VERSION;
  readonly checkpointId: string;
  readonly originRunId: string;
  readonly completedUnitCount: number;
  readonly units: readonly CodingResumeExecutionUnit[];
  readonly executableUnits: readonly CodingResumeExecutionUnit[];
  readonly skippedUnits: readonly CodingResumeExecutionUnit[];
  readonly blockedUnits: readonly CodingResumeExecutionUnit[];
  readonly executionAllowed: boolean;
  readonly requiresRevalidation: true;
  readonly planSha256: string;
}

export interface CodingResumeIdempotencySessionPort {
  readonly plan: CodingResumeIdempotencyPlan;
  settle(input: {
    readonly unitId: string;
    readonly status: CodingResumeReceiptStatus;
    readonly evidenceRefs: readonly string[];
  }): CodingResumeOperationReceipt;
  receipts(): readonly CodingResumeOperationReceipt[];
}

export interface ResumeIdempotencyPort {
  bind(input: {
    readonly restore: CodingCheckpointRestoreDecision;
    readonly receipts?: readonly CodingResumeOperationReceipt[];
  }): CodingResumeIdempotencySessionPort;
  snapshotReceipt(receipt: CodingResumeOperationReceipt): CodingResumeOperationReceipt;
  snapshotPlan(plan: CodingResumeIdempotencyPlan): CodingResumeIdempotencyPlan;
}

/** Owns stable resume operation identity and fail-closed replay reconciliation. */
export class CanonicalResumeIdempotencyService implements ResumeIdempotencyPort {
  bind(input: Parameters<ResumeIdempotencyPort['bind']>[0]): CodingResumeIdempotencySessionPort {
    if (!input || typeof input !== 'object') resumeFailure('invalid-binding');
    const restore = snapshotRestore(input.restore);
    const priorReceipts = (input.receipts ?? []).map(receipt => this.snapshotReceipt(receipt));
    const receiptsByKey = new Map<string, CodingResumeOperationReceipt>();
    const allReceipts: CodingResumeOperationReceipt[] = [];
    for (const receipt of priorReceipts) {
      if (receipt.checkpointId !== restore.checkpointId) resumeFailure('receipt-checkpoint-mismatch');
      const existing = receiptsByKey.get(receipt.idempotencyKey);
      if (existing?.receiptSha256 === receipt.receiptSha256) continue;
      if (existing && existing.status !== 'failed-no-effect') {
        resumeFailure('invalid-operation-receipt-transition');
      }
      receiptsByKey.set(receipt.idempotencyKey, receipt);
      allReceipts.push(receipt);
    }
    const plan = createPlan(restore, receiptsByKey);

    return Object.freeze({
      plan,
      settle: (settleInput: Parameters<CodingResumeIdempotencySessionPort['settle']>[0]) => {
        if (!settleInput || typeof settleInput !== 'object') resumeFailure('invalid-settlement');
        if (!plan.executionAllowed) resumeFailure('execution-blocked');
        const unit = plan.executableUnits.find(item => item.id === settleInput.unitId);
        if (!unit) resumeFailure('unit-not-executable');
        const receipt = createReceipt(plan.checkpointId, unit, settleInput);
        const existing = receiptsByKey.get(receipt.idempotencyKey);
        if (existing) {
          if (existing.receiptSha256 === receipt.receiptSha256) return existing;
          if (existing.status !== 'failed-no-effect') {
            resumeFailure('invalid-operation-receipt-transition');
          }
        }
        receiptsByKey.set(receipt.idempotencyKey, receipt);
        allReceipts.push(receipt);
        return receipt;
      },
      receipts: () => Object.freeze([...allReceipts]),
    });
  }

  snapshotReceipt(receipt: CodingResumeOperationReceipt): CodingResumeOperationReceipt {
    if (!receipt || typeof receipt !== 'object') resumeFailure('invalid-receipt');
    if (receipt.version !== CODING_RESUME_IDEMPOTENCY_VERSION) resumeFailure('unsupported-version');
    const payload = {
      version: CODING_RESUME_IDEMPOTENCY_VERSION,
      checkpointId: requireText(receipt.checkpointId, 'missing-checkpoint-id'),
      unitId: requireText(receipt.unitId, 'missing-unit-id'),
      unitFingerprint: requireSha256(receipt.unitFingerprint, 'invalid-unit-fingerprint'),
      idempotencyKey: requireSha256(receipt.idempotencyKey, 'invalid-idempotency-key'),
      effectClass: requireEffectClass(receipt.effectClass),
      status: requireReceiptStatus(receipt.status),
      evidenceRefs: Object.freeze(uniqueText(receipt.evidenceRefs, 'invalid-evidence-ref')),
    };
    if (receipt.receiptSha256 !== codingSemanticDigest(payload)) resumeFailure('receipt-sha256-mismatch');
    return deepFreeze({ ...payload, receiptSha256: receipt.receiptSha256 });
  }

  snapshotPlan(plan: CodingResumeIdempotencyPlan): CodingResumeIdempotencyPlan {
    if (!plan || typeof plan !== 'object') resumeFailure('invalid-plan');
    if (plan.version !== CODING_RESUME_IDEMPOTENCY_VERSION) resumeFailure('unsupported-version');
    const units = (plan.units ?? []).map(snapshotExecutionUnit);
    const payload = planPayload({
      checkpointId: requireText(plan.checkpointId, 'missing-checkpoint-id'),
      originRunId: requireText(plan.originRunId, 'missing-origin-run-id'),
      completedUnitCount: nonNegativeInteger(plan.completedUnitCount, 'invalid-completed-unit-count'),
      units,
    });
    if (plan.requiresRevalidation !== true) resumeFailure('revalidation-required');
    if (plan.planSha256 !== codingSemanticDigest(payload)) resumeFailure('plan-sha256-mismatch');
    return freezePlan({ ...payload, planSha256: plan.planSha256 });
  }
}

function createPlan(
  restore: CodingCheckpointRestoreDecision,
  receiptsByKey: ReadonlyMap<string, CodingResumeOperationReceipt>,
): CodingResumeIdempotencyPlan {
  const units = restore.pendingUnits.map(unit => {
    const effectClass = classifyEffect(unit);
    const idempotencyKey = codingSemanticDigest({
      protocol: CODING_RESUME_IDEMPOTENCY_VERSION,
      checkpointId: restore.checkpointId,
      unitFingerprint: unit.fingerprint,
      effectClass,
    });
    const receipt = receiptsByKey.get(idempotencyKey);
    if (receipt && (
      receipt.unitId !== unit.id
      || receipt.unitFingerprint !== unit.fingerprint
      || receipt.effectClass !== effectClass
    )) {
      resumeFailure('receipt-unit-mismatch');
    }
    const disposition: CodingResumeUnitDisposition = receipt?.status === 'completed'
      ? 'skip-completed'
      : receipt?.status === 'indeterminate'
        ? 'block-indeterminate'
        : 'execute';
    return deepFreeze({ ...unit, effectClass, idempotencyKey, disposition });
  });
  const expectedKeys = new Set(units.map(unit => unit.idempotencyKey));
  if ([...receiptsByKey.keys()].some(key => !expectedKeys.has(key))) {
    resumeFailure('receipt-unit-mismatch');
  }
  const payload = planPayload({
    checkpointId: restore.checkpointId,
    originRunId: restore.originRunId,
    completedUnitCount: restore.completedUnitCount,
    units,
  });
  return freezePlan({ ...payload, planSha256: codingSemanticDigest(payload) });
}

function planPayload(input: {
  readonly checkpointId: string;
  readonly originRunId: string;
  readonly completedUnitCount: number;
  readonly units: readonly CodingResumeExecutionUnit[];
}): Omit<CodingResumeIdempotencyPlan, 'planSha256'> {
  const executableUnits = input.units.filter(unit => unit.disposition === 'execute');
  const skippedUnits = input.units.filter(unit => unit.disposition === 'skip-completed');
  const blockedUnits = input.units.filter(unit => unit.disposition === 'block-indeterminate');
  return deepFreeze({
    version: CODING_RESUME_IDEMPOTENCY_VERSION,
    checkpointId: input.checkpointId,
    originRunId: input.originRunId,
    completedUnitCount: input.completedUnitCount,
    units: Object.freeze([...input.units]),
    executableUnits: Object.freeze(executableUnits),
    skippedUnits: Object.freeze(skippedUnits),
    blockedUnits: Object.freeze(blockedUnits),
    executionAllowed: blockedUnits.length === 0,
    requiresRevalidation: true,
  });
}

function createReceipt(
  checkpointId: string,
  unit: CodingResumeExecutionUnit,
  input: Parameters<CodingResumeIdempotencySessionPort['settle']>[0],
): CodingResumeOperationReceipt {
  const payload = {
    version: CODING_RESUME_IDEMPOTENCY_VERSION,
    checkpointId,
    unitId: unit.id,
    unitFingerprint: unit.fingerprint,
    idempotencyKey: unit.idempotencyKey,
    effectClass: unit.effectClass,
    status: requireReceiptStatus(input.status),
    evidenceRefs: Object.freeze(uniqueText(input.evidenceRefs, 'invalid-evidence-ref')),
  };
  return deepFreeze({ ...payload, receiptSha256: codingSemanticDigest(payload) });
}

function snapshotRestore(restore: CodingCheckpointRestoreDecision): CodingCheckpointRestoreDecision {
  if (!restore || typeof restore !== 'object') resumeFailure('invalid-restore');
  if (!restore.checkpointId?.trim() || !restore.originRunId?.trim() || restore.requiresRevalidation !== true) {
    resumeFailure('invalid-restore');
  }
  const pendingUnits = (restore.pendingUnits ?? []).map(unit => {
    const snapshot = snapshotPendingUnit(unit);
    if (snapshot.fingerprint !== unit.fingerprint) resumeFailure('pending-unit-fingerprint-mismatch');
    return snapshot;
  });
  if (pendingUnits.length === 0 || new Set(pendingUnits.map(unit => unit.id)).size !== pendingUnits.length) {
    resumeFailure('invalid-pending-units');
  }
  return deepFreeze({
    ...restore,
    checkpointId: restore.checkpointId.trim(),
    originRunId: restore.originRunId.trim(),
    completedUnitCount: nonNegativeInteger(restore.completedUnitCount, 'invalid-completed-unit-count'),
    pendingUnits: Object.freeze(pendingUnits),
    evidenceRefs: Object.freeze(uniqueText(restore.evidenceRefs ?? [], 'invalid-evidence-ref')),
    contextChanged: Boolean(restore.contextChanged),
    memoryPolicyChanged: Boolean(restore.memoryPolicyChanged),
    requiresRevalidation: true,
  });
}

function snapshotPendingUnit(unit: CodingCheckpointPendingUnit): CodingCheckpointPendingUnit {
  if (!unit || typeof unit !== 'object') resumeFailure('invalid-pending-unit');
  const base = {
    id: requireText(unit.id, 'missing-unit-id'),
    description: requireText(unit.description, 'missing-unit-description'),
    ...(unit.action?.trim() ? { action: unit.action.trim() } : {}),
    ...(unit.target?.trim() ? { target: unit.target.trim() } : {}),
    ...(unit.effectClass ? { effectClass: requireEffectClass(unit.effectClass) } : {}),
    ...(unit.operationSha256 ? {
      operationSha256: requireSha256(unit.operationSha256, 'invalid-operation-sha256'),
    } : {}),
  };
  return Object.freeze({ ...base, fingerprint: codingSemanticDigest(base) });
}

function snapshotExecutionUnit(unit: CodingResumeExecutionUnit): CodingResumeExecutionUnit {
  const pending = snapshotPendingUnit(unit);
  if (pending.fingerprint !== unit.fingerprint) resumeFailure('pending-unit-fingerprint-mismatch');
  const effectClass = requireEffectClass(unit.effectClass);
  const idempotencyKey = requireSha256(unit.idempotencyKey, 'invalid-idempotency-key');
  const disposition = requireDisposition(unit.disposition);
  return deepFreeze({ ...pending, effectClass, idempotencyKey, disposition });
}

function classifyEffect(unit: CodingCheckpointPendingUnit): CodingResumeEffectClass {
  if (unit.effectClass) return requireEffectClass(unit.effectClass);
  // Compatibility only for checkpoints created before structured effectClass existed.
  const text = `${unit.action ?? ''} ${unit.description} ${unit.target ?? ''}`.toLowerCase();
  if (/\b(?:publish|deploy|release|upload|network|http|mcp|email|notify|external)\b/u.test(text)) {
    return 'external-effect';
  }
  if (/\b(?:write|edit|modify|create|delete|move|rename|mutation|patch)\b/u.test(text)) {
    return 'workspace-mutation';
  }
  if (/\b(?:verify|test|build|lint|review|check)\b/u.test(text)) return 'verification';
  return 'workspace-mutation';
}

function requireEffectClass(value: unknown): CodingResumeEffectClass {
  if (value !== 'read' && value !== 'workspace-mutation' && value !== 'external-effect' && value !== 'verification') {
    resumeFailure('invalid-effect-class');
  }
  return value;
}

function requireReceiptStatus(value: unknown): CodingResumeReceiptStatus {
  if (value !== 'completed' && value !== 'failed-no-effect' && value !== 'indeterminate') {
    resumeFailure('invalid-receipt-status');
  }
  return value;
}

function requireDisposition(value: unknown): CodingResumeUnitDisposition {
  if (value !== 'execute' && value !== 'skip-completed' && value !== 'block-indeterminate') {
    resumeFailure('invalid-disposition');
  }
  return value;
}

function freezePlan(plan: CodingResumeIdempotencyPlan): CodingResumeIdempotencyPlan {
  return deepFreeze({
    ...plan,
    units: Object.freeze([...plan.units]),
    executableUnits: Object.freeze([...plan.executableUnits]),
    skippedUnits: Object.freeze([...plan.skippedUnits]),
    blockedUnits: Object.freeze([...plan.blockedUnits]),
  });
}

function uniqueText(value: unknown, reason: string): string[] {
  if (!Array.isArray(value)) resumeFailure(reason);
  return [...new Set(value.map(item => requireText(item, reason)))];
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) resumeFailure(reason);
  return value.trim();
}

function requireSha256(value: unknown, reason: string): string {
  const text = requireText(value, reason).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) resumeFailure(reason);
  return text;
}

function nonNegativeInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) resumeFailure(reason);
  return Number(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function resumeFailure(reason: string): never {
  throw new Error(`coding-resume-idempotency:${reason}`);
}
